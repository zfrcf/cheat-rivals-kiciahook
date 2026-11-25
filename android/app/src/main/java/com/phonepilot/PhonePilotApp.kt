package com.phonepilot

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class PhonePilotApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_STATUS, getString(R.string.channel_status), NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CH_CONFIRM, getString(R.string.channel_confirm), NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)
        })
        nm.createNotificationChannel(NotificationChannel(CH_ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_DEFAULT))
    }

    companion object {
        lateinit var instance: PhonePilotApp
        const val CH_STATUS = "statut"
        const val CH_CONFIRM = "confirmations"
        const val CH_ALERTS = "alertes"
    }
}

/** Journal local affiché dans l'app (le journal d'audit complet est côté serveur). */
object Journal {
    private val lines = ArrayDeque<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.FRANCE)
    var listener: (() -> Unit)? = null

    @Synchronized
    fun add(msg: String) {
        lines.addFirst("${fmt.format(Date())}  $msg")
        while (lines.size > 300) lines.removeLast()
        listener?.invoke()
    }

    @Synchronized
    fun text(): String = lines.joinToString("\n")
}

/** Réglages + jeton d'appairage chiffré par l'Android Keystore. */
object Prefs {
    private const val KEY_ALIAS = "phonepilot_token_key"
    private val sp by lazy { PhonePilotApp.instance.getSharedPreferences("phonepilot", Context.MODE_PRIVATE) }

    var bridgeUrl: String
        get() = sp.getString("url", "") ?: ""
        set(v) = sp.edit().putString("url", v).apply()

    var token: String
        get() = sp.getString("token", null)?.let { decrypt(it) } ?: ""
        set(v) = sp.edit().putString("token", encrypt(v)).apply()

    var pairingCode: String
        get() = sp.getString("code", "") ?: ""
        set(v) = sp.edit().putString("code", v).apply()

    /** Jeton généré sur le téléphone (mode cloud : le serveur adopte le premier téléphone qui se présente). */
    fun ensureToken(): String {
        if (token.isBlank()) {
            val b = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
            token = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        }
        return token
    }

    var stopped: Boolean
        get() = sp.getBoolean("stopped", false)
        set(v) = sp.edit().putBoolean("stopped", v).apply()

    var enabled: Boolean
        get() = sp.getBoolean("enabled", true)
        set(v) = sp.edit().putBoolean("enabled", v).apply()

    val allCategories = listOf(
        "paiement" to "Paiement", "achat" to "Achat", "virement" to "Virement",
        "nouveau_contact" to "Envoi à un nouveau contact", "suppression_definitive" to "Suppression définitive",
        "publication_publique" to "Publication publique", "securite" to "Mot de passe / sécurité",
        "desinstallation" to "Désinstallation", "redemarrage" to "Redémarrage", "declencheur" to "Déclencheurs automatiques",
    )

    /** Catégories pour lesquelles on demande Oui/Non. Une catégorie absente = refus automatique impossible : on demande toujours par défaut. */
    fun requiresConfirm(cat: String): Boolean = sp.getBoolean("confirm_$cat", true)
    fun setRequiresConfirm(cat: String, v: Boolean) = sp.edit().putBoolean("confirm_$cat", v).apply()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(s: String): String? = runCatching {
        val (iv, data) = s.split(":")
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)))
    }.getOrNull()
}
