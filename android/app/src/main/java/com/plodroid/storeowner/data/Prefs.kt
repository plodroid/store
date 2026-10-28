package com.plodroid.storeowner.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Small, non-secret app preferences: which shop this phone is connected to (public
 * Firebase client config only), demo mode, and which tips the owner has dismissed.
 * Passwords and sign-in tokens are never stored here — Firebase Auth manages those.
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("owner_prefs", Context.MODE_PRIVATE)

    var connectionJson: String?
        get() = sp.getString("connection", null)
        set(v) { sp.edit().putString("connection", v).apply() }

    var demoMode: Boolean
        get() = sp.getBoolean("demo", false)
        set(v) { sp.edit().putBoolean("demo", v).apply() }

    var onboardingDone: Boolean
        get() = sp.getBoolean("onboarded", false)
        set(v) { sp.edit().putBoolean("onboarded", v).apply() }

    var askedNotificationPermission: Boolean
        get() = sp.getBoolean("asked_notif", false)
        set(v) { sp.edit().putBoolean("asked_notif", v).apply() }

    fun dismissedHints(): Set<String> = sp.getStringSet("hints", emptySet()) ?: emptySet()

    fun dismissHint(id: String) {
        sp.edit().putStringSet("hints", dismissedHints() + id).apply()
    }

    fun resetHints() {
        sp.edit().remove("hints").putBoolean("onboarded", false).apply()
    }

    fun clearConnection() {
        sp.edit().remove("connection").putBoolean("demo", false).apply()
    }
}
