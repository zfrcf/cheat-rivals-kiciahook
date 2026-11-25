# PROGRESS — PhonePilot

> Mis à jour à chaque étape. Légende : ✅ fait · 🔄 en cours · ⛔ action d'Antoine requise · ☐ à valider sur le P30

## Décision du 25/11/2026 : « jamais branché, plus de Mac »
Le téléphone (4G/Wi-Fi) se connecte à un serveur PhonePilot sur **Cloudflare Workers** ; Claude y accède par un **connecteur MCP personnalisé** (OAuth approuvé sur le téléphone). Voir `docs/DECISIONS.md` D13–D18.

| Bloc | État | Détail |
|---|---|---|
| Serveur cloud (`cloud/`) | ✅ code · ✅ E2E simulé 20/20 | OAuth, appairage, 102 outils, liens 24 h, STOP, révocation, alarmes |
| App Android (`android/`) | ✅ compile (APK release signée) · ☐ réel | Saisie d'adresse serveur, remplaçants natifs de Shizuku, révocation |
| Déploiement auto | ✅ workflow · ⛔ secrets | `deploy.yml` : APK signée + serveur. Secrets à ajouter (INSTALL §2) |
| 100 capacités | 🔄 | Toutes implémentées ; validation réelle à cocher dans `docs/CAPACITES.md` |
| Robustesse 24 h (EMUI) | ☐ | À mesurer une fois installé |
| Docs FR | ✅ | `docs/INSTALL.md` (100 % depuis le téléphone), DECISIONS, CAPACITES |

## Prochaine étape (Antoine, ~20 min depuis le téléphone)
1. Cloudflare : compte + jeton + ID de compte (INSTALL §1).
2. Secrets GitHub : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANDROID_KEYSTORE_B64` (INSTALL §2).
3. Actions › « Déployer PhonePilot (cloud) » › Run. Puis INSTALL §4 à §6.
4. Ensuite (session Claude) : dérouler `docs/CAPACITES.md`, corriger les libellés EMUI réels (tuiles, « Forcer l'arrêt », déclencheur photo, ids WhatsApp).
