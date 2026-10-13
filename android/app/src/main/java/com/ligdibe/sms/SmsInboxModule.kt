package com.ligdibe.sms

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Module natif « LigdiBeSms » :
 * - readInbox : import de l'historique des SMS (premier lancement / rattrapage),
 * - drainPending : récupère les SMS mis en file quand la tâche Headless n'a pas pu démarrer.
 */
class SmsInboxModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LigdiBeSms"

    @ReactMethod
    fun readInbox(sinceMs: Double, limit: Int, promise: Promise) {
        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("E_PERMISSION", "Permission READ_SMS refusée")
            return
        }
        try {
            val result = Arguments.createArray()
            val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
            reactContext.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                "${Telephony.Sms.DATE} >= ?",
                arrayOf(sinceMs.toLong().toString()),
                "${Telephony.Sms.DATE} ASC",
            )?.use { cursor ->
                val iAddress = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                val iBody = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
                val iDate = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
                var count = 0
                while (cursor.moveToNext() && count < limit) {
                    val body = cursor.getString(iBody) ?: continue
                    if (!SmsReceiver.looksLikeMoneySms(body)) continue
                    result.pushMap(Arguments.createMap().apply {
                        putString("sender", cursor.getString(iAddress) ?: "")
                        putString("body", body)
                        putDouble("timestamp", cursor.getLong(iDate).toDouble())
                    })
                    count++
                }
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("E_READ_INBOX", e)
        }
    }

    @ReactMethod
    fun drainPending(promise: Promise) {
        try {
            val queue = PendingSmsStore.drain(reactContext)
            val result = Arguments.createArray()
            for (i in 0 until queue.length()) {
                val item = queue.getJSONObject(i)
                result.pushMap(Arguments.createMap().apply {
                    putString("sender", item.getString("sender"))
                    putString("body", item.getString("body"))
                    putDouble("timestamp", item.getLong("timestamp").toDouble())
                })
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("E_DRAIN", e)
        }
    }
}
