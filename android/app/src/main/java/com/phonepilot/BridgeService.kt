package com.phonepilot

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Service de premier plan permanent : tient la connexion SORTANTE vers le bridge du Mac
 * (aucun port ouvert sur le téléphone), exécute les requêtes, affiche « PhonePilot actif » + STOP.
 */
class BridgeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var ws: WebSocket? = null
    private var backoffMs = 2000L
    private var connecting = false
    private lateinit var wake: PowerManager.WakeLock

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PhonePilot:req")
        startForeground(NOTIF_ID, buildNotification())
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (!connected) { backoffMs = 2000; connect() }
            }
        })
        ShizukuShell.init { active -> sendEvent("shizuku", json("active" to active)); sendEvent("methods", Router.methods().toJsonArray { it }) }
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_RECONNECT) { ws?.close(1000, "reconnexion"); backoffMs = 1000; connect() }
        return START_STICKY
    }

    override fun onDestroy() {
        ws?.close(1000, "arrêt du service")
        instance = null
        super.onDestroy()
    }

    // ---------- Connexion ----------

    @Volatile var connected = false
        private set

    private fun connect() {
        if (connecting || connected || !Prefs.enabled) return
        val url = Prefs.bridgeUrl
        if (url.isBlank() || Prefs.token.isBlank()) { Journal.add("Pas appairé : scanne le QR code du Mac."); return }
        connecting = true
        ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(json(
                    "type" to "hello", "token" to Prefs.token,
                    "device" to json("model" to Build.MODEL, "android" to Build.VERSION.RELEASE, "app" to "0.1.0"),
                    "methods" to Router.methods().toJsonArray { it }, "shizuku" to ShizukuShell.active,
                ).toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = JSONObject(text)
                when (msg.optString("type")) {
                    "welcome" -> {
                        connecting = false; connected = true; backoffMs = 2000
                        Journal.add("✅ Connecté au Mac"); refresh()
                        if (Prefs.stopped) sendEvent("stop", json("reason" to "STOP actif sur le téléphone"))
                    }
                    "req" -> scope.launch { handle(webSocket, msg) }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost("fermé ($code $reason)", code)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost(t.message ?: "échec")
        })
    }

    private fun lost(why: String, code: Int = 0) {
        val was = connected
        connected = false; connecting = false
        if (was) Journal.add("❌ Déconnecté : $why")
        refresh()
        if (code == 4401) { Journal.add("Jeton refusé : refais l'appairage (QR code)."); return }
        scope.launch {
            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000)
            connect()
        }
    }

    private suspend fun handle(socket: WebSocket, msg: JSONObject) {
        val id = msg.getString("id")
        val method = msg.getString("method")
        val params = msg.optJSONObject("params") ?: JSONObject()
        val res = JSONObject().put("type", "res").put("id", id)
        wake.acquire(5 * 60_000L)
        try {
            if (Prefs.stopped && method !in setOf("health", "stop.notify", "notify")) throw RpcError("EMERGENCY_STOP", "STOP actif sur le téléphone")
            Journal.add("→ $method")
            val result = Router.call(method, params)
            res.put("ok", true).put("result", result ?: JSONObject.NULL)
        } catch (e: RpcError) {
            res.put("ok", false).put("error", json("code" to e.code, "message" to e.message))
            Journal.add("⚠️ $method : ${e.message}")
        } catch (e: SecurityException) {
            res.put("ok", false).put("error", json("code" to "PERMISSION", "message" to "Permission Android manquante : ${e.message}. Ouvre l'app PhonePilot › Permissions."))
            Journal.add("⚠️ $method : permission manquante")
        } catch (e: Throwable) {
            res.put("ok", false).put("error", json("code" to "PHONE_ERROR", "message" to (e.message ?: e.javaClass.simpleName)))
            Journal.add("⚠️ $method : ${e.message}")
        } finally {
            if (wake.isHeld) wake.release()
        }
        socket.send(res.toString())
    }

    fun sendEvent(name: String, data: Any) {
        ws?.takeIf { connected }?.send(json("type" to "event", "name" to name, "data" to data).toString())
    }

    // ---------- Notification permanente ----------

    fun refresh() {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification())
        MainActivity.refreshUi()
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getBroadcast(this, 1, Intent(this, ActionReceiver::class.java).setAction(ActionReceiver.STOP), PendingIntent.FLAG_IMMUTABLE)
        val state = when {
            Prefs.stopped -> "⛔ ARRÊT D'URGENCE — ouvre l'app pour reprendre"
            connected -> "Connecté au Mac" + if (ShizukuShell.active) " · Shizuku actif" else " · Shizuku inactif"
            else -> "Recherche du Mac…"
        }
        return Notification.Builder(this, PhonePilotApp.CH_STATUS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(getString(R.string.notif_active))
            .setContentText(state)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, getString(R.string.stop), stop).build())
            .build()
    }

    companion object {
        const val NOTIF_ID = 1
        const val ACTION_RECONNECT = "reconnect"
        @Volatile var instance: BridgeService? = null

        fun start(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, BridgeService::class.java))
        }

        fun reconnect(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, BridgeService::class.java).setAction(ACTION_RECONNECT))
        }

        fun event(name: String, data: Any) = instance?.sendEvent(name, data)
    }
}

/** STOP / Oui / Non depuis les notifications. */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            STOP -> Emergency.stop("bouton STOP de la notification")
            YES, NO -> Confirm.answer(intent.getStringExtra("id") ?: return, intent.action == YES)
        }
    }

    companion object {
        const val STOP = "com.phonepilot.STOP"
        const val YES = "com.phonepilot.YES"
        const val NO = "com.phonepilot.NO"
    }
}

object Emergency {
    fun stop(reason: String) {
        Prefs.stopped = true
        Journal.add("⛔ STOP : $reason")
        BridgeService.event("stop", json("reason" to reason))
        BridgeService.instance?.refresh()
    }

    /** Reprise : UNIQUEMENT depuis l'interface de l'app (action humaine). */
    fun resume() {
        Prefs.stopped = false
        Journal.add("▶️ Reprise par Antoine")
        BridgeService.event("resume", JSONObject())
        BridgeService.instance?.refresh()
    }
}

/** Confirmations Oui/Non sur le téléphone pour les actions sensibles. */
object Confirm {
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
    private val seq = AtomicInteger(100)

    suspend fun request(category: String, summary: String, timeoutSec: Int): Boolean {
        if (!Prefs.requiresConfirm(category)) { Journal.add("✔️ Auto-validé ($category désactivé dans l'app)"); return true }
        val ctx = PhonePilotApp.instance
        val n = seq.incrementAndGet()
        val id = n.toString()
        val d = CompletableDeferred<Boolean>()
        pending[id] = d
        fun pi(action: String) = PendingIntent.getBroadcast(ctx, n * 10 + if (action == ActionReceiver.YES) 1 else 2,
            Intent(ctx, ActionReceiver::class.java).setAction(action).putExtra("id", id), PendingIntent.FLAG_IMMUTABLE)
        val notif = Notification.Builder(ctx, PhonePilotApp.CH_CONFIRM)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Claude demande ta confirmation ($category)")
            .setContentText(summary)
            .setStyle(Notification.BigTextStyle().bigText(summary))
            .setCategory(Notification.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(timeoutSec * 1000L)
            .addAction(Notification.Action.Builder(null, ctx.getString(R.string.yes), pi(ActionReceiver.YES)).build())
            .addAction(Notification.Action.Builder(null, ctx.getString(R.string.no), pi(ActionReceiver.NO)).build())
            .build()
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.notify(n, notif)
        Journal.add("❓ Confirmation demandée : $summary")
        val ok = withTimeoutOrNull(timeoutSec * 1000L) { d.await() } ?: false
        pending.remove(id)
        nm.cancel(n)
        Journal.add(if (ok) "✔️ Accepté : $summary" else "✖️ Refusé/expiré : $summary")
        return ok
    }

    fun answer(id: String, yes: Boolean) {
        pending[id]?.complete(yes)
    }
}
