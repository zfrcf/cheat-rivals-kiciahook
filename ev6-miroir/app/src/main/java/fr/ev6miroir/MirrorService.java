package fr.ev6miroir;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;

/**
 * Service au premier plan qui détient la capture d'écran, garde l'écran
 * allumé et peut forcer le mode paysage (pour remplir l'écran large de l'EV6).
 */
public class MirrorService extends Service implements MirrorState.Listener {

    public static final String ACTION_START = "fr.ev6miroir.START";
    public static final String ACTION_STOP = "fr.ev6miroir.STOP";
    public static final String ACTION_UPDATE = "fr.ev6miroir.UPDATE";
    public static final String EXTRA_CODE = "code";
    public static final String EXTRA_DATA = "data";

    public static final String PREFS = "ev6miroir";
    public static final String PREF_LANDSCAPE = "paysage";

    private static final String CHANNEL = "recopie";
    private static final int NOTIF_ID = 6;

    private View overlay;
    private PowerManager.WakeLock wakeLock;

    public static boolean isLandscapeForced(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_LANDSCAPE, true);
    }

    public static void setLandscapeForced(Context c, boolean on) {
        c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_LANDSCAPE, on).apply();
        if (MirrorState.get().hasProjection()) {
            c.startService(new Intent(c, MirrorService.class).setAction(ACTION_UPDATE));
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            MirrorState.get().stopProjection();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_UPDATE.equals(action)) {
            applyOverlay();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            goForeground();
            int code = intent.getIntExtra(EXTRA_CODE, 0);
            Intent data = intent.getParcelableExtra(EXTRA_DATA);
            MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
            MediaProjection mp = data != null ? mpm.getMediaProjection(code, data) : null;
            if (mp == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            MirrorState.get().setProjection(mp);
            MirrorState.get().addListener(this);
            acquireWakeLock();
            applyOverlay();
        }
        return START_NOT_STICKY;
    }

    @Override public void onMirrorStateChanged() {
        if (!MirrorState.get().hasProjection()) stopSelf();
    }

    @Override
    public void onDestroy() {
        MirrorState.get().removeListener(this);
        removeOverlay();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    // ---------- Notification ----------

    private void goForeground() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Recopie d'écran",
                NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, MirrorService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_recents)
                .setContentTitle("EV6 Miroir actif")
                .setContentText("L'écran du téléphone est recopié sur la voiture.")
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Arrêter", stop).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    // ---------- Écran allumé + orientation ----------

    @SuppressWarnings("deprecation")
    private void acquireWakeLock() {
        if (wakeLock != null) return;
        PowerManager pm = getSystemService(PowerManager.class);
        // Sans écran allumé, la recopie devient noire.
        wakeLock = pm.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP, "EV6Miroir:ecran");
        wakeLock.acquire();
    }

    /**
     * Petite fenêtre invisible (1 pixel, non tactile) qui garde l'écran allumé
     * et, si demandé, impose l'orientation paysage à tout le téléphone.
     */
    private void applyOverlay() {
        removeOverlay();
        if (!Settings.canDrawOverlays(this)) return;
        WindowManager wm = getSystemService(WindowManager.class);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(1, 1,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT);
        lp.screenOrientation = isLandscapeForced(this)
                ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        overlay = new View(this);
        try {
            wm.addView(overlay, lp);
        } catch (Exception e) {
            overlay = null;
        }
    }

    private void removeOverlay() {
        if (overlay != null) {
            try { getSystemService(WindowManager.class).removeView(overlay); } catch (Exception ignored) {}
            overlay = null;
        }
    }
}
