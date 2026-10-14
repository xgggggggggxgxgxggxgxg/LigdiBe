package com.ligdibe.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import com.ligdibe.MainActivity
import com.ligdibe.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Widget « Budget du jour » : reste à dépenser, jauge, série 🔥 et (si autorisé)
 * patrimoine. Les données sont calculées par l'application ou la tâche SMS Headless.
 */
class BudgetWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { manager.updateAppWidget(it, render(context)) }
    }

    companion object {
        private const val GREEN = "#FFFFFF"
        private const val WARNING = "#FFD54F"
        private const val EXCEEDED = "#FF8A80"

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, BudgetWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                val views = render(context)
                ids.forEach { manager.updateAppWidget(it, views) }
            }
        }

        private fun render(context: Context): RemoteViews {
            val prefs = WidgetStore.prefs(context)
            val views = RemoteViews(context.packageName, R.layout.widget_budget)
            val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val day = prefs.getString("day", null)

            if (day == null || day != today) {
                // Rien encore calculé, ou nouveau jour : l'enveloppe d'hier n'a plus de sens.
                views.setTextViewText(R.id.widget_remaining, "—")
                views.setTextViewText(
                    R.id.widget_caption,
                    context.getString(if (day == null) R.string.widget_empty else R.string.widget_stale),
                )
                views.setTextViewText(R.id.widget_detail, "")
                views.setProgressBar(R.id.widget_progress, 100, 0, false)
                views.setViewVisibility(R.id.widget_badge, View.GONE)
                views.setViewVisibility(R.id.widget_balance, View.GONE)
                views.setTextViewText(R.id.widget_updated, "")
            } else {
                val status = prefs.getString("status", "OK")
                val color = Color.parseColor(
                    when (status) {
                        "EXCEEDED" -> EXCEEDED
                        "WARNING" -> WARNING
                        else -> GREEN
                    },
                )
                views.setTextViewText(R.id.widget_remaining, prefs.getString("remaining", ""))
                views.setTextColor(R.id.widget_remaining, color)
                views.setTextViewText(R.id.widget_caption, prefs.getString("caption", ""))
                views.setTextViewText(R.id.widget_detail, prefs.getString("detail", ""))
                views.setProgressBar(R.id.widget_progress, 100, prefs.getInt("progress", 0), false)
                setOptional(views, R.id.widget_badge, prefs.getString("badge", ""))
                setOptional(views, R.id.widget_balance, prefs.getString("balance", ""))
                views.setTextViewText(R.id.widget_updated, prefs.getString("updated", ""))
            }

            val launch = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context,
                0,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pending)
            return views
        }

        private fun setOptional(views: RemoteViews, id: Int, text: String?) {
            if (text.isNullOrEmpty()) {
                views.setViewVisibility(id, View.GONE)
            } else {
                views.setViewVisibility(id, View.VISIBLE)
                views.setTextViewText(id, text)
            }
        }
    }
}
