package com.plodroid.storeowner.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import com.plodroid.storeowner.domain.Address
import com.plodroid.storeowner.domain.Category
import com.plodroid.storeowner.domain.Feedback
import com.plodroid.storeowner.domain.Order
import com.plodroid.storeowner.domain.OrderItem
import com.plodroid.storeowner.domain.OrderStatus
import com.plodroid.storeowner.domain.OwnerNotice
import com.plodroid.storeowner.domain.OwnerSettings
import com.plodroid.storeowner.domain.PaymentStatus
import com.plodroid.storeowner.domain.Product
import com.plodroid.storeowner.domain.ProductPrivate
import com.plodroid.storeowner.domain.SiteSettings
import com.plodroid.storeowner.domain.ValidProduct
import com.plodroid.storeowner.domain.Money
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout

/**
 * Live shop data in Cloud Firestore + photos in Cloud Storage.
 *
 * Every change runs as a server transaction (which can't complete offline) and is
 * awaited, so the app only says "Saved" after the server has accepted it.
 */
class FirebaseShop(private val net: NetworkMonitor) : ShopBackend {
    override val isDemo = false

    private val db = FirebaseFirestore.getInstance()
    private val storage by lazy { FirebaseStorage.getInstance() }

    private val productsCol = db.collection("products")
    private val privateCol = db.collection("productPrivate")
    private val categoriesCol = db.collection("categories")
    private val ordersCol = db.collection("orders")
    private val feedbackCol = db.collection("feedback")
    private val noticesCol = db.collection("notifications")
    private val siteDoc = db.collection("settings").document("site")
    private val ownerDoc = db.collection("settings").document("owner")

    /* ── reading ─────────────────────────────────────────── */

    private fun <T> listen(q: Query, map: (DocumentSnapshot) -> T): Flow<Loadable<List<T>>> = callbackFlow {
        trySend(Loadable.Loading)
        val reg = q.addSnapshotListener { snap, err ->
            if (err != null) trySend(Loadable.Failed(friendlyMessage(err)))
            else if (snap != null) trySend(Loadable.Ready(snap.documents.mapNotNull { d -> runCatching { map(d) }.getOrNull() }))
        }
        awaitClose { reg.remove() }
    }

    private fun <T> listenDoc(ref: DocumentReference, map: (DocumentSnapshot) -> T): Flow<Loadable<T>> = callbackFlow {
        trySend(Loadable.Loading)
        val reg = ref.addSnapshotListener { snap, err ->
            if (err != null) trySend(Loadable.Failed(friendlyMessage(err)))
            else if (snap != null) trySend(Loadable.Ready(map(snap)))
        }
        awaitClose { reg.remove() }
    }

    override val products = listen(productsCol) { toProduct(it) }
    override val categories = listen(categoriesCol) { toCategory(it) }
    override val orders = listen(ordersCol.orderBy("createdAt", Query.Direction.DESCENDING).limit(500)) { toOrder(it) }
    override val feedback = listen(feedbackCol.orderBy("createdAt", Query.Direction.DESCENDING).limit(300)) { toFeedback(it) }
    override val notices = listen(noticesCol.orderBy("createdAt", Query.Direction.DESCENDING).limit(100)) { toNotice(it) }
    override val siteSettings = listenDoc(siteDoc) { toSite(it) }
    override val ownerSettings = listenDoc(ownerDoc) { toOwnerSettings(it) }

    override suspend fun productPrivate(id: String): ProductPrivate {
        val d = privateCol.document(id).get().await()
        if (!d.exists()) return ProductPrivate()
        return ProductPrivate(costPrice = d.dbl("costPrice"), sku = d.str("sku"), barcode = d.str("barcode"))
    }

    /* ── writing ─────────────────────────────────────────── */

    private suspend fun <T> write(block: suspend () -> T): T {
        net.requireOnline()
        return withTimeout(45_000) { block() }
    }

    private fun gone() = FirebaseFirestoreException("This item no longer exists.", FirebaseFirestoreException.Code.NOT_FOUND)

    private suspend fun upload(folder: String, ownerId: String, image: PreparedImage): Pair<String, String> {
        val path = "$folder/$ownerId/${System.currentTimeMillis()}.jpg"
        val ref = storage.reference.child(path)
        ref.putBytes(image.bytes, StorageMetadata.Builder().setContentType(image.contentType).build()).await()
        return path to ref.downloadUrl.await().toString()
    }

    private fun deleteFileQuietly(path: String?) {
        if (path.isNullOrBlank()) return
        runCatching { storage.reference.child(path).delete() }
    }

    override suspend fun saveProduct(id: String?, p: ValidProduct, image: PreparedImage?, removeImage: Boolean): String = write {
        val ref = if (id == null) productsCol.document() else productsCol.document(id)
        val uploaded = image?.let { upload("product-images", ref.id, it) }
        var oldPath: String? = null
        try {
            db.runTransaction<Unit> { tx ->
                val cur = tx.get(ref)
                if (id != null && !cur.exists()) throw gone()
                oldPath = cur.get("imagePath") as? String
                val data = hashMapOf<String, Any?>(
                    "name" to p.name,
                    "price" to p.price,
                    "stock" to p.stock,
                    "categoryId" to p.categoryId,
                    "description" to p.description,
                    "unit" to p.unit,
                    "visible" to p.visible,
                    "featured" to p.featured,
                    "lowStockThreshold" to p.lowStockThreshold,
                    "updatedAt" to FieldValue.serverTimestamp(),
                )
                if (!cur.exists()) {
                    data["createdAt"] = FieldValue.serverTimestamp()
                    data["archived"] = false
                    data["sortOrder"] = 0
                }
                if (uploaded != null) { data["imagePath"] = uploaded.first; data["image"] = uploaded.second }
                else if (removeImage) { data["imagePath"] = null; data["image"] = null }
                tx.set(ref, data, SetOptions.merge())
                tx.set(
                    privateCol.document(ref.id),
                    hashMapOf<String, Any?>(
                        "costPrice" to p.private.costPrice,
                        "sku" to p.private.sku,
                        "barcode" to p.private.barcode,
                        "updatedAt" to FieldValue.serverTimestamp(),
                    ),
                )
                Unit
            }.await()
        } catch (e: Exception) {
            deleteFileQuietly(uploaded?.first)   // don't leave an orphaned photo behind
            throw e
        }
        if ((uploaded != null || removeImage) && oldPath != uploaded?.first) deleteFileQuietly(oldPath)
        ref.id
    }

    private suspend fun updateProduct(id: String, fields: Map<String, Any>) = write {
        val ref = productsCol.document(id)
        db.runTransaction<Unit> { tx ->
            if (!tx.get(ref).exists()) throw gone()
            tx.update(ref, fields + ("updatedAt" to FieldValue.serverTimestamp()))
            Unit
        }.await()
    }

    override suspend fun setStock(id: String, stock: Int) {
        if (stock < 0) throw UserFacingException("Stock can't go below zero.")
        updateProduct(id, mapOf("stock" to stock))
    }

    override suspend fun setVisible(id: String, visible: Boolean) = updateProduct(id, mapOf("visible" to visible))

    override suspend fun setArchived(id: String, archived: Boolean) = updateProduct(id, mapOf("archived" to archived))

    override suspend fun deleteProduct(id: String): DeleteOutcome = write {
        val used = ordersCol.whereArrayContains("productIds", id).limit(1).get().await()
        if (!used.isEmpty) {
            updateProduct(id, mapOf("archived" to true))
            return@write DeleteOutcome.ARCHIVED_INSTEAD
        }
        val ref = productsCol.document(id)
        val path = db.runTransaction<String?> { tx ->
            val cur = tx.get(ref)
            if (!cur.exists()) throw gone()
            tx.delete(ref)
            tx.delete(privateCol.document(id))
            cur.get("imagePath") as? String
        }.await()
        deleteFileQuietly(path)
        DeleteOutcome.DELETED
    }

    override suspend fun saveCategory(id: String?, name: String, description: String, visible: Boolean, image: PreparedImage?, removeImage: Boolean): String = write {
        val ref = if (id == null) categoriesCol.document() else categoriesCol.document(id)
        val nextOrder = if (id == null) {
            val last = categoriesCol.orderBy("sortOrder", Query.Direction.DESCENDING).limit(1).get().await()
            ((last.documents.firstOrNull()?.long("sortOrder") ?: -1L) + 1).toInt()
        } else 0
        val uploaded = image?.let { upload("category-images", ref.id, it) }
        var oldPath: String? = null
        try {
            db.runTransaction<Unit> { tx ->
                val cur = tx.get(ref)
                if (id != null && !cur.exists()) throw gone()
                oldPath = cur.get("imagePath") as? String
                val data = hashMapOf<String, Any?>(
                    "name" to name.trim(),
                    "description" to description.trim(),
                    "visible" to visible,
                    "updatedAt" to FieldValue.serverTimestamp(),
                )
                if (!cur.exists()) {
                    data["createdAt"] = FieldValue.serverTimestamp()
                    data["sortOrder"] = nextOrder
                }
                if (uploaded != null) { data["imagePath"] = uploaded.first; data["image"] = uploaded.second }
                else if (removeImage) { data["imagePath"] = null; data["image"] = null }
                tx.set(ref, data, SetOptions.merge())
                Unit
            }.await()
        } catch (e: Exception) {
            deleteFileQuietly(uploaded?.first)
            throw e
        }
        if ((uploaded != null || removeImage) && oldPath != uploaded?.first) deleteFileQuietly(oldPath)
        ref.id
    }

    override suspend fun moveCategory(id: String, up: Boolean) = write {
        val all = categoriesCol.get().await().documents
            .map { it.reference to (it.long("sortOrder") ?: 0L) }
            .sortedWith(compareBy({ it.second }, { it.first.id }))
            .map { it.first }
            .toMutableList()
        val i = all.indexOfFirst { it.id == id }
        val j = if (up) i - 1 else i + 1
        if (i < 0 || j !in all.indices) return@write
        val tmp = all[i]; all[i] = all[j]; all[j] = tmp
        db.runTransaction<Unit> { tx ->
            val snaps = all.map { tx.get(it) }
            snaps.forEachIndexed { idx, s ->
                if (s.exists() && s.long("sortOrder") != idx.toLong()) {
                    tx.update(s.reference, mapOf("sortOrder" to idx, "updatedAt" to FieldValue.serverTimestamp()))
                }
            }
            Unit
        }.await()
    }

    override suspend fun deleteCategory(id: String, removal: CategoryRemoval) = write {
        val catRef = categoriesCol.document(id)
        val inside = productsCol.whereEqualTo("categoryId", id).get().await().documents.map { it.reference }
        if (removal is CategoryRemoval.MoveTo && removal.categoryId == id) throw UserFacingException("Pick a different category to move the products to.")
        val path = db.runTransaction<String?> { tx ->
            val cat = tx.get(catRef)
            if (!cat.exists()) throw gone()
            val target = (removal as? CategoryRemoval.MoveTo)?.categoryId
            if (target != null && !tx.get(categoriesCol.document(target)).exists()) {
                throw UserFacingException("The category you chose to move products into no longer exists.")
            }
            val prods = inside.map { tx.get(it) }
            prods.filter { it.exists() }.forEach { s ->
                val change: Map<String, Any?> = when (removal) {
                    is CategoryRemoval.MoveTo -> mapOf("categoryId" to removal.categoryId)
                    CategoryRemoval.ArchiveProducts -> mapOf("archived" to true, "categoryId" to null)
                }
                tx.set(s.reference, change + ("updatedAt" to FieldValue.serverTimestamp()), SetOptions.merge())
            }
            tx.delete(catRef)
            cat.get("imagePath") as? String
        }.await()
        deleteFileQuietly(path)
    }

    override suspend fun setOrderStatus(id: String, status: OrderStatus) = write {
        val ref = ordersCol.document(id)
        db.runTransaction<Unit> { tx ->
            val cur = tx.get(ref)
            if (!cur.exists()) throw gone()
            if (cur.getString("status") == "cancelled") throw UserFacingException("This order was cancelled, so it can't be changed.")
            tx.update(ref, mapOf("status" to status.key, "updatedAt" to FieldValue.serverTimestamp()))
            Unit
        }.await()
    }

    override suspend fun setPaymentStatus(id: String, status: PaymentStatus) = write {
        if (status == PaymentStatus.MOCK) throw UserFacingException("Only test orders use the test payment status.")
        val ref = ordersCol.document(id)
        db.runTransaction<Unit> { tx ->
            val cur = tx.get(ref)
            if (!cur.exists()) throw gone()
            if (cur.getBoolean("isTest") == true) throw UserFacingException("Test orders never take payment, so their payment status can't be changed.")
            if (cur.getString("status") == "cancelled") throw UserFacingException("This order was cancelled, so it can't be changed.")
            tx.update(ref, mapOf("paymentStatus" to status.key, "updatedAt" to FieldValue.serverTimestamp()))
            Unit
        }.await()
    }

    override suspend fun deleteTestOrder(id: String) = write {
        val ref = ordersCol.document(id)
        db.runTransaction<Unit> { tx ->
            val cur = tx.get(ref)
            if (!cur.exists()) throw gone()
            if (cur.getBoolean("isTest") != true || cur.getString("status") != "cancelled") {
                throw UserFacingException("Only cancelled test orders can be deleted. Real orders are kept for your records.")
            }
            tx.delete(ref)
            Unit
        }.await()
    }

    override suspend fun setFeedbackRead(id: String, read: Boolean) = write {
        feedbackCol.document(id).update("read", read).await(); Unit
    }

    override suspend fun setFeedbackArchived(id: String, archived: Boolean) = write {
        feedbackCol.document(id).update(mapOf("archived" to archived, "read" to true)).await(); Unit
    }

    override suspend fun markNoticesRead(ids: List<String>) = write {
        if (ids.isEmpty()) return@write
        ids.chunked(400).forEach { chunk ->
            val batch = db.batch()
            chunk.forEach { batch.update(noticesCol.document(it), "read", true) }
            batch.commit().await()
        }
    }

    override suspend fun saveSiteSettings(s: SiteSettings) = write {
        siteDoc.set(
            hashMapOf<String, Any?>(
                "storeName" to s.storeName.trim(),
                "heroTitle" to s.heroTitle.trim(),
                "heroSubtitle" to s.heroSubtitle.trim(),
                "announcement" to s.announcement.trim(),
                "whatsapp" to s.whatsapp.trim(),
                "collection" to s.collection,
                "delivery" to s.delivery,
                "deliveryFee" to s.deliveryFee,
                "currency" to "GBP",
                "updatedAt" to FieldValue.serverTimestamp(),
            ),
            SetOptions.merge(),
        ).await(); Unit
    }

    override suspend fun saveOwnerSettings(s: OwnerSettings) = write {
        ownerDoc.set(
            hashMapOf<String, Any?>(
                "defaultLowStock" to s.defaultLowStock,
                "notify" to mapOf("orders" to s.notifyOrders, "feedback" to s.notifyFeedback, "stock" to s.notifyStock),
                "updatedAt" to FieldValue.serverTimestamp(),
            ),
        ).await(); Unit
    }

    /* ── mapping (defensive: bad fields never crash the app) ─ */

    companion object {
        fun DocumentSnapshot.str(k: String): String = get(k) as? String ?: ""
        fun DocumentSnapshot.long(k: String): Long? = (get(k) as? Number)?.toLong()
        fun DocumentSnapshot.dbl(k: String): Double? = (get(k) as? Number)?.toDouble()
        fun DocumentSnapshot.bool(k: String, def: Boolean): Boolean = get(k) as? Boolean ?: def
        fun DocumentSnapshot.ms(k: String): Long? = (get(k) as? Timestamp)?.toDate()?.time
        private fun Map<*, *>.s(k: String): String = this[k] as? String ?: ""
        private fun Map<*, *>.d(k: String): Double = (this[k] as? Number)?.toDouble() ?: 0.0

        fun toProduct(d: DocumentSnapshot) = Product(
            id = d.id,
            name = d.str("name"),
            price = d.dbl("price") ?: 0.0,
            stock = (d.long("stock") ?: 0L).toInt(),
            categoryId = (d.get("categoryId") as? String)?.ifBlank { null },
            image = (d.get("image") as? String)?.ifBlank { null },
            imagePath = d.get("imagePath") as? String,
            description = d.str("description"),
            unit = (d.get("unit") as? String)?.ifBlank { null },
            visible = d.bool("visible", d.bool("active", true)),
            archived = d.bool("archived", false),
            featured = d.bool("featured", false),
            sortOrder = (d.long("sortOrder") ?: 0L).toInt(),
            lowStockThreshold = d.long("lowStockThreshold")?.toInt(),
            createdAt = d.ms("createdAt"),
            updatedAt = d.ms("updatedAt"),
        )

        fun toCategory(d: DocumentSnapshot) = Category(
            id = d.id,
            name = d.str("name"),
            description = d.str("description"),
            image = (d.get("image") as? String)?.ifBlank { null },
            imagePath = d.get("imagePath") as? String,
            sortOrder = (d.long("sortOrder") ?: 0L).toInt(),
            visible = d.bool("visible", true),
        )

        fun toOrder(d: DocumentSnapshot): Order {
            val items = (d.get("items") as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }.map { m ->
                OrderItem(
                    productId = m.s("productId"),
                    name = m.s("name"),
                    unit = (m["unit"] as? String)?.ifBlank { null },
                    qty = ((m["qty"] as? Number)?.toInt() ?: 0),
                    unitPrice = m.d("unitPrice"),
                    lineTotal = m.d("lineTotal"),
                )
            }
            val customer = d.get("customer") as? Map<*, *>
            val addr = d.get("address") as? Map<*, *>
            val total = d.dbl("total") ?: 0.0
            return Order(
                id = d.id,
                ref = d.str("ref").ifBlank { d.id.take(8) },
                status = OrderStatus.of(d.get("status") as? String),
                payment = PaymentStatus.of(d.get("paymentStatus") as? String),
                isTest = d.bool("isTest", false),
                items = items,
                subtotal = d.dbl("subtotal") ?: total,
                deliveryFee = d.dbl("deliveryFee") ?: 0.0,
                total = total,
                totalPence = d.long("totalPence") ?: Money.pence(total),
                fulfilment = d.str("fulfilment").ifBlank { "collection" },
                customerName = customer?.s("name").orEmpty(),
                phone = customer?.s("phone").orEmpty(),
                email = customer?.s("email").orEmpty(),
                address = addr?.let { Address(it.s("line1"), it.s("line2"), it.s("city"), it.s("postcode")) },
                note = d.str("note"),
                createdAt = d.ms("createdAt"),
                updatedAt = d.ms("updatedAt"),
            )
        }

        fun toFeedback(d: DocumentSnapshot) = Feedback(
            id = d.id,
            name = d.str("name"),
            orderRef = (d.get("orderRef") as? String)?.ifBlank { null },
            orderId = (d.get("orderId") as? String)?.ifBlank { null },
            rating = d.long("rating")?.toInt()?.takeIf { it in 1..5 },
            message = d.str("message"),
            createdAt = d.ms("createdAt"),
            read = d.bool("read", false),
            archived = d.bool("archived", false),
        )

        fun toNotice(d: DocumentSnapshot) = OwnerNotice(
            id = d.id,
            type = d.str("type"),
            title = d.str("title"),
            body = d.str("body"),
            refId = (d.get("refId") as? String)?.ifBlank { null },
            read = d.bool("read", false),
            createdAt = d.ms("createdAt"),
        )

        fun toSite(d: DocumentSnapshot): SiteSettings = if (!d.exists()) SiteSettings() else SiteSettings(
            storeName = d.str("storeName").ifBlank { "Plodroid Store" },
            heroTitle = d.str("heroTitle"),
            heroSubtitle = d.str("heroSubtitle"),
            announcement = d.str("announcement"),
            whatsapp = d.str("whatsapp"),
            collection = d.bool("collection", true),
            delivery = d.bool("delivery", false),
            deliveryFee = d.dbl("deliveryFee") ?: 0.0,
        )

        fun toOwnerSettings(d: DocumentSnapshot): OwnerSettings {
            if (!d.exists()) return OwnerSettings()
            val n = d.get("notify") as? Map<*, *>
            return OwnerSettings(
                defaultLowStock = (d.long("defaultLowStock") ?: 5L).toInt(),
                notifyOrders = n?.get("orders") as? Boolean ?: true,
                notifyFeedback = n?.get("feedback") as? Boolean ?: true,
                notifyStock = n?.get("stock") as? Boolean ?: true,
            )
        }
    }
}
