package com.phonepilot.handlers

import android.app.NotificationManager
import android.bluetooth.BluetoothAdapter
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.media.MediaRecorder
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.util.Base64
import com.phonepilot.*
import kotlinx.coroutines.delay
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Remplaçants natifs des commandes shell (mode « jamais branché » : pas de Shizuku possible sur Android 10).
 */
object NoShell {
    private val ctx get() = PhonePilotApp.instance
    private val cr get() = ctx.contentResolver

    private fun requireWriteSettings() {
        if (!Settings.System.canWrite(ctx)) throw RpcError("WRITE_SETTINGS", "Autorisation « Modifier les paramètres système » manquante : app PhonePilot › Permissions.")
    }

    val handlers: Map<String, Handler> = mapOf(
        "settings.brightness" to { p ->
            requireWriteSettings()
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, (p.getDouble("percent") / 100 * 255).toInt().coerceIn(1, 255))
            json("ok" to true)
        },
        "settings.screen_timeout" to { p ->
            requireWriteSettings()
            Settings.System.putInt(cr, Settings.System.SCREEN_OFF_TIMEOUT, (p.getDouble("seconds") * 1000).toInt())
            json("ok" to true)
        },
        "settings.rotation" to { p ->
            requireWriteSettings()
            val mode = p.getString("mode")
            Settings.System.putInt(cr, Settings.System.ACCELEROMETER_ROTATION, if (mode == "auto") 1 else 0)
            if (mode != "auto") Settings.System.putInt(cr, Settings.System.USER_ROTATION,
                mapOf("portrait" to 0, "landscape" to 1, "reverse_portrait" to 2, "reverse_landscape" to 3)[mode] ?: 0)
            json("ok" to true)
        },
        "settings.dnd" to { p ->
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (!nm.isNotificationPolicyAccessGranted) throw RpcError("DND_ACCESS", "Accès « Ne pas déranger » manquant : app PhonePilot › Permissions.")
            nm.setInterruptionFilter(if (p.getBoolean("on")) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
            json("ok" to true)
        },
        "settings.bluetooth" to { p ->
            val bt = BluetoothAdapter.getDefaultAdapter() ?: throw RpcError("NO_BT", "Pas de Bluetooth")
            @Suppress("MissingPermission")
            json("ok" to if (p.getBoolean("on")) bt.enable() else bt.disable())
        },
        "pdf.render" to { p ->
            val f = File(p.getString("path").replace(Regex("^/sdcard"), Environment.getExternalStorageDirectory().absolutePath))
            PdfRenderer(ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)).use { pdf ->
                val pages = JSONArray()
                val wanted = p.optJSONArray("pages")?.let { a -> (0 until a.length()).map { a.getInt(it) } } ?: listOf(1, 2, 3)
                for (n in wanted.filter { it in 1..pdf.pageCount }.take(5)) pdf.openPage(n - 1).use { page ->
                    val w = 1080
                    val bmp = Bitmap.createBitmap(w, (w.toFloat() * page.height / page.width).toInt(), Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(Color.WHITE)
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    val bos = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.JPEG, 75, bos)
                    pages.put(json("page" to n, "data" to Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)))
                }
                json("pageCount" to pdf.pageCount, "pages" to pages)
            }
        },
        "screen.record" to { p -> ScreenCapture.record(p.int("seconds", 10).coerceIn(1, 180)) },
    )
}

/** Enregistrement vidéo de l'écran via la même autorisation MediaProjection que les captures. */
suspend fun ScreenCapture.record(seconds: Int): Any {
    val dir = File(Environment.getExternalStorageDirectory(), "Movies/PhonePilot").apply { mkdirs() }
    val out = File(dir, "ecran_${System.currentTimeMillis()}.mp4")
    @Suppress("DEPRECATION")
    val rec = MediaRecorder().apply {
        setVideoSource(MediaRecorder.VideoSource.SURFACE)
        setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        setVideoSize(720, 1560)
        setVideoFrameRate(30)
        setVideoEncodingBitRate(4_000_000)
        setOutputFile(out.absolutePath)
        prepare()
    }
    val vd = virtualDisplayFor(rec.surface, 720, 1560)
    rec.start()
    Journal.add("🎥 Enregistrement de l'écran ($seconds s)")
    delay(seconds * 1000L)
    runCatching { rec.stop() }
    rec.release(); vd.release()
    return json("ok" to true, "path" to "/sdcard/Movies/PhonePilot/${out.name}")
}
