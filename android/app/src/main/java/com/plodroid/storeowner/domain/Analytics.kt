package com.plodroid.storeowner.domain

import java.util.Calendar
import java.util.TimeZone

/**
 * Dashboard numbers, derived only from stored orders, products and feedback.
 *
 * Definitions (kept deliberately strict so the owner is never misled):
 *  - Test orders (placed with the mock checkout) are counted separately and NEVER
 *    included in money figures or customer counts.
 *  - "Money received" = real orders whose payment status is Paid, not cancelled.
 *  - "Open order value" = real orders not yet completed or cancelled. This is NOT money received.
 *  - Operational counts (new, being prepared…) include test orders, because the owner
 *    still has to deal with them while testing — the UI says so.
 */
data class DayPoint(val dayStart: Long, val realOrders: Int, val testOrders: Int, val receivedPence: Long)

data class Dashboard(
    val realOrders: Int,
    val testOrders: Int,
    val newOrders: Int,
    val inProgress: Int,
    val awaitingPayment: Int,
    val completed: Int,
    val cancelled: Int,
    val receivedPence: Long,
    val openValuePence: Long,
    val customers: Int,
    val productsOnSale: Int,
    val lowStock: Int,
    val outOfStock: Int,
    val hiddenProducts: Int,
    val unreadFeedback: Int,
    val days: List<DayPoint>,
    val rangeDays: Int,
) {
    val hasAnyOrders: Boolean get() = realOrders + testOrders > 0
}

object Analytics {

    fun compute(
        orders: List<Order>,
        products: List<Product>,
        feedback: List<Feedback>,
        defaultLowStock: Int,
        nowMs: Long,
        rangeDays: Int,
        zone: TimeZone = TimeZone.getDefault(),
    ): Dashboard {
        val real = orders.filter { !it.isTest }
        val liveProducts = products.filter { !it.archived }

        val customers = real.asSequence()
            .filter { it.status != OrderStatus.CANCELLED }
            .map { customerKey(it) }
            .filter { it.isNotEmpty() }
            .toSet().size

        return Dashboard(
            realOrders = real.size,
            testOrders = orders.size - real.size,
            newOrders = orders.count { it.status == OrderStatus.NEW },
            inProgress = orders.count { it.status == OrderStatus.CONFIRMED || it.status == OrderStatus.PREPARING || it.status == OrderStatus.READY },
            awaitingPayment = real.count { it.payment == PaymentStatus.PENDING && it.status != OrderStatus.CANCELLED },
            completed = orders.count { it.status == OrderStatus.COMPLETED },
            cancelled = orders.count { it.status == OrderStatus.CANCELLED },
            receivedPence = real.filter { isReceived(it) }.sumOf { it.totalPence },
            openValuePence = real.filter { it.status.isOpen }.sumOf { it.totalPence },
            customers = customers,
            productsOnSale = liveProducts.count { it.onSale },
            lowStock = liveProducts.count { it.stockLevel(defaultLowStock) == StockLevel.LOW },
            outOfStock = liveProducts.count { it.stockLevel(defaultLowStock) == StockLevel.OUT },
            hiddenProducts = liveProducts.count { !it.visible },
            unreadFeedback = feedback.count { !it.read && !it.archived },
            days = daily(orders, nowMs, rangeDays, zone),
            rangeDays = rangeDays,
        )
    }

    fun isReceived(o: Order): Boolean = !o.isTest && o.payment == PaymentStatus.PAID && o.status != OrderStatus.CANCELLED

    /** Same person across orders: email first, then phone digits, then name. */
    fun customerKey(o: Order): String = when {
        o.email.isNotBlank() -> "e:" + o.email.trim().lowercase()
        o.phone.any { it.isDigit() } -> "p:" + o.phone.filter { it.isDigit() }.takeLast(10)
        else -> "n:" + o.customerName.trim().lowercase()
    }.let { if (it.length <= 2) "" else it }

    fun startOfDay(ms: Long, zone: TimeZone): Long {
        val c = Calendar.getInstance(zone)
        c.timeInMillis = ms
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /** One point per calendar day, oldest first, ending today. Days with no orders are zeros. */
    fun daily(orders: List<Order>, nowMs: Long, rangeDays: Int, zone: TimeZone): List<DayPoint> {
        val days = ArrayList<Long>(rangeDays)
        val c = Calendar.getInstance(zone)
        c.timeInMillis = startOfDay(nowMs, zone)
        repeat(rangeDays) {
            days.add(0, c.timeInMillis)
            c.add(Calendar.DAY_OF_YEAR, -1)
        }
        val firstDay = days.first()
        val buckets = HashMap<Long, MutableList<Order>>()
        for (o in orders) {
            val t = o.createdAt ?: continue
            if (t < firstDay) continue
            buckets.getOrPut(startOfDay(t, zone)) { mutableListOf() }.add(o)
        }
        return days.map { d ->
            val list = buckets[d].orEmpty()
            DayPoint(
                dayStart = d,
                realOrders = list.count { !it.isTest && it.status != OrderStatus.CANCELLED },
                testOrders = list.count { it.isTest && it.status != OrderStatus.CANCELLED },
                receivedPence = list.filter { isReceived(it) }.sumOf { it.totalPence },
            )
        }
    }

    /** Gross margin per unit, or null when cost price is unknown. */
    fun marginPercent(price: Double, cost: Double?): Double? {
        if (cost == null || price <= 0.0) return null
        return (price - cost) / price * 100.0
    }
}
