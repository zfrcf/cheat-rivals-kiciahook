package io.appimagedroid.android

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.github.luben.zstd.ZstdInputStream
import io.appimagedroid.core.AppImage
import io.appimagedroid.core.Decompressor
import io.appimagedroid.core.Decompressors
import java.io.ByteArrayInputStream
import java.io.File

object Installer {
    private val ZSTD = Decompressor { src, max -> Decompressors.drain(ZstdInputStream(ByteArrayInputStream(src)), max) }
    val decompressors = Decompressors.defaults() + (6 to ZSTD)

    class Result(val app: InstalledApp, val warning: String?)

    /** Copie l'AppImage dans /sdcard/AppImages, lit ses métadonnées et l'enregistre. */
    fun install(ctx: Context, uri: Uri, progress: (Long, Long) -> Unit): Result {
        val store = AppStore(ctx)
        val displayName = displayName(ctx, uri) ?: "application.AppImage"
        val total = size(ctx, uri)
        val dir = AppStore.publicDir()
        val tmp = File(dir, ".import-${System.currentTimeMillis()}.part")
        try {
            ctx.contentResolver.openInputStream(uri)!!.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(256 * 1024)
                    var copied = 0L
                    var last = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        copied += n
                        if (copied - last > 1_000_000) { progress(copied, total); last = copied }
                    }
                }
            }
            val meta = AppImage.read(tmp, decompressors)
            val name = meta.name ?: displayName.substringBeforeLast('.').replace(Regex("[-_]?(x86_64|aarch64|amd64|arm64)$", RegexOption.IGNORE_CASE), "")
            val id = AppStore.slug(name)
            // Remplace une version précédente du même logiciel.
            store.get(id)?.let { old -> File(old.path).takeIf { it.parentFile == dir }?.delete() }
            val finalFile = File(dir, safeFileName(displayName))
            finalFile.delete()
            if (!tmp.renameTo(finalFile)) throw IllegalStateException("Impossible de renommer le fichier")
            val app = InstalledApp(
                id = id, name = name, version = meta.version, comment = meta.comment,
                arch = meta.header.arch, path = finalFile.absolutePath, offset = meta.header.squashOffset,
                size = finalFile.length(), compression = meta.compression, electron = meta.isElectron,
                extraArgs = if (meta.isElectron) "--no-sandbox" else "",
                installedAt = System.currentTimeMillis(),
            )
            store.saveIcon(id, meta.iconBytes)
            store.put(app)
            return Result(app, meta.warning)
        } finally {
            tmp.delete()
        }
    }

    fun uninstall(ctx: Context, app: InstalledApp) {
        File(app.path).delete()
        AppStore(ctx).remove(app.id)
    }

    private fun safeFileName(n: String): String {
        val clean = n.replace(Regex("[^A-Za-z0-9._+-]"), "_")
        return if (clean.endsWith(".AppImage", ignoreCase = true)) clean else "$clean.AppImage"
    }

    private fun displayName(ctx: Context, uri: Uri): String? = try {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }
    } catch (_: Exception) { null } ?: uri.lastPathSegment?.substringAfterLast('/')

    private fun size(ctx: Context, uri: Uri): Long = try {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else -1L
        } ?: -1L
    } catch (_: Exception) { -1L }
}
