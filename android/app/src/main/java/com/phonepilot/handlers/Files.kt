package com.phonepilot.handlers

import android.os.Environment
import android.os.StatFs
import android.util.Base64
import com.phonepilot.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** Fichiers : Android 10 + requestLegacyExternalStorage → accès java.io classique à /sdcard. */
object Files {
    private val root = Environment.getExternalStorageDirectory()
    val trash = File(root, ".PhonePilotCorbeille")

    private fun f(path: String): File {
        val file = File(path.replace(Regex("^/sdcard"), root.absolutePath))
        val canon = file.canonicalPath
        if (!canon.startsWith(root.canonicalPath) && !canon.startsWith("/storage/")) throw RpcError("OUT_OF_STORAGE", "Accès limité au stockage partagé (/sdcard).")
        return file
    }

    private fun info(x: File) = json("path" to x.absolutePath.replace(root.absolutePath, "/sdcard"), "name" to x.name, "dir" to x.isDirectory,
        "size" to if (x.isFile) x.length() else null, "modified" to msToIso(x.lastModified()))

    val handlers: Map<String, Handler> = mapOf(
        "files.list" to { p ->
            val d = f(p.str("path") ?: "/sdcard")
            if (!d.isDirectory) throw RpcError("NOT_DIR", "Pas un dossier : ${p.str("path")}")
            (d.listFiles() ?: emptyArray()).sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() })).toJsonArray { info(it) }
        },
        "file.stat" to { p -> val x = f(p.getString("path")); if (!x.exists()) throw RpcError("NOT_FOUND", "Introuvable : ${p.getString("path")}"); info(x) },
        "files.search" to { p -> search(p) },
        "file.read_chunk" to { p ->
            val x = f(p.getString("path"))
            RandomAccessFile(x, "r").use { raf ->
                raf.seek(p.long("offset", 0))
                val buf = ByteArray(minOf(p.int("length", 512 * 1024).toLong(), raf.length() - raf.filePointer).toInt().coerceAtLeast(0))
                raf.readFully(buf)
                json("data" to Base64.encodeToString(buf, Base64.NO_WRAP), "eof" to (raf.filePointer >= raf.length()))
            }
        },
        "file.write_chunk" to { p ->
            val x = f(p.getString("path"))
            x.parentFile?.mkdirs()
            FileOutputStream(x, p.bool("append", false)).use { it.write(Base64.decode(p.optString("data", ""), Base64.NO_WRAP)) }
            json("ok" to true, "size" to x.length())
        },
        "file.move" to { p ->
            val from = f(p.getString("from")); val to = f(p.getString("to"))
            if (!from.exists()) throw RpcError("NOT_FOUND", "Introuvable : ${p.getString("from")}")
            to.parentFile?.mkdirs()
            if (p.bool("copy", false)) from.copyRecursively(to, overwrite = false)
            else if (!from.renameTo(to)) { from.copyRecursively(to); from.deleteRecursively() }
            json("ok" to true, "to" to info(to))
        },
        "file.mkdir" to { p -> json("ok" to f(p.getString("path")).let { it.isDirectory || it.mkdirs() }) },
        "file.delete" to { p ->
            val perm = p.bool("permanent", false)
            val done = JSONArray()
            for (path in p.strList("paths")) {
                val x = f(path)
                if (!x.exists()) continue
                if (perm) x.deleteRecursively()
                else {
                    trash.mkdirs()
                    val dest = File(trash, "${System.currentTimeMillis()}__${x.absolutePath.replace(root.absolutePath, "").trim('/').replace('/', '~')}")
                    if (!x.renameTo(dest)) { x.copyRecursively(dest); x.deleteRecursively() }
                }
                done.put(path)
            }
            purgeTrash()
            json("ok" to true, "deleted" to done, "mode" to if (perm) "définitif" else "corbeille PhonePilot (30 jours)")
        },
        "trash.restore" to { p ->
            val name = p.str("name")
            val items = trash.listFiles()?.toList() ?: emptyList()
            if (name == null) items.toJsonArray { json("name" to it.name, "original" to "/sdcard/" + it.name.substringAfter("__").replace('~', '/')) }
            else {
                val item = items.firstOrNull { it.name == name || it.name.endsWith(name) } ?: throw RpcError("NOT_FOUND", "Pas dans la corbeille : $name")
                val orig = File(root, item.name.substringAfter("__").replace('~', '/'))
                orig.parentFile?.mkdirs(); item.renameTo(orig)
                json("ok" to true, "restored" to orig.absolutePath)
            }
        },
        "archive.zip" to { p ->
            val dest = f(p.getString("dest")); dest.parentFile?.mkdirs()
            ZipOutputStream(FileOutputStream(dest)).use { zos ->
                for (path in p.strList("paths")) {
                    val base = f(path)
                    base.walkTopDown().filter { it.isFile }.forEach { file ->
                        zos.putNextEntry(ZipEntry(base.name + "/" + file.relativeTo(base).path.ifEmpty { file.name }))
                        FileInputStream(file).use { it.copyTo(zos) }
                        zos.closeEntry()
                    }
                }
            }
            json("ok" to true, "path" to p.getString("dest"), "size" to dest.length())
        },
        "archive.unzip" to { p ->
            val dest = f(p.getString("dest")); dest.mkdirs()
            var n = 0
            ZipInputStream(FileInputStream(f(p.getString("path")))).use { zis ->
                var e = zis.nextEntry
                while (e != null) {
                    val out = File(dest, e.name)
                    if (!out.canonicalPath.startsWith(dest.canonicalPath)) throw RpcError("ZIP_SLIP", "Archive dangereuse (chemin hors destination).")
                    if (e.isDirectory) out.mkdirs() else { out.parentFile?.mkdirs(); FileOutputStream(out).use { zis.copyTo(it) }; n++ }
                    e = zis.nextEntry
                }
            }
            json("ok" to true, "files" to n)
        },
        "storage.info" to { _ ->
            val s = StatFs(root.path)
            val folders = listOf("DCIM", "Pictures", "Movies", "Music", "Download", "Documents", "WhatsApp", "Android").map { File(root, it) }.filter { it.exists() }
            json("totalBytes" to s.totalBytes, "freeBytes" to s.availableBytes,
                "freeHuman" to "%.1f Go libres / %.1f Go".format(s.availableBytes / 1e9, s.totalBytes / 1e9),
                "folders" to folders.toJsonArray { json("name" to it.name, "bytes" to it.walkTopDown().filter { f -> f.isFile }.sumOf { f -> f.length() }) })
        },
        "files.duplicates" to { p ->
            val min = p.long("min_size", 100_000)
            val bySize = f(p.str("root") ?: "/sdcard").walkTopDown().onEnter { it != trash && !it.name.startsWith(".") }
                .filter { it.isFile && it.length() >= min }.groupBy { it.length() }.filter { it.value.size > 1 }
            val groups = JSONArray()
            for ((_, files) in bySize) files.groupBy { md5(it) }.values.filter { it.size > 1 }.forEach { g -> groups.put(g.toJsonArray { info(it) }) }
            groups
        },
        "screenshots.organize" to { p ->
            val dir = File(root, "Pictures/Screenshots")
            val fmt = SimpleDateFormat("yyyy-MM", Locale.FRANCE)
            val moves = (dir.listFiles() ?: emptyArray()).filter { it.isFile }.map { it to File(dir, "${fmt.format(it.lastModified())}/${it.name}") }
            if (!p.bool("dry_run", true)) moves.forEach { (a, b) -> b.parentFile?.mkdirs(); a.renameTo(b) }
            json("count" to moves.size, "dry_run" to p.bool("dry_run", true), "months" to moves.map { it.second.parentFile!!.name }.distinct().toJsonArray { it })
        },
    )

    private fun search(p: JSONObject): JSONArray {
        val name = p.str("name")?.lowercase()
        val exts = p.strList("ext").map { it.lowercase().trimStart('.') }.toSet()
        val after = isoToMs(p.str("after")); val before = isoToMs(p.str("before"))
        val min = p.long("min_size", -1); val max = p.long("max_size", Long.MAX_VALUE)
        val res = f(p.str("root") ?: "/sdcard").walkTopDown().onEnter { it != trash && !(it.name.startsWith(".") && it.name != ".") }
            .filter { it.isFile }
            .filter { name == null || it.name.lowercase().contains(name) }
            .filter { exts.isEmpty() || it.extension.lowercase() in exts }
            .filter { (after == null || it.lastModified() >= after) && (before == null || it.lastModified() <= before) }
            .filter { it.length() in (min.coerceAtLeast(0))..max }
            .take(20_000).toList()
        val sorted = when (p.optString("sort", "date")) {
            "size" -> res.sortedByDescending { it.length() }
            "name" -> res.sortedBy { it.name.lowercase() }
            else -> res.sortedByDescending { it.lastModified() }
        }
        return sorted.take(p.int("limit", 50)).toJsonArray { info(it) }
    }

    private fun purgeTrash() {
        val limit = System.currentTimeMillis() - 30L * 86_400_000
        trash.listFiles()?.filter { (it.name.substringBefore("__").toLongOrNull() ?: Long.MAX_VALUE) < limit }?.forEach { it.deleteRecursively() }
    }

    private fun md5(x: File): String {
        val md = MessageDigest.getInstance("MD5")
        FileInputStream(x).use { s -> val b = ByteArray(1 shl 16); while (true) { val n = s.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
