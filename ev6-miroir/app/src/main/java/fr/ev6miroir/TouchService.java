package fr.ev6miroir;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.graphics.Path;
import android.graphics.Point;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;

/**
 * Service d'accessibilité : rejoue sur le téléphone les gestes faits sur
 * l'écran de la voiture (appui, glissement, pincement, retour, accueil…).
 */
public class TouchService extends AccessibilityService {

    private static TouchService instance;

    public static TouchService get() { return instance; }

    public static boolean isEnabled(Context ctx) {
        if (instance != null) return true;
        String list = Settings.Secure.getString(ctx.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return list != null && list.contains(ctx.getPackageName() + "/");
    }

    @Override protected void onServiceConnected() { instance = this; }

    @Override public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override public void onInterrupt() {}

    // ---------- Gestes ----------

    public void tap(float x, float y) {
        Path p = new Path();
        p.moveTo(x, y);
        dispatch(new GestureDescription.StrokeDescription(p, 0, 60));
    }

    public void longPress(float x, float y) {
        Path p = new Path();
        p.moveTo(x, y);
        dispatch(new GestureDescription.StrokeDescription(p, 0, 700));
    }

    /** Glissement du doigt de (x1,y1) vers (x2,y2). */
    public void swipe(float x1, float y1, float x2, float y2, long durationMs) {
        Point s = MirrorState.phoneSize(this);
        Path p = new Path();
        p.moveTo(clamp(x1, s.x), clamp(y1, s.y));
        p.lineTo(clamp(x2, s.x), clamp(y2, s.y));
        dispatch(new GestureDescription.StrokeDescription(p, 0, Math.max(10, durationMs)));
    }

    /** Pincement à deux doigts autour de (cx,cy). factor > 1 = zoom avant. */
    public void pinch(float cx, float cy, float factor) {
        Point s = MirrorState.phoneSize(this);
        float start = Math.min(s.x, s.y) * 0.12f;
        float end = Math.max(20f, Math.min(start * factor, Math.min(s.x, s.y) * 0.45f));
        Path a = new Path();
        a.moveTo(clamp(cx - start, s.x), cy);
        a.lineTo(clamp(cx - end, s.x), cy);
        Path b = new Path();
        b.moveTo(clamp(cx + start, s.x), cy);
        b.lineTo(clamp(cx + end, s.x), cy);
        GestureDescription g = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(a, 0, 300))
                .addStroke(new GestureDescription.StrokeDescription(b, 0, 300))
                .build();
        dispatchGesture(g, null, null);
    }

    public void global(int action) { performGlobalAction(action); }

    private void dispatch(GestureDescription.StrokeDescription stroke) {
        dispatchGesture(new GestureDescription.Builder().addStroke(stroke).build(), null, null);
    }

    private static float clamp(float v, int max) {
        return Math.max(1f, Math.min(v, max - 2f));
    }
}
