package com.plodroid.storeowner.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.domain.Money
import com.plodroid.storeowner.domain.Order
import com.plodroid.storeowner.domain.OrderStatus
import com.plodroid.storeowner.domain.PaymentStatus
import com.plodroid.storeowner.ui.Fmt
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.Routes
import com.plodroid.storeowner.ui.components.BackHeader
import com.plodroid.storeowner.ui.components.Chip
import com.plodroid.storeowner.ui.components.ChipRow
import com.plodroid.storeowner.ui.components.ConfirmDialog
import com.plodroid.storeowner.ui.components.EmptyState
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Group
import com.plodroid.storeowner.ui.components.Hairline
import com.plodroid.storeowner.ui.components.Hint
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.Notice
import com.plodroid.storeowner.ui.components.Page
import com.plodroid.storeowner.ui.components.Pill
import com.plodroid.storeowner.ui.components.PrimaryButton
import com.plodroid.storeowner.ui.components.RowItem
import com.plodroid.storeowner.ui.components.SectionTitle
import com.plodroid.storeowner.ui.plural
import com.plodroid.storeowner.ui.statusTone
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.launch

enum class OrderFilter(val label: String) { ACTIVE("Active"), NEW("New"), COMPLETED("Completed"), CANCELLED("Cancelled"), ALL("All") }

@Composable
fun OrdersScreen(vm: OwnerViewModel, nav: NavHostController) {
    val orders by vm.orders.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(OrderFilter.ACTIVE) }
    val all = orders.getOrNull().orEmpty()
    fun matches(o: Order, f: OrderFilter) = when (f) {
        OrderFilter.ACTIVE -> o.status.isOpen
        OrderFilter.NEW -> o.status == OrderStatus.NEW
        OrderFilter.COMPLETED -> o.status == OrderStatus.COMPLETED
        OrderFilter.CANCELLED -> o.status == OrderStatus.CANCELLED
        OrderFilter.ALL -> true
    }
    val shown = all.filter { matches(it, filter) }

    Page(title = "Orders", subtitle = if (all.isEmpty()) null else "${all.count { it.status.isOpen }} open") {
        item("hint") {
            Hint(
                visible = "orders" !in hints,
                text = "New orders from your website appear here. Open one and press the big button to move it along: Confirm → Preparing → Ready → Completed.",
                onDismiss = { vm.dismissHint("orders") },
            )
        }
        when (val l = orders) {
            is Loadable.Loading -> { item("load") { LoadingBlock() }; return@Page }
            is Loadable.Failed -> { item("err") { ErrorBlock(l.message) }; return@Page }
            is Loadable.Ready -> Unit
        }
        if (all.isEmpty()) {
            item("empty") {
                EmptyState(
                    "No orders yet",
                    "When a customer checks out on your website, the order shows up here — and your phone alerts you if notifications are on.",
                )
            }
            return@Page
        }
        item("filters") {
            ChipRow {
                OrderFilter.entries.forEach { f ->
                    Chip(f.label, filter == f, { filter = f }, count = if (f == OrderFilter.NEW || f == OrderFilter.ACTIVE) all.count { matches(it, f) } else null)
                }
            }
        }
        if (shown.isEmpty()) {
            item("none") { EmptyState("Nothing here", "No ${filter.label.lowercase()} orders right now.") }
        } else item("list") {
            Group(Modifier.padding(top = 6.dp)) {
                shown.forEachIndexed { i, o ->
                    if (i > 0) Hairline()
                    OrderRow(o) { nav.navigate(Routes.order(o.id)) }
                }
            }
        }
    }
}

@Composable
private fun OrderRow(o: Order, onClick: () -> Unit) {
    RowItem(onClick = onClick, trailing = {
        Column(horizontalAlignment = Alignment.End) {
            Text(Money.gbp(o.total), style = T.label.copy(fontFeatureSettings = "tnum"))
            Spacer(Modifier.height(4.dp))
            Pill(o.statusLabel, statusTone(o))
        }
    }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (o.status == OrderStatus.NEW) { Box(Modifier.size(8.dp).clip(CircleShape).background(C.Orange)); Spacer(Modifier.width(6.dp)) }
            Text(o.ref, style = T.label)
            if (o.isTest) { Spacer(Modifier.width(6.dp)); Pill("TEST", Tone.BLUE) }
        }
        Text("${Fmt.ago(o.createdAt)} · ${plural(o.itemCount, "item")} · ${if (o.isDelivery) "Delivery" else "Collection"}", style = T.caption.copy(fontSize = 13.sp))
        if (o.customerName.isNotBlank()) Text(o.customerName, style = T.caption, maxLines = 1)
    }
}

/* ── one order ───────────────────────────────────────── */

@Composable
fun OrderDetailScreen(vm: OwnerViewModel, nav: NavHostController, id: String) {
    val orders by vm.orders.collectAsStateWithLifecycle()
    val o = orders.getOrNull()?.firstOrNull { it.id == id }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var busy by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var payMenu by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(C.Bg)) {
        BackHeader(o?.let { "Order ${it.ref}" } ?: "Order", onBack = { nav.popBackStack() })
        when {
            orders is Loadable.Failed -> { ErrorBlock((orders as Loadable.Failed).message); return@Column }
            orders is Loadable.Loading -> { LoadingBlock(); return@Column }
            o == null -> { ErrorBlock("This order can't be found. It may have been a test order that was deleted."); return@Column }
        }
        val order = o!!
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            if (order.isTest) Notice("Test order — placed with the test checkout. No money was taken, and it never counts towards your sales.", Tone.BLUE)

            // ── progress ────────────────────────────
            SectionTitle("Status")
            Group {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Pill(order.statusLabel, statusTone(order))
                        Spacer(Modifier.width(8.dp))
                        Text("Updated ${Fmt.ago(order.updatedAt)}", style = T.caption)
                    }
                    Spacer(Modifier.height(14.dp))
                    Steps(order)
                    val next = order.status.next()
                    val label = order.status.nextActionLabel(order.isDelivery)
                    if (next != null && label != null) {
                        PrimaryButton(
                            label, busy = busy,
                            modifier = Modifier.padding(top = 16.dp).fillMaxWidth(),
                            onClick = {
                                busy = true
                                scope.launch {
                                    vm.act("Order ${order.ref}: ${next.label(order.isDelivery)}") { it.setOrderStatus(order.id, next) }
                                    busy = false
                                }
                            },
                        )
                    }
                    if (order.status.isOpen) {
                        TextButton(onClick = { confirmCancel = true }, enabled = !busy, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                            Text("Cancel order", color = C.Red)
                        }
                    }
                    if (order.status == OrderStatus.CANCELLED) {
                        Text("Cancelled orders are final. Their items were put back into stock.", style = T.caption, modifier = Modifier.padding(top = 8.dp))
                        if (order.isTest) {
                            TextButton(onClick = { confirmDelete = true }) { Text("Delete this test order", color = C.Red) }
                        }
                    }
                }
            }

            // ── payment ─────────────────────────────
            SectionTitle("Payment")
            Group {
                RowItem(onClick = if (!order.isTest && order.status != OrderStatus.CANCELLED) ({ payMenu = true }) else null, chevron = false, trailing = {
                    if (!order.isTest && order.status != OrderStatus.CANCELLED) Text("Change", color = C.Orange, style = T.label)
                }) {
                    Text(order.payment.label, style = T.label)
                    Text(
                        if (order.isTest) "The test checkout never takes money."
                        else "Mark it Paid once you've actually received the money.",
                        style = T.caption,
                    )
                    Box {
                        DropdownMenu(expanded = payMenu, onDismissRequest = { payMenu = false }) {
                            listOf(PaymentStatus.PENDING, PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.REFUNDED).forEach { ps ->
                                DropdownMenuItem(text = { Text(ps.label) }, onClick = {
                                    payMenu = false
                                    scope.launch { vm.act("Payment marked: ${ps.label}") { it.setPaymentStatus(order.id, ps) } }
                                })
                            }
                        }
                    }
                }
            }

            // ── customer ────────────────────────────
            SectionTitle("Customer")
            Group {
                RowItem(onClick = null) {
                    Text(order.customerName.ifBlank { "No name given" }, style = T.label)
                    Text(if (order.isDelivery) "Delivery" else "Collection", style = T.caption)
                }
                if (order.phone.isNotBlank()) {
                    Hairline()
                    RowItem(onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + order.phone.filter { it.isDigit() || it == '+' }))) },
                        leading = { Icon(Icons.Filled.Call, null, tint = C.Orange) }) {
                        Text(order.phone, style = T.label)
                        Text("Tap to call", style = T.caption)
                    }
                }
                if (order.email.isNotBlank()) {
                    Hairline()
                    RowItem(onClick = {
                        val i = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + order.email)).putExtra(Intent.EXTRA_SUBJECT, "Your order ${order.ref}")
                        runCatching { context.startActivity(i) }.onFailure { vm.say("No email app found on this phone.", true) }
                    }, leading = { Icon(Icons.Filled.Email, null, tint = C.Orange) }) {
                        Text(order.email, style = T.label)
                        Text("Tap to email", style = T.caption)
                    }
                }
                order.address?.let { a ->
                    Hairline()
                    RowItem(onClick = null, leading = { Icon(Icons.Filled.LocationOn, null, tint = C.Muted) }) {
                        a.lines().forEach { Text(it, style = T.body) }
                    }
                }
                if (order.note.isNotBlank()) {
                    Hairline()
                    RowItem(onClick = null) {
                        Text("Note from customer", style = T.caption)
                        Text(order.note, style = T.body)
                    }
                }
            }

            // ── items ───────────────────────────────
            SectionTitle("Items")
            Group {
                order.items.forEachIndexed { i, line ->
                    if (i > 0) Hairline()
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text("${line.qty} × ${line.name}", style = T.label)
                            Text("${Money.gbp(line.unitPrice)} each${line.unit?.let { u -> " · per $u" } ?: ""}", style = T.caption)
                        }
                        Text(Money.gbp(line.lineTotal), style = T.label.copy(fontFeatureSettings = "tnum"))
                    }
                }
                Hairline(0.dp)
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    TotalLine("Subtotal", Money.gbp(order.subtotal))
                    if (order.isDelivery) TotalLine("Delivery", if (order.deliveryFee > 0) Money.gbp(order.deliveryFee) else "Free")
                    TotalLine(if (order.isTest) "Total (not charged)" else "Total", Money.gbp(order.total), bold = true)
                }
            }
            Text("Placed ${Fmt.full(order.createdAt)}", style = T.caption, modifier = Modifier.padding(20.dp))
            Spacer(Modifier.navigationBarsPadding())
        }

        if (confirmCancel) {
            ConfirmDialog(
                "Cancel order ${order.ref}?",
                "The items go back into stock and the order can't be reopened. Let the customer know.",
                confirm = "Cancel order", destructive = true, dismiss = "Keep order",
                onConfirm = {
                    confirmCancel = false; busy = true
                    scope.launch { vm.act("Order cancelled — items returned to stock") { it.setOrderStatus(order.id, OrderStatus.CANCELLED) }; busy = false }
                },
                onDismiss = { confirmCancel = false },
            )
        }
        if (confirmDelete) {
            ConfirmDialog(
                "Delete this test order?", "It disappears from your list. Real orders can't be deleted.",
                confirm = "Delete", destructive = true,
                onConfirm = {
                    confirmDelete = false
                    scope.launch { if (vm.act("Test order deleted") { it.deleteTestOrder(order.id) } != null) nav.popBackStack() }
                },
                onDismiss = { confirmDelete = false },
            )
        }
    }
}

@Composable
private fun TotalLine(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = if (bold) T.label else T.bodyMuted, modifier = Modifier.weight(1f))
        Text(value, style = (if (bold) T.numberSmall else T.body).copy(fontFeatureSettings = "tnum"))
    }
}

/** New → Confirmed → Preparing → Ready → Completed, with the current step marked. */
@Composable
private fun Steps(o: Order) {
    val steps = listOf(OrderStatus.NEW, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.COMPLETED)
    val current = steps.indexOf(o.status)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        steps.forEachIndexed { i, s ->
            val done = current >= 0 && i <= current
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(if (i == current) 14.dp else 10.dp).clip(CircleShape)
                        .background(if (o.status == OrderStatus.CANCELLED) C.Surface3 else if (done) C.Orange else C.Surface3),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    s.label(o.isDelivery).replace(" to collect", "").replace("Out for delivery", "Out"),
                    fontSize = 11.sp, lineHeight = 13.sp,
                    color = if (i == current) C.Text else C.Faint,
                    fontWeight = if (i == current) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                )
            }
        }
    }
}

