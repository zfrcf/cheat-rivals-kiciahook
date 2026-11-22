package io.appimagedroid.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class InstalledApp(
    val id: String,
    val name: String,
    val version: String?,
    val comment: String?,
    val arch: String,
    val path: String,
    val offset: Long,
    val size: Long,
    val compression: String?,
    val electron: Boolean,
    val extraArgs: String,
    val installedAt: Long,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("name", name).put("version", version).put("comment", comment)
        .put("arch", arch).put("path", path).put("offset", offset).put("size", size)
        .put("compression", compression).put("electron", electron)
        .put("extraArgs", extraArgs).put("installedAt", installedAt)

    companion object {
        fun fromJson(o: JSONObject) = InstalledApp(
            id = o.getString("id"), name = o.getString("name"),
            version = o.optString("version").ifEmpty { null }.takeIf { it != "null" },
            comment = o.optString("comment").ifEmpty { null }.takeIf { it != "null" },
            arch = o.getString("arch"), path = o.getString("path"), offset = o.getLong("offset"),
            size = o.optLong("size"),
            compression = o.optString("compression").ifEmpty { null }.takeIf { it != "null" },
            electron = o.optBoolean("electron"), extraArgs = o.optString("extraArgs"),
            installedAt = o.optLong("installedAt"),
        )
    }
}

/** Stockage des apps installées (JSON + icônes dans le stockage privé). */
class AppStore(private val ctx: Context) {
    private val file = File(ctx.filesDir, "apps.json")
    private val iconDir = File(ctx.filesDir, "icons").apply { mkdirs() }

    @Synchronized
    fun all(): List<InstalledApp> = try {
        val arr = JSONArray(file.readText())
        (0 until arr.length()).map { InstalledApp.fromJson(arr.getJSONObject(it)) }
            .sortedBy { it.name.lowercase() }
    } catch (_: Exception) { emptyList() }

    fun get(id: String) = all().firstOrNull { it.id == id }

    @Synchronized
    fun put(app: InstalledApp) = save(all().filter { it.id != app.id } + app)

    @Synchronized
    fun remove(id: String) {
        save(all().filter { it.id != id })
        iconFile(id).delete()
    }

    private fun save(list: List<InstalledApp>) {
        val arr = JSONArray()
        list.forEach { arr.put(it.toJson()) }
        val tmp = File(file.path + ".tmp")
        tmp.writeText(arr.toString(2))
        tmp.renameTo(file)
    }

    fun iconFile(id: String) = File(iconDir, "$id.img")

    fun saveIcon(id: String, bytes: ByteArray?) {
        if (bytes == null || BitmapFactory.decodeByteArray(bytes, 0, bytes.size) == null) iconFile(id).delete()
        else iconFile(id).writeBytes(bytes)
    }

    fun icon(id: String): Bitmap? = iconFile(id).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

    companion object {
        /** Dossier partagé lisible par Termux (termux-setup-storage). */
        @Suppress("DEPRECATION")
        fun publicDir(): File = File(Environment.getExternalStorageDirectory(), "AppImages").apply { mkdirs() }

        fun slug(s: String): String =
            s.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(40).ifEmpty { "app" }
    }
}
