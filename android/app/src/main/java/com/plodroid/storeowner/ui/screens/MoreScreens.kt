package com.plodroid.storeowner.ui.screens

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.plodroid.storeowner.BuildConfig
import com.plodroid.storeowner.data.AuthState
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.domain.OwnerNotice
import com.plodroid.storeowner.domain.OwnerSettings
import com.plodroid.storeowner.domain.Validation
import com.plodroid.storeowner.notify.Channels
import com.plodroid.storeowner.ui.Fmt
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.Routes
import com.plodroid.storeowner.ui.components.BackHeader
import com.plodroid.storeowner.ui.components.ConfirmDialog
import com.plodroid.storeowner.ui.components.Dot
import com.plodroid.storeowner.ui.components.EmptyState
import com.plodroid.storeowner.ui.components.ErrorBlock
import com.plodroid.storeowner.ui.components.Field
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
import com.plodroid.storeowner.ui.components.SwitchRow
import com.plodroid.storeowner.ui.plural
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.T
import com.plodroid.storeowner.ui.theme.Tone
import kotlinx.coroutines.launch

/* ── More tab ────────────────────────────────────────── */

@Composable
fun MoreScreen(vm: OwnerViewModel, nav: NavHostController) {
    val categories by vm.categories.collectAsStateWithLifecycle()
    val notices by vm.notices.collectAsStateWithLifecycle()
    val backend by vm.backend.collectAsStateWithLifecycle()
    val unread = notices.getOrNull()?.count { !it.read } ?: 0
    val catCount = categories.getOrNull()?.size

    Page(title = "More") {
        item("g1") {
            Spacer(Modifier.height(8.dp))
            Group {
                RowItem(onClick = { nav.navigate(Routes.CATEGORIES) }, leading = { Icon(Icons.Filled.List, null, tint = C.Orange) }) {
                    Text("Categories", style = T.label)
                    Text(catCount?.let { "${plural(it, "category", "categories")} · the tabs on your website" } ?: "The tabs on your website", style = T.caption)
                }
                Hairline(52.dp)
                RowItem(onClick = { nav.navigate(Routes.NOTIFICATIONS) }, leading = { Icon(Icons.Filled.Notifications, null, tint = C.Orange) },
                    trailing = { if (unread > 0) Pill("$unread new", Tone.ORANGE) }) {
                    Text("Notifications", style = T.label)
                    Text("Alerts about orders, feedback and stock", style = T.caption)
                }
                Hairline(52.dp)
                RowItem(onClick = { nav.navigate(Routes.SETTINGS) }, leading = { Icon(Icons.Filled.Settings, null, tint = C.Orange) }) {
                    Text("Settings", style = T.label)
                    Text("Shop name, delivery, stock warnings, account", style = T.caption)
                }
            }
        }
        item("g2") {
            SectionTitle("Help")
            Group {
                RowItem(onClick = { vm.showTipsAgain(); vm.say("Tips are back on every screen") }, leading = { Icon(Icons.Filled.Info, null, tint = C.Blue) }, chevron = false) {
                    Text("Show tips again", style = T.label)
                    Text("Brings back the intro and the blue tips", style = T.caption)
                }
            }
        }
        if (backend?.isDemo == true) {
            item("demo") {
                Notice("You're in demo mode. Nothing you change here reaches your website.", Tone.BLUE)
                PrimaryButton("Leave demo mode", onClick = { vm.leaveDemo() }, modifier = Modifier.padding(16.dp).fillMaxWidth())
            }
        }
    }
}

/* ── Notifications ───────────────────────────────────── */

@Composable
fun NotificationsScreen(vm: OwnerViewModel, nav: NavHostController) {
    val context = LocalContext.current
    val notices by vm.notices.collectAsStateWithLifecycle()
    val hints by vm.dismissedHints.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var allowed by remember { mutableStateOf(Channels.canPost(context)) }

    // Re-check when returning from system settings.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) allowed = Channels.canPost(context) }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        vm.prefs.askedNotificationPermission = true
        allowed = Channels.canPost(context)
        if (!ok) vm.say("Notifications are off. You can turn them on in your phone's settings.", true)
    }
    fun openSystemSettings() {
        val i = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName))
        runCatching { context.startActivity(i) }
    }

    Column(Modifier.fillMaxSize().background(C.Bg)) {
        BackHeader("Notifications", onBack = { nav.popBackStack() }) {
            val unread = notices.getOrNull()?.filter { !it.read }.orEmpty()
            if (unread.isNotEmpty()) TextButton(onClick = { scope.launch { vm.act(null) { b -> b.markNoticesRead(unread.map { it.id }) } } }) {
                Text("Mark all read", color = C.Orange)
            }
        }
        LazyColumn(Modifier.weight(1f)) {
            item {
                Hint(
                    visible = "notifications" !in hints,
                    text = "Turn on notifications so your phone alerts you about new orders and messages, even when this app is closed.",
                    onDismiss = { vm.dismissHint("notifications") },
                )
            }
            item {
                Group(Modifier.padding(top = 6.dp)) {
                    RowItem(onClick = null, leading = { Icon(if (allowed) Icons.Filled.Notifications else Icons.Filled.Warning, null, tint = if (allowed) C.Green else C.Orange) }) {
                        Text(if (allowed) "Alerts are on for this phone" else "Alerts are off for this phone", style = T.label)
                        Text(
                            if (allowed) "You'll get alerts once your shop's server is set up (see the setup guide)."
                            else "You won't hear about new orders until you turn them on.",
                            style = T.caption,
                        )
                    }
                    if (!allowed) {
                        val canAsk = Build.VERSION.SDK_INT >= 33 && !vm.prefs.askedNotificationPermission
                        PrimaryButton(
                            if (canAsk) "Turn on notifications" else "Open phone settings",
                            onClick = { if (canAsk) ask.launch(Manifest.permission.POST_NOTIFICATIONS) else openSystemSettings() },
                            modifier = Modifier.padding(16.dp).fillMaxWidth(),
                        )
                    }
                }
            }
            item { SectionTitle("Recent alerts") }
            when (val l = notices) {
                is Loadable.Loading -> item { LoadingBlock() }
                is Loadable.Failed -> item { ErrorBlock(l.message) }
                is Loadable.Ready -> {
                    if (l.data.isEmpty()) item {
                        EmptyState("No alerts yet", "New orders, customer feedback and stock warnings will be listed here.")
                    } else item {
                        Group {
                            l.data.forEachIndexed { i, n ->
                                if (i > 0) Hairline(36.dp)
                                NoticeRow(n) {
                                    if (!n.read) scope.launch { vm.act(null) { it.markNoticesRead(listOf(n.id)) } }
                                    when (n.type) {
                                        "order", "reminder" -> n.refId?.let { nav.navigate(Routes.order(it)) }
                                        "feedback" -> n.refId?.let { nav.navigate(Routes.feedbackItem(it)) }
                                        "stock" -> n.refId?.let { nav.navigate(Routes.product(it)) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(32.dp).navigationBarsPadding()) }
        }
    }
}

@Composable
private fun NoticeRow(n: OwnerNotice, onClick: () -> Unit) {
    val tone = when (n.type) { "stock" -> if (n.title.startsWith("Out")) C.Red else C.Orange; "feedback" -> C.Blue; else -> C.Orange }
    RowItem(onClick = onClick, leading = { Dot(if (n.read) C.Surface3 else tone) }) {
        Text(n.title, style = T.label.copy(fontWeight = if (n.read) FontWeight.Normal else FontWeight.SemiBold))
        Text(n.body, style = T.caption.copy(fontSize = 13.sp, color = C.Muted))
        Text(Fmt.ago(n.createdAt), style = T.caption)
    }
}

/* ── Settings ────────────────────────────────────────── */

@Composable
fun SettingsScreen(vm: OwnerViewModel, nav: NavHostController) {
    val site by vm.siteSettings.collectAsStateWithLifecycle()
    val owner by vm.ownerSettings.collectAsStateWithLifecycle()
    val auth by vm.authState.collectAsStateWithLifecycle()
    val backend by vm.backend.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val s = site.getOrNull()
    val o = owner.getOrNull()

    var name by remember { mutableStateOf("") }
    var announcement by remember { mutableStateOf("") }
    var collection by remember { mutableStateOf(true) }
    var delivery by remember { mutableStateOf(false) }
    var fee by remember { mutableStateOf("") }
    var lowStock by remember { mutableStateOf("") }
    var loadedSite by remember { mutableStateOf(false) }
    var loadedOwner by remember { mutableStateOf(false) }
    var savingShop by remember { mutableStateOf(false) }
    var savingStock by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var confirmForget by remember { mutableStateOf(false) }

    LaunchedEffect(s) {
        if (s != null && !loadedSite) {
            name = s.storeName; announcement = s.announcement; collection = s.collection; delivery = s.delivery
            fee = if (s.deliveryFee > 0) Validation.priceText(s.deliveryFee) else ""
            loadedSite = true
        }
    }
    LaunchedEffect(o) { if (o != null && !loadedOwner) { lowStock = o.defaultLowStock.toString(); loadedOwner = true } }

    val feeValue = Validation.deliveryFee(fee)
    val shopDirty = s != null && (name.trim() != s.storeName || announcement.trim() != s.announcement || collection != s.collection ||
        delivery != s.delivery || (feeValue ?: -1.0) != s.deliveryFee)
    val lowValue = Validation.parseWhole(lowStock, 100_000)

    Column(Modifier.fillMaxSize().background(C.Bg)) {
        BackHeader("Settings", onBack = { nav.popBackStack() })
        if (site is Loadable.Failed) { ErrorBlock((site as Loadable.Failed).message); return@Column }
        if (s == null || o == null) { LoadingBlock(); return@Column }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            // ── shop ─────────────────────────────────
            SectionTitle("Your shop")
            Field("Shop name", name, { name = it.take(60) }, help = "Shown in the browser tab and footer of your website.")
            Field("Announcement (optional)", announcement, { announcement = it.take(160) }, singleLine = false,
                help = "A short message in a thin bar at the top of your website. Leave empty to hide it.")
            SectionTitle("How customers get their order")
            Group {
                SwitchRow("Collection", "Customers collect from you — free", collection, { collection = it })
                Hairline(0.dp)
                SwitchRow("Delivery", "Customers enter an address at checkout", delivery, { delivery = it })
            }
            if (delivery) {
                Field("Delivery charge", fee, { fee = it.filter { c -> c.isDigit() || c == '.' }.take(7) }, prefix = "£",
                    keyboard = KeyboardType.Decimal, placeholder = "0.00",
                    error = if (feeValue == null) "Use an amount like 2.50, up to £1000." else null,
                    help = "Added to the total for delivery orders. Leave empty for free delivery.")
            }
            if (!collection && !delivery) Notice("With both switched off, customers can't place orders on your website.", Tone.ORANGE)
            Field("Currency", "Pounds (GBP, £)", {}, enabled = false)
            PrimaryButton(
                "Save shop settings", busy = savingShop, enabled = shopDirty && feeValue != null && name.isNotBlank(),
                modifier = Modifier.padding(16.dp).fillMaxWidth(),
                onClick = {
                    savingShop = true
                    scope.launch {
                        val next = s.copy(storeName = name.trim(), announcement = announcement.trim(), collection = collection, delivery = delivery, deliveryFee = feeValue ?: 0.0)
                        vm.act("Saved — your website is updated") { it.saveSiteSettings(next) }
                        savingShop = false
                    }
                },
            )

            // ── stock ────────────────────────────────
            SectionTitle("Stock warnings")
            Field("Warn me when a product falls to", lowStock, { lowStock = it.filter { c -> c.isDigit() }.take(6) }, keyboard = KeyboardType.Number,
                error = if (lowValue == null) "Use a whole number." else null,
                help = "Used for every product that doesn't have its own warning level.")
            PrimaryButton(
                "Save", busy = savingStock, enabled = lowValue != null && lowValue != o.defaultLowStock,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth(),
                onClick = {
                    savingStock = true
                    scope.launch { vm.act("Stock warning level saved") { it.saveOwnerSettings(o.copy(defaultLowStock = lowValue ?: 5)) }; savingStock = false }
                },
            )

            // ── notifications ────────────────────────
            SectionTitle("Alerts to send me")
            Group {
                fun save(next: OwnerSettings) = scope.launch { vm.act("Alert settings saved") { it.saveOwnerSettings(next) } }
                SwitchRow("New orders", "Plus a reminder if an order waits over 2 hours", o.notifyOrders, { save(o.copy(notifyOrders = it)) })
                Hairline(0.dp)
                SwitchRow("Customer feedback", null, o.notifyFeedback, { save(o.copy(notifyFeedback = it)) })
                Hairline(0.dp)
                SwitchRow("Low and sold-out stock", null, o.notifyStock, { save(o.copy(notifyStock = it)) })
            }

            // ── account ──────────────────────────────
            SectionTitle("Account")
            Group {
                if (backend?.isDemo == true) {
                    RowItem(onClick = { vm.leaveDemo() }, chevron = false) {
                        Text("Leave demo mode", style = T.label.copy(color = C.Orange))
                        Text("Go back to connecting your real shop", style = T.caption)
                    }
                } else {
                    RowItem(onClick = null) {
                        Text((auth as? AuthState.Owner)?.email ?: "Signed in", style = T.label)
                        Text("Shop owner", style = T.caption)
                    }
                    Hairline(0.dp)
                    RowItem(onClick = { confirmSignOut = true }, chevron = false) {
                        Text("Sign out", style = T.label.copy(color = C.Red))
                    }
                }
            }

            SectionTitle("About")
            Group {
                RowItem(onClick = null) {
                    Text("Plodroid Store Owner ${BuildConfig.VERSION_NAME}", style = T.label)
                    Text(if (BuildConfig.DEBUG) "Debug build — for testing" else "Release build", style = T.caption)
                }
                Hairline(0.dp)
                RowItem(onClick = null) {
                    Text("Connected shop", style = T.label)
                    Text(if (backend?.isDemo == true) "Demo data (this phone only)" else vm.projectId ?: "—", style = T.caption)
                }
                if (vm.connectedOnPhone && backend?.isDemo != true) {
                    Hairline(0.dp)
                    RowItem(onClick = { confirmForget = true }, chevron = false) {
                        Text("Disconnect this phone", style = T.label.copy(color = C.Red))
                        Text("Forget this shop. The app restarts.", style = T.caption)
                    }
                }
            }
        }
    }

    if (confirmSignOut) {
        ConfirmDialog("Sign out?", "This phone will stop getting alerts until you sign in again.", "Sign out",
            onConfirm = { confirmSignOut = false; vm.signOut() }, onDismiss = { confirmSignOut = false }, destructive = true)
    }
    if (confirmForget) {
        val context = LocalContext.current
        ConfirmDialog("Disconnect this phone?", "The app forgets this shop and closes. Your shop and website aren't affected.", "Disconnect",
            onConfirm = {
                confirmForget = false
                vm.signOut()
                vm.forgetConnection()
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                context.startActivity(launch)
                (context as? android.app.Activity)?.finishAffinity()
                kotlin.system.exitProcess(0)
            },
            onDismiss = { confirmForget = false }, destructive = true)
    }
}
