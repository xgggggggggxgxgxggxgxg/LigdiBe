package com.ligdibe.contacts

import android.Manifest
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Module natif « LigdiBeContacts » : lecture locale des contacts (nom + numéro)
 * pour remplir « Ma famille ». Rien ne quitte l'appareil.
 */
class ContactsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LigdiBeContacts"

    @ReactMethod
    fun list(promise: Promise) {
        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CONTACTS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("E_PERMISSION", "Permission READ_CONTACTS refusée")
            return
        }
        try {
            val result = Arguments.createArray()
            val projection = arrayOf(
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.STARRED,
            )
            reactContext.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC",
            )?.use { cursor ->
                val idIdx = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
                val nameIdx = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numberIdx = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
                val starredIdx = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.STARRED)
                while (cursor.moveToNext()) {
                    val number = cursor.getString(numberIdx) ?: continue
                    val map = Arguments.createMap()
                    map.putString("id", cursor.getString(idIdx) ?: "")
                    map.putString("name", cursor.getString(nameIdx) ?: number)
                    map.putString("phone", number)
                    map.putBoolean("starred", cursor.getInt(starredIdx) == 1)
                    result.pushMap(map)
                }
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("E_CONTACTS", e.message, e)
        }
    }
}
