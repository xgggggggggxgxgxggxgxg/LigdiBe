package com.ligdibe.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/** Module natif « LigdiBeWidget » : enregistre les données du widget puis le redessine. */
class WidgetModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LigdiBeWidget"

    @ReactMethod
    fun update(payload: ReadableMap, promise: Promise) {
        try {
            val editor = WidgetStore.prefs(reactContext).edit()
            WidgetStore.KEYS.forEach { key ->
                editor.putString(key, if (payload.hasKey(key) && !payload.isNull(key)) payload.getString(key) else "")
            }
            val progress = if (payload.hasKey("progress") && !payload.isNull("progress")) payload.getDouble("progress") else 0.0
            editor.putInt("progress", progress.toInt().coerceIn(0, 100))
            editor.apply()
            BudgetWidgetProvider.refreshAll(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("E_WIDGET", e.message, e)
        }
    }
}
