package fr.ev6miroir;

import android.content.Context;
import android.graphics.Point;
import android.graphics.PointF;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.Surface;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * État central de la recopie : la capture d'écran du téléphone (MediaProjection)
 * et la surface fournie par l'écran de la voiture. Quand les deux existent,
 * l'écran du téléphone est projeté directement dans la surface (sans copie).
 *
 * Toutes les méthodes s'appellent depuis le thread principal.
 */
public final class MirrorState {

    public interface Listener { void onMirrorStateChanged(); }

    private static final String TAG = "EV6Miroir";
    private static final MirrorState INSTANCE = new MirrorState();

    public static MirrorState get() { return INSTANCE; }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;

    private Surface carSurface;
    private int carWidth, carHeight, carDpi;

    private MirrorState() {}

    // ---------- Capture (côté téléphone) ----------

    public boolean hasProjection() { return projection != null; }

    public boolean isMirroring() { return virtualDisplay != null && carSurface != null; }

    public boolean hasCarSurface() { return carSurface != null; }

    public void setProjection(MediaProjection mp) {
        stopProjection();
        projection = mp;
        mp.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() {
                if (projection == mp) {
                    releaseDisplay();
                    projection = null;
                    notifyListeners();
                }
            }
        }, main);
        updateDisplay();
        notifyListeners();
    }

    public void stopProjection() {
        releaseDisplay();
        if (projection != null) {
            MediaProjection p = projection;
            projection = null;
            try { p.stop(); } catch (Exception ignored) {}
        }
        notifyListeners();
    }

    // ---------- Surface (côté voiture) ----------

    public void attachCarSurface(Surface surface, int width, int height, int dpi) {
        carSurface = surface;
        carWidth = width;
        carHeight = height;
        carDpi = dpi;
        updateDisplay();
        notifyListeners();
    }

    public void detachCarSurface() {
        carSurface = null;
        if (virtualDisplay != null) virtualDisplay.setSurface(null);
        notifyListeners();
    }

    public int getCarWidth() { return carWidth; }
    public int getCarHeight() { return carHeight; }

    private void updateDisplay() {
        if (projection == null || carSurface == null || !carSurface.isValid()) return;
        try {
            if (virtualDisplay == null) {
                // Un seul VirtualDisplay par session de capture (obligatoire sur Android 14+) :
                // on le réutilise en changeant sa surface et sa taille.
                virtualDisplay = projection.createVirtualDisplay("EV6Miroir",
                        carWidth, carHeight, carDpi,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                        carSurface, null, main);
            } else {
                virtualDisplay.resize(carWidth, carHeight, carDpi);
                virtualDisplay.setSurface(carSurface);
            }
        } catch (Exception e) {
            Log.e(TAG, "Impossible de créer l'affichage virtuel", e);
        }
    }

    private void releaseDisplay() {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
    }

    // ---------- Conversion des coordonnées voiture -> téléphone ----------

    /**
     * Le système recopie l'écran du téléphone dans la surface de la voiture en
     * conservant les proportions, centré (bandes noires). On applique l'inverse.
     * Retourne null si le point tombe dans une bande noire.
     */
    public PointF carToPhone(Context ctx, float x, float y) {
        Point phone = phoneSize(ctx);
        float scale = carScale(ctx);
        if (scale <= 0) return null;
        float offX = (carWidth - phone.x * scale) / 2f;
        float offY = (carHeight - phone.y * scale) / 2f;
        float px = (x - offX) / scale;
        float py = (y - offY) / scale;
        if (px < 0 || py < 0 || px >= phone.x || py >= phone.y) return null;
        return new PointF(px, py);
    }

    /** Facteur d'échelle téléphone -> voiture. */
    public float carScale(Context ctx) {
        Point phone = phoneSize(ctx);
        if (phone.x == 0 || phone.y == 0 || carWidth == 0 || carHeight == 0) return 0;
        return Math.min((float) carWidth / phone.x, (float) carHeight / phone.y);
    }

    /** Taille réelle de l'écran du téléphone dans son orientation actuelle. */
    public static Point phoneSize(Context ctx) {
        DisplayManager dm = ctx.getSystemService(DisplayManager.class);
        Display d = dm.getDisplay(Display.DEFAULT_DISPLAY);
        Point p = new Point();
        d.getRealSize(p);
        return p;
    }

    // ---------- Écouteurs ----------

    public void addListener(Listener l) { listeners.addIfAbsent(l); }
    public void removeListener(Listener l) { listeners.remove(l); }

    private void notifyListeners() {
        for (Listener l : listeners) l.onMirrorStateChanged();
    }
}
