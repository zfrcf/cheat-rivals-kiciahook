# Décisions techniques

Chaque décision : contexte → choix → conséquence. À challenger.

### D1 — Trois chemins d'exécution, un seul routeur
App compagnon (natif) > Shizuku (shell dans l'app) > ADB (Mac). Le bridge choisit automatiquement (`bridge/src/phone/device.ts`).
Les commandes shell sont écrites **une fois** (`shellimpl.ts`) et tournent via ADB *ou* Shizuku.
→ Après un redémarrage (Shizuku inactif), tout ce qui est natif continue ; le reste renvoie `SHIZUKU_INACTIVE — branche le téléphone au Mac`.

### D2 — Le téléphone se connecte au Mac (sortant), jamais l'inverse
WebSocket sortant + jeton d'appairage (QR). Aucun port ouvert sur le P30 (Android 10 sans correctifs).
→ Fonctionne en 4G via Tailscale. **Limite** : le Mac doit être allumé (option : Raspberry Pi toujours allumé avec le même bridge).

### D3 — L'arbre UI est simplifié côté bridge
L'app et `uiautomator` renvoient le même format brut ; le bridge calcule ids stables (hash du chemin), rendu compact (< 14 000 caractères ≈ 4 000 tokens) et sélection.
→ Un seul code testé, comportement identique câble / sans câble.

### D4 — Captures : MediaProjection (app) ou `screencap` (shell)
Android 10 n'a pas `AccessibilityService.takeScreenshot`. JPEG 70 % redimensionné à 1080 px.
Écran `FLAG_SECURE` (banques) = image noire **détectée et signalée**, jamais contournée.

### D5 — Presse-papiers : activité transparente
Android 10 refuse la lecture en arrière-plan ; une activité transparente prend le focus 100 ms, lit, se ferme (autorisée grâce à « Afficher par-dessus »).

### D6 — Sécurité en profondeur (bridge ET téléphone)
- STOP : déclenchable par Claude ou le téléphone ; **reprise uniquement depuis l'app** (geste humain). L'app refuse aussi les requêtes quand STOP est actif.
- Confirmations Oui/Non sur le téléphone, catégories configurables dans `~/.phonepilot/config.json` et dans l'app.
- Détection heuristique des éléments sensibles (Payer, Virement, Publier, mot de passe…) avant `tap` / `type_text`.
- Shell : liste noire (reset usine, `locksettings`, `wipe`, `setprop`, `rm -rf /sdcard`…).
- Anti-injection : tout contenu lu est encadré `<donnees_telephone statut="non_fiable">` + alerte si formulation d'ordre détectée.
  Les déclencheurs n'insèrent **jamais** le corps d'un message dans une action (seuls numéro / nom / appli).
- Audit JSONL quotidien `~/.phonepilot/audit/` (0600) + captures avant/après des actions confirmées.

### D7 — Secrets
Jetons générés aléatoirement dans `~/.phonepilot/config.json` (0600, hors dépôt). Côté téléphone : jeton chiffré AES-GCM par l'Android Keystore.
*Amélioration possible* : stockage dans le trousseau macOS (`security add-generic-password`).

### D8 — Accès distant depuis l'app Claude : **recommandation = Remote Control**, pas d'exposition HTTP
⚠️ **Contradiction dans le cahier des charges** : « réseau privé Tailscale uniquement » **et** « piloter depuis l'app Claude ».
Les connecteurs MCP personnalisés de claude.ai sont appelés **depuis le cloud d'Anthropic** : ils ne peuvent pas joindre une IP Tailscale privée.
- **Choix retenu** : l'app Claude (mobile/web) pilote **Claude Code sur le Mac via Remote Control** ; le MCP reste en stdio local. Zéro port public.
- Alternative (non activée) : `phonepilot-bridge http` (Bearer) derrière **Tailscale Funnel** (HTTPS public). Il faudrait alors un vrai OAuth 2.1 — non implémenté ; à faire seulement si Remote Control ne convient pas.

### D9 — `targetSdk 29`, APK sideload
Nécessaire pour `requestLegacyExternalStorage` (accès fichiers complet sur Android 10). Pas de Play Store → pas de contrainte de targetSdk.

### D10 — WhatsApp / Gmail par l'interface
Pas d'API officielle pour lire WhatsApp ; envoi via lien `wa.me` + bouton Envoyer, lecture via l'arbre UI. **Fragile** aux mises à jour de WhatsApp (ids `message_text`, `send`).
Pour répondre vite : `notification_reply` (fiable) est préféré.

### D11 — Caméra via l'appli Appareil photo
Pas de Camera2 maison (lourd, et l'appli Huawei fait mieux) : intent caméra + déclencheur (touche `KEYCODE_CAMERA` en shell, sinon bouton trouvé par accessibilité).

### D12 — Mode avion / point d'accès par réglages rapides
Android 10 interdit au shell de diffuser `AIRPLANE_MODE` et n'a pas de commande `tether` : on bascule la tuile EMUI via l'accessibilité.

---
## Bascule « jamais branché » (25/11/2026, demande d'Antoine : 4G/Wi-Fi uniquement, connecteur MCP personnalisé, plus de Mac)

### D13 — Serveur MCP sur Cloudflare Workers + Durable Object
Remplace D2/D8. Gratuit (offre Free : DO SQLite, 30 s CPU par requête, 100 000 requêtes/jour), HTTPS fourni, toujours allumé, rien à maintenir.
Un seul Durable Object tient le WebSocket du téléphone (API d'hibernation : coût nul au repos), le serveur MCP (transport Streamable HTTP « web standard »),
l'OAuth, l'audit (30 j), les planifications (alarmes du DO) et les liens de téléchargement.
Le cœur `bridge/src` est partagé : les outils ne dépendent plus du Mac (interface `Platform` : `deliver`, `source`, `oneShot`).
*Alternative écartée* : téléphone serveur (EMUI tue les services, Android 10 non patché exposé, pas de Funnel Tailscale sur Android). VPS : payant et à maintenir.

### D14 — OAuth 2.1 maison, approuvé sur le téléphone
DCR + code + PKCE S256 + rafraîchissement avec rotation ; seuls des hachés SHA-256 sont stockés. Pas de mot de passe :
la page /authorize déclenche une notification **Oui/Non sur le P30** (catégorie `connexion_claude`, non désactivable).
Révocation totale depuis l'app. *Pourquoi pas la librairie Cloudflare* : elle impose un namespace KV à provisionner ; tout tient ici dans le DO.

### D15 — Appairage « premier arrivé » (TOFU) + code optionnel
L'app génère son propre jeton (Keystore) ; le serveur adopte le premier téléphone puis refuse les autres. Risque résiduel : quelqu'un qui connaîtrait l'URL
avant ton premier lancement — d'où « appaire juste après le déploiement ». Pour réappairer : secret `PAIRING_CODE`.
Même un intrus appairé ne pourrait rien faire de TON téléphone (il n'est pas connecté à lui) et l'OAuth passerait par SON appareil.

### D16 — Plus de Shizuku ni d'ADB (Android 10 sans câble)
Shizuku sans root exige le débogage sans fil (Android 11+) ou un ordinateur à chaque démarrage → **impossible** en « jamais branché ». Remplacements natifs :
luminosité / veille / rotation (`WRITE_SETTINGS`), Ne pas déranger (`setInterruptionFilter`), Bluetooth (`BluetoothAdapter`), enregistrement d'écran (MediaProjection),
PDF (`PdfRenderer` → images), redémarrage (menu d'alimentation par accessibilité), arrêt forcé / désinstallation (écrans système + accessibilité),
Wi-Fi / données / avion / point d'accès / mode sombre (tuiles des réglages rapides).
**Perdus** : saisie de touches brutes (Entrée, volume physique) → on touche le bouton d'envoi ; installation silencieuse (Antoine valide l'installeur) ; vidage global des caches.

### D17 — Fichiers : liens temporaires en flux direct
`file_pull` renvoie un lien HTTPS secret valable 24 h ; le fichier est lu **en direct sur le téléphone** au moment du téléchargement (rien n'est stocké chez Cloudflare).
Plusieurs fichiers → zip sur le téléphone puis un lien. Envoi vers le téléphone : depuis une URL https.

### D18 — APK servie par le serveur, signée par une clé stable
Le workflow GitHub compile l'APK, la signe avec `ANDROID_KEYSTORE_B64` (secret GitHub, jamais dans le dépôt — **le dépôt est public**) et la publie à `/PhonePilot.apk`.
Clé stable = mises à jour sans désinstaller (donc sans perdre les permissions).
