package com.plodroid.storeowner.ui

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.List
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.plodroid.storeowner.data.AuthState
import com.plodroid.storeowner.domain.OrderStatus
import com.plodroid.storeowner.ui.components.GlassTabBar
import com.plodroid.storeowner.ui.components.LoadingBlock
import com.plodroid.storeowner.ui.components.TabSpec
import com.plodroid.storeowner.ui.screens.CategoriesScreen
import com.plodroid.storeowner.ui.screens.DashboardScreen
import com.plodroid.storeowner.ui.screens.FeedbackDetailScreen
import com.plodroid.storeowner.ui.screens.FeedbackScreen
import com.plodroid.storeowner.ui.screens.MoreScreen
import com.plodroid.storeowner.ui.screens.NotOwnerScreen
import com.plodroid.storeowner.ui.screens.NotificationsScreen
import com.plodroid.storeowner.ui.screens.OnboardingScreen
import com.plodroid.storeowner.ui.screens.OrderDetailScreen
import com.plodroid.storeowner.ui.screens.OrdersScreen
import com.plodroid.storeowner.ui.screens.ProblemScreen
import com.plodroid.storeowner.ui.screens.ProductEditScreen
import com.plodroid.storeowner.ui.screens.ProductsScreen
import com.plodroid.storeowner.ui.screens.SettingsScreen
import com.plodroid.storeowner.ui.screens.SetupScreen
import com.plodroid.storeowner.ui.screens.SignInScreen
import com.plodroid.storeowner.ui.theme.C
import com.plodroid.storeowner.ui.theme.EaseOutStrong
import com.plodroid.storeowner.ui.theme.LocalReducedMotion
import com.plodroid.storeowner.ui.theme.T
import kotlinx.coroutines.launch

object Routes {
    const val HOME = "home"
    const val PRODUCTS = "products"
    const val ORDERS = "orders"
    const val FEEDBACK = "feedback"
    const val MORE = "more"
    const val PRODUCT = "product/{id}"
    const val ORDER = "order/{id}"
    const val FEEDBACK_ITEM = "feedbackItem/{id}"
    const val CATEGORIES = "categories"
    const val NOTIFICATIONS = "notifications"
    const val SETTINGS = "settings"

    fun product(id: String?) = "product/${id ?: "new"}"
    fun order(id: String) = "order/$id"
    fun feedbackItem(id: String) = "feedbackItem/$id"

    val tabs = setOf(HOME, PRODUCTS, ORDERS, FEEDBACK, MORE)
}

private val TABS = listOf(
    TabSpec(Routes.HOME, "Home", Icons.Outlined.Home, Icons.Filled.Home),
    TabSpec(Routes.PRODUCTS, "Products", Icons.Outlined.List, Icons.Filled.List),
    TabSpec(Routes.ORDERS, "Orders", Icons.Outlined.ShoppingCart, Icons.Filled.ShoppingCart),
    TabSpec(Routes.FEEDBACK, "Feedback", Icons.Outlined.Email, Icons.Filled.Email),
    TabSpec(Routes.MORE, "More", Icons.Outlined.Menu, Icons.Filled.Menu),
)

/** Decides what the owner sees first: connect, sign in, intro, or the app itself. */
@Composable
fun AppRoot(vm: OwnerViewModel) {
    val mode by vm.mode.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        when (mode) {
            AppMode.SETUP -> SetupScreen(vm)
            AppMode.DEMO -> OwnerShell(vm)
            AppMode.LIVE -> {
                val auth by vm.authState.collectAsStateWithLifecycle()
                when (val a = auth) {
                    AuthState.Checking -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingBlock() }
                    AuthState.SignedOut -> SignInScreen(vm)
                    is AuthState.NotOwner -> NotOwnerScreen(vm, a)
                    is AuthState.Problem -> ProblemScreen(vm, a.message)
                    is AuthState.Owner -> OwnerShell(vm)
                }
            }
        }
        MessageHost(vm, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun OwnerShell(vm: OwnerViewModel) {
    val onboarded by vm.onboarded.collectAsStateWithLifecycle()
    if (!onboarded) OnboardingScreen(vm) else MainNav(vm)
}

@Composable
private fun MainNav(vm: OwnerViewModel) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val reduced = LocalReducedMotion.current
    val online by vm.online.collectAsStateWithLifecycle()
    val backend by vm.backend.collectAsStateWithLifecycle()
    val orders by vm.orders.collectAsStateWithLifecycle()
    val feedback by vm.feedback.collectAsStateWithLifecycle()
    val link by vm.deepLink.collectAsStateWithLifecycle()

    // Notification taps
    LaunchedEffect(link) {
        val l = link ?: return@LaunchedEffect
        when (l.type) {
            "order" -> if (l.id != null) nav.navigate(Routes.order(l.id)) else tab(nav, Routes.ORDERS)
            "feedback" -> if (l.id != null) nav.navigate(Routes.feedbackItem(l.id)) else tab(nav, Routes.FEEDBACK)
            "stock" -> if (l.id != null) nav.navigate(Routes.product(l.id)) else tab(nav, Routes.PRODUCTS)
            else -> nav.navigate(Routes.NOTIFICATIONS)
        }
        vm.consumeDeepLink()
    }

    val badges = mapOf(
        Routes.ORDERS to (orders.getOrNull()?.count { it.status == OrderStatus.NEW } ?: 0),
        Routes.FEEDBACK to (feedback.getOrNull()?.count { !it.read && !it.archived } ?: 0),
    )

    Column(Modifier.fillMaxSize()) {
        AnimatedVisibility(visible = !online || backend?.isDemo == true) {
            StatusBanner(offline = !online, demo = backend?.isDemo == true)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            NavHost(
                navController = nav,
                startDestination = Routes.HOME,
                modifier = Modifier.fillMaxSize().imePadding(),
                enterTransition = { enter(reduced) },
                exitTransition = { exit(reduced) },
                popEnterTransition = { popEnter(reduced) },
                popExitTransition = { popExit(reduced) },
            ) {
                composable(Routes.HOME) { DashboardScreen(vm, nav) }
                composable(Routes.PRODUCTS) { ProductsScreen(vm, nav) }
                composable(Routes.ORDERS) { OrdersScreen(vm, nav) }
                composable(Routes.FEEDBACK) { FeedbackScreen(vm, nav) }
                composable(Routes.MORE) { MoreScreen(vm, nav) }
                composable(Routes.PRODUCT) { e -> ProductEditScreen(vm, nav, e.arguments?.getString("id")?.takeIf { it != "new" }) }
                composable(Routes.ORDER) { e -> OrderDetailScreen(vm, nav, e.arguments?.getString("id").orEmpty()) }
                composable(Routes.FEEDBACK_ITEM) { e -> FeedbackDetailScreen(vm, nav, e.arguments?.getString("id").orEmpty()) }
                composable(Routes.CATEGORIES) { CategoriesScreen(vm, nav) }
                composable(Routes.NOTIFICATIONS) { NotificationsScreen(vm, nav) }
                composable(Routes.SETTINGS) { SettingsScreen(vm, nav) }
            }
            AnimatedVisibility(
                visible = route in Routes.tabs,
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = if (reduced) EnterTransition.None else slideInVertically(tween(260, easing = EaseOutStrong)) { it } + fadeIn(tween(160)),
                exit = if (reduced) ExitTransition.None else slideOutVertically(tween(200)) { it } + fadeOut(tween(120)),
            ) {
                GlassTabBar(TABS, route, badges, onSelect = { tab(nav, it.route) })
            }
        }
    }
}

fun tab(nav: NavHostController, route: String) {
    nav.navigate(route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

private fun isTab(e: NavBackStackEntry) = e.destination.route in Routes.tabs

private fun AnimatedContentTransitionScope<NavBackStackEntry>.enter(reduced: Boolean): EnterTransition = when {
    reduced -> EnterTransition.None
    isTab(initialState) && isTab(targetState) -> fadeIn(tween(200, easing = EaseOutStrong))
    else -> slideInHorizontally(tween(320, easing = EaseOutStrong)) { it / 4 } + fadeIn(tween(220))
}

private fun AnimatedContentTransitionScope<NavBackStackEntry>.exit(reduced: Boolean): ExitTransition = when {
    reduced -> ExitTransition.None
    isTab(initialState) && isTab(targetState) -> fadeOut(tween(140))
    else -> slideOutHorizontally(tween(320, easing = EaseOutStrong)) { -it / 10 } + fadeOut(tween(200))
}

private fun AnimatedContentTransitionScope<NavBackStackEntry>.popEnter(reduced: Boolean): EnterTransition = when {
    reduced -> EnterTransition.None
    else -> slideInHorizontally(tween(320, easing = EaseOutStrong)) { -it / 10 } + fadeIn(tween(220))
}

private fun AnimatedContentTransitionScope<NavBackStackEntry>.popExit(reduced: Boolean): ExitTransition = when {
    reduced -> ExitTransition.None
    else -> slideOutHorizontally(tween(280, easing = EaseOutStrong)) { it / 4 } + fadeOut(tween(180))
}

@Composable
private fun StatusBanner(offline: Boolean, demo: Boolean) {
    val (text, color) = when {
        offline -> "You're offline. You can look around, but changes can't be saved until you reconnect." to C.Red
        else -> "Demo mode — sample data on this phone only. Nothing reaches your website." to C.Blue
    }
    Row(
        Modifier.fillMaxWidth().background(C.Surface).statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Warning, null, tint = color, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, style = T.caption.copy(color = C.Text, fontSize = 13.sp))
    }
}

/** Success / error messages. Errors are red-edged and stay longer. */
@Composable
private fun MessageHost(vm: OwnerViewModel, modifier: Modifier) {
    val host = remember { SnackbarHostState() }
    var isError by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        vm.messages.collect { m ->
            isError = m.isError
            host.currentSnackbarData?.dismiss()
            launch {
                host.showSnackbar(m.text, duration = if (m.isError) androidx.compose.material3.SnackbarDuration.Long else androidx.compose.material3.SnackbarDuration.Short)
            }
        }
    }
    SnackbarHost(host, modifier.navigationBarsPadding().padding(bottom = 84.dp)) { data ->
        Row(
            Modifier
                .padding(horizontal = 16.dp)
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .shadow(16.dp, RoundedCornerShape(16.dp))
                .clip(RoundedCornerShape(16.dp))
                .background(C.Surface3)
                .border(1.dp, if (isError) C.Red.copy(alpha = 0.6f) else C.Green.copy(alpha = 0.45f), RoundedCornerShape(16.dp))
                .clickable { data.dismiss() }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(if (isError) Icons.Filled.Warning else Icons.Filled.CheckCircle, null, tint = if (isError) C.Red else C.Green, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(data.visuals.message, style = T.body.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium))
        }
    }
}
