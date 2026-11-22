package fr.ev6miroir;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

/** Écran du téléphone : vérifie les réglages et lance la recopie. */
public class MainActivity extends AppCompatActivity implements MirrorState.Listener {

    private static final int REQ_CAPTURE = 1;

    private TextView status, stAccess, stOverlay, stBattery;
    private Button btnStart;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
        status = findViewById(R.id.status);
        stAccess = findViewById(R.id.st_access);
        stOverlay = findViewById(R.id.st_overlay);
        stBattery = findViewById(R.id.st_battery);
        btnStart = findViewById(R.id.btn_start);

        btnStart.setOnClickListener(v -> {
            if (MirrorState.get().hasProjection()) {
                startService(new Intent(this, MirrorService.class).setAction(MirrorService.ACTION_STOP));
            } else {
                askCapture();
            }
        });
        findViewById(R.id.btn_access).setOnClickListener(v ->
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        findViewById(R.id.btn_overlay).setOnClickListener(v ->
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()))));
        findViewById(R.id.btn_battery).setOnClickListener(v -> askBattery());

        CompoundButton sw = findViewById(R.id.sw_landscape);
        sw.setChecked(MirrorService.isLandscapeForced(this));
        sw.setOnCheckedChangeListener((v, on) -> MirrorService.setLandscapeForced(this, on));

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        MirrorState.get().addListener(this);
        refresh();
    }

    @Override protected void onPause() {
        MirrorState.get().removeListener(this);
        super.onPause();
    }

    @Override public void onMirrorStateChanged() { refresh(); }

    private void refresh() {
        MirrorState st = MirrorState.get();
        boolean access = TouchService.isEnabled(this);
        boolean overlay = Settings.canDrawOverlays(this);
        boolean battery = getSystemService(PowerManager.class)
                .isIgnoringBatteryOptimizations(getPackageName());

        stAccess.setText(mark(access) + " Tactile (service d'accessibilité « EV6 Miroir – tactile »)");
        stOverlay.setText(mark(overlay) + " Affichage par-dessus (écran allumé + mode paysage)");
        stBattery.setText(mark(battery) + " Pas de mise en veille forcée par la batterie");

        if (!st.hasProjection()) {
            status.setText("⏸  Recopie arrêtée");
            status.setBackgroundColor(Color.parseColor("#33888888"));
            btnStart.setText("Démarrer la recopie");
        } else if (st.isMirroring()) {
            status.setText("🟢  Recopie en cours sur l'EV6");
            status.setBackgroundColor(Color.parseColor("#3326C281"));
            btnStart.setText("Arrêter la recopie");
        } else {
            status.setText("🟡  Prêt — ouvrez « EV6 Miroir » sur l'écran de la voiture");
            status.setBackgroundColor(Color.parseColor("#33F2B705"));
            btnStart.setText("Arrêter la recopie");
        }
    }

    private static String mark(boolean ok) { return ok ? "✅" : "❌"; }

    private void askCapture() {
        MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE);
    }

    @SuppressLint("BatteryLife")
    private void askBattery() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_CAPTURE) return;
        if (res != RESULT_OK || data == null) {
            Toast.makeText(this, "Autorisation de capture refusée", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(this, MirrorService.class)
                .setAction(MirrorService.ACTION_START)
                .putExtra(MirrorService.EXTRA_CODE, res)
                .putExtra(MirrorService.EXTRA_DATA, data);
        startForegroundService(i);
        if (!TouchService.isEnabled(this)) {
            Toast.makeText(this, "Pensez à activer le tactile dans l'accessibilité",
                    Toast.LENGTH_LONG).show();
        }
    }
}
