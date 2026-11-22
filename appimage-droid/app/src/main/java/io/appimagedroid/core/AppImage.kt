package io.appimagedroid.core

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class AppImageHeader(
    /** 1 = ISO 9660 (ancien), 2 = ELF + squashfs (standard actuel). */
    val type: Int,
    /** Architecture au format `uname -m` : x86_64, aarch64, armv7l, i686… */
    val arch: String,
    /** Position du système de fichiers squashfs dans le fichier. */
    val squashOffset: Long,
)

data class AppImageMeta(
    val header: AppImageHeader,
    val name: String?,
    val version: String?,
    val comment: String?,
    val categories: String?,
    val iconBytes: ByteArray?,
    val isElectron: Boolean,
    val compression: String?,
    /** Message si la lecture du contenu a échoué (l'installation reste possible). */
    val warning: String?,
)

class NotAnAppImageException(msg: String) : Exception(msg)

object AppImage {

    fun readHeader(file: File): AppImageHeader = RandomAccessFile(file, "r").use { raf ->
        val h = ByteArray(64)
        if (raf.length() < 64) throw NotAnAppImageException("Fichier trop petit")
        raf.readFully(h)
        if (h[0] != 0x7F.toByte() || h[1] != 'E'.code.toByte() || h[2] != 'L'.code.toByte() || h[3] != 'F'.code.toByte())
            throw NotAnAppImageException("Ce n'est pas un exécutable Linux (ELF)")
        val type = if (h[8] == 'A'.code.toByte() && h[9] == 'I'.code.toByte()) h[10].toInt() else 0
        val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
        val is64 = h[4].toInt() == 2
        val arch = when (b.getShort(0x12).toInt() and 0xFFFF) {
            0x3E -> "x86_64"; 0xB7 -> "aarch64"; 0x28 -> "armv7l"; 0x03 -> "i686"
            else -> "inconnue"
        }
        val computed = if (is64) {
            b.getLong(0x28) + (b.getShort(0x3A).toLong() and 0xFFFF) * (b.getShort(0x3C).toLong() and 0xFFFF)
        } else {
            (b.getInt(0x20).toLong() and 0xFFFFFFFFL) +
                (b.getShort(0x2E).toLong() and 0xFFFF) * (b.getShort(0x30).toLong() and 0xFFFF)
        }
        val offset = if (hasMagicAt(raf, computed)) computed else scanForSquash(raf)
            ?: if (type == 1) throw NotAnAppImageException("AppImage de type 1 (ISO 9660) non supporté")
            else throw NotAnAppImageException("Aucune image squashfs trouvée : ce n'est pas un AppImage")
        AppImageHeader(if (type == 0) 2 else type, arch, offset)
    }

    fun read(file: File, decompressors: Map<Int, Decompressor> = Decompressors.defaults()): AppImageMeta {
        val header = readHeader(file)
        return try {
            SquashFs(RandomAccessFile(file, "r"), header.squashOffset, decompressors).use { fs ->
                val entries = fs.rootEntries()
                val desktopName = entries.firstOrNull { it.name.endsWith(".desktop") }?.name
                val desktop = desktopName?.let { fs.readFile(it, 1L shl 20) }
                    ?.let { parseDesktop(String(it, Charsets.UTF_8)) } ?: emptyMap()
                val names = entries.map { it.name }.toSet()
                val electron = "chrome-sandbox" in names || "resources.pak" in names || "libffmpeg.so" in names
                AppImageMeta(
                    header = header,
                    name = desktop.loc("Name"),
                    version = desktop["X-AppImage-Version"],
                    comment = desktop.loc("Comment") ?: desktop.loc("GenericName"),
                    categories = desktop["Categories"],
                    iconBytes = findIcon(fs, desktop["Icon"]),
                    isElectron = electron,
                    compression = SquashFs.compressorName(fs.compressor),
                    warning = null,
                )
            }
        } catch (e: Exception) {
            AppImageMeta(header, null, null, null, null, null, false, null,
                "Contenu non lu : ${e.message}")
        }
    }

    private fun Map<String, String>.loc(key: String): String? =
        this["$key[fr_FR]"] ?: this["$key[fr]"] ?: this[key]

    fun parseDesktop(text: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        var inEntry = false
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("[")) { inEntry = line == "[Desktop Entry]"; continue }
            if (!inEntry || line.startsWith("#")) continue
            val eq = line.indexOf('=')
            if (eq > 0) out.putIfAbsent(line.substring(0, eq).trim(), line.substring(eq + 1).trim())
        }
        return out
    }

    private fun findIcon(fs: SquashFs, icon: String?): ByteArray? {
        val candidates = mutableListOf<String>()
        if (icon != null) {
            if (icon.contains('/')) candidates += icon
            candidates += listOf("$icon.png", icon)
            for (s in listOf(256, 512, 128, 64, 48)) candidates += "usr/share/icons/hicolor/${s}x$s/apps/$icon.png"
            candidates += "usr/share/pixmaps/$icon.png"
        }
        candidates += ".DirIcon"
        for (c in candidates) {
            val data = try { fs.readFile(c, 8L shl 20) } catch (_: Exception) { null } ?: continue
            if (isBitmap(data)) return data
        }
        return null
    }

    private fun isBitmap(d: ByteArray) = d.size > 8 &&
        ((d[0] == 0x89.toByte() && d[1] == 'P'.code.toByte()) || (d[0] == 0xFF.toByte() && d[1] == 0xD8.toByte()))

    private fun hasMagicAt(raf: RandomAccessFile, pos: Long): Boolean {
        if (pos <= 0 || pos + 4 > raf.length()) return false
        raf.seek(pos)
        val b = ByteArray(4); raf.readFully(b)
        return ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).int == SquashFs.MAGIC
    }

    /** Recherche de secours de la signature "hsqs" dans les 4 premiers Mo. */
    private fun scanForSquash(raf: RandomAccessFile): Long? {
        val limit = minOf(raf.length(), 4L shl 20).toInt()
        val buf = ByteArray(limit)
        raf.seek(0); raf.readFully(buf)
        var i = 0
        while (i <= limit - 4) {
            if (buf[i] == 'h'.code.toByte() && buf[i + 1] == 's'.code.toByte() &&
                buf[i + 2] == 'q'.code.toByte() && buf[i + 3] == 's'.code.toByte() &&
                i + 30 <= limit && buf[i + 28].toInt() == 4 && buf[i + 29].toInt() == 0
            ) return i.toLong()
            i++
        }
        return null
    }
}
