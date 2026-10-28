package com.plodroid.storeowner.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.plodroid.storeowner.MainActivity
import com.plodroid.storeowner.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

object Channels {
    const val ORDERS = "orders"
    const val FEEDBACK = "feedback"
    const val STOCK = "stock"

    /** Must match the channel ids the Cloud Functions send to. */
    fun create(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(ORDERS, "Orders", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "New orders and orders waiting for you"
                },
                NotificationChannel(FEEDBACK, "Customer feedback", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Messages customers send from the website"
                },
                NotificationChannel(STOCK, "Stock alerts", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Products running low or sold out"
                },
            )
        )
    }

    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
}

/** Where a notification tap should take the owner. Extras match the backend's data payload. */
object DeepLinks {
    const val TYPE = "type"
    const val ID = "id"

    fun intent(context: Context, type: String, id: String?): Intent =
        Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(TYPE, type)
            if (id != null) putExtra(ID, id)
        }
}

/** Saves this phone's push token so the backend knows where to send alerts. */
object DeviceRegistrar {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun registerCurrent(context: Context) {
        if (FirebaseApp.getApps(context).isEmpty()) return
        scope.launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                save(token)
            }
        }
    }

    fun save(token: String) {
        val user = FirebaseAuth.getInstance().currentUser ?: return
        FirebaseFirestore.getInstance().collection("ownerDevices").document(token).set(
            mapOf(
                "uid" to user.uid,
                "platform" to "android",
                "model" to (Build.MANUFACTURER + " " + Build.MODEL).take(80),
                "updatedAt" to FieldValue.serverTimestamp(),
            )
        )
    }

    suspend fun unregisterCurrent() {
        val token = FirebaseMessaging.getInstance().token.await()
        FirebaseFirestore.getInstance().collection("ownerDevices").document(token).delete().await()
    }
}

/**
 * Receives pushes from the backend. When the app is in the background Android shows
 * them automatically; when it's open we show them ourselves so nothing is missed.
 */
class OwnerMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        runCatching { DeviceRegistrar.save(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification ?: return
        val type = message.data[DeepLinks.TYPE] ?: "order"
        val id = message.data[DeepLinks.ID]
        show(applicationContext, type, id, n.title ?: "Plodroid Store", n.body.orEmpty())
    }

    companion object {
        fun show(context: Context, type: String, id: String?, title: String, body: String) {
            if (!Channels.canPost(context)) return
            val channel = when (type) {
                "feedback" -> Channels.FEEDBACK
                "stock" -> Channels.STOCK
                else -> Channels.ORDERS
            }
            val pending = PendingIntent.getActivity(
                context,
                (type + (id ?: "")).hashCode(),
                DeepLinks.intent(context, type, id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notification = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ContextCompat.getColor(context, R.color.notify_accent))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setPriority(if (channel == Channels.ORDERS) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                .build()
            try {
                NotificationManagerCompat.from(context).notify((type + (id ?: "")).hashCode(), notification)
            } catch (_: SecurityException) {
                // permission was revoked between the check and the post — nothing to show
            }
        }
    }
}
