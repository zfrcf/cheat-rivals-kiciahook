package io.appimagedroid.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/** Activité invisible ouverte par les raccourcis de l'écran d'accueil. */
class LaunchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = intent.getStringExtra(EXTRA_ID)?.let { AppStore(this).get(it) }
        if (app == null) {
            Toast.makeText(this, "Cette application n'est plus installée", Toast.LENGTH_LONG).show()
        } else {
            val err = Termux.launch(this, app)
            if (err != null) {
                Toast.makeText(this, err, Toast.LENGTH_LONG).show()
                startActivity(Intent(this, SetupActivity::class.java))
            }
        }
        finish()
    }

    companion object {
        const val EXTRA_ID = "io.appimagedroid.APP_ID"
    }
}
