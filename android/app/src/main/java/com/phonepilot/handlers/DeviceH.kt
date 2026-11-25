package com.phonepilot.handlers

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.usage.UsageStatsManager
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioManager
import android.media.MediaRecorder
import android.media.RingtoneManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Bundle
import android.os.Environment
import android.os.Looper
import android.os.PowerManager
import android.provider.AlarmClock
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.view.KeyEvent
import androidx.core.content.FileProvider
import com.phonepilot.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import java.io.File
import java.util.Locale

/** Applis, médias, capteurs, réglages accessibles sans Shizuku. */
object DeviceH {
    private val ctx: Context get() = PhonePilotApp.instance
    private val pm get() = ctx.packageManager
    private var tts: TextToSpeech? = null

    private fun start(i: Intent) = ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    val handlers: Map<String, Handler> = mapOf(
        "health" to { _ ->
            json("accessibilite" to (PilotAccessibilityService.instance != null), "capture" to ScreenCapture.ready,
                "notifications" to (PilotNotificationListener.instance != null), "shizuku" to ShizukuShell.active,
                "superposition" to android.provider.Settings.canDrawOverlays(ctx),
                "batterie_optimisee" to !ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName),
                "stop" to Prefs.stopped)
        },
        "confirm.request" to { p -> json("approved" to Confirm.request(p.getString("category"), p.getString("summary"), p.int("timeoutSec", 60))) },
        "stop.notify" to { p -> Emergency.stop(p.optString("reason", "demandé par Claude")); json("ok" to true) },
        "notify" to { p ->
            val n = Notification.Builder(ctx, PhonePilotApp.CH_ALERTS).setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(p.getString("title")).setContentText(p.getString("text")).setStyle(Notification.BigTextStyle().bigText(p.getString("text"))).setAutoCancel(true).build()
            ctx.getSystemService(NotificationManager::class.java).notify((System.currentTimeMillis() % 100000).toInt() + 1000, n)
            json("ok" to true)
        },

        "device.state" to { _ ->
            val bm = ctx.getSystemService(BatteryManager::class.java)
            json("screenOn" to ctx.getSystemService(PowerManager::class.java).isInteractive,
                "locked" to ctx.getSystemService(KeyguardManager::class.java).isKeyguardLocked,
                "foreground" to (PilotAccessibilityService.instance?.rootInActiveWindow?.packageName?.toString() ?: PilotAccessibilityService.foreground),
                "battery" to json("level" to bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY), "charging" to bm.isCharging))
        },
        "app.foreground" to { _ -> json("package" to (PilotAccessibilityService.instance?.rootInActiveWindow?.packageName?.toString() ?: PilotAccessibilityService.foreground)) },
        "battery.info" to { _ ->
            val i = ctx.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))!!
            val health = mapOf(BatteryManager.BATTERY_HEALTH_GOOD to "bonne", BatteryManager.BATTERY_HEALTH_OVERHEAT to "surchauffe", BatteryManager.BATTERY_HEALTH_DEAD to "morte", BatteryManager.BATTERY_HEALTH_COLD to "froide")
            json("level" to i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) * 100 / i.getIntExtra(BatteryManager.EXTRA_SCALE, 100),
                "temperatureC" to i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0, "voltageMv" to i.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0),
                "health" to (health[i.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)] ?: "inconnue"), "charging" to (i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0))
        },

        // ---- Écran / UI (accessibilité) ----
        "ui.dump" to { _ -> PilotAccessibilityService.require().dump() },
        "ui.action" to { p -> PilotAccessibilityService.require().action(p) },
        "ui.type_focused" to { p -> PilotAccessibilityService.require().typeFocused(p.getString("text"), p.bool("replace", true)) },
        "gesture.swipe" to { p -> PilotAccessibilityService.require().gesture(p.getDouble("x1").toFloat(), p.getDouble("y1").toFloat(), p.getDouble("x2").toFloat(), p.getDouble("y2").toFloat(), p.long("ms", 300)) },
        "input.tap" to { p -> PilotAccessibilityService.require().gesture(p.getDouble("x").toFloat(), p.getDouble("y").toFloat(), p.getDouble("x").toFloat(), p.getDouble("y").toFloat(), 60) },
        "input.long_press" to { p -> PilotAccessibilityService.require().gesture(p.getDouble("x").toFloat(), p.getDouble("y").toFloat(), p.getDouble("x").toFloat(), p.getDouble("y").toFloat(), p.long("ms", 800)) },
        "gesture.pinch" to { p -> PilotAccessibilityService.require().pinch(p.getDouble("x").toFloat(), p.getDouble("y").toFloat(), p.getString("zoom") == "in") },
        "global.action" to { p -> PilotAccessibilityService.require().global(p.getString("action")) },
        "camera.shutter" to { _ -> PilotAccessibilityService.require().shutter() },
        "screen.capture" to { _ -> ScreenCapture.capture() },
        "clipboard.get" to { _ -> json("text" to clipboard(null)) },
        "clipboard.set" to { p -> clipboard(p.getString("text")); json("ok" to true) },

        // ---- Applis ----
        "apps.list" to { p ->
            val all = p.bool("all", false)
            pm.getInstalledApplications(0).filter { all || pm.getLaunchIntentForPackage(it.packageName) != null }
                .map { json("package" to it.packageName, "label" to pm.getApplicationLabel(it).toString()) }
                .sortedBy { it.optString("label").lowercase() }.toJsonArray { it }
        },
        "app.open" to { p ->
            val i = pm.getLaunchIntentForPackage(p.getString("package")) ?: throw RpcError("APP_NOT_FOUND", "Appli non lançable : ${p.getString("package")}")
            start(i.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)); json("ok" to true)
        },
        "app.permissions" to { p ->
            val info = pm.getPackageInfo(p.getString("package"), PackageManager.GET_PERMISSIONS)
            (info.requestedPermissions ?: emptyArray()).mapIndexed { i, perm ->
                json("permission" to perm, "granted" to ((info.requestedPermissionsFlags[i] and PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0))
            }.toJsonArray { it }
        },
        "app.install_prompt" to { p ->
            val f = File(p.getString("path").replace("/sdcard", Environment.getExternalStorageDirectory().absolutePath))
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
            start(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            json("ok" to true)
        },
        "url.open" to { p -> start(Intent(Intent.ACTION_VIEW, Uri.parse(p.getString("url")))); json("ok" to true) },
        "intent.start" to { p ->
            val i = Intent(p.str("action") ?: Intent.ACTION_VIEW)
            p.str("data")?.let { i.data = Uri.parse(it) }
            p.str("component")?.let { i.component = android.content.ComponentName.unflattenFromString(it) }
            p.optJSONObject("extras")?.let { e -> e.keys().forEach { k -> when (val v = e.get(k)) { is Int -> i.putExtra(k, v); is Boolean -> i.putExtra(k, v); else -> i.putExtra(k, v.toString()) } } }
            start(i); json("ok" to true)
        },
        "share" to { p -> share(p) },
        "usage.stats" to { p ->
            val usm = ctx.getSystemService(UsageStatsManager::class.java)
            val days = if (p.optString("period") == "week") 7 else 1
            val cal = java.util.Calendar.getInstance().apply { set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); add(java.util.Calendar.DAY_OF_YEAR, -(days - 1)) }
            val stats = usm.queryAndAggregateUsageStats(cal.timeInMillis, System.currentTimeMillis())
            if (stats.isEmpty()) throw RpcError("USAGE_DENIED", "Accès aux données d'utilisation non accordé : Paramètres › Sécurité › Accès aux données d'utilisation › PhonePilot.")
            stats.values.filter { it.totalTimeInForeground > 60_000 }.sortedByDescending { it.totalTimeInForeground }.take(p.int("top", 15)).toJsonArray {
                json("app" to (runCatching { pm.getApplicationLabel(pm.getApplicationInfo(it.packageName, 0)).toString() }.getOrNull() ?: it.packageName),
                    "minutes" to it.totalTimeInForeground / 60_000)
            }
        },

        // ---- Médias ----
        "photos.list" to { p -> photos(p) },
        "camera.open" to { p ->
            val action = if (p.optString("mode") == "video") MediaStore.INTENT_ACTION_VIDEO_CAMERA else MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA
            start(Intent(action).apply { if (p.bool("front", false)) { putExtra("android.intent.extras.CAMERA_FACING", 1); putExtra("android.intent.extras.LENS_FACING_FRONT", 1) } })
            json("ok" to true)
        },
        "media.key" to { p ->
            val code = mapOf("play_pause" to KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, "next" to KeyEvent.KEYCODE_MEDIA_NEXT, "previous" to KeyEvent.KEYCODE_MEDIA_PREVIOUS, "stop" to KeyEvent.KEYCODE_MEDIA_STOP)[p.getString("action")]
                ?: throw RpcError("BAD_ACTION", "Action média inconnue")
            val am = ctx.getSystemService(AudioManager::class.java)
            am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code)); am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
            json("ok" to true)
        },
        "volume.set" to { p ->
            val am = ctx.getSystemService(AudioManager::class.java)
            val s = mapOf("media" to AudioManager.STREAM_MUSIC, "ring" to AudioManager.STREAM_RING, "alarm" to AudioManager.STREAM_ALARM, "notification" to AudioManager.STREAM_NOTIFICATION, "voice" to AudioManager.STREAM_VOICE_CALL, "system" to AudioManager.STREAM_SYSTEM)[p.getString("stream")]!!
            val max = am.getStreamMaxVolume(s)
            val lvl = p.dbl("percent")?.let { (it / 100 * max).toInt() } ?: p.int("level", max / 2)
            am.setStreamVolume(s, lvl.coerceIn(0, max), 0)
            json("ok" to true, "level" to lvl, "max" to max)
        },
        "tts.say" to { p -> say(p.getString("text"), p.optString("lang", "fr-FR")) },
        "torch.set" to { p ->
            val cm = ctx.getSystemService(CameraManager::class.java)
            val id = cm.cameraIdList.first { cm.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            cm.setTorchMode(id, p.getBoolean("on")); json("ok" to true)
        },
        "ring.start" to { p ->
            val am = ctx.getSystemService(AudioManager::class.java)
            am.ringerMode = AudioManager.RINGER_MODE_NORMAL
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            val r = RingtoneManager.getRingtone(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            r.audioAttributes = android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ALARM).build()
            r.play()
            android.os.Handler(Looper.getMainLooper()).postDelayed({ r.stop() }, p.int("seconds", 30) * 1000L)
            json("ok" to true, "seconds" to p.int("seconds", 30))
        },
        "audio.record" to { p -> record(p.int("seconds", 30)) },

        // ---- Capteurs / réseaux ----
        "location.get" to { p -> location(p.bool("fresh", true)) },
        "wifi.scan" to { _ ->
            val wm = ctx.applicationContext.getSystemService(WifiManager::class.java)
            @Suppress("DEPRECATION") wm.startScan()
            delay(4000)
            wm.scanResults.sortedByDescending { it.level }.distinctBy { it.SSID }.toJsonArray {
                json("ssid" to it.SSID, "signal_dbm" to it.level, "securite" to it.capabilities, "frequence" to it.frequency)
            }
        },
        "bluetooth.list" to { _ ->
            @SuppressLint("MissingPermission")
            val bonded = BluetoothAdapter.getDefaultAdapter()?.bondedDevices ?: emptySet()
            json("enabled" to (BluetoothAdapter.getDefaultAdapter()?.isEnabled == true), "devices" to bonded.toJsonArray { json("name" to it.name, "address" to it.address) })
        },
        "alarm.create" to { p ->
            start(Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, p.getInt("hour")).putExtra(AlarmClock.EXTRA_MINUTES, p.getInt("minutes"))
                .putExtra(AlarmClock.EXTRA_MESSAGE, p.optString("label", "PhonePilot")).putExtra(AlarmClock.EXTRA_SKIP_UI, true).apply {
                    p.optJSONArray("days")?.let { d -> putExtra(AlarmClock.EXTRA_DAYS, ArrayList((0 until d.length()).map { d.getInt(it) })) }
                })
            json("ok" to true)
        },
        "timer.create" to { p ->
            start(Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, p.getInt("seconds")).putExtra(AlarmClock.EXTRA_MESSAGE, p.optString("label", "PhonePilot")).putExtra(AlarmClock.EXTRA_SKIP_UI, true))
            json("ok" to true)
        },
    )

    private suspend fun clipboard(set: String?): String {
        val d = CompletableDeferred<String>()
        ClipboardActivity.pending = d
        start(Intent(ctx, ClipboardActivity::class.java).apply { if (set != null) putExtra("set", set) })
        return withTimeoutOrNull(5000) { d.await() } ?: throw RpcError("CLIPBOARD_TIMEOUT", "Presse-papiers inaccessible (écran éteint ?).")
    }

    private fun share(p: org.json.JSONObject): Any {
        val path = p.str("path")
        val email = p.str("email")
        val i = Intent(if (path == null && email != null) Intent.ACTION_SENDTO else Intent.ACTION_SEND)
        if (path != null) {
            val f = File(path.replace(Regex("^/sdcard"), Environment.getExternalStorageDirectory().absolutePath))
            if (!f.exists()) throw RpcError("NOT_FOUND", "Fichier introuvable : $path")
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
            i.putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            i.type = p.str("mime") ?: (android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase()) ?: "*/*")
        } else if (email != null) i.data = Uri.parse("mailto:") else i.type = "text/plain"
        p.str("text")?.let { i.putExtra(Intent.EXTRA_TEXT, it) }
        email?.let { i.putExtra(Intent.EXTRA_EMAIL, arrayOf(it)) }
        p.str("subject")?.let { i.putExtra(Intent.EXTRA_SUBJECT, it) }
        val pkg = p.str("package")
        if (pkg != null) i.setPackage(pkg)
        start(if (pkg != null) i else Intent.createChooser(i, "Partager"))
        return json("ok" to true, "note" to "Appli ouverte : termine avec ui_tree / tap.")
    }

    private fun photos(p: org.json.JSONObject): JSONArray {
        val kind = p.optString("kind", "photo")
        val uris = when (kind) { "video" -> listOf(MediaStore.Video.Media.EXTERNAL_CONTENT_URI); "all" -> listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI); else -> listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI) }
        val after = isoToMs(p.str("after")); val before = isoToMs(p.str("before"))
        val near = p.optJSONObject("near")
        val res = mutableListOf<org.json.JSONObject>()
        for (u in uris) {
            @Suppress("DEPRECATION")
            ctx.contentResolver.query(u, arrayOf(MediaStore.MediaColumns.DATA, MediaStore.MediaColumns.DATE_TAKEN, MediaStore.MediaColumns.SIZE, MediaStore.Images.ImageColumns.LATITUDE, MediaStore.Images.ImageColumns.LONGITUDE),
                null, null, "${MediaStore.MediaColumns.DATE_TAKEN} DESC")?.use { c ->
                while (c.moveToNext()) {
                    val t = c.getLong(1)
                    if (after != null && t < after) break
                    if (before != null && t > before) continue
                    val lat = c.getDouble(3); val lon = c.getDouble(4)
                    if (near != null) {
                        if (lat == 0.0 && lon == 0.0) continue
                        val d = FloatArray(1); Location.distanceBetween(lat, lon, near.getDouble("lat"), near.getDouble("lon"), d)
                        if (d[0] > near.optDouble("radius_km", 2.0) * 1000) continue
                    }
                    res += json("path" to c.getString(0).replace(Environment.getExternalStorageDirectory().absolutePath, "/sdcard"), "date" to msToIso(t), "size" to c.getLong(2),
                        "lat" to lat.takeIf { it != 0.0 }, "lon" to lon.takeIf { it != 0.0 })
                    if (res.size >= p.int("limit", 20) * uris.size) break
                }
            }
        }
        return res.sortedByDescending { it.optString("date") }.take(p.int("limit", 20)).toJsonArray { it }
    }

    private suspend fun say(text: String, lang: String): Any {
        val ready = CompletableDeferred<Boolean>()
        val engine = tts ?: TextToSpeech(ctx) { ready.complete(it == TextToSpeech.SUCCESS) }.also { tts = it }
        if (!ready.isCompleted && tts === engine) withTimeoutOrNull(5000) { ready.await() }
        engine.language = Locale.forLanguageTag(lang)
        engine.speak(text, TextToSpeech.QUEUE_ADD, null, "pp${System.currentTimeMillis()}")
        return json("ok" to true)
    }

    private suspend fun record(seconds: Int): Any = withContext(Dispatchers.IO) {
        val dir = File(Environment.getExternalStorageDirectory(), "Recordings/PhonePilot").apply { mkdirs() }
        val f = File(dir, "memo_${System.currentTimeMillis()}.m4a")
        @Suppress("DEPRECATION")
        val r = MediaRecorder().apply {
            setAudioSource(MediaRecorder.AudioSource.MIC); setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC); setAudioEncodingBitRate(96_000); setAudioSamplingRate(44_100)
            setOutputFile(f.absolutePath); prepare(); start()
        }
        Journal.add("🎙️ Enregistrement audio ($seconds s)")
        delay(seconds * 1000L)
        r.stop(); r.release()
        json("ok" to true, "path" to "/sdcard/Recordings/PhonePilot/${f.name}", "seconds" to seconds)
    }

    @SuppressLint("MissingPermission")
    private suspend fun location(fresh: Boolean): Any {
        val lm = ctx.getSystemService(LocationManager::class.java)
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { lm.isProviderEnabled(it) }
        if (providers.isEmpty()) throw RpcError("LOCATION_OFF", "Localisation désactivée sur le téléphone.")
        var loc: Location? = null
        if (fresh) {
            val d = CompletableDeferred<Location>()
            val l = object : LocationListener {
                override fun onLocationChanged(location: Location) { d.complete(location) }
                override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
                override fun onProviderEnabled(p: String) {}
                override fun onProviderDisabled(p: String) {}
            }
            withContext(Dispatchers.Main) { providers.forEach { lm.requestLocationUpdates(it, 0L, 0f, l, Looper.getMainLooper()) } }
            loc = withTimeoutOrNull(30_000) { d.await() }
            withContext(Dispatchers.Main) { lm.removeUpdates(l) }
        }
        loc = loc ?: providers.mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time } ?: throw RpcError("NO_FIX", "Pas de position disponible.")
        return json("lat" to loc.latitude, "lon" to loc.longitude, "accuracy_m" to loc.accuracy, "time" to msToIso(loc.time), "provider" to loc.provider)
    }
}
