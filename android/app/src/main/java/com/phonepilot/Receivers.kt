package com.phonepilot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.ContactsContract
import android.provider.Telephony
import android.telephony.TelephonyManager
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Bundle
import kotlinx.coroutines.CompletableDeferred

/** Relance automatique au démarrage / après mise à jour. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Journal.add("Démarrage du téléphone : relance de PhonePilot")
        BridgeService.start(ctx)
    }
}

/** Appels manqués et SMS entrants → événements pour les déclencheurs. */
class PhoneEventsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            TelephonyManager.ACTION_PHONE_STATE_CHANGED -> {
                val st = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
                val num = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                if (num != null && st == TelephonyManager.EXTRA_STATE_RINGING) { lastRinging = num; answered = false }
                if (st == TelephonyManager.EXTRA_STATE_OFFHOOK) answered = true
                if (st == TelephonyManager.EXTRA_STATE_IDLE && lastRinging != null) {
                    if (!answered) {
                        val n = lastRinging!!
                        BridgeService.event("missed_call", json("number" to n, "from" to n, "name" to contactName(ctx, n)))
                    }
                    lastRinging = null
                }
            }
            Telephony.Sms.Intents.SMS_RECEIVED_ACTION -> {
                val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                val from = msgs.firstOrNull()?.originatingAddress ?: return
                val body = msgs.joinToString("") { it.messageBody ?: "" }
                BridgeService.event("sms", json("from" to from, "number" to from, "name" to contactName(ctx, from), "body" to body))
            }
        }
    }

    companion object {
        private var lastRinging: String? = null
        private var answered = false

        fun contactName(ctx: Context, number: String): String? = runCatching {
            val uri = android.net.Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, android.net.Uri.encode(number))
            ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
        }.getOrNull()
    }
}

/**
 * Android 10 interdit la lecture du presse-papiers en arrière-plan : cette activité transparente
 * prend le focus une fraction de seconde, lit (ou écrit) le presse-papiers, puis se ferme.
 */
class ClipboardActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) return
        val cm = getSystemService(ClipboardManager::class.java)
        val set = intent.getStringExtra("set")
        if (set != null) cm.setPrimaryClip(ClipData.newPlainText("PhonePilot", set))
        pending?.complete(cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString() ?: "")
        pending = null
        finish()
    }

    companion object {
        var pending: CompletableDeferred<String>? = null
    }
}
