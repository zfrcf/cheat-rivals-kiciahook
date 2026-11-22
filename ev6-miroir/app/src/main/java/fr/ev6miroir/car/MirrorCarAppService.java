package fr.ev6miroir.car;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

/** Point d'entrée Android Auto. */
public class MirrorCarAppService extends CarAppService {

    @NonNull @Override
    public HostValidator createHostValidator() {
        // Seuls les hôtes officiels (Android Auto, Android Automotive) peuvent se connecter :
        // aucune autre appli du téléphone ne peut récupérer l'écran via ce service.
        return new HostValidator.Builder(getApplicationContext())
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build();
    }

    @NonNull @Override
    public Session onCreateSession() {
        return new MirrorSession();
    }
}
