package com.phonepilot

import android.content.pm.PackageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import rikka.shizuku.Shizuku

/**
 * Shell de niveau ADB sans câble, via Shizuku. Sur Android 10 (pas de débogage sans fil natif),
 * Shizuku doit être relancé depuis le Mac après chaque redémarrage : scripts/mac/relancer-shizuku.sh.
 */
object ShizukuShell {
    @Volatile var active = false
        private set
    private var onChange: ((Boolean) -> Unit)? = null

    fun init(listener: (Boolean) -> Unit) {
        onChange = listener
        Shizuku.addBinderReceivedListenerSticky { update() }
        Shizuku.addBinderDeadListener { update() }
        Shizuku.addRequestPermissionResultListener { _, _ -> update() }
        update()
    }

    fun update() {
        val now = runCatching { Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false)
        if (now != active) {
            active = now
            Journal.add(if (now) "Shizuku actif" else "Shizuku inactif — à relancer depuis le Mac")
            onChange?.invoke(now)
            BridgeService.instance?.refresh()
        }
    }

    fun binderAlive() = runCatching { Shizuku.pingBinder() }.getOrDefault(false)

    fun requestPermission() {
        if (binderAlive() && Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) Shizuku.requestPermission(42)
    }

    suspend fun exec(cmd: String, timeoutMs: Long = 30_000): org.json.JSONObject = withContext(Dispatchers.IO) {
        if (!active) throw RpcError("SHIZUKU_INACTIVE", "Shizuku inactif — branche le téléphone au Mac.")
        // newProcess n'est plus public dans l'API 13 : appel par réflexion (toujours présent dans le service).
        val m = Shizuku::class.java.getDeclaredMethod("newProcess", Array<String>::class.java, Array<String>::class.java, String::class.java)
        m.isAccessible = true
        val p = m.invoke(null, arrayOf("sh", "-c", cmd), null, null) as Process
        withTimeout(timeoutMs) {
            val out = async(p.inputStream)
            val err = async(p.errorStream)
            val code = p.waitFor()
            json("stdout" to out.get(), "stderr" to err.get(), "code" to code)
        }
    }

    private fun async(s: java.io.InputStream): java.util.concurrent.Future<String> =
        java.util.concurrent.Executors.newSingleThreadExecutor().submit<String> { s.bufferedReader().readText() }
}
