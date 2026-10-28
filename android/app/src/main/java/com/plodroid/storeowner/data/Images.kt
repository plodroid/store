package com.plodroid.storeowner.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** Checks a picked photo and shrinks it so uploads are quick and cheap. */
object Images {
    private val allowed = setOf("image/jpeg", "image/png", "image/webp")
    private const val MAX_SOURCE_BYTES = 15L * 1024 * 1024   // what we accept from the phone
    private const val MAX_UPLOAD_BYTES = 5 * 1024 * 1024      // what the storage rules accept
    private const val MAX_EDGE = 1600

    suspend fun prepare(context: Context, uri: Uri): PreparedImage = withContext(Dispatchers.IO) {
        val cr = context.contentResolver
        val type = cr.getType(uri)
        if (type !in allowed) throw UserFacingException("Please choose a JPG, PNG or WebP photo.")

        val size = cr.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L
        } ?: -1L
        if (size > MAX_SOURCE_BYTES) throw UserFacingException("That photo is too big (over 15 MB). Please choose a smaller one.")

        // Read the size first, then decode a scaled-down copy to save memory.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw UserFacingException("That photo couldn't be opened. Please try another one.")

        var sample = 1
        while (bounds.outWidth / (sample * 2) >= MAX_EDGE || bounds.outHeight / (sample * 2) >= MAX_EDGE) sample *= 2
        val decoded = cr.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw UserFacingException("That photo couldn't be opened. Please try another one.")

        val scale = minOf(1f, MAX_EDGE.toFloat() / maxOf(decoded.width, decoded.height))
        val bmp = if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true) else decoded

        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        if (bmp !== decoded) bmp.recycle()
        decoded.recycle()

        val bytes = out.toByteArray()
        if (bytes.size > MAX_UPLOAD_BYTES) throw UserFacingException("That photo is still too large after shrinking. Please choose another one.")
        PreparedImage(bytes, "image/jpeg")
    }
}
