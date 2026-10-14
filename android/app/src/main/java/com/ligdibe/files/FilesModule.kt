package com.ligdibe.files

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Module natif « LigdiBeFiles » :
 * - shareFile : envoie une sauvegarde par WhatsApp, Bluetooth, e-mail, Drive… (FileProvider),
 * - pickFile : ouvre le sélecteur de fichiers Android et renvoie le contenu en base64.
 */
class FilesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var pickPromise: Promise? = null

    private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != PICK_REQUEST) return
            val promise = pickPromise ?: return
            pickPromise = null
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null) {
                promise.resolve(null)
                return
            }
            try {
                promise.resolve(readUri(uri))
            } catch (e: Exception) {
                promise.reject("E_READ", e.message, e)
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityListener)
    }

    override fun getName(): String = "LigdiBeFiles"

    @ReactMethod
    fun shareFile(path: String, mimeType: String, title: String, promise: Promise) {
        try {
            val file = File(path)
            if (!file.exists()) {
                promise.reject("E_NOT_FOUND", "Fichier introuvable : $path")
                return
            }
            val uri = FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, file.name)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, title).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val activity = currentActivity
            if (activity != null) {
                activity.startActivity(chooser)
            } else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(chooser)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_SHARE", e.message, e)
        }
    }

    @ReactMethod
    fun pickFile(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "Application au premier plan requise")
            return
        }
        if (pickPromise != null) {
            promise.reject("E_BUSY", "Sélection déjà en cours")
            return
        }
        pickPromise = promise
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf("application/zip", "application/x-zip-compressed", "application/json", "application/octet-stream", "text/plain"),
                )
            }
            activity.startActivityForResult(intent, PICK_REQUEST)
        } catch (e: Exception) {
            pickPromise = null
            promise.reject("E_PICK", e.message, e)
        }
    }

    private fun readUri(uri: Uri): com.facebook.react.bridge.WritableMap {
        val resolver = reactContext.contentResolver
        var name = uri.lastPathSegment ?: "sauvegarde"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        if (size > MAX_BYTES) throw IllegalStateException("Fichier trop volumineux pour une sauvegarde LigdiBe")
        val bytes = resolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_BYTES) throw IllegalStateException("Fichier trop volumineux pour une sauvegarde LigdiBe")
                out.write(buffer, 0, read)
            }
            out.toByteArray()
        } ?: throw IllegalStateException("Lecture impossible")
        return Arguments.createMap().apply {
            putString("name", name)
            putDouble("size", bytes.size.toDouble())
            putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
    }

    companion object {
        private const val PICK_REQUEST = 4242
        private const val MAX_BYTES = 64L * 1024 * 1024
    }
}
