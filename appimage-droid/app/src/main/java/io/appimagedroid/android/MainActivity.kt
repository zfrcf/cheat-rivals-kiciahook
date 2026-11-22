package io.appimagedroid.android

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.Formatter
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.ImageView
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import io.appimagedroid.R
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private lateinit var store: AppStore
    private lateinit var adapter: AppAdapter
    private lateinit var progress: ProgressBar
    private lateinit var progressText: TextView
    private lateinit var banner: TextView
    private var pendingUri: Uri? = null
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = AppStore(this)
        progress = findViewById(R.id.progress)
        progressText = findViewById(R.id.progressText)
        banner = findViewById(R.id.banner)
        banner.setOnClickListener { startActivity(Intent(this, SetupActivity::class.java)) }

        val list = findViewById<ListView>(R.id.list)
        adapter = AppAdapter()
        list.adapter = adapter
        list.emptyView = findViewById(R.id.empty)
        list.setOnItemClickListener { _, _, pos, _ -> showActions(adapter.getItem(pos)) }
        findViewById<View>(R.id.install).setOnClickListener { pick() }

        askPermissions()
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun handleIntent(i: Intent?) {
        val uri = when (i?.action) {
            Intent.ACTION_VIEW -> i.data
            Intent.ACTION_SEND -> i.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        } ?: return
        install(uri)
    }

    private fun refresh() {
        adapter.items = store.all()
        adapter.notifyDataSetChanged()
        val problems = mutableListOf<String>()
        if (!Termux.isInstalled(this)) problems += "Termux absent"
        else if (!Termux.hasPermission(this)) problems += "autorisation Termux manquante"
        if (!Termux.isInstalled(this, Termux.X11_PACKAGE)) problems += "Termux:X11 absent"
        if (!hasStorage()) problems += "accès stockage refusé"
        banner.visibility = if (problems.isEmpty()) View.GONE else View.VISIBLE
        banner.text = "⚠ ${problems.joinToString(" · ")} — toucher pour configurer"
    }

    private fun hasStorage() = checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

    private fun askPermissions() {
        val wanted = mutableListOf<String>()
        if (!hasStorage()) wanted += Manifest.permission.WRITE_EXTERNAL_STORAGE
        if (Termux.isInstalled(this) && !Termux.hasPermission(this)) wanted += Termux.PERMISSION
        if (wanted.isNotEmpty()) requestPermissions(wanted.toTypedArray(), REQ_PERMS)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        refresh()
        pendingUri?.takeIf { hasStorage() }?.let { pendingUri = null; install(it) }
    }

    private fun pick() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
        startActivityForResult(i, REQ_PICK)
    }

    @Deprecated("API Activity classique")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PICK && resultCode == RESULT_OK) data?.data?.let { install(it) }
    }

    private fun install(uri: Uri) {
        if (busy) return toast("Une installation est déjà en cours")
        if (!hasStorage()) {
            pendingUri = uri
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_PERMS)
            return
        }
        busy = true
        setProgress(true, "Copie de l'AppImage…", -1)
        io.execute {
            try {
                val res = Installer.install(this, uri) { done, total ->
                    main.post {
                        val pct = if (total > 0) (done * 100 / total).toInt() else -1
                        setProgress(true, "Copie… ${Formatter.formatShortFileSize(this, done)}", pct)
                    }
                }
                main.post {
                    busy = false
                    setProgress(false, "", 0)
                    refresh()
                    val msg = StringBuilder("${res.app.name} est installé.")
                    res.warning?.let { msg.append("\n\n$it") }
                    compatibility(res.app)?.let { msg.append("\n\n$it") }
                    AlertDialog.Builder(this)
                        .setTitle("Installation terminée")
                        .setMessage(msg)
                        .setPositiveButton("Lancer") { _, _ -> launch(res.app) }
                        .setNeutralButton("Raccourci") { _, _ -> pinShortcut(res.app) }
                        .setNegativeButton("Fermer", null)
                        .show()
                }
            } catch (e: Exception) {
                main.post {
                    busy = false
                    setProgress(false, "", 0)
                    AlertDialog.Builder(this)
                        .setTitle("Installation impossible")
                        .setMessage(e.message ?: e.javaClass.simpleName)
                        .setPositiveButton("OK", null).show()
                }
            }
        }
    }

    private fun setProgress(visible: Boolean, text: String, pct: Int) {
        val v = if (visible) View.VISIBLE else View.GONE
        progress.visibility = v
        progressText.visibility = v
        progressText.text = text
        progress.isIndeterminate = pct < 0
        if (pct >= 0) progress.progress = pct
    }

    private fun compatibility(app: InstalledApp): String? {
        val abi = android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: return null
        val device = when {
            abi.startsWith("arm64") -> "aarch64"
            abi.startsWith("x86_64") -> "x86_64"
            abi.startsWith("armeabi") -> "armv7l"
            else -> abi
        }
        return when {
            app.arch == device -> null
            app.arch == "x86_64" && device == "aarch64" ->
                "AppImage x86_64 sur un appareil ARM64 : exécution via box64 (émulation, plus lente, compatibilité variable)."
            else -> "Architecture ${app.arch} incompatible avec cet appareil ($device)."
        }
    }

    private fun showActions(app: InstalledApp) {
        val actions = arrayOf("Lancer", "Créer un raccourci", "Arguments de lancement", "Informations", "Désinstaller")
        AlertDialog.Builder(this)
            .setTitle(app.name)
            .setItems(actions) { _, which ->
                when (which) {
                    0 -> launch(app)
                    1 -> pinShortcut(app)
                    2 -> editArgs(app)
                    3 -> info(app)
                    4 -> confirmUninstall(app)
                }
            }.show()
    }

    private fun launch(app: InstalledApp) {
        val err = Termux.launch(this, app)
        if (err != null) {
            AlertDialog.Builder(this).setTitle("Lancement impossible").setMessage(err)
                .setPositiveButton("Configurer") { _, _ -> startActivity(Intent(this, SetupActivity::class.java)) }
                .setNegativeButton("Fermer", null).show()
        } else {
            toast("Lancement dans Termux… (la 1re fois, l'extraction peut prendre une minute)")
        }
    }

    private fun pinShortcut(app: InstalledApp) {
        val sm = getSystemService(ShortcutManager::class.java)
        if (sm == null || !sm.isRequestPinShortcutSupported) return toast("Votre lanceur ne gère pas les raccourcis")
        val icon = store.icon(app.id)?.let { Icon.createWithBitmap(it) }
            ?: Icon.createWithResource(this, R.mipmap.ic_launcher)
        val intent = Intent(this, LaunchActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .putExtra(LaunchActivity.EXTRA_ID, app.id)
        val info = ShortcutInfo.Builder(this, "app-${app.id}")
            .setShortLabel(app.name.take(24))
            .setLongLabel(app.name)
            .setIcon(icon)
            .setIntent(intent)
            .build()
        sm.requestPinShortcut(info, null)
    }

    private fun editArgs(app: InstalledApp) {
        val input = EditText(this).apply { setText(app.extraArgs); hint = "ex. --no-sandbox" }
        AlertDialog.Builder(this)
            .setTitle("Arguments de lancement")
            .setView(input)
            .setPositiveButton("Enregistrer") { _, _ ->
                store.put(app.copy(extraArgs = input.text.toString().trim())); refresh()
            }
            .setNegativeButton("Annuler", null).show()
    }

    private fun info(app: InstalledApp) {
        val lines = listOfNotNull(
            app.comment,
            "Version : ${app.version ?: "—"}",
            "Architecture : ${app.arch}",
            "Taille : ${Formatter.formatFileSize(this, app.size)}",
            "Compression : ${app.compression ?: "—"}",
            "Électron : ${if (app.electron) "oui" else "non"}",
            "Offset squashfs : ${app.offset}",
            "Fichier : ${app.path}",
            "Extraction Termux : /opt/appimages/${app.id} (debian)",
            compatibility(app),
        )
        AlertDialog.Builder(this).setTitle(app.name).setMessage(lines.joinToString("\n"))
            .setPositiveButton("OK", null).show()
    }

    private fun confirmUninstall(app: InstalledApp) {
        AlertDialog.Builder(this)
            .setTitle("Désinstaller ${app.name} ?")
            .setMessage("Le fichier AppImage et les fichiers extraits dans Termux seront supprimés.")
            .setPositiveButton("Désinstaller") { _, _ ->
                Termux.removeExtracted(this, app.id)
                getSystemService(ShortcutManager::class.java)?.disableShortcuts(listOf("app-${app.id}"))
                Installer.uninstall(this, app)
                refresh()
                toast("${app.name} désinstallé")
            }
            .setNegativeButton("Annuler", null).show()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "Configuration Termux").setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
        menu.add(0, 2, 1, "À propos")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            1 -> startActivity(Intent(this, SetupActivity::class.java))
            2 -> AlertDialog.Builder(this).setTitle("AppImage Droid")
                .setMessage(
                    "Installe et lance des AppImage Linux sur Android.\n\n" +
                        "Android ne sait pas exécuter un AppImage directement : l'app le range dans " +
                        "/sdcard/AppImages, lit son nom et son icône, puis le lance dans une Debian " +
                        "(proot-distro) via Termux, avec l'affichage Termux:X11. Les AppImage x86_64 " +
                        "passent par l'émulateur box64."
                ).setPositiveButton("OK", null).show()
        }
        return true
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

    private inner class AppAdapter : BaseAdapter() {
        var items: List<InstalledApp> = emptyList()
        override fun getCount() = items.size
        override fun getItem(p: Int) = items[p]
        override fun getItemId(p: Int) = p.toLong()
        override fun getView(p: Int, convert: View?, parent: ViewGroup): View {
            val v = convert ?: layoutInflater.inflate(R.layout.item_app, parent, false)
            val app = items[p]
            val bmp = store.icon(app.id)
            v.findViewById<ImageView>(R.id.icon).apply {
                if (bmp != null) setImageBitmap(bmp) else setImageResource(R.drawable.ic_appimage)
            }
            v.findViewById<TextView>(R.id.name).text = app.name
            v.findViewById<TextView>(R.id.details).text = listOfNotNull(
                app.version, app.arch, Formatter.formatShortFileSize(this@MainActivity, app.size),
            ).joinToString(" · ")
            return v
        }
    }

    companion object {
        private const val REQ_PICK = 10
        private const val REQ_PERMS = 11
    }
}
