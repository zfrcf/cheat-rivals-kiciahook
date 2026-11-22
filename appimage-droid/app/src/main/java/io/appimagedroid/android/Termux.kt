package io.appimagedroid.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import io.appimagedroid.R
import java.io.File

/** Pont vers Termux via l'intent RUN_COMMAND. */
object Termux {
    const val PACKAGE = "com.termux"
    const val X11_PACKAGE = "com.termux.x11"
    const val PERMISSION = "com.termux.permission.RUN_COMMAND"
    private const val BASH = "/data/data/com.termux/files/usr/bin/bash"
    private const val HOME = "/data/data/com.termux/files/home"

    fun isInstalled(ctx: Context, pkg: String = PACKAGE) = try {
        ctx.packageManager.getPackageInfo(pkg, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }

    fun hasPermission(ctx: Context) = ctx.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    /** Copie le script d'exécution dans le dossier partagé et renvoie son chemin. */
    fun helperScript(ctx: Context): File {
        val f = File(AppStore.publicDir(), ".appimage-droid.sh")
        val content = ctx.resources.openRawResource(R.raw.appimage_droid).use { it.readBytes() }
        if (!f.exists() || !f.readBytes().contentEquals(content)) f.writeBytes(content)
        return f
    }

    /** Renvoie null si tout va bien, sinon un message d'erreur en français. */
    fun launch(ctx: Context, app: InstalledApp): String? {
        val args = mutableListOf("run", app.path, app.offset.toString(), app.id, app.arch)
        args += app.extraArgs.split(' ').filter { it.isNotBlank() }
        return run(ctx, args, background = false)
    }

    fun removeExtracted(ctx: Context, id: String): String? = run(ctx, listOf("remove", id), background = true)

    private fun run(ctx: Context, args: List<String>, background: Boolean): String? {
        if (!isInstalled(ctx)) return "Termux n'est pas installé."
        if (!hasPermission(ctx)) return "Autorisation « Exécuter des commandes Termux » non accordée."
        if (!AppStore.publicDir().canWrite()) return "Accès au stockage refusé."
        val script = helperScript(ctx)
        val intent = Intent("com.termux.RUN_COMMAND")
            .setClassName(PACKAGE, "com.termux.app.RunCommandService")
            .putExtra("com.termux.RUN_COMMAND_PATH", BASH)
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", (listOf(script.absolutePath) + args).toTypedArray())
            .putExtra("com.termux.RUN_COMMAND_WORKDIR", HOME)
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", background)
            .putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        return try {
            ctx.startService(intent); null
        } catch (e: Exception) {
            "Termux a refusé la commande (${e.javaClass.simpleName}). " +
                "Vérifiez allow-external-apps=true dans ~/.termux/termux.properties."
        }
    }
}
