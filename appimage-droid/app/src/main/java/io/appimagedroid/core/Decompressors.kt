package io.appimagedroid.core

import org.tukaani.xz.LZMAInputStream
import org.tukaani.xz.XZInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.zip.Inflater

/** Décompresseurs en Java pur. Le zstd (natif) est ajouté côté Android. */
object Decompressors {
    val GZIP = Decompressor { src, max ->
        val inf = Inflater()
        try {
            inf.setInput(src)
            val out = ByteArrayOutputStream(max)
            val buf = ByteArray(8192)
            while (!inf.finished()) {
                val n = inf.inflate(buf)
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) break
                out.write(buf, 0, n)
            }
            out.toByteArray()
        } finally {
            inf.end()
        }
    }

    val XZ = Decompressor { src, max -> drain(XZInputStream(ByteArrayInputStream(src)), max) }
    val LZMA = Decompressor { src, max -> drain(LZMAInputStream(ByteArrayInputStream(src)), max) }

    /** Décodeur de bloc LZ4 (format brut utilisé par squashfs). */
    val LZ4 = Decompressor { src, max ->
        val out = ByteArray(max)
        var si = 0
        var di = 0
        while (si < src.size) {
            val token = src[si++].toInt() and 0xFF
            var lit = token ushr 4
            if (lit == 15) {
                var b: Int
                do { b = src[si++].toInt() and 0xFF; lit += b } while (b == 255)
            }
            System.arraycopy(src, si, out, di, lit)
            si += lit; di += lit
            if (si >= src.size) break
            val offset = (src[si].toInt() and 0xFF) or ((src[si + 1].toInt() and 0xFF) shl 8)
            si += 2
            var len = token and 15
            if (len == 15) {
                var b: Int
                do { b = src[si++].toInt() and 0xFF; len += b } while (b == 255)
            }
            len += 4
            var from = di - offset
            repeat(len) { out[di++] = out[from++] }
        }
        out.copyOf(di)
    }

    fun defaults(): Map<Int, Decompressor> = mapOf(1 to GZIP, 2 to LZMA, 4 to XZ, 5 to LZ4)

    fun drain(input: InputStream, max: Int): ByteArray = input.use {
        val out = ByteArrayOutputStream(max)
        it.copyTo(out)
        out.toByteArray()
    }
}
