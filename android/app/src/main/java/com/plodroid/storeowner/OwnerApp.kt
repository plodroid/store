package com.plodroid.storeowner

import android.app.Application
import com.plodroid.storeowner.data.FirebaseConfig
import com.plodroid.storeowner.data.NetworkMonitor
import com.plodroid.storeowner.data.Prefs
import com.plodroid.storeowner.notify.Channels

class OwnerApp : Application() {
    lateinit var prefs: Prefs
        private set
    lateinit var network: NetworkMonitor
        private set

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        network = NetworkMonitor(this)
        // Reconnect to the shop chosen on this phone (no-op if built with google-services.json).
        FirebaseConfig.restore(this, prefs)
        Channels.create(this)
    }
}
