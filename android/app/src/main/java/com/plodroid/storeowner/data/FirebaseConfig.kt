package com.plodroid.storeowner.data

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import org.json.JSONObject

/**
 * Connects the app to the owner's Firebase project.
 *
 * Two ways:
 *  1. Build-time: put google-services.json in android/app/ before building (Firebase sets itself up).
 *  2. On the phone: pick the google-services.json file once in the app. We read the public
 *     client settings from it and remember them. No rebuild needed, no secrets involved.
 */
object FirebaseConfig {
    const val PACKAGE = "com.plodroid.storeowner"

    data class Connection(
        val projectId: String,
        val appId: String,
        val apiKey: String,
        val senderId: String,
        val storageBucket: String?,
    ) {
        fun toJson(): String = JSONObject()
            .put("projectId", projectId).put("appId", appId).put("apiKey", apiKey)
            .put("senderId", senderId).put("storageBucket", storageBucket ?: "")
            .toString()

        fun toOptions(): FirebaseOptions = FirebaseOptions.Builder()
            .setProjectId(projectId)
            .setApplicationId(appId)
            .setApiKey(apiKey)
            .setGcmSenderId(senderId)
            .apply { if (!storageBucket.isNullOrBlank()) setStorageBucket(storageBucket) }
            .build()

        companion object {
            fun fromJson(s: String): Connection? = runCatching {
                val o = JSONObject(s)
                Connection(
                    o.getString("projectId"), o.getString("appId"), o.getString("apiKey"),
                    o.getString("senderId"), o.optString("storageBucket").ifBlank { null },
                )
            }.getOrNull()
        }
    }

    /** True when Firebase is ready (bundled at build time or connected on this phone). */
    fun isReady(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    fun projectId(context: Context): String? =
        if (isReady(context)) FirebaseApp.getInstance().options.projectId else null

    /** Called from Application.onCreate: restores a connection saved on this phone. */
    fun restore(context: Context, prefs: Prefs) {
        if (isReady(context)) return
        val c = prefs.connectionJson?.let { Connection.fromJson(it) } ?: return
        runCatching { FirebaseApp.initializeApp(context, c.toOptions()) }
    }

    /**
     * Reads a google-services.json file. Throws [UserFacingException] with a clear reason
     * when the file is wrong (e.g. registered for a different app).
     */
    fun parseGoogleServices(text: String): Connection {
        val root = try { JSONObject(text) } catch (e: Exception) {
            throw UserFacingException("That file isn't a google-services.json file. Download it again from the Firebase console.")
        }
        val info = root.optJSONObject("project_info")
            ?: throw UserFacingException("That file is missing project details. Download google-services.json again from the Firebase console.")
        val projectId = info.optString("project_id")
        val senderId = info.optString("project_number")
        val bucket = info.optString("storage_bucket").ifBlank { null }
        val clients = root.optJSONArray("client")
            ?: throw UserFacingException("That file has no Android apps in it.")

        var found: JSONObject? = null
        val names = mutableListOf<String>()
        for (i in 0 until clients.length()) {
            val c = clients.getJSONObject(i)
            val pkg = c.optJSONObject("client_info")?.optJSONObject("android_client_info")?.optString("package_name").orEmpty()
            names += pkg
            if (pkg == PACKAGE) found = c
        }
        val client = found ?: throw UserFacingException(
            "This file is for a different app (${names.filter { it.isNotBlank() }.joinToString().ifBlank { "unknown" }}). " +
                "In Firebase, add an Android app with the package name $PACKAGE, then download its google-services.json."
        )
        val appId = client.optJSONObject("client_info")?.optString("mobilesdk_app_id").orEmpty()
        val keys = client.optJSONArray("api_key")
        val apiKey = if (keys != null && keys.length() > 0) keys.getJSONObject(0).optString("current_key") else ""
        if (projectId.isBlank() || senderId.isBlank() || appId.isBlank() || apiKey.isBlank()) {
            throw UserFacingException("That file is incomplete. Download google-services.json again from the Firebase console.")
        }
        return Connection(projectId, appId, apiKey, senderId, bucket)
    }

    /** Saves and starts the connection right away. */
    fun connect(context: Context, prefs: Prefs, c: Connection) {
        FirebaseApp.initializeApp(context, c.toOptions())
        prefs.connectionJson = c.toJson()
        prefs.demoMode = false
    }
}
