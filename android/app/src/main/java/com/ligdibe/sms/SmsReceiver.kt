package com.ligdibe.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Telephony
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/**
 * Intercepte les SMS entrants, même application fermée.
 *
 * - Réassemble les SMS multi-parties (un message long arrive en plusieurs PDU).
 * - Pré-filtre natif très léger (présence d'un montant/solde) pour ne pas réveiller
 *   le moteur JS à chaque SMS personnel. La whitelist stricte des expéditeurs
 *   et le rejet des OTP sont appliqués côté TypeScript (SmsParserEngine).
 * - Délègue au moteur TypeScript via une tâche Headless JS (ProcessIncomingSmsUseCase).
 *
 * Les SMS ne quittent jamais le téléphone : aucun appel réseau.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = try {
            Telephony.Sms.Intents.getMessagesFromIntent(intent)
        } catch (e: Exception) {
            Log.w(TAG, "PDU illisible", e)
            return
        } ?: return

        // Regroupe les parties par expéditeur (un même broadcast peut contenir plusieurs SMS).
        val bySender = LinkedHashMap<String, StringBuilder>()
        var timestamp = System.currentTimeMillis()
        for (msg in messages) {
            if (msg == null) continue
            val sender = msg.displayOriginatingAddress ?: msg.originatingAddress ?: continue
            bySender.getOrPut(sender) { StringBuilder() }.append(msg.displayMessageBody ?: msg.messageBody ?: "")
            timestamp = msg.timestampMillis
        }

        for ((sender, body) in bySender) {
            val text = body.toString()
            if (!looksLikeMoneySms(text)) continue
            dispatchToJs(context, sender, text, timestamp)
        }
    }

    private fun dispatchToJs(context: Context, sender: String, body: String, timestamp: Long) {
        val extras = Bundle().apply {
            putString(EXTRA_SENDER, sender)
            putString(EXTRA_BODY, body)
            putDouble(EXTRA_TIMESTAMP, timestamp.toDouble())
        }
        val serviceIntent = Intent(context, SmsHeadlessTaskService::class.java).putExtras(extras)
        try {
            // SMS_RECEIVED place l'application sur la liste blanche temporaire :
            // le démarrage du service est autorisé même en arrière-plan (Android 8+).
            context.startService(serviceIntent)
            HeadlessJsTaskService.acquireWakeLockNow(context)
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Impossible de démarrer la tâche Headless : SMS mis en file", e)
            PendingSmsStore.enqueue(context, sender, body, timestamp)
        }
    }

    companion object {
        private const val TAG = "LigdiBeSmsReceiver"
        const val EXTRA_SENDER = "sender"
        const val EXTRA_BODY = "body"
        const val EXTRA_TIMESTAMP = "timestamp"

        private val MONEY_PATTERN = Regex("(?i)(FCFA|F\\s?CFA|XOF|\\d\\s?F\\b|solde)")

        fun looksLikeMoneySms(body: String): Boolean = MONEY_PATTERN.containsMatchIn(body)
    }
}
