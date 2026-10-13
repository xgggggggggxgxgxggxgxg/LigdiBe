package com.ligdibe.sms

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Exécute la tâche JS « LigdiBeSmsTask » (enregistrée dans index.js) avec le SMS brut.
 * Fonctionne aussi bien application ouverte que fermée.
 */
class SmsHeadlessTaskService : HeadlessJsTaskService() {

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras = intent?.extras ?: return null
        return HeadlessJsTaskConfig(
            TASK_NAME,
            Arguments.fromBundle(extras),
            TIMEOUT_MS,
            true, // autorisé quand l'application est au premier plan
        )
    }

    companion object {
        const val TASK_NAME = "LigdiBeSmsTask"
        private const val TIMEOUT_MS = 30_000L
    }
}
