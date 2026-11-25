package com.phonepilot

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject

/** Écran de statut en français : connexion, permissions, STOP/Reprendre, confirmations, journal. */
class MainActivity : ComponentActivity() {
    private lateinit var status: TextView
    private lateinit var journal: TextView
    private lateinit var stopBtn: Button

    private val scan = registerForActivityResult(ScanContract()) { r -> r.contents?.let { applyPairing(it) } }
    private val perms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        BridgeService.start(this)
        setContentView(buildUi())
        Journal.listener = { runOnUiThread { journal.text = Journal.text() } }
    }

    override fun onResume() { super.onResume(); ShizukuShell.update(); refresh() }
    override fun onDestroy() { if (current === this) current = null; super.onDestroy() }

    private fun buildUi(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 48, 40, 48) }
        fun title(t: String) = col.addView(TextView(this).apply { text = t; textSize = 18f; setTypeface(null, Typeface.BOLD); setPadding(0, 36, 0, 12) })
        fun button(t: String, onClick: () -> Unit) = col.addView(Button(this).apply { text = t; isAllCaps = false; setOnClickListener { onClick() } })

        col.addView(TextView(this).apply { text = "PhonePilot"; textSize = 26f; setTypeface(null, Typeface.BOLD) })
        status = TextView(this).apply { textSize = 15f; setPadding(0, 16, 0, 16) }
        col.addView(status)

        stopBtn = Button(this).apply {
            textSize = 20f; setTextColor(Color.WHITE); setPadding(0, 40, 0, 40)
            setOnClickListener {
                if (Prefs.stopped) AlertDialog.Builder(this@MainActivity).setTitle("Reprendre ?")
                    .setMessage("Claude pourra de nouveau agir sur le téléphone.").setPositiveButton("Reprendre") { _, _ -> Emergency.resume(); refresh() }
                    .setNegativeButton("Annuler", null).show()
                else { Emergency.stop("bouton STOP de l'app"); refresh() }
            }
        }
        col.addView(stopBtn)

        title("1. Connexion au serveur PhonePilot")
        button("Saisir l'adresse du serveur (https://…workers.dev)") {
            val input = EditText(this).apply { hint = "https://phonepilot.ton-compte.workers.dev"; setText(Prefs.bridgeUrl.replace("wss://", "https://").removeSuffix("/phone")) }
            AlertDialog.Builder(this).setTitle("Adresse du serveur").setView(input).setPositiveButton("OK") { _, _ -> applyPairing(input.text.toString()) }.show()
        }
        button("Scanner un QR code (adresse du serveur)") { scan.launch(ScanOptions().setPrompt("Scanne le QR de l'adresse du serveur").setBeepEnabled(false).setOrientationLocked(false)) }
        button("Révoquer tous les accès Claude") {
            AlertDialog.Builder(this).setTitle("Révoquer ?").setMessage("Claude devra se reconnecter (et tu devras réapprouver sur le téléphone).")
                .setPositiveButton("Révoquer") { _, _ -> BridgeService.event("revoke_tokens", JSONObject()); Journal.add("🔒 Accès Claude révoqués") }
                .setNegativeButton("Annuler", null).show()
        }

        title("2. Permissions (à faire une fois)")
        button("Autoriser les permissions de base") {
            perms.launch(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION,
                Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS, Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE,
                Manifest.permission.READ_CALL_LOG, Manifest.permission.ANSWER_PHONE_CALLS, Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS,
                Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA))
        }
        button("Localisation « Toujours autoriser »") { perms.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) }
        button("Accessibilité › PhonePilot (lecture et contrôle de l'écran)") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        button("Autoriser la capture d'écran") { startActivity(Intent(this, CaptureActivity::class.java)) }
        button("Accès aux notifications") { open(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")) }
        button("Afficher par-dessus les autres applis") { open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        button("Modifier les paramètres système (luminosité, veille, rotation)") { open(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName"))) }
        button("Accès « Ne pas déranger »") { open(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)) }
        button("Accès aux données d'utilisation (temps d'écran)") { open(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
        button("Ignorer l'optimisation de la batterie") { open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
        button("Huawei : Lancement d'applications (gérer manuellement)") {
            val tries = listOf(
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
            )
            if (tries.none { runCatching { startActivity(Intent().setComponent(it)) }.isSuccess }) open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        button("Reconnecter au serveur") { BridgeService.reconnect(this) }

        title("3. Confirmations demandées sur le téléphone")
        for ((key, label) in Prefs.allCategories) col.addView(Switch(this).apply {
            text = label; isChecked = Prefs.requiresConfirm(key); setPadding(0, 12, 0, 12)
            setOnCheckedChangeListener { _, v -> Prefs.setRequiresConfirm(key, v) }
        })

        title("Journal")
        journal = TextView(this).apply { textSize = 12f; typeface = Typeface.MONOSPACE; text = Journal.text() }
        col.addView(journal)
        refresh()
        return ScrollView(this).apply { addView(col) }
    }

    private fun open(i: Intent) = runCatching { startActivity(i) }.onFailure { Toast.makeText(this, "Écran introuvable sur ce téléphone", Toast.LENGTH_SHORT).show() }

    /** Accepte « https://hote[#code=XXXX] », « wss://hote/phone » ou l'ancien JSON {url, token}. */
    private fun applyPairing(raw: String) {
        runCatching {
            val text = raw.trim()
            if (text.startsWith("{")) {
                val j = JSONObject(text)
                Prefs.bridgeUrl = j.getString("url"); Prefs.token = j.getString("token")
            } else {
                val code = text.substringAfter("#code=", "").trim()
                var base = text.substringBefore("#").trimEnd('/')
                require(base.startsWith("https://") || base.startsWith("wss://") || base.startsWith("ws://") || base.startsWith("http://"))
                base = base.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
                Prefs.bridgeUrl = if (base.endsWith("/phone")) base else "$base/phone"
                if (code.isNotBlank()) Prefs.pairingCode = code
                Prefs.ensureToken()
            }
            Journal.add("Serveur : ${Prefs.bridgeUrl}")
            BridgeService.reconnect(this)
        }.onFailure { Toast.makeText(this, "Adresse invalide (attendu : https://…)", Toast.LENGTH_LONG).show() }
        refresh()
    }

    fun refresh() {
        if (!::status.isInitialized) return
        val ok = { b: Boolean -> if (b) "✅" else "❌" }
        val svc = BridgeService.instance
        val pmgr = getSystemService(PowerManager::class.java)
        status.text = """
            ${ok(svc?.connected == true)} Serveur : ${if (svc?.connected == true) "connecté" else if (Prefs.bridgeUrl.isBlank()) "adresse à saisir" else "recherche… (${Prefs.bridgeUrl})"}
            ${ok(PilotAccessibilityService.instance != null)} Accessibilité
            ${ok(ScreenCapture.ready)} Capture d'écran
            ${ok(PilotNotificationListener.instance != null)} Notifications
            ${ok(Settings.canDrawOverlays(this))} Superposition (ouvrir des applis en arrière-plan)
            ${ok(pmgr.isIgnoringBatteryOptimizations(packageName))} Batterie non optimisée
            ${ok(Settings.System.canWrite(this))} Paramètres système (luminosité, veille)
        """.trimIndent()
        stopBtn.text = if (Prefs.stopped) "▶️  REPRENDRE (arrêt d'urgence actif)" else "⛔  STOP — bloquer Claude"
        stopBtn.setBackgroundColor(if (Prefs.stopped) Color.rgb(30, 130, 60) else Color.rgb(200, 30, 30))
        stopBtn.gravity = Gravity.CENTER
    }

    companion object {
        @Volatile private var current: MainActivity? = null
        fun refreshUi() { current?.let { a -> a.runOnUiThread { a.refresh() } } }
    }
}
