package com.plodroid.storeowner.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.plodroid.storeowner.OwnerApp
import com.plodroid.storeowner.data.AuthState
import com.plodroid.storeowner.data.DemoShop
import com.plodroid.storeowner.data.FirebaseConfig
import com.plodroid.storeowner.data.FirebaseShop
import com.plodroid.storeowner.data.Images
import com.plodroid.storeowner.data.Loadable
import com.plodroid.storeowner.data.OwnerAuth
import com.plodroid.storeowner.data.PreparedImage
import com.plodroid.storeowner.data.ShopBackend
import com.plodroid.storeowner.data.friendlyMessage
import com.plodroid.storeowner.domain.Category
import com.plodroid.storeowner.domain.Feedback
import com.plodroid.storeowner.domain.Order
import com.plodroid.storeowner.domain.OwnerNotice
import com.plodroid.storeowner.domain.OwnerSettings
import com.plodroid.storeowner.domain.Product
import com.plodroid.storeowner.domain.SiteSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class AppMode { SETUP, DEMO, LIVE }

data class DeepLink(val type: String, val id: String?)

data class UiMessage(val text: String, val isError: Boolean, val id: Long = System.nanoTime())

@OptIn(ExperimentalCoroutinesApi::class)
class OwnerViewModel(app: Application) : AndroidViewModel(app) {
    private val ownerApp = app as OwnerApp
    val prefs = ownerApp.prefs
    val online: StateFlow<Boolean> = ownerApp.network.online

    /* ── which mode the app is in ─────────────────────────── */

    private val _mode = MutableStateFlow(initialMode())
    val mode: StateFlow<AppMode> = _mode

    private fun initialMode(): AppMode = when {
        prefs.demoMode -> AppMode.DEMO
        FirebaseConfig.isReady(ownerApp) -> AppMode.LIVE
        else -> AppMode.SETUP
    }

    /** True when the connection was chosen on this phone (so it can be undone in Settings). */
    val connectedOnPhone: Boolean get() = prefs.connectionJson != null
    val projectId: String? get() = FirebaseConfig.projectId(ownerApp)

    private var authHolder: OwnerAuth? = null
    val auth: OwnerAuth? get() {
        if (authHolder == null && _mode.value == AppMode.LIVE) authHolder = OwnerAuth(ownerApp, viewModelScope)
        return authHolder
    }
    private val noAuth = MutableStateFlow<AuthState>(AuthState.SignedOut)
    val authState: StateFlow<AuthState> get() = auth?.state ?: noAuth

    /* ── the active data source ───────────────────────────── */

    private var live: FirebaseShop? = null
    private fun liveShop(): FirebaseShop = live ?: FirebaseShop(ownerApp.network).also { live = it }

    private val backendFlow: Flow<ShopBackend?> = mode.flatMapLatest { m ->
        when (m) {
            AppMode.SETUP -> flowOf<ShopBackend?>(null)
            AppMode.DEMO -> flowOf<ShopBackend?>(DemoShop())
            AppMode.LIVE -> authState.map<AuthState, ShopBackend?> { s -> if (s is AuthState.Owner) liveShop() else null }
        }
    }
    val backend: StateFlow<ShopBackend?> = backendFlow.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private fun <T> pick(sel: (ShopBackend) -> Flow<Loadable<T>>): StateFlow<Loadable<T>> =
        backend.flatMapLatest { b -> if (b == null) flowOf<Loadable<T>>(Loadable.Loading) else sel(b) }
            .stateIn(viewModelScope, SharingStarted.Eagerly, Loadable.Loading)

    val products: StateFlow<Loadable<List<Product>>> = pick { it.products }
    val categories: StateFlow<Loadable<List<Category>>> = pick { it.categories }
    val orders: StateFlow<Loadable<List<Order>>> = pick { it.orders }
    val feedback: StateFlow<Loadable<List<Feedback>>> = pick { it.feedback }
    val notices: StateFlow<Loadable<List<OwnerNotice>>> = pick { it.notices }
    val siteSettings: StateFlow<Loadable<SiteSettings>> = pick { it.siteSettings }
    val ownerSettings: StateFlow<Loadable<OwnerSettings>> = pick { it.ownerSettings }

    val defaultLowStock: Int get() = ownerSettings.value.getOrNull()?.defaultLowStock ?: 5

    /* ── messages (shown as snackbars) ────────────────────── */

    private val _messages = MutableSharedFlow<UiMessage>(extraBufferCapacity = 8)
    val messages: SharedFlow<UiMessage> = _messages
    fun say(text: String, isError: Boolean = false) { _messages.tryEmit(UiMessage(text, isError)) }

    /**
     * Runs a change against the backend. Returns the result, or null after telling the
     * owner (in plain words) why it didn't work. Never reports success early.
     */
    suspend fun <T> act(success: String?, block: suspend (ShopBackend) -> T): T? {
        val b = backend.value ?: run { say("Not connected to your shop yet.", true); return null }
        return try {
            val r = block(b)
            if (success != null) say(success)
            r
        } catch (e: TimeoutCancellationException) {
            say(friendlyMessage(e), true); null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say(friendlyMessage(e), true); null
        }
    }

    fun launchAct(success: String?, block: suspend (ShopBackend) -> Unit) {
        viewModelScope.launch { act(success, block) }
    }

    suspend fun prepareImage(uri: Uri): PreparedImage? = try {
        Images.prepare(ownerApp, uri)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        say(friendlyMessage(e), true); null
    }

    /* ── connection / demo ────────────────────────────────── */

    fun connectFromFile(text: String): String? = try {
        val c = FirebaseConfig.parseGoogleServices(text)
        FirebaseConfig.connect(ownerApp, prefs, c)
        _mode.value = AppMode.LIVE
        null
    } catch (e: Exception) {
        friendlyMessage(e)
    }

    fun startDemo() {
        prefs.demoMode = true
        _mode.value = AppMode.DEMO
    }

    fun leaveDemo() {
        prefs.demoMode = false
        _mode.value = if (FirebaseConfig.isReady(ownerApp)) AppMode.LIVE else AppMode.SETUP
    }

    /** Forgets a connection chosen on this phone. The app must restart to fully let go of it. */
    fun forgetConnection() {
        prefs.clearConnection()
    }

    fun signOut() {
        viewModelScope.launch {
            try { auth?.signOut() } catch (e: Exception) { say(friendlyMessage(e), true) }
        }
    }

    /* ── tips & onboarding ────────────────────────────────── */

    private val _hints = MutableStateFlow(prefs.dismissedHints())
    val dismissedHints: StateFlow<Set<String>> = _hints
    fun dismissHint(id: String) { prefs.dismissHint(id); _hints.value = prefs.dismissedHints() }

    private val _onboarded = MutableStateFlow(prefs.onboardingDone)
    val onboarded: StateFlow<Boolean> = _onboarded
    fun finishOnboarding() { prefs.onboardingDone = true; _onboarded.value = true }
    fun showTipsAgain() {
        prefs.resetHints()
        _hints.value = emptySet()
        _onboarded.value = false
    }

    /* ── deep links from notifications ────────────────────── */

    private val _deepLink = MutableStateFlow<DeepLink?>(null)
    val deepLink: StateFlow<DeepLink?> = _deepLink
    fun openDeepLink(link: DeepLink) { _deepLink.value = link }
    fun consumeDeepLink() { _deepLink.value = null }

    override fun onCleared() {
        authHolder?.close()
        super.onCleared()
    }
}
