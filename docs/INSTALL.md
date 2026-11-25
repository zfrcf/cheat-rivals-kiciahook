# Installation — mode cloud, sans Mac ni câble (≈ 20 min, tout depuis le téléphone)

Architecture : **app Claude** → connecteur MCP personnalisé (HTTPS + OAuth) → **serveur PhonePilot sur Cloudflare** (gratuit, toujours allumé) ← connexion sortante de l'**app PhonePilot** (4G / Wi-Fi).
Rien n'est ouvert sur le téléphone. Chaque nouvel accès de Claude doit être **approuvé sur le téléphone** (notification Oui/Non).

## 1. Cloudflare (5 min, navigateur du téléphone)
1. Crée un compte gratuit sur **dash.cloudflare.com** (e-mail + mot de passe). Aucune carte bancaire n'est demandée.
2. Menu **Workers et Pages** : ouvre-le une fois et choisis ton sous-domaine `xxx.workers.dev`.
3. **ID de compte** : il est affiché dans la colonne de droite de « Workers et Pages » (« Account ID ») → copie-le.
4. **Jeton d'API** : icône profil › *Mon profil* › *Jetons d'API* › *Créer un jeton* › modèle **« Modifier Cloudflare Workers »** › *Continuer* › *Créer* → copie le jeton (affiché une seule fois).

## 2. Secrets GitHub (3 min)
Dépôt GitHub › **Settings › Secrets and variables › Actions › New repository secret**, trois fois :
| Nom | Valeur |
|---|---|
| `CLOUDFLARE_API_TOKEN` | le jeton de l'étape 1.4 |
| `CLOUDFLARE_ACCOUNT_ID` | l'ID de l'étape 1.3 |
| `ANDROID_KEYSTORE_B64` | le contenu du fichier `ANDROID_KEYSTORE_B64.txt` que Claude t'a fourni (clé de signature de l'app : **ne la publie nulle part**) |

## 3. Déployer (3 min, automatique)
Dépôt › onglet **Actions** › « Déployer PhonePilot (cloud) » › **Run workflow** (ou *Re-run jobs* sur le dernier essai).
À la fin, l'adresse du serveur s'affiche dans le résumé : `https://phonepilot.xxx.workers.dev`.
Chaque modification du code redéploie automatiquement serveur + app.

## 4. Installer l'app (3 min)
1. Sur le P30, ouvre `https://phonepilot.xxx.workers.dev` › **télécharger PhonePilot.apk**.
2. Autorise l'installation : Paramètres › Sécurité › Plus de paramètres › **Installer des applis inconnues** › ton navigateur › Autoriser.
3. Ouvre PhonePilot › **Saisir l'adresse du serveur** › colle `https://phonepilot.xxx.workers.dev` → « ✅ Serveur : connecté ».
   Le premier téléphone qui se connecte est **adopté** ; tout autre sera refusé. Fais-le juste après le déploiement.

## 5. Permissions dans l'app (5 min, une seule fois)
Suis les boutons **dans l'ordre** :
1. Permissions de base → tout accepter ; puis Localisation « Toujours autoriser ».
2. **Accessibilité** : Paramètres › Fonctions d'accessibilité › Accessibilité › PhonePilot › activer.
3. **Capture d'écran** → « Commencer maintenant ».
4. **Accès aux notifications** : Paramètres › Applications › Applications › ⋮ › Accès spécial › Accès aux notifications › PhonePilot.
5. **Afficher par-dessus les autres applis** → activer.
6. **Modifier les paramètres système** → activer (luminosité, mise en veille, rotation).
7. **Accès « Ne pas déranger »** → PhonePilot.
8. **Données d'utilisation** : Paramètres › Sécurité › Plus de paramètres › Accès aux données d'utilisation › PhonePilot.
9. **Ignorer l'optimisation de la batterie** → Autoriser.
10. **Huawei – Lancement d'applications** : Paramètres › Batterie › Lancement d'applications › PhonePilot → désactive « Gérer automatiquement » → coche les **3 cases**.
11. **Verrouille l'app dans les récents** : Applis récentes › glisse la carte PhonePilot vers le bas › cadenas 🔒.

## 6. Ajouter le connecteur dans Claude (2 min)
1. App Claude (ou claude.ai) › **Paramètres › Connecteurs › Ajouter un connecteur personnalisé**.
2. Nom : `PhonePilot` · URL : `https://phonepilot.xxx.workers.dev/mcp` › **Ajouter**, puis **Se connecter**.
3. Une page s'ouvre et une notification **« Autoriser Claude à piloter ton téléphone ? »** arrive sur le P30 → **Oui**.
4. Test : « Quel est l'état de mon téléphone ? » puis « Active le mode sombre ».

## Sécurité au quotidien
- **STOP** : bouton de la notification « PhonePilot actif » ou de l'app → Claude est bloqué jusqu'à ce que tu appuies sur *Reprendre*.
- **Révoquer Claude** : app › « Révoquer tous les accès Claude » (il faudra réapprouver).
- Journal d'audit : demande « montre-moi le journal d'audit » (outil `audit_log_tail`, 30 jours).
- Changer de téléphone : ajoute le secret Cloudflare `PAIRING_CODE` (Workers › phonepilot › Paramètres › Variables › secret), puis saisis dans l'app l'adresse sous la forme `https://…workers.dev#code=TONCODE`.

## Dépannage
| Symptôme | Solution |
|---|---|
| Workflow rouge « Ajoute les secrets… » | Étape 2 puis *Re-run jobs*. |
| « Serveur : recherche… » | Réseau ? Vérifie l'adresse (sans `/mcp`). Batterie : refais les étapes 5.9 à 5.11. |
| `PHONE_OFFLINE` dans Claude | EMUI a tué l'app : ouvre-la ; vérifie 5.10 et 5.11. |
| `A11Y_OFF` | Réactive l'accessibilité (5.2) ; EMUI la coupe parfois après une mise à jour. |
| `CAPTURE_OFF` | Bouton « Autoriser la capture d'écran » (à refaire après un redémarrage du téléphone). |
| Capture noire | Appli protégée (banque) : normal, Claude passe par l'arbre UI ou te demande. |

> Mode câblé historique (Mac + ADB + Shizuku) : voir `INSTALL-MAC.md`. Il n'est plus nécessaire.
