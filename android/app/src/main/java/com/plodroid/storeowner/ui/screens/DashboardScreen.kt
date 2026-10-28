package com.plodroid.storeowner.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.domain.Analytics
import com.plodroid.storeowner.domain.Money
import com.plodroid.storeowner.ui.Fmt
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.Routes
import com.plodroid.storeowner.ui.components.Chip
import com.plodroid.storeowner.ui.components.DailyBars
import com.plodroid.storeowner.ui.components.Dot
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Group
import com.plodroid.storeowner.ui.components.Hairline
import com.plodroid.storeowner.ui.components.Hint
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.Notice
import com.plodroid.storeowner.ui.components.Page
import com.plodroid.storeowner.ui.components.Pill
import com.plodroid.storeowner.ui.components.RowItem
import com.plodroid.storeowner.ui.components.SectionTitle
import com.plodroid.storeowner.ui.components.Stars
import com.plodroid.storeowner.ui.plural
import com.plodroid.storeowner.ui.statusTone
import com.plodroid.storeowner.ui.tab
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import com.plodroid.storeowner.ui.theme.fg
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun DashboardScreen(vm: OwnerViewModel, nav: NavHostController) {
    val orders by vm.orders.collectAsStateWithLifecycle()
    val products by vm.products.collectAsStateWithLifecycle()
    val feedback by vm.feedback.collectAsStateWithLifecycle()
    val site by vm.siteSettings.collectAsStateWithLifecycle()
    val owner by vm.ownerSettings.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    var range by rememberSaveable { mutableIntStateOf(7) }

    val o = orders.getOrNull()
    val p = products.getOrNull()
    val f = feedback.getOrNull()
    val low = owner.getOrNull()?.defaultLowStock ?: 5
    val dash = remember(o, p, f, low, range) {
        if (o == null || p == null || f == null) null
        else Analytics.compute(o, p, f, low, System.currentTimeMillis(), range)
    }
    val today = remember { SimpleDateFormat("EEEE d MMMM", Locale.UK).format(Date()) }

    Page(title = site.getOrNull()?.storeName ?: "Home", subtitle = today) {
        item("hint") {
            Hint(
                visible = "home" !in hints,
                text = "This is your shop at a glance. New orders show up at the top of this screen and in Orders. Tap any line to see the details.",
                onDismiss = { vm.dismissHint("home") },
            )
        }

        val failed = listOf(orders, products, feedback).filterIsInstance<Loadable.Failed>().firstOrNull()
        if (failed != null) { item("err") { ErrorBlock(failed.message) }; return@Page }
        if (dash == null) { item("load") { LoadingBlock() }; return@Page }

        if (dash.testOrders > 0 && dash.realOrders == 0) {
            item("testmode") {
                Notice("Your website checkout is in test mode. Orders placed there are marked TEST and never count as money.", Tone.BLUE)
            }
        }

        // ── needs attention ─────────────────────────────
        item("att_t") { SectionTitle("Needs attention") }
        item("att") {
            val lines = listOf(
                Line("New orders to confirm", dash.newOrders, Tone.ORANGE) { tab(nav, Routes.ORDERS) },
                Line("Orders awaiting payment", dash.awaitingPayment, Tone.ORANGE) { tab(nav, Routes.ORDERS) },
                Line("Products sold out", dash.outOfStock, Tone.RED) { tab(nav, Routes.PRODUCTS) },
                Line("Products running low", dash.lowStock, Tone.ORANGE) { tab(nav, Routes.PRODUCTS) },
                Line("Unread feedback", dash.unreadFeedback, Tone.BLUE) { tab(nav, Routes.FEEDBACK) },
            ).filter { it.n > 0 }
            Group {
                if (lines.isEmpty()) {
                    RowItem(onClick = null, leading = { Dot(C.Green, 10.dp) }) {
                        Text("All caught up", style = T.label)
                        Text("Nothing needs you right now.", style = T.caption)
                    }
                }
                lines.forEachIndexed { i, l ->
                    if (i > 0) Hairline(42.dp)
                    RowItem(onClick = l.go, leading = { Dot(l.tone.fg(), 10.dp) }, trailing = {
                        Text("${l.n}", style = T.numberSmall)
                    }) { Text(l.label, style = T.label) }
                }
            }
        }

        // ── money & orders ──────────────────────────────
        item("range") {
            SectionTitle("Sales", trailing = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip("7 days", range == 7, { range = 7 })
                    Chip("30 days", range == 30, { range = 30 })
                }
            })
        }
        item("money") {
            val inRange = dash.days.sumOf { it.receivedPence }
            val ordersInRange = dash.days.sumOf { it.realOrders }
            val testInRange = dash.days.sumOf { it.testOrders }
            Group {
                Column(Modifier.padding(16.dp)) {
                    Text("Money received · last $range days", style = T.caption.copy(fontSize = 13.sp))
                    Text(Money.gbpPence(inRange), style = T.number)
                    Text("Only orders marked Paid count. Test orders never do.", style = T.caption)
                }
                Hairline()
                Row(Modifier.padding(16.dp)) {
                    Stat("Orders", "$ordersInRange", if (testInRange > 0) "+ ${plural(testInRange, "test order")}" else "last $range days", Modifier.weight(1f))
                    Stat("Customers", "${dash.customers}", "all time", Modifier.weight(1f))
                }
                Hairline()
                Row(Modifier.padding(16.dp)) {
                    Stat("Open order value", Money.gbpPence(dash.openValuePence), "not yet received", Modifier.weight(1f))
                    Stat("All-time received", Money.gbpPence(dash.receivedPence), "paid orders", Modifier.weight(1f))
                }
            }
        }
        item("chart_t") { SectionTitle("Orders per day") }
        item("chart") {
            Group {
                if (!dash.hasAnyOrders) {
                    Text(
                        "No orders yet. This chart fills in as real orders arrive from your website.",
                        style = T.bodyMuted, modifier = Modifier.padding(16.dp),
                    )
                } else {
                    val real = dash.days.map { it.realOrders }
                    val test = dash.days.map { it.testOrders }
                    DailyBars(
                        days = dash.days.map { it.dayStart },
                        real = real, test = test,
                        description = "Orders per day for the last $range days: ${real.sum()} real and ${test.sum()} test orders.",
                    )
                }
            }
        }

        // ── order pipeline ──────────────────────────────
        item("pipe_t") { SectionTitle("Orders") }
        item("pipe") {
            Group {
                RowItem(onClick = { tab(nav, Routes.ORDERS) }) {
                    Row {
                        Stat("New", "${dash.newOrders}", null, Modifier.weight(1f))
                        Stat("In progress", "${dash.inProgress}", null, Modifier.weight(1f))
                        Stat("Completed", "${dash.completed}", null, Modifier.weight(1f))
                    }
                }
            }
        }

        // ── products ────────────────────────────────────
        item("prod_t") { SectionTitle("Products") }
        item("prod") {
            Group {
                RowItem(onClick = { tab(nav, Routes.PRODUCTS) }) {
                    Row {
                        Stat("On sale", "${dash.productsOnSale}", null, Modifier.weight(1f))
                        Stat("Running low", "${dash.lowStock}", null, Modifier.weight(1f), if (dash.lowStock > 0) C.Orange else null)
                        Stat("Sold out", "${dash.outOfStock}", null, Modifier.weight(1f), if (dash.outOfStock > 0) C.Red else null)
                    }
                }
            }
        }

        // ── recent ──────────────────────────────────────
        val recent = o.orEmpty().take(5)
        item("rec_t") {
            SectionTitle("Recent orders", trailing = {
                if (recent.isNotEmpty()) androidx.compose.material3.TextButton(onClick = { tab(nav, Routes.ORDERS) }) { Text("See all", color = C.Orange) }
            })
        }
        item("rec") {
            Group {
                if (recent.isEmpty()) Text("New orders will appear here.", style = T.bodyMuted, modifier = Modifier.padding(16.dp))
                recent.forEachIndexed { i, ord ->
                    if (i > 0) Hairline()
                    RowItem(onClick = { nav.navigate(Routes.order(ord.id)) }, trailing = { Pill(ord.statusLabel, statusTone(ord)) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(ord.ref, style = T.label)
                            if (ord.isTest) { Spacer(Modifier.width(6.dp)); Pill("TEST", Tone.BLUE) }
                        }
                        Text("${Fmt.ago(ord.createdAt)} · ${plural(ord.itemCount, "item")} · ${Money.gbp(ord.total)}", style = T.caption)
                    }
                }
            }
        }

        val recentFb = f.orEmpty().filter { !it.archived }.take(3)
        item("fb_t") { SectionTitle("Latest feedback") }
        item("fb") {
            Group {
                if (recentFb.isEmpty()) Text("Customer messages will appear here.", style = T.bodyMuted, modifier = Modifier.padding(16.dp))
                recentFb.forEachIndexed { i, fb ->
                    if (i > 0) Hairline()
                    RowItem(
                        onClick = { nav.navigate(Routes.feedbackItem(fb.id)) },
                        leading = { Dot(if (fb.read) C.Surface3 else C.Orange) },
                    ) {
                        Stars(fb.rating, 14.dp)
                        Text(fb.message, style = T.body.copy(fontWeight = if (fb.read) FontWeight.Normal else FontWeight.Medium), maxLines = 2)
                        Text(Fmt.ago(fb.createdAt), style = T.caption)
                    }
                }
            }
        }
        item("end") { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun Stat(label: String, value: String, note: String?, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color? = null) {
    Column(modifier.padding(end = 8.dp)) {
        Text(label, style = T.caption.copy(fontSize = 13.sp))
        Text(value, style = T.numberSmall.copy(fontSize = 20.sp, color = color ?: C.Text), maxLines = 1)
        if (note != null) Text(note, style = T.caption)
    }
}

private class Line(val label: String, val n: Int, val tone: Tone, val go: () -> Unit)
