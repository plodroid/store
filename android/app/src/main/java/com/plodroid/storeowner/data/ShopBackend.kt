package com.plodroid.storeowner.data

import com.plodroid.storeowner.domain.Category
import com.plodroid.storeowner.domain.Feedback
import com.plodroid.storeowner.domain.Order
import com.plodroid.storeowner.domain.OrderStatus
import com.plodroid.storeowner.domain.OwnerNotice
import com.plodroid.storeowner.domain.OwnerSettings
import com.plodroid.storeowner.domain.PaymentStatus
import com.plodroid.storeowner.domain.Product
import com.plodroid.storeowner.domain.ProductPrivate
import com.plodroid.storeowner.domain.SiteSettings
import com.plodroid.storeowner.domain.ValidProduct
import kotlinx.coroutines.flow.Flow

/** Something that is still loading, has loaded, or couldn't load (with a plain-English reason). */
sealed class Loadable<out T> {
    data object Loading : Loadable<Nothing>()
    data class Ready<T>(val data: T) : Loadable<T>()
    data class Failed(val message: String) : Loadable<Nothing>()

    fun getOrNull(): T? = (this as? Ready<T>)?.data
}

/** A picture the owner picked, already checked and shrunk for upload. */
class PreparedImage(val bytes: ByteArray, val contentType: String)

/** How to treat products that are still inside a category being removed. */
sealed class CategoryRemoval {
    data class MoveTo(val categoryId: String?) : CategoryRemoval()   // null = no category
    data object ArchiveProducts : CategoryRemoval()
}

enum class DeleteOutcome { DELETED, ARCHIVED_INSTEAD }

/**
 * Everything the owner app can read or change.
 * Every write either finishes on the server or throws — nothing is reported as saved
 * while it only exists on the phone.
 */
interface ShopBackend {
    val isDemo: Boolean

    val products: Flow<Loadable<List<Product>>>
    val categories: Flow<Loadable<List<Category>>>
    val orders: Flow<Loadable<List<Order>>>
    val feedback: Flow<Loadable<List<Feedback>>>
    val notices: Flow<Loadable<List<OwnerNotice>>>
    val siteSettings: Flow<Loadable<SiteSettings>>
    val ownerSettings: Flow<Loadable<OwnerSettings>>

    suspend fun productPrivate(id: String): ProductPrivate
    /** Creates when [id] is null. Returns the product id. */
    suspend fun saveProduct(id: String?, p: ValidProduct, image: PreparedImage?, removeImage: Boolean): String
    suspend fun setStock(id: String, stock: Int)
    suspend fun setVisible(id: String, visible: Boolean)
    suspend fun setArchived(id: String, archived: Boolean)
    /** Deletes only if no order ever used it; otherwise archives so order history stays intact. */
    suspend fun deleteProduct(id: String): DeleteOutcome

    suspend fun saveCategory(id: String?, name: String, description: String, visible: Boolean, image: PreparedImage?, removeImage: Boolean): String
    suspend fun moveCategory(id: String, up: Boolean)
    suspend fun deleteCategory(id: String, removal: CategoryRemoval)

    suspend fun setOrderStatus(id: String, status: OrderStatus)
    suspend fun setPaymentStatus(id: String, status: PaymentStatus)
    suspend fun deleteTestOrder(id: String)

    suspend fun setFeedbackRead(id: String, read: Boolean)
    suspend fun setFeedbackArchived(id: String, archived: Boolean)

    suspend fun markNoticesRead(ids: List<String>)

    suspend fun saveSiteSettings(s: SiteSettings)
    suspend fun saveOwnerSettings(s: OwnerSettings)
}
