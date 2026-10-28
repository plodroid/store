package com.plodroid.storeowner.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Live "is there internet?" signal for banners and for refusing writes while offline. */
class NetworkMonitor(context: Context) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val _online = MutableStateFlow(check())
    val online: StateFlow<Boolean> = _online

    init {
        val request = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
        cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { _online.value = check() }
            override fun onLost(network: Network) { _online.value = check() }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { _online.value = check() }
        })
    }

    fun check(): Boolean {
        val n = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(n) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun requireOnline() {
        if (!check()) throw OfflineException()
    }
}
