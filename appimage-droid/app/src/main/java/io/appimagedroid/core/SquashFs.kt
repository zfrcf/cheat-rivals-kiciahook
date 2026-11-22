package io.appimagedroid.core

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Décompresse un bloc squashfs. [maxOut] = taille maximale attendue. */
fun interface Decompressor {
    fun decompress(src: ByteArray, maxOut: Int): ByteArray
}

class SquashFsException(msg: String) : Exception(msg)

/**
 * Lecteur squashfs 4.0 minimal en lecture seule (sans dépendance Android).
 * Suffisant pour lire la métadonnée d'un AppImage : .desktop, icône, liste racine.
 */
class SquashFs(
    private val raf: RandomAccessFile,
    private val base: Long,
    decompressors: Map<Int, Decompressor> = Decompressors.defaults(),
) : Closeable {

    sealed class Inode
    data class DirInode(val blockIndex: Long, val blockOffset: Int, val fileSize: Long) : Inode()
    class FileInode(
        val blocksStart: Long,
        val fileSize: Long,
        val fragIndex: Long,
        val fragOffset: Int,
        val blockSizes: IntArray,
    ) : Inode()
    data class LinkInode(val target: String) : Inode()
    data class OtherInode(val type: Int) : Inode()

    data class Entry(val name: String, val type: Int, val ref: Long)

    val blockSize: Int
    val compressor: Int
    private val fragCount: Long
    private val rootRef: Long
    private val inodeTable: Long
    private val dirTable: Long
    private val fragTable: Long
    private val decomp: Decompressor
    private val metaCache = HashMap<Long, Pair<ByteArray, Long>>()

    init {
        val b = le(read(base, 96))
        if (b.getInt(0) != MAGIC) throw SquashFsException("Signature squashfs introuvable")
        if (b.getShort(28).toInt() != 4) throw SquashFsException("Version squashfs non supportée")
        blockSize = b.getInt(12)
        fragCount = b.getInt(16).toLong() and 0xFFFFFFFFL
        compressor = b.getShort(20).toInt() and 0xFFFF
        rootRef = b.getLong(32)
        inodeTable = b.getLong(64)
        dirTable = b.getLong(72)
        fragTable = b.getLong(80)
        decomp = decompressors[compressor]
            ?: throw SquashFsException("Compression non supportée : ${compressorName(compressor)}")
    }

    fun root(): DirInode = readInode(rootRef) as DirInode

    fun list(dir: DirInode): List<Entry> {
        val m = Meta(dirTable + dir.blockIndex, dir.blockOffset)
        var remaining = dir.fileSize - 3
        val out = ArrayList<Entry>()
        while (remaining > 0) {
            val count = m.u32().toInt() + 1
            val start = m.u32()
            m.u32() // numéro d'inode de référence
            remaining -= 12
            repeat(count) {
                val off = m.u16()
                m.u16() // delta inode
                val type = m.u16()
                val nameLen = m.u16() + 1
                val name = String(m.bytes(nameLen), Charsets.UTF_8)
                remaining -= 8 + nameLen
                out += Entry(name, type, (start shl 16) or off.toLong())
            }
        }
        return out
    }

    fun rootEntries(): List<Entry> = list(root())

    /** Résout un chemin (relatif à la racine) en suivant les liens symboliques. */
    fun lookup(path: String, depth: Int = 0): Inode? {
        if (depth > 32) return null
        val parts = normalize(path)
        var cur: Inode = root()
        for (i in parts.indices) {
            val dir = cur as? DirInode ?: return null
            val e = list(dir).firstOrNull { it.name == parts[i] } ?: return null
            val node = readInode(e.ref)
            if (node is LinkInode) {
                val parent = parts.subList(0, i).joinToString("/")
                val rest = parts.subList(i + 1, parts.size).joinToString("/")
                val target = if (node.target.startsWith("/")) node.target else "$parent/${node.target}"
                return lookup("$target/$rest", depth + 1)
            }
            cur = node
        }
        return cur
    }

    fun readFile(path: String, limit: Long = 32L shl 20): ByteArray? =
        (lookup(path) as? FileInode)?.let { readFile(it, limit) }

    fun readFile(f: FileInode, limit: Long = 32L shl 20): ByteArray {
        if (f.fileSize > limit) throw SquashFsException("Fichier trop volumineux (${f.fileSize} o)")
        val out = ByteArrayOutputStream(f.fileSize.toInt())
        var pos = f.blocksStart
        for (bsz in f.blockSizes) {
            val size = bsz and 0xFFFFFF
            if (size == 0) { // bloc creux
                out.write(ByteArray(minOf(blockSize.toLong(), f.fileSize - out.size()).toInt()))
                continue
            }
            val raw = read(base + pos, size)
            pos += size
            out.write(if (bsz and UNCOMPRESSED_DATA != 0) raw else decomp.decompress(raw, blockSize))
        }
        if (f.fragIndex != NO_FRAGMENT) {
            val frag = fragment(f.fragIndex)
            val tail = (f.fileSize - out.size()).toInt()
            if (tail > 0) out.write(frag, f.fragOffset, tail)
        }
        val bytes = out.toByteArray()
        return if (bytes.size > f.fileSize) bytes.copyOf(f.fileSize.toInt()) else bytes
    }

    fun readInode(ref: Long): Inode {
        val m = Meta(inodeTable + (ref ushr 16), (ref and 0xFFFF).toInt())
        val type = m.u16()
        m.bytes(14) // permissions, uid, gid, mtime, numéro d'inode
        return when (type) {
            1 -> { // répertoire basique
                val blockIndex = m.u32(); m.u32()
                val fileSize = m.u16().toLong(); val blockOffset = m.u16()
                DirInode(blockIndex, blockOffset, fileSize)
            }
            8 -> { // répertoire étendu
                m.u32(); val fileSize = m.u32(); val blockIndex = m.u32(); m.u32(); m.u16()
                val blockOffset = m.u16()
                DirInode(blockIndex, blockOffset, fileSize)
            }
            2 -> {
                val start = m.u32(); val frag = m.u32(); val fragOff = m.u32().toInt(); val size = m.u32()
                FileInode(start, size, frag, fragOff, blockList(m, size, frag))
            }
            9 -> {
                val start = m.u64(); val size = m.u64(); m.u64(); m.u32()
                val frag = m.u32(); val fragOff = m.u32().toInt(); m.u32()
                FileInode(start, size, frag, fragOff, blockList(m, size, frag))
            }
            3, 10 -> {
                m.u32(); val len = m.u32().toInt()
                LinkInode(String(m.bytes(len), Charsets.UTF_8))
            }
            else -> OtherInode(type)
        }
    }

    private fun blockList(m: Meta, size: Long, frag: Long): IntArray {
        val bs = blockSize.toLong()
        val n = if (frag == NO_FRAGMENT) (size + bs - 1) / bs else size / bs
        return IntArray(n.toInt()) { m.u32().toInt() }
    }

    private fun fragment(idx: Long): ByteArray {
        if (idx >= fragCount) throw SquashFsException("Fragment invalide")
        val ptr = le(read(base + fragTable + (idx / 512) * 8, 8)).long
        val m = Meta(ptr, ((idx % 512) * 16).toInt())
        val start = m.u64()
        val size = m.u32().toInt()
        val raw = read(base + start, size and 0xFFFFFF)
        return if (size and UNCOMPRESSED_DATA != 0) raw else decomp.decompress(raw, blockSize)
    }

    private fun metaBlock(pos: Long): Pair<ByteArray, Long> = metaCache.getOrPut(pos) {
        val h = read(base + pos, 2)
        val header = (h[0].toInt() and 0xFF) or ((h[1].toInt() and 0xFF) shl 8)
        val size = header and 0x7FFF
        val raw = read(base + pos + 2, size)
        val data = if (header and 0x8000 != 0) raw else decomp.decompress(raw, METADATA_SIZE)
        data to (pos + 2 + size)
    }

    private inner class Meta(var block: Long, var off: Int) {
        fun bytes(n: Int): ByteArray {
            val out = ByteArray(n)
            var filled = 0
            while (filled < n) {
                val (data, next) = metaBlock(block)
                val avail = data.size - off
                if (avail <= 0) { block = next; off -= data.size; continue }
                val k = minOf(avail, n - filled)
                System.arraycopy(data, off, out, filled, k)
                filled += k; off += k
            }
            return out
        }
        fun u16() = le(bytes(2)).short.toInt() and 0xFFFF
        fun u32() = le(bytes(4)).int.toLong() and 0xFFFFFFFFL
        fun u64() = le(bytes(8)).long
    }

    private fun read(pos: Long, len: Int): ByteArray {
        val b = ByteArray(len)
        raf.seek(pos)
        raf.readFully(b)
        return b
    }

    override fun close() = raf.close()

    companion object {
        const val MAGIC = 0x73717368 // "hsqs"
        private const val METADATA_SIZE = 8192
        private const val UNCOMPRESSED_DATA = 1 shl 24
        private const val NO_FRAGMENT = 0xFFFFFFFFL

        fun compressorName(id: Int) = when (id) {
            1 -> "gzip"; 2 -> "lzma"; 3 -> "lzo"; 4 -> "xz"; 5 -> "lz4"; 6 -> "zstd"
            else -> "inconnue ($id)"
        }

        private fun le(b: ByteArray): ByteBuffer = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN)

        private fun normalize(p: String): List<String> {
            val out = ArrayList<String>()
            for (s in p.split('/')) when (s) {
                "", "." -> {}
                ".." -> if (out.isNotEmpty()) out.removeAt(out.size - 1)
                else -> out.add(s)
            }
            return out
        }
    }
}
