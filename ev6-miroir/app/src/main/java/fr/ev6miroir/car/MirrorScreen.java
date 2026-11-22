package fr.ev6miroir.car;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Point;
import android.graphics.PointF;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Surface;

import androidx.annotation.DrawableRes;
import androidx.annotation.NonNull;
import androidx.car.app.AppManager;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.SurfaceCallback;
import androidx.car.app.SurfaceContainer;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.model.MessageInfo;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import fr.ev6miroir.MirrorService;
import fr.ev6miroir.MirrorState;
import fr.ev6miroir.R;
import fr.ev6miroir.TouchService;

/**
 * Écran affiché sur la voiture : la surface plein écran reçoit la recopie du
 * téléphone, et les gestes faits sur l'écran de la voiture sont renvoyés au
 * téléphone.
 *
 * Boutons à droite : Retour, Accueil, Applis récentes, Paysage/Portrait.
 * Boutons carte : Déplacement (active le glisser), Défiler haut, Défiler bas.
 */
public class MirrorScreen extends Screen
        implements SurfaceCallback, MirrorState.Listener, DefaultLifecycleObserver {

    private static final long SCROLL_DEBOUNCE_MS = 90;
    private static final long SCROLL_MAX_WAIT_MS = 350;
    private static final long SCALE_DEBOUNCE_MS = 150;

    private final Handler handler = new Handler(Looper.getMainLooper());

    // Défilement : on cumule les petits déplacements envoyés par la voiture,
    // puis on rejoue un seul glissement sur le téléphone.
    private float scrollX, scrollY;
    private long scrollStart;
    private final Runnable flushScroll = this::flushScroll;

    private float scaleAcc = 1f, scaleFx = -1, scaleFy = -1;
    private final Runnable flushScale = this::flushScale;

    public MirrorScreen(@NonNull CarContext carContext) {
        super(carContext);
        getLifecycle().addObserver(this);
    }

    // ---------- Cycle de vie ----------

    @Override public void onCreate(@NonNull LifecycleOwner owner) {
        MirrorState.get().addListener(this);
        getCarContext().getCarService(AppManager.class).setSurfaceCallback(this);
    }

    @Override public void onDestroy(@NonNull LifecycleOwner owner) {
        MirrorState.get().removeListener(this);
        handler.removeCallbacksAndMessages(null);
    }

    @Override public void onMirrorStateChanged() { invalidate(); }

    // ---------- Gabarit affiché ----------

    @NonNull @Override
    public Template onGetTemplate() {
        boolean landscape = MirrorService.isLandscapeForced(getCarContext());
        ActionStrip strip = new ActionStrip.Builder()
                .addAction(icon(R.drawable.ic_back, () -> global(AccessibilityService.GLOBAL_ACTION_BACK)))
                .addAction(icon(R.drawable.ic_home, () -> global(AccessibilityService.GLOBAL_ACTION_HOME)))
                .addAction(icon(R.drawable.ic_recents, () -> global(AccessibilityService.GLOBAL_ACTION_RECENTS)))
                .addAction(icon(R.drawable.ic_rotate, () -> toggleOrientation(!landscape)))
                .build();

        ActionStrip mapStrip = new ActionStrip.Builder()
                .addAction(Action.PAN)
                .addAction(icon(R.drawable.ic_up, () -> pageScroll(false)))
                .addAction(icon(R.drawable.ic_down, () -> pageScroll(true)))
                .build();

        NavigationTemplate.Builder b = new NavigationTemplate.Builder()
                .setActionStrip(strip)
                .setMapActionStrip(mapStrip)
                .setPanModeListener(inPan -> { });

        MessageInfo info = statusMessage();
        if (info != null) b.setNavigationInfo(info);
        return b.build();
    }

    private MessageInfo statusMessage() {
        MirrorState st = MirrorState.get();
        if (!st.hasProjection()) {
            return new MessageInfo.Builder("Recopie en attente")
                    .setText("Sur le téléphone : ouvrez EV6 Miroir et appuyez sur « Démarrer la recopie ».")
                    .build();
        }
        if (!TouchService.isEnabled(getCarContext())) {
            return new MessageInfo.Builder("Tactile désactivé")
                    .setText("Activez « EV6 Miroir – tactile » dans les réglages d'accessibilité du téléphone.")
                    .build();
        }
        return null;
    }

    private Action icon(@DrawableRes int res, Runnable onClick) {
        return new Action.Builder()
                .setIcon(new CarIcon.Builder(
                        IconCompat.createWithResource(getCarContext(), res)).build())
                .setOnClickListener(onClick::run)
                .build();
    }

    // ---------- Surface de la voiture ----------

    @Override public void onSurfaceAvailable(@NonNull SurfaceContainer sc) {
        Surface s = sc.getSurface();
        if (s == null) return;
        MirrorState.get().attachCarSurface(s, sc.getWidth(), sc.getHeight(), sc.getDpi());
    }

    @Override public void onSurfaceDestroyed(@NonNull SurfaceContainer sc) {
        MirrorState.get().detachCarSurface();
    }

    @Override public void onVisibleAreaChanged(@NonNull Rect visibleArea) { }

    @Override public void onStableAreaChanged(@NonNull Rect stableArea) { }

    // ---------- Gestes venant de la voiture ----------

    @Override public void onClick(float x, float y) {
        TouchService t = touch();
        if (t == null) return;
        PointF p = MirrorState.get().carToPhone(getCarContext(), x, y);
        if (p != null) t.tap(p.x, p.y);
    }

    @Override public void onScroll(float distanceX, float distanceY) {
        if (scrollX == 0 && scrollY == 0) scrollStart = SystemClock.uptimeMillis();
        scrollX += distanceX;
        scrollY += distanceY;
        handler.removeCallbacks(flushScroll);
        if (SystemClock.uptimeMillis() - scrollStart > SCROLL_MAX_WAIT_MS) {
            flushScroll();
        } else {
            handler.postDelayed(flushScroll, SCROLL_DEBOUNCE_MS);
        }
    }

    @Override public void onFling(float velocityX, float velocityY) {
        handler.removeCallbacks(flushScroll);
        TouchService t = touch();
        float scale = MirrorState.get().carScale(getCarContext());
        if (t == null || scale <= 0) { resetScroll(); return; }
        // Déplacement du doigt = inverse de la distance de défilement + élan du lancer.
        float dx = (-scrollX + velocityX * 0.12f) / scale;
        float dy = (-scrollY + velocityY * 0.12f) / scale;
        resetScroll();
        Point s = MirrorState.phoneSize(getCarContext());
        float cx = s.x / 2f, cy = s.y / 2f;
        t.swipe(cx, cy, cx + dx, cy + dy, 80);
    }

    @Override public void onScale(float focusX, float focusY, float scaleFactor) {
        scaleAcc *= scaleFactor;
        scaleFx = focusX;
        scaleFy = focusY;
        handler.removeCallbacks(flushScale);
        handler.postDelayed(flushScale, SCALE_DEBOUNCE_MS);
    }

    private void flushScroll() {
        TouchService t = touch();
        float scale = MirrorState.get().carScale(getCarContext());
        if (t != null && scale > 0 && (scrollX != 0 || scrollY != 0)) {
            Point s = MirrorState.phoneSize(getCarContext());
            float cx = s.x / 2f, cy = s.y / 2f;
            // Glissement lent : le contenu suit le doigt sans effet de lancer.
            t.swipe(cx, cy, cx - scrollX / scale, cy - scrollY / scale, 250);
        }
        resetScroll();
    }

    private void resetScroll() {
        scrollX = 0;
        scrollY = 0;
    }

    private void flushScale() {
        TouchService t = touch();
        if (t != null && Math.abs(scaleAcc - 1f) > 0.03f) {
            PointF p = null;
            if (scaleFx >= 0 && scaleFy >= 0) {
                p = MirrorState.get().carToPhone(getCarContext(), scaleFx, scaleFy);
            }
            if (p == null) {
                Point s = MirrorState.phoneSize(getCarContext());
                p = new PointF(s.x / 2f, s.y / 2f);
            }
            t.pinch(p.x, p.y, scaleAcc);
        }
        scaleAcc = 1f;
    }

    private void pageScroll(boolean down) {
        TouchService t = touch();
        if (t == null) return;
        Point s = MirrorState.phoneSize(getCarContext());
        float cx = s.x / 2f;
        if (down) t.swipe(cx, s.y * 0.72f, cx, s.y * 0.28f, 300);
        else t.swipe(cx, s.y * 0.28f, cx, s.y * 0.72f, 300);
    }

    private void global(int action) {
        TouchService t = touch();
        if (t != null) t.global(action);
    }

    private void toggleOrientation(boolean landscape) {
        try {
            MirrorService.setLandscapeForced(getCarContext(), landscape);
            CarToast.makeText(getCarContext(), landscape ? "Mode paysage" : "Mode libre",
                    CarToast.LENGTH_SHORT).show();
        } catch (Exception e) {
            CarToast.makeText(getCarContext(), "Impossible de changer l'orientation",
                    CarToast.LENGTH_SHORT).show();
        }
        invalidate();
    }

    /** Service tactile, ou null (avec un message) s'il n'est pas prêt. */
    private TouchService touch() {
        if (!MirrorState.get().isMirroring()) return null;
        TouchService t = TouchService.get();
        if (t == null) {
            CarToast.makeText(getCarContext(),
                    "Activez le tactile EV6 Miroir dans l'accessibilité du téléphone",
                    CarToast.LENGTH_LONG).show();
        }
        return t;
    }
}
