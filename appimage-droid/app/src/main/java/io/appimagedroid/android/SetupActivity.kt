package io.appimagedroid.android

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Guide d'installation de l'environnement Termux, avec état en direct. */
class SetupActivity : Activity() {
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Configuration Termux"
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(16); setPadding(p, p, p, p)
        }
        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onResume() {
        super.onResume()
        build()
    }

    private fun build() {
        root.removeAllViews()
        val termux = Termux.isInstalled(this)
        val x11 = Termux.isInstalled(this, Termux.X11_PACKAGE)
        val perm = Termux.hasPermission(this)
        val storage = checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

        heading("État")
        status(termux, "Termux installé")
        status(x11, "Termux:X11 installé (affichage graphique)")
        status(perm, "Autorisation « Exécuter des commandes Termux »")
        status(storage, "Accès au stockage (/sdcard/AppImages)")
        if (!perm || !storage) button("Accorder les autorisations") {
            val p = mutableListOf<String>()
            if (!storage) p += Manifest.permission.WRITE_EXTERNAL_STORAGE
            if (termux && !perm) p += Termux.PERMISSION
            requestPermissions(p.toTypedArray(), 1)
        }

        heading("1. Installer les applications")
        text("Installez Termux et Termux:X11 depuis F-Droid ou GitHub. La version Play Store de Termux est obsolète et ne fonctionne pas.")
        button("Termux (F-Droid)") { open("https://f-droid.org/packages/com.termux/") }
        button("Termux:X11 (GitHub)") { open("https://github.com/termux/termux-x11/releases") }

        heading("2. Préparer Termux")
        text("Ouvrez Termux, collez ces commandes et validez (≈ 5 min) :")
        code(
            "termux-setup-storage\n" +
                "apt update && apt full-upgrade -y -o Dpkg::Options::=\"--force-confnew\"\n" +
                "pkg install -y x11-repo\n" +
                "pkg install -y proot-distro termux-x11-nightly\n" +
                "mkdir -p ~/.termux && (grep -q '^allow-external-apps=true' ~/.termux/termux.properties || " +
                "echo 'allow-external-apps=true' >> ~/.termux/termux.properties)\n" +
                "termux-reload-settings"
        )

        text("Erreur « CANNOT LINK EXECUTABLE curl » ou miroir introuvable : lancez termux-change-repo " +
            "(Mirror group → All mirrors) puis relancez le bloc. En dernier recours, réinstallez Termux depuis F-Droid.")

        heading("3. Installer Debian et les bibliothèques")
        text("Environnement Linux dans lequel tournent les AppImage (≈ 1 Go) :")
        code(
            "proot-distro install debian\n" +
                "proot-distro login debian -- bash -c \"apt update && apt install -y " +
                "libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libsecret-1-0 " +
                "libnotify4 libdrm2 libglib2.0-0 libfuse2 fonts-dejavu dbus-x11 squashfs-tools\""
        )

        heading("4. (Optionnel) AppImage x86_64")
        text("La plupart des AppImage sont compilés pour PC (x86_64). Sur un téléphone ARM64, ils passent par l'émulateur box64 :")
        code("proot-distro login debian -- bash -c \"apt install -y box64 || echo 'box64 indisponible dans ce dépôt'\"")
        text("Si box64 n'est pas proposé par Debian, suivez les instructions des paquets box64-debs (Pi-Apps-Coders).")

        heading("Bon à savoir")
        text(
            "• 1er lancement : l'AppImage est extrait dans Debian (/opt/appimages), ce qui peut prendre une minute.\n" +
                "• Les apps Electron reçoivent automatiquement --no-sandbox.\n" +
                "• Performances : correctes en ARM64 natif, nettement plus lentes en émulation x86_64.\n" +
                "• Pas d'accélération GPU : les jeux 3D et apps lourdes risquent d'être inutilisables."
        )
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) = build()

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun heading(s: String) = root.addView(TextView(this).apply {
        text = s; textSize = 18f; setTypeface(typeface, Typeface.BOLD); setPadding(0, dp(18), 0, dp(6))
    })

    private fun text(s: String) = root.addView(TextView(this).apply { text = s; textSize = 15f; setPadding(0, 0, 0, dp(6)) })

    private fun status(ok: Boolean, s: String) = text((if (ok) "✅  " else "❌  ") + s)

    private fun button(label: String, onClick: () -> Unit) = root.addView(Button(this).apply {
        text = label; isAllCaps = false; setOnClickListener { onClick() }
    })

    private fun code(cmd: String) {
        root.addView(TextView(this).apply {
            text = cmd; typeface = Typeface.MONOSPACE; textSize = 12f
            setTextIsSelectable(true)
            setBackgroundColor(0x22888888)
            val p = dp(10); setPadding(p, p, p, p)
        })
        root.addView(Button(this).apply {
            text = "Copier"; isAllCaps = false
            setOnClickListener {
                getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("commandes", cmd))
                Toast.makeText(this@SetupActivity, "Copié — collez dans Termux", Toast.LENGTH_SHORT).show()
            }
        })
        root.addView(View(this).apply { minimumHeight = dp(4) })
    }

    private fun open(url: String) = try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (_: Exception) {
        Toast.makeText(this, url, Toast.LENGTH_LONG).show()
    }
}
