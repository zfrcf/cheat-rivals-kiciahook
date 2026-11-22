package io.appimagedroid.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import kotlin.random.Random

/** Construit de vrais AppImage (runtime ELF + squashfs) avec mksquashfs et les relit. */
class AppImageTest {
    private val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10) +
        Random(1).nextBytes(3000)
    private val big = Random(2).nextBytes(300_000) + ByteArray(200_000) // > 1 bloc + fragment + zone compressible

    private fun build(comp: String, extra: List<String> = emptyList()): File {
        assumeTrue(File("/usr/bin/mksquashfs").exists())
        val dir = Files.createTempDirectory("appdir").toFile()
        File(dir, "monapp.desktop").writeText(
            "[Desktop Entry]\nType=Application\nName=Mon Appli\nName[fr]=Mon Appli FR\n" +
                "Comment=Test\nIcon=monapp\nX-AppImage-Version=1.2.3\nCategories=Utility;\n[Desktop Action x]\nName=Autre\n"
        )
        val iconDir = File(dir, "usr/share/icons/hicolor/256x256/apps").apply { mkdirs() }
        File(iconDir, "monapp.png").writeBytes(png)
        File(dir, "usr/lib").mkdirs()
        File(dir, "usr/lib/big.bin").writeBytes(big)
        repeat(300) { File(dir, "usr/lib/f$it.txt").writeText("fichier $it") } // force plusieurs blocs de métadonnées
        File(dir, "chrome-sandbox").writeText("x")
        File(dir, "AppRun").writeText("#!/bin/sh\n")
        Files.createSymbolicLink(File(dir, "monapp.png").toPath(), File("usr/share/icons/hicolor/256x256/apps/monapp.png").toPath())
        Files.createSymbolicLink(File(dir, ".DirIcon").toPath(), File("monapp.png").toPath())

        val sq = File.createTempFile("img", ".sqfs").apply { delete() }
        val p = ProcessBuilder(listOf("mksquashfs", dir.path, sq.path, "-comp", comp, "-noappend", "-quiet", "-all-root") + extra)
            .redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        assumeTrue("mksquashfs $comp: $out", p.waitFor() == 0)

        // Runtime : un vrai ELF x86_64 avec la signature AppImage type 2.
        val runtime = File("/bin/true").readBytes()
        runtime[8] = 'A'.code.toByte(); runtime[9] = 'I'.code.toByte(); runtime[10] = 2
        val img = File.createTempFile("test", ".AppImage")
        img.writeBytes(runtime + sq.readBytes())
        return img
    }

    private fun check(comp: String, extra: List<String> = emptyList()) {
        val img = build(comp, extra)
        val meta = AppImage.read(img)
        assertNull(meta.warning)
        assertEquals("x86_64", meta.header.arch)
        assertEquals(2, meta.header.type)
        assertEquals(File("/bin/true").length(), meta.header.squashOffset)
        assertEquals("Mon Appli FR", meta.name)
        assertEquals("1.2.3", meta.version)
        assertEquals(comp, meta.compression)
        assertTrue(meta.isElectron)
        assertArrayEquals(png, meta.iconBytes)
        SquashFs(RandomAccessFile(img, "r"), meta.header.squashOffset).use { fs ->
            assertArrayEquals(big, fs.readFile("usr/lib/big.bin"))
            assertEquals("fichier 299", String(fs.readFile("usr/lib/f299.txt")!!))
            assertArrayEquals(png, fs.readFile(".DirIcon"))
            assertEquals(301, fs.list(fs.lookup("usr/lib") as SquashFs.DirInode).size)
        }
    }

    @Test fun gzip() = check("gzip")
    @Test fun xz() = check("xz")
    @Test fun lz4() = check("lz4")
    @Test fun gzipSansFragments() = check("gzip", listOf("-no-fragments"))
    @Test fun gzipNonCompresse() = check("gzip", listOf("-noI", "-noD", "-noF"))

    @Test fun compressionInconnueDonneUnAvertissement() {
        val img = build("lzo")
        val meta = AppImage.read(img, mapOf(1 to Decompressors.GZIP))
        assertEquals("x86_64", meta.header.arch)
        assertNotNull(meta.warning)
    }

    @Test(expected = NotAnAppImageException::class)
    fun fichierNonElf() {
        val f = File.createTempFile("pasunelf", ".AppImage").apply { writeText("pas un elf".repeat(20)) }
        AppImage.readHeader(f)
    }
}
