package com.phonepilot

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume

/** Yeux et mains de Claude : lecture de l'arbre UI, clics, saisie, gestes, actions globales. */
class PilotAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
        Journal.add("Accessibilité active")
        BridgeService.event("methods", Router.methods().toJsonArray { it })
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        Journal.add("⚠️ Accessibilité désactivée")
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            event.packageName?.toString()?.let { if (it != "com.android.systemui") foreground = it }
        }
    }

    override fun onInterrupt() {}

    // ---------- Lecture ----------

    fun dump(): JSONArray {
        val out = JSONArray()
        val root = rootInActiveWindow ?: throw RpcError("NO_WINDOW", "Écran illisible (verrouillé, ou appli protégée).")
        walk(root, "0", out, 0)
        return out
    }

    private fun walk(n: AccessibilityNodeInfo, path: String, out: JSONArray, depth: Int) {
        if (depth > 40 || out.length() > 2500) return
        val r = Rect().also { n.getBoundsInScreen(it) }
        out.put(JSONObject().apply {
            put("path", path)
            put("cls", n.className?.toString() ?: "")
            put("pkg", n.packageName?.toString())
            n.text?.toString()?.takeIf { it.isNotBlank() }?.let { put("text", it) }
            n.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { put("desc", it) }
            n.viewIdResourceName?.let { put("resId", it) }
            put("bounds", JSONArray(listOf(r.left, r.top, r.right, r.bottom)))
            if (n.isClickable) put("clickable", true)
            if (n.isLongClickable) put("longClickable", true)
            if (n.isScrollable) put("scrollable", true)
            if (n.isEditable) put("editable", true)
            if (n.isCheckable) { put("checkable", true); put("checked", n.isChecked) }
            if (n.isFocused) put("focused", true)
            if (!n.isEnabled) put("enabled", false)
            if (n.isPassword) put("password", true)
        })
        for (i in 0 until n.childCount) n.getChild(i)?.let { walk(it, "$path.$i", out, depth + 1) }
    }

    private fun byPath(path: String): AccessibilityNodeInfo? {
        var n = rootInActiveWindow ?: return null
        for (idx in path.split(".").drop(1)) n = n.getChild(idx.toInt()) ?: return null
        return n
    }

    // ---------- Actions ----------

    suspend fun action(p: JSONObject): JSONObject {
        val action = p.getString("action")
        val b = p.optJSONArray("bounds")
        val cx = b?.let { (it.getInt(0) + it.getInt(2)) / 2f } ?: 0f
        val cy = b?.let { (it.getInt(1) + it.getInt(3)) / 2f } ?: 0f
        val node = p.str("path")?.let { byPath(it) }?.takeIf { n ->
            // Vérifie qu'on vise toujours le même élément (l'écran a pu changer).
            b == null || Rect().also { n.getBoundsInScreen(it) }.contains(cx.toInt(), cy.toInt())
        }
        return when (action) {
            "click" -> clickOrTap(node, cx, cy)
            "long_click" -> if (node?.let { clickable(it, AccessibilityNodeInfo.ACTION_LONG_CLICK) } == true) json("ok" to true, "via" to "node") else gesture(cx, cy, cx, cy, 800)
            "double_click" -> { clickOrTap(node, cx, cy); kotlinx.coroutines.delay(90); clickOrTap(node, cx, cy) }
            "set_text", "clear" -> {
                val target = node ?: throw RpcError("ELEMENT_GONE", "Champ introuvable (l'écran a changé) : relis ui_tree.")
                target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                val text = if (action == "clear") "" else {
                    val cur = if (p.bool("replace", true)) "" else (target.text?.toString() ?: "")
                    cur + p.getString("text")
                }
                val ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                })
                if (!ok) throw RpcError("SET_TEXT_FAILED", "Le champ refuse la saisie directe.")
                json("ok" to true)
            }
            else -> throw RpcError("BAD_ACTION", "Action inconnue : $action")
        }
    }

    fun typeFocused(text: String, replace: Boolean): JSONObject {
        val f = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: throw RpcError("NO_FOCUS", "Aucun champ de saisie actif : touche d'abord un champ.")
        val value = if (replace) text else (f.text?.toString() ?: "") + text
        f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) })
        return json("ok" to true)
    }

    private fun clickable(n: AccessibilityNodeInfo, act: Int): Boolean {
        var cur: AccessibilityNodeInfo? = n
        var hops = 0
        while (cur != null && hops < 5) {
            if ((act == AccessibilityNodeInfo.ACTION_CLICK && cur.isClickable) || (act == AccessibilityNodeInfo.ACTION_LONG_CLICK && cur.isLongClickable)) return cur.performAction(act)
            cur = cur.parent; hops++
        }
        return false
    }

    private suspend fun clickOrTap(node: AccessibilityNodeInfo?, x: Float, y: Float): JSONObject =
        if (node != null && clickable(node, AccessibilityNodeInfo.ACTION_CLICK)) json("ok" to true, "via" to "node") else gesture(x, y, x, y, 60)

    suspend fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long): JSONObject {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return dispatch(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms.coerceAtLeast(1))).build())
    }

    suspend fun pinch(x: Float, y: Float, zoomIn: Boolean): JSONObject {
        val near = 80f; val far = 450f
        val (s, e) = if (zoomIn) near to far else far to near
        val p1 = Path().apply { moveTo(x - s, y - s); lineTo(x - e, y - e) }
        val p2 = Path().apply { moveTo(x + s, y + s); lineTo(x + e, y + e) }
        return dispatch(GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(p1, 0, 400))
            .addStroke(GestureDescription.StrokeDescription(p2, 0, 400)).build())
    }

    private suspend fun dispatch(g: GestureDescription): JSONObject = suspendCancellableCoroutine { c ->
        val ok = dispatchGesture(g, object : GestureResultCallback() {
            override fun onCompleted(d: GestureDescription?) { if (c.isActive) c.resume(json("ok" to true, "via" to "geste")) }
            override fun onCancelled(d: GestureDescription?) { if (c.isActive) c.resume(json("ok" to false, "via" to "geste annulé")) }
        }, null)
        if (!ok && c.isActive) c.resume(json("ok" to false, "via" to "geste refusé"))
    }

    fun global(name: String): JSONObject {
        val a = when (name) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "lock_screen" -> GLOBAL_ACTION_LOCK_SCREEN
            "power_dialog" -> GLOBAL_ACTION_POWER_DIALOG
            "collapse" -> GLOBAL_ACTION_BACK
            else -> throw RpcError("BAD_ACTION", "Action globale inconnue : $name")
        }
        return json("ok" to performGlobalAction(a))
    }

    /** Déclencheur de l'appli photo (libellés EMUI/Google courants). */
    suspend fun shutter(): JSONObject {
        val nodes = dump()
        for (i in 0 until nodes.length()) {
            val n = nodes.getJSONObject(i)
            val hay = "${n.optString("resId")} ${n.optString("desc")} ${n.optString("text")}".lowercase()
            if (Regex("shutter|d[ée]clencheur|prendre une photo|take photo|enregistrer|record|capture").containsMatchIn(hay) && n.optBoolean("clickable")) {
                return action(json("action" to "click", "path" to n.getString("path"), "bounds" to n.getJSONArray("bounds")))
            }
        }
        throw RpcError("SHUTTER_NOT_FOUND", "Bouton de déclenchement introuvable : utilise ui_tree puis tap.")
    }

    companion object {
        @Volatile var instance: PilotAccessibilityService? = null
        @Volatile var foreground: String? = null
        fun require(): PilotAccessibilityService = instance
            ?: throw RpcError("A11Y_OFF", "Service d'accessibilité PhonePilot désactivé : Paramètres › Accessibilité › PhonePilot.")
    }
}
