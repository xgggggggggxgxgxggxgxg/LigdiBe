package com.ligdibe.widget

import android.content.Context
import android.content.SharedPreferences

/** Dernières données du widget, écrites par le JS (textes déjà formatés en français). */
object WidgetStore {
    private const val PREFS = "ligdibe_widget"

    val KEYS = listOf("day", "remaining", "caption", "detail", "status", "badge", "balance", "updated")

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
