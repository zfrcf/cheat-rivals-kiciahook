package com.phonepilot

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Captures d'écran via MediaProjection (Android 10 n'a pas AccessibilityService.takeScreenshot).
 * L'accord est donné une fois et reste valable tant que le service tourne.
 */
object ScreenCapture {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private val thread by lazy { HandlerThread("capture").apply { start() } }

    val ready get() = projection != null

    fun start(ctx: Context, resultCode: Int, data: Intent) {
        val mpm = ctx.getSystemService(MediaProjectionManager::class.java)
        projection = mpm.getMediaProjection(resultCode, data)
        val dm = DisplayMetrics().also { (ctx.getSystemService(WindowManager::class.java)).defaultDisplay.getRealMetrics(it) }
        reader = ImageReader.newInstance(dm.widthPixels, dm.heightPixels, PixelFormat.RGBA_8888, 2)
        display = projection!!.createVirtualDisplay("phonepilot", dm.widthPixels, dm.heightPixels, dm.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader!!.surface, null, Handler(thread.looper))
        projection!!.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { projection = null; display?.release(); Journal.add("⚠️ Capture d'écran révoquée") }
        }, Handler(thread.looper))
        Journal.add("Capture d'écran autorisée")
        BridgeService.event("methods", Router.methods().toJsonArray { it })
    }

    suspend fun capture(quality: Int = 70, maxWidth: Int = 1080): JSONObject {
        val r = reader ?: throw RpcError("CAPTURE_OFF", "Capture non autorisée : ouvre l'app PhonePilot › « Autoriser la capture d'écran ».")
        var img = r.acquireLatestImage()
        var tries = 0
        while (img == null && tries++ < 20) { delay(50); img = r.acquireLatestImage() }
        img ?: throw RpcError("CAPTURE_EMPTY", "Aucune image (écran éteint ?).")
        img.use { im ->
            val plane = im.planes[0]
            val rowPad = plane.rowStride - plane.pixelStride * im.width
            val bmp = Bitmap.createBitmap(im.width + rowPad / plane.pixelStride, im.height, Bitmap.Config.ARGB_8888)
            bmp.copyPixelsFromBuffer(plane.buffer)
            var out = Bitmap.createBitmap(bmp, 0, 0, im.width, im.height)
            if (out.width > maxWidth) out = Bitmap.createScaledBitmap(out, maxWidth, out.height * maxWidth / out.width, true)
            // Écran protégé (FLAG_SECURE) = image noire : on le signale, on ne contourne pas.
            val secure = isAllBlack(out)
            val bos = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, quality, bos)
            return json("mime" to "image/jpeg", "data" to Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP), "secure" to secure, "width" to out.width, "height" to out.height)
        }
    }

    private fun isAllBlack(b: Bitmap): Boolean {
        for (i in 1..30) {
            val px = b.getPixel((b.width * i / 31), (b.height * ((i * 7) % 31) / 31))
            if ((px and 0xFFFFFF) != 0) return false
        }
        return true
    }
}

/** Activité transparente qui demande l'accord MediaProjection. */
class CaptureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(), 1)
    }

    @Deprecated("API Activity simple, suffisante ici")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode == RESULT_OK && data != null) ScreenCapture.start(applicationContext, resultCode, data)
        else Journal.add("Capture d'écran refusée")
        finish()
    }
}
