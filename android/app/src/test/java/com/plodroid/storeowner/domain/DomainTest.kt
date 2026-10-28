package com.plodroid.storeowner.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/** Run with:  cd android && ./gradlew testDebugUnitTest */
class DomainTest {
    private val utc = TimeZone.getTimeZone("UTC")
    private val day = 24L * 60 * 60 * 1000
    private val now = 1_800_000_000_000L // fixed clock

    private fun order(
        id: String, total: Double, status: OrderStatus = OrderStatus.NEW, pay: PaymentStatus = PaymentStatus.PENDING,
        test: Boolean = false, email: String = "", phone: String = "", at: Long = now,
    ) = Order(
        id, "PS-$id", status, pay, test, listOf(OrderItem("p", "P", null, 1, total, total)),
        total, 0.0, total, Money.pence(total), "collection", "Name $id", phone, email, null, "", at, at,
    )

    private fun product(id: String, stock: Int, visible: Boolean = true, archived: Boolean = false, low: Int? = null) =
        Product(id = id, name = id, price = 1.0, stock = stock, visible = visible, archived = archived, lowStockThreshold = low)

    @Test fun moneyIsExactInPence() {
        assertEquals(30L, Money.pence(0.1) + Money.pence(0.2))
        assertEquals("£1,234.50", Money.gbpPence(123_450))
        assertEquals("£0.05", Money.gbp(0.05))
    }

    @Test fun testOrdersNeverCountAsMoney() {
        val d = Analytics.compute(
            listOf(
                order("1", 10.0, OrderStatus.COMPLETED, PaymentStatus.PAID, email = "a@x.co"),
                order("2", 5.0, OrderStatus.NEW, PaymentStatus.MOCK, test = true, email = "b@x.co"),
                order("3", 7.5, OrderStatus.CONFIRMED, PaymentStatus.PENDING, phone = "07700 900123"),
                order("4", 99.0, OrderStatus.CANCELLED, PaymentStatus.PAID, email = "c@x.co"),
                order("5", 3.0, OrderStatus.COMPLETED, PaymentStatus.MOCK, test = true),
            ),
            emptyList(), emptyList(), 5, now, 7, utc,
        )
        assertEquals(3, d.realOrders)
        assertEquals(2, d.testOrders)
        assertEquals(1000L, d.receivedPence)            // only the paid, real, not-cancelled order
        assertEquals(750L, d.openValuePence)            // open real orders, not money received
        assertEquals(1, d.awaitingPayment)
        assertEquals(2, d.customers)                    // cancelled + test customers excluded
        assertEquals(2, d.completed)
        assertEquals(1, d.newOrders)
    }

    @Test fun sameCustomerCountedOnce() {
        val d = Analytics.compute(
            listOf(order("1", 1.0, email = "Sam@X.co"), order("2", 1.0, email = "sam@x.co "), order("3", 1.0, phone = "+44 7700 900123"), order("4", 1.0, phone = "07700900123")),
            emptyList(), emptyList(), 5, now, 7, utc,
        )
        assertEquals(2, d.customers)
    }

    @Test fun stockCountsIgnoreArchivedAndUseThresholds() {
        val d = Analytics.compute(
            emptyList(),
            listOf(product("a", 10), product("b", 3), product("c", 0), product("d", 8, low = 10), product("e", 0, archived = true), product("f", 9, visible = false)),
            emptyList(), 5, now, 7, utc,
        )
        assertEquals(3, d.productsOnSale)   // a, b, d
        assertEquals(2, d.lowStock)         // b (≤5), d (≤10)
        assertEquals(1, d.outOfStock)       // c (archived e ignored)
        assertEquals(1, d.hiddenProducts)
    }

    @Test fun dailyBucketsCoverTheRangeWithZeros() {
        val pts = Analytics.daily(
            listOf(order("1", 2.0, at = now), order("2", 2.0, at = now - day, test = true), order("3", 2.0, at = now - 30 * day)),
            now, 7, utc,
        )
        assertEquals(7, pts.size)
        assertEquals(1, pts.last().realOrders)
        assertEquals(1, pts[5].testOrders)
        assertEquals(0, pts.first().realOrders)
        assertTrue(pts.zipWithNext().all { (a, b) -> b.dayStart - a.dayStart == day })
    }

    @Test fun emptyShopIsAllZeros() {
        val d = Analytics.compute(emptyList(), emptyList(), emptyList(), 5, now, 30, utc)
        assertEquals(0L, d.receivedPence)
        assertEquals(30, d.days.size)
        assertTrue(!d.hasAnyOrders)
    }

    @Test fun priceParsing() {
        assertEquals(2.5, Validation.parsePrice("2.50")!!, 0.0)
        assertEquals(1234.5, Validation.parsePrice("£1,234.5")!!, 0.0)
        assertNull(Validation.parsePrice("-1"))
        assertNull(Validation.parsePrice("2.555"))
        assertNull(Validation.parsePrice("abc"))
        assertNull(Validation.parsePrice("100001"))
    }

    @Test fun productFormRejectsNegativeStockAndBadPrice() {
        val bad = Validation.product(ProductForm(name = "", price = "x", stock = "-3"))
        assertTrue(bad is Checked.Problems)
        val p = (bad as Checked.Problems).byField
        assertTrue(p.containsKey("name") && p.containsKey("price") && p.containsKey("stock"))

        val ok = Validation.product(ProductForm(name = " Dates ", price = "6.5", stock = "12", cost = "4", lowStock = ""))
        assertTrue(ok is Checked.Ok)
        val v = (ok as Checked.Ok).value
        assertEquals("Dates", v.name)
        assertEquals(4.0, v.private.costPrice!!, 0.0)
        assertNull(v.lowStockThreshold)
    }

    @Test fun orderFlowMovesForwardOnly() {
        assertEquals(OrderStatus.CONFIRMED, OrderStatus.NEW.next())
        assertNull(OrderStatus.COMPLETED.next())
        assertNull(OrderStatus.CANCELLED.next())
        assertEquals("Ready to collect", OrderStatus.READY.label(delivery = false))
        assertEquals("Out for delivery", OrderStatus.READY.label(delivery = true))
    }

    @Test fun marginNeedsACostPrice() {
        assertNull(Analytics.marginPercent(2.0, null))
        assertEquals(25.0, Analytics.marginPercent(2.0, 1.5)!!, 0.001)
    }
}
