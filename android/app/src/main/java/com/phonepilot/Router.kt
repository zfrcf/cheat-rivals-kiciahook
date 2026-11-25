package com.phonepilot

import com.phonepilot.handlers.Comms
import com.phonepilot.handlers.DeviceH
import com.phonepilot.handlers.Files
import com.phonepilot.handlers.NoShell
import org.json.JSONObject

/** Table des méthodes exposées au bridge. Seules les méthodes réellement utilisables sont annoncées. */
object Router {
    private val all: Map<String, Handler> = DeviceH.handlers + Files.handlers + Comms.handlers + NoShell.handlers + mapOf(
        "shell.exec" to { p -> ShizukuShell.exec(p.getString("cmd"), p.long("timeoutMs", 30_000)) },
        "notifications.list" to { p -> PilotNotificationListener.require().list(p.str("app")) },
        "notifications.history" to { p -> PilotNotificationListener.require(); PilotNotificationListener.historySince(System.currentTimeMillis() - p.int("hours", 24) * 3_600_000L, p.str("app")) },
        "notification.reply" to { p -> PilotNotificationListener.require().reply(p.getString("key"), p.getString("text")) },
        "notification.dismiss" to { p -> PilotNotificationListener.require().dismiss(p.str("key"), p.str("app"), p.bool("all", false)) },
    )

    private val needsA11y = setOf("ui.dump", "ui.action", "ui.type_focused", "gesture.swipe", "gesture.pinch", "global.action", "input.tap", "input.long_press", "camera.shutter")

    /** Annonce dynamique : si l'accessibilité est coupée, le bridge se replie sur ADB/Shizuku au lieu d'échouer. */
    fun methods(): List<String> = all.keys.filter { m ->
        when {
            m in needsA11y -> PilotAccessibilityService.instance != null
            m == "screen.capture" || m == "screen.record" -> ScreenCapture.ready
            m == "shell.exec" -> ShizukuShell.active
            m.startsWith("notification") -> PilotNotificationListener.instance != null
            else -> true
        }
    }

    suspend fun call(method: String, params: JSONObject): Any? {
        val h = all[method] ?: throw RpcError("UNKNOWN_METHOD", "Méthode inconnue côté téléphone : $method")
        return h(params)
    }
}
