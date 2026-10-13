package com.ligdibe.sms

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * File de secours (SharedPreferences privées) si le système refuse de démarrer la
 * tâche Headless. Vidée par le JS au prochain lancement (LigdiBeSms.drainPending).
 */
object PendingSmsStore {
    private const val PREFS = "ligdibe_pending_sms"
    private const val KEY = "queue"
    private const val MAX_ITEMS = 200

    @Synchronized
    fun enqueue(context: Context, sender: String, body: String, timestamp: Long) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val queue = JSONArray(prefs.getString(KEY, "[]"))
        if (queue.length() >= MAX_ITEMS) queue.remove(0)
        queue.put(JSONObject().put("sender", sender).put("body", body).put("timestamp", timestamp))
        prefs.edit().putString(KEY, queue.toString()).apply()
    }

    @Synchronized
    fun drain(context: Context): JSONArray {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val queue = JSONArray(prefs.getString(KEY, "[]"))
        prefs.edit().remove(KEY).apply()
        return queue
    }
}
