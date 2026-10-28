package com.plodroid.storeowner.data

import com.plodroid.storeowner.domain.Address
import com.plodroid.storeowner.domain.Category
import com.plodroid.storeowner.domain.Feedback
import com.plodroid.storeowner.domain.Money
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.util.UUID

/**
 * DEMO MODE — sample data kept in memory on this phone only, so the app can be explored
 * before a Firebase project exists. Nothing reaches the website and everything resets
 * when the app closes. Every demo order is a test order, so money figures stay at £0.
 */
class DemoShop : ShopBackend {
    override val isDemo = true

    private val now = System.currentTimeMillis()
    private val hour = 60 * 60 * 1000L

    private val cats = MutableStateFlow(
        listOf(
            Category("d-c1", "Drinks", "Juices, water and soft drinks", sortOrder = 0),
            Category("d-c2", "Snacks", "Bars, nuts and treats", sortOrder = 1),
        )
    )
    private val prods = MutableStateFlow(
        listOf(
            Product("d-p1", "Sparkling Water 500ml", 0.85, 40, "d-c1", unit = "bottle", createdAt = now - 90 * hour, updatedAt = now - 3 * hour),
            Product("d-p2", "Apple Juice 1L", 1.95, 4, "d-c1", lowStockThreshold = 5, createdAt = now - 80 * hour, updatedAt = now - 5 * hour),
            Product("d-p3", "Almond Bar", 1.20, 0, "d-c2", createdAt = now - 70 * hour, updatedAt = now - 2 * hour),
            Product("d-p4", "Mixed Nuts 200g", 2.80, 15, "d-c2", featured = true, createdAt = now - 60 * hour, updatedAt = now - 9 * hour),
            Product("d-p5", "Seasonal Gift Box", 12.00, 6, null, visible = false, description = "Not on the website yet.", createdAt = now - 20 * hour, updatedAt = now - 20 * hour),
        )
    )
    private val priv = HashMap<String, ProductPrivate>()

    private fun demoOrder(id: String, hoursAgo: Long, status: OrderStatus, lines: List<Pair<String, Int>>, delivery: Boolean = false): Order {
        val items = lines.map { (pid, qty) ->
            val p = prods.value.first { it.id == pid }
            OrderItem(pid, p.name, p.unit, qty, p.price, Money.pence(p.price) * qty / 100.0)
        }
        val sub = items.sumOf { Money.pence(it.lineTotal) }
        val fee = if (delivery) 250L else 0L
        return Order(
            id, "PS-DEMO${id.takeLast(2)}", status, PaymentStatus.MOCK, isTest = true, items = items,
            subtotal = sub / 100.0, deliveryFee = fee / 100.0, total = (sub + fee) / 100.0, totalPence = sub + fee,
            fulfilment = if (delivery) "delivery" else "collection", customerName = "Sample Customer",
            phone = "07700 900000", email = "sample@example.com",
            address = if (delivery) Address("1 Sample Street", "", "Sampletown", "AB1 2CD") else null,
            note = "This is demo data.", createdAt = now - hoursAgo * hour, updatedAt = now - hoursAgo * hour,
        )
    }

    private val ords = MutableStateFlow(
        listOf(
            demoOrder("dm01", 1, OrderStatus.NEW, listOf("d-p1" to 6, "d-p4" to 1)),
            demoOrder("dm02", 26, OrderStatus.PREPARING, listOf("d-p2" to 2), delivery = true),
            demoOrder("dm03", 50, OrderStatus.COMPLETED, listOf("d-p3" to 3)),
        )
    )
    private val fb = MutableStateFlow(
        listOf(
            Feedback("d-f1", "Sample Customer", "PS-DEMO01", "dm01", 5, "Demo message: quick and friendly, thank you!", now - 2 * hour, read = false, archived = false),
            Feedback("d-f2", "", null, null, 3, "Demo message: it would be great to have more snacks.", now - 30 * hour, read = true, archived = false),
        )
    )
    private val ntc = MutableStateFlow(
        listOf(
            OwnerNotice("d-n1", "order", "New order PS-DEMO01", "7 items · £7.90 · Collection · test order", "dm01", false, now - hour),
            OwnerNotice("d-n2", "stock", "Out of stock", "Almond Bar has sold out and is no longer orderable.", "d-p3", false, now - 2 * hour),
            OwnerNotice("d-n3", "feedback", "New customer feedback", "5★ rating · tap to read", "d-f1", true, now - 2 * hour),
        )
    )
    private val site = MutableStateFlow(SiteSettings(storeName = "Demo Shop"))
    private val owner = MutableStateFlow(OwnerSettings())

    override val products: Flow<Loadable<List<Product>>> = prods.map { Loadable.Ready(it) }
    override val categories: Flow<Loadable<List<Category>>> = cats.map { Loadable.Ready(it.sortedBy { c -> c.sortOrder }) }
    override val orders: Flow<Loadable<List<Order>>> = ords.map { Loadable.Ready(it.sortedByDescending { o -> o.createdAt ?: 0L }) }
    override val feedback: Flow<Loadable<List<Feedback>>> = fb.map { Loadable.Ready(it) }
    override val notices: Flow<Loadable<List<OwnerNotice>>> = ntc.map { Loadable.Ready(it) }
    override val siteSettings: Flow<Loadable<SiteSettings>> = site.map { Loadable.Ready(it) }
    override val ownerSettings: Flow<Loadable<OwnerSettings>> = owner.map { Loadable.Ready(it) }

    private suspend fun pause() = delay(300)
    private fun t() = System.currentTimeMillis()

    override suspend fun productPrivate(id: String) = priv[id] ?: ProductPrivate()

    override suspend fun saveProduct(id: String?, p: ValidProduct, image: PreparedImage?, removeImage: Boolean): String {
        pause()
        val newId = id ?: "d-p" + UUID.randomUUID().toString().take(6)
        // Demo can't host photos; a picked photo is acknowledged but not stored.
        prods.update { list ->
            val old = list.firstOrNull { it.id == newId }
            val next = Product(
                id = newId, name = p.name, price = p.price, stock = p.stock, categoryId = p.categoryId,
                image = if (removeImage) null else old?.image, description = p.description, unit = p.unit,
                visible = p.visible, archived = old?.archived ?: false, featured = p.featured,
                lowStockThreshold = p.lowStockThreshold, createdAt = old?.createdAt ?: t(), updatedAt = t(),
            )
            if (old == null) list + next else list.map { if (it.id == newId) next else it }
        }
        priv[newId] = p.private
        return newId
    }

    private fun editProduct(id: String, f: (Product) -> Product) {
        prods.update { list -> list.map { if (it.id == id) f(it).copy(updatedAt = t()) else it } }
    }

    override suspend fun setStock(id: String, stock: Int) { pause(); editProduct(id) { it.copy(stock = stock) } }
    override suspend fun setVisible(id: String, visible: Boolean) { pause(); editProduct(id) { it.copy(visible = visible) } }
    override suspend fun setArchived(id: String, archived: Boolean) { pause(); editProduct(id) { it.copy(archived = archived) } }

    override suspend fun deleteProduct(id: String): DeleteOutcome {
        pause()
        if (ords.value.any { o -> o.items.any { it.productId == id } }) {
            editProduct(id) { it.copy(archived = true) }
            return DeleteOutcome.ARCHIVED_INSTEAD
        }
        prods.update { list -> list.filterNot { it.id == id } }
        return DeleteOutcome.DELETED
    }

    override suspend fun saveCategory(id: String?, name: String, description: String, visible: Boolean, image: PreparedImage?, removeImage: Boolean): String {
        pause()
        val newId = id ?: "d-c" + UUID.randomUUID().toString().take(6)
        cats.update { list ->
            val old = list.firstOrNull { it.id == newId }
            val next = Category(newId, name.trim(), description.trim(), if (removeImage) null else old?.image, null, old?.sortOrder ?: ((list.maxOfOrNull { it.sortOrder } ?: -1) + 1), visible)
            if (old == null) list + next else list.map { if (it.id == newId) next else it }
        }
        return newId
    }

    override suspend fun moveCategory(id: String, up: Boolean) {
        pause()
        cats.update { list ->
            val sorted = list.sortedBy { it.sortOrder }.toMutableList()
            val i = sorted.indexOfFirst { it.id == id }
            val j = if (up) i - 1 else i + 1
            if (i >= 0 && j in sorted.indices) { val tmp = sorted[i]; sorted[i] = sorted[j]; sorted[j] = tmp }
            sorted.mapIndexed { idx, c -> c.copy(sortOrder = idx) }
        }
    }

    override suspend fun deleteCategory(id: String, removal: CategoryRemoval) {
        pause()
        prods.update { list ->
            list.map {
                if (it.categoryId != id) it else when (removal) {
                    is CategoryRemoval.MoveTo -> it.copy(categoryId = removal.categoryId, updatedAt = t())
                    CategoryRemoval.ArchiveProducts -> it.copy(archived = true, categoryId = null, updatedAt = t())
                }
            }
        }
        cats.update { list -> list.filterNot { it.id == id } }
    }

    override suspend fun setOrderStatus(id: String, status: OrderStatus) {
        pause()
        val o = ords.value.firstOrNull { it.id == id } ?: throw UserFacingException("That order no longer exists.")
        if (o.status == OrderStatus.CANCELLED) throw UserFacingException("This order was cancelled, so it can't be changed.")
        if (status == OrderStatus.CANCELLED) {   // mirror the server: cancelling restocks
            o.items.forEach { line -> editProduct(line.productId) { it.copy(stock = it.stock + line.qty) } }
        }
        ords.update { list -> list.map { if (it.id == id) it.copy(status = status, updatedAt = t()) else it } }
    }

    override suspend fun setPaymentStatus(id: String, status: PaymentStatus) {
        pause()
        throw UserFacingException("Test orders never take payment, so their payment status can't be changed.")
    }

    override suspend fun deleteTestOrder(id: String) {
        pause()
        ords.update { list -> list.filterNot { it.id == id && it.isTest && it.status == OrderStatus.CANCELLED } }
    }

    override suspend fun setFeedbackRead(id: String, read: Boolean) { fb.update { l -> l.map { if (it.id == id) it.copy(read = read) else it } } }
    override suspend fun setFeedbackArchived(id: String, archived: Boolean) { pause(); fb.update { l -> l.map { if (it.id == id) it.copy(archived = archived, read = true) else it } } }
    override suspend fun markNoticesRead(ids: List<String>) { ntc.update { l -> l.map { if (it.id in ids) it.copy(read = true) else it } } }
    override suspend fun saveSiteSettings(s: SiteSettings) { pause(); site.value = s }
    override suspend fun saveOwnerSettings(s: OwnerSettings) { pause(); owner.value = s }
}
