package com.plodroid.storeowner.ui

import com.plodroid.storeowner.domain.Order
import com.plodroid.storeowner.domain.OrderStatus
import com.plodroid.storeowner.domain.Product
import com.plodroid.storeowner.domain.StockLevel
import com.plodroid.storeowner.ui.theme.Tone
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object Fmt {
    private val dayMonth = SimpleDateFormat("d MMM", Locale.UK)
    private val full = SimpleDateFormat("d MMM yyyy, HH:mm", Locale.UK)
    private val time = SimpleDateFormat("HH:mm", Locale.UK)

    /** "just now", "12 min ago", "Today 14:05", "Yesterday 09:10", "3 Oct". */
    fun ago(ms: Long?, now: Long = System.currentTimeMillis()): String {
        if (ms == null) return "just now"
        val diff = now - ms
        if (diff < 60_000) return "just now"
        if (diff < 60 * 60_000) return "${diff / 60_000} min ago"
        val c = Calendar.getInstance(); c.timeInMillis = now
        val today = c.get(Calendar.DAY_OF_YEAR) to c.get(Calendar.YEAR)
        c.timeInMillis = ms
        val then = c.get(Calendar.DAY_OF_YEAR) to c.get(Calendar.YEAR)
        if (then == today) return "Today " + time.format(Date(ms))
        c.timeInMillis = now; c.add(Calendar.DAY_OF_YEAR, -1)
        if (then == (c.get(Calendar.DAY_OF_YEAR) to c.get(Calendar.YEAR))) return "Yesterday " + time.format(Date(ms))
        return dayMonth.format(Date(ms))
    }

    fun full(ms: Long?): String = if (ms == null) "—" else full.format(Date(ms))
    fun dayMonth(ms: Long): String = dayMonth.format(Date(ms))
}

fun statusTone(o: Order): Tone = when (o.status) {
    OrderStatus.NEW -> Tone.ORANGE
    OrderStatus.CONFIRMED, OrderStatus.PREPARING -> Tone.BLUE
    OrderStatus.READY -> Tone.GREEN
    OrderStatus.COMPLETED -> Tone.NEUTRAL
    OrderStatus.CANCELLED -> Tone.RED
}

fun stockText(p: Product, defaultLow: Int): Pair<String, Tone> = when (p.stockLevel(defaultLow)) {
    StockLevel.OUT -> "Sold out" to Tone.RED
    StockLevel.LOW -> "Low · ${p.stock} left" to Tone.ORANGE
    StockLevel.OK -> "${p.stock} in stock" to Tone.GREEN
}

fun plural(n: Int, one: String, many: String = one + "s") = "$n ${if (n == 1) one else many}"
