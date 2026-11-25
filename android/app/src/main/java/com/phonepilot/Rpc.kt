package com.phonepilot

import org.json.JSONArray
import org.json.JSONObject

class RpcError(val code: String, message: String) : Exception(message)

typealias Handler = suspend (JSONObject) -> Any?

/** Petits utilitaires JSON. */
fun json(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply {
    for ((k, v) in pairs) if (v != null) put(k, v)
}

fun <T> Iterable<T>.toJsonArray(map: (T) -> Any?): JSONArray = JSONArray().also { a -> forEach { a.put(map(it)) } }

fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) getString(k) else null
fun JSONObject.int(k: String, def: Int): Int = if (has(k) && !isNull(k)) getInt(k) else def
fun JSONObject.long(k: String, def: Long): Long = if (has(k) && !isNull(k)) getLong(k) else def
fun JSONObject.bool(k: String, def: Boolean): Boolean = if (has(k) && !isNull(k)) getBoolean(k) else def
fun JSONObject.dbl(k: String): Double? = if (has(k) && !isNull(k)) getDouble(k) else null
fun JSONObject.strList(k: String): List<String> = optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()

/** Dates ISO 8601 (« 2026-11-25T08:00:00Z » ou « 2026-11-25 ») → epoch ms. */
fun isoToMs(s: String?): Long? {
    if (s.isNullOrBlank()) return null
    return runCatching { java.time.Instant.parse(s).toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.LocalDateTime.parse(s).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { java.time.LocalDate.parse(s).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
        ?: throw RpcError("BAD_DATE", "Date invalide : $s (format ISO attendu)")
}

fun msToIso(ms: Long): String = java.time.Instant.ofEpochMilli(ms).toString()
