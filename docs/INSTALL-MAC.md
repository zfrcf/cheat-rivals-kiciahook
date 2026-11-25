# Installation pas à pas (objectif : 15 minutes)

> Chemins EMUI 10 (P30, Android 10). Les libellés peuvent varier légèrement selon la mise à jour : si un menu diffère, utilise la recherche des Paramètres.

## 0. Préparer le téléphone (3 min)
1. **Options pour les développeurs** : Paramètres › À propos du téléphone › touche **7 fois** « Numéro de build ».
2. Paramètres › Système et mises à jour › **Options pour les développeurs** :
   - active **Débogage USB** ;
   - active **« Autoriser le débogage ADB en mode Charge uniquement »** (spécifique Huawei, sinon ADB se coupe).
3. Branche le câble USB au Mac, choisis « Charge uniquement », accepte **l'empreinte RSA** (coche « Toujours autoriser »).

## 1. Phase 1 — POC en 5 minutes (sans rien compiler)
Sur le Mac :
```bash
brew install --cask android-platform-tools
adb devices                      # doit afficher le P30 « device »
claude mcp add mobile-mcp -- npx -y @mobilenext/mobile-mcp@latest
```
Dans Claude Code : **« Ouvre Réglages et active le mode sombre »**.
Passer en Wi-Fi : `scripts/mac/adb-wifi.sh` puis débrancher.

## 2. Installer PhonePilot sur le Mac (3 min)
```bash
git clone <ce dépôt> ~/PhonePilot-src && cd ~/PhonePilot-src
scripts/mac/installer.sh         # outils, bridge, tests, démon Shizuku, enregistrement MCP
```
Le script enregistre le serveur `phonepilot` dans Claude Code (stdio). Tu peux retirer `mobile-mcp` ensuite : `claude mcp remove mobile-mcp`.

## 3. Installer l'app sur le téléphone (2 min)
```bash
scripts/mac/installer-apk.sh     # compile si besoin, installe et ouvre l'app
```
(Ou télécharge l'APK produit par la CI GitHub : onglet Actions › artefact « PhonePilot-apk ».)

## 4. Permissions dans l'app PhonePilot (4 min)
Ouvre PhonePilot et suis les boutons **dans l'ordre** :
1. **Autoriser les permissions de base** → tout accepter.
2. **Localisation « Toujours autoriser »**.
3. **Accessibilité** : Paramètres › Fonctions d'accessibilité › Accessibilité › **PhonePilot** › activer.
4. **Autoriser la capture d'écran** → « Commencer maintenant » (coche « Ne plus afficher » si proposé).
5. **Accès aux notifications** : Paramètres › Applications › Applications › ⋮ › Accès spécial › Accès aux notifications › PhonePilot.
6. **Afficher par-dessus les autres applis** → activer (permet d'ouvrir des applis depuis l'arrière-plan).
7. **Accès aux données d'utilisation** (temps d'écran) : Paramètres › Sécurité › Plus de paramètres › Accès aux données d'utilisation › PhonePilot.
8. **Ignorer l'optimisation de la batterie** → Autoriser.
9. **Huawei : Lancement d'applications** : Paramètres › Batterie › Lancement d'applications › PhonePilot → désactive « Gérer automatiquement », puis coche les **3 cases** (Lancement auto, Lancement secondaire, Exécuter en arrière-plan).
10. **Verrouille l'app dans les récents** : bouton Applis récentes › glisse la carte PhonePilot vers le bas › cadenas 🔒.

## 5. Accès distant via Tailscale (3 min)
1. Installe **Tailscale** sur le Mac et sur le P30 (Play Store), même compte, connecte les deux.
2. Relance `scripts/mac/installer.sh` (il écrit l'IP Tailscale du Mac dans `~/.phonepilot/config.json`).
3. Sur le Mac : `node bridge/dist/index.js pair` → un QR code s'affiche.
4. Dans l'app : **Scanner le QR code du Mac** → statut « ✅ Mac : connecté ».
5. Test : coupe le Wi-Fi du téléphone (4G) et demande à Claude `device_state`.

**Piloter depuis l'app Claude (mobile)** : active **Remote Control** dans Claude Code sur le Mac, puis ouvre la session depuis l'app Claude. Le MCP reste local : rien n'est exposé sur Internet (voir `DECISIONS.md` D8).

## 6. Shizuku (fonctions avancées : Wi-Fi/données, shell, redémarrage…)
1. Installe **Shizuku** (Play Store) sur le téléphone, ouvre-la une fois.
2. Téléphone branché : `scripts/mac/relancer-shizuku.sh` (le démon installé à l'étape 2 le fait **automatiquement** dès que tu branches le câble).
3. Dans PhonePilot : **Autoriser Shizuku** → Autoriser.
4. ⚠️ Après **chaque redémarrage** du téléphone, Shizuku s'arrête (Android 10 n'a pas de débogage sans fil natif) : rebranche simplement le câble au Mac.

## Révoquer / réappairer
`node bridge/dist/index.js pair --rotate` (nouveau jeton, l'ancien est refusé) puis rescanner le QR.

## Dépannage rapide
| Symptôme | Solution |
|---|---|
| « Mac : recherche… » | Tailscale connecté des deux côtés ? Bridge lancé (Claude Code ouvert) ? |
| `A11Y_OFF` | EMUI a coupé l'accessibilité : refaire l'étape 4.3, puis vérifier 4.9 et 4.10. |
| `CAPTURE_OFF` | Bouton « Autoriser la capture d'écran » (à refaire après redémarrage de l'app). |
| `SHIZUKU_INACTIVE` | Brancher le téléphone au Mac (relance auto) ou `scripts/mac/relancer-shizuku.sh`. |
| Captures noires | Appli protégée (banque) : normal, Claude utilise l'arbre UI ou te demande. |
