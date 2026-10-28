package com.plodroid.storeowner.domain

import java.util.Locale

/* Plain data the whole app works with. No Android or Firebase types here,
   so the business rules can be unit-tested on any JVM. */

data class Category(
    val id: String,
    val name: String,
    val description: String = "",
    val image: String? = null,
    val imagePath: String? = null,
    val sortOrder: Int = 0,
    val visible: Boolean = true,
)

enum class StockLevel { OK, LOW, OUT }

data class Product(
    val id: String,
    val name: String,
    val price: Double,
    val stock: Int,
    val categoryId: String? = null,
    val image: String? = null,
    val imagePath: String? = null,
    val description: String = "",
    val unit: String? = null,
    val visible: Boolean = true,
    val archived: Boolean = false,
    val featured: Boolean = false,
    val sortOrder: Int = 0,
    val lowStockThreshold: Int? = null,
    val createdAt: Long? = null,
    val updatedAt: Long? = null,
) {
    fun threshold(default: Int): Int = lowStockThreshold ?: default
    fun stockLevel(default: Int): StockLevel = when {
        stock <= 0 -> StockLevel.OUT
        stock <= threshold(default) -> StockLevel.LOW
        else -> StockLevel.OK
    }
    /** True when a customer could buy it right now. */
    val onSale: Boolean get() = visible && !archived && stock > 0
}

/** Owner-only product fields, stored separately so customers never see them. */
data class ProductPrivate(
    val costPrice: Double? = null,
    val sku: String = "",
    val barcode: String = "",
)

enum class OrderStatus(val key: String) {
    NEW("new"), CONFIRMED("confirmed"), PREPARING("preparing"), READY("ready"), COMPLETED("completed"), CANCELLED("cancelled");

    val isOpen: Boolean get() = this != COMPLETED && this != CANCELLED

    fun next(): OrderStatus? = when (this) {
        NEW -> CONFIRMED
        CONFIRMED -> PREPARING
        PREPARING -> READY
        READY -> COMPLETED
        COMPLETED, CANCELLED -> null
    }

    fun label(delivery: Boolean): String = when (this) {
        NEW -> "New"
        CONFIRMED -> "Confirmed"
        PREPARING -> "Preparing"
        READY -> if (delivery) "Out for delivery" else "Ready to collect"
        COMPLETED -> "Completed"
        CANCELLED -> "Cancelled"
    }

    /** Text for the big "move this order forward" button. */
    fun nextActionLabel(delivery: Boolean): String? = when (this) {
        NEW -> "Confirm order"
        CONFIRMED -> "Start preparing"
        PREPARING -> if (delivery) "Mark out for delivery" else "Mark ready to collect"
        READY -> if (delivery) "Mark delivered" else "Mark collected"
        COMPLETED, CANCELLED -> null
    }

    companion object {
        fun of(key: String?): OrderStatus = entries.firstOrNull { it.key == key } ?: NEW
    }
}

enum class PaymentStatus(val key: String, val label: String) {
    MOCK("mock", "Test only — no payment"),
    PENDING("pending", "Awaiting payment"),
    PAID("paid", "Paid"),
    FAILED("failed", "Payment failed"),
    REFUNDED("refunded", "Refunded");

    companion object {
        fun of(key: String?): PaymentStatus = entries.firstOrNull { it.key == key } ?: PENDING
    }
}

data class OrderItem(
    val productId: String,
    val name: String,
    val unit: String?,
    val qty: Int,
    val unitPrice: Double,
    val lineTotal: Double,
)

data class Address(val line1: String, val line2: String, val city: String, val postcode: String) {
    fun lines(): List<String> = listOf(line1, line2, city, postcode).filter { it.isNotBlank() }
}

data class Order(
    val id: String,
    val ref: String,
    val status: OrderStatus,
    val payment: PaymentStatus,
    val isTest: Boolean,
    val items: List<OrderItem>,
    val subtotal: Double,
    val deliveryFee: Double,
    val total: Double,
    val totalPence: Long,
    val fulfilment: String,
    val customerName: String,
    val phone: String,
    val email: String,
    val address: Address?,
    val note: String,
    val createdAt: Long?,
    val updatedAt: Long?,
) {
    val isDelivery: Boolean get() = fulfilment == "delivery"
    val itemCount: Int get() = items.sumOf { it.qty }
    val statusLabel: String get() = status.label(isDelivery)
}

data class Feedback(
    val id: String,
    val name: String,
    val orderRef: String?,
    val orderId: String?,
    val rating: Int?,
    val message: String,
    val createdAt: Long?,
    val read: Boolean,
    val archived: Boolean,
)

/** An alert the backend recorded for the owner (also pushed to the phone). */
data class OwnerNotice(
    val id: String,
    val type: String,
    val title: String,
    val body: String,
    val refId: String?,
    val read: Boolean,
    val createdAt: Long?,
)

data class SiteSettings(
    val storeName: String = "Plodroid Store",
    val heroTitle: String = "",
    val heroSubtitle: String = "",
    val announcement: String = "",
    val whatsapp: String = "",
    val collection: Boolean = true,
    val delivery: Boolean = false,
    val deliveryFee: Double = 0.0,
)

data class OwnerSettings(
    val defaultLowStock: Int = 5,
    val notifyOrders: Boolean = true,
    val notifyFeedback: Boolean = true,
    val notifyStock: Boolean = true,
)

/* ── money ─────────────────────────────────────────────── */

object Money {
    fun pence(pounds: Double): Long = Math.round(pounds * 100.0)
    fun gbp(pounds: Double): String = gbpPence(pence(pounds))
    fun gbpPence(p: Long): String {
        val sign = if (p < 0) "-" else ""
        val abs = Math.abs(p)
        return sign + "£" + String.format(Locale.UK, "%,d.%02d", abs / 100, abs % 100)
    }
}
