package com.plodroid.storeowner

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.plodroid.storeowner.notify.DeepLinks
import com.plodroid.storeowner.ui.AppRoot
import com.plodroid.storeowner.ui.DeepLink
import com.plodroid.storeowner.ui.OwnerViewModel
import com.plodroid.storeowner.ui.theme.OwnerTheme

class MainActivity : ComponentActivity() {
    private val vm: OwnerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        handle(intent)
        setContent { OwnerTheme { AppRoot(vm) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Notification taps carry "type" + "id" (both from our own notifications and from FCM). */
    private fun handle(intent: Intent?) {
        val type = intent?.getStringExtra(DeepLinks.TYPE) ?: return
        vm.openDeepLink(DeepLink(type, intent.getStringExtra(DeepLinks.ID)))
        intent.removeExtra(DeepLinks.TYPE)
    }
}
