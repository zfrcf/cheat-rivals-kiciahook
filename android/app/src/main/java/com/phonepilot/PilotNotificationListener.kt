package com.phonepilot

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/** Lecture / réponse / effacement des notifications + historique du jour (pour le résumé quotidien). */
class PilotNotificationListener : NotificationListenerService() {
    override fun onListenerConnected() { instance = this; Journal.add("Accès aux notifications actif") }
    override fun onListenerDisconnected() { instance = null }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName) return
        val j = toJson(sbn)
        synchronized(history) {
            history.addLast(j)
            while (history.size > 2000) history.removeFirst()
        }
        if (!sbn.isOngoing) BridgeService.event("notification", JSONObject(j.toString()).apply { put("from", optString("title")) })
    }

    private fun toJson(sbn: StatusBarNotification): JSONObject {
        val e = sbn.notification.extras
        val label = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString() }.getOrNull()
        return json(
            "key" to sbn.key, "app" to sbn.packageName, "appLabel" to label,
            "title" to e.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            "text" to (e.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: e.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
            "time" to msToIso(sbn.postTime),
            "canReply" to (replyAction(sbn.notification) != null),
            "ongoing" to sbn.isOngoing,
        )
    }

    private fun replyAction(n: Notification): Notification.Action? =
        n.actions?.firstOrNull { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true }

    fun list(app: String?): JSONArray = activeNotifications.filter { app == null || it.packageName.contains(app, true) }.toJsonArray { toJson(it) }

    fun reply(key: String, text: String): JSONObject {
        val sbn = activeNotifications.firstOrNull { it.key == key } ?: throw RpcError("NOTIF_GONE", "Notification introuvable (déjà lue ?).")
        val action = replyAction(sbn.notification) ?: throw RpcError("NO_REPLY", "Cette notification ne permet pas de répondre directement.")
        val intent = Intent()
        val results = Bundle()
        action.remoteInputs.forEach { results.putCharSequence(it.resultKey, text) }
        RemoteInput.addResultsToIntent(action.remoteInputs, intent, results)
        action.actionIntent.send(this, 0, intent)
        return json("ok" to true)
    }

    fun dismiss(key: String?, app: String?, all: Boolean): JSONObject {
        when {
            key != null -> cancelNotification(key)
            app != null -> activeNotifications.filter { it.packageName.contains(app, true) }.forEach { cancelNotification(it.key) }
            all -> cancelAllNotifications()
            else -> throw RpcError("BAD_ARGS", "key, app ou all requis")
        }
        return json("ok" to true)
    }

    companion object {
        @Volatile var instance: PilotNotificationListener? = null
        val history = ArrayDeque<JSONObject>()

        fun require() = instance ?: throw RpcError("NOTIF_OFF", "Accès aux notifications non accordé : Paramètres › Applications › Accès spécial › Accès aux notifications › PhonePilot.")

        fun historySince(ms: Long, app: String?): JSONArray = synchronized(history) {
            history.filter { (isoToMs(it.optString("time")) ?: 0) >= ms && (app == null || it.optString("app").contains(app, true)) }.toJsonArray { it }
        }
    }
}
