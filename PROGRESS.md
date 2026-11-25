# PROGRESS — PhonePilot

> Mis à jour à chaque étape. Légende : ✅ fait · 🔄 en cours · ⛔ bloqué (action d'Antoine requise)

## Session du 25/11/2026 (cloud Linux, sans téléphone ni Mac)
| Phase | État | Détail |
|---|---|---|
| §3 Évaluation | ✅ | `docs/EVALUATION.md` — mobile-mcp retenu pour le POC |
| 1 — POC | ⛔ | Code/procédure prêts (`docs/INSTALL.md` §1). Nécessite le P30 branché au Mac. |
| 2 — App compagnon | ✅ code · ☐ réel | `android/` compile (APK debug). Accessibilité, MediaProjection, WebSocket sortant, écran FR, STOP. |
| 3 — Fichiers & données | ✅ code · ☐ réel | Fichiers, photos, SMS, appels, contacts, agenda, notifications. |
| 4 — Shizuku | ✅ code · ☐ réel | Shell via Shizuku (réflexion `newProcess`, vérifiée sur l'API 13.1.5), démon launchd de relance. |
| 5 — Distant + sécurité | ✅ code · ☐ réel | Tailscale, audit, confirmations, STOP testés en simulé. Distant via Remote Control (D8). |
| 6 — 100 capacités | 🔄 | Toutes implémentées ; validation réelle à cocher dans `docs/CAPACITES.md`. |
| 7 — Robustesse 24 h | ☐ | À mesurer sur le téléphone (EMUI). |
| 8 — Docs | ✅ | README, INSTALL (chemins EMUI), DECISIONS, PROTOCOLE, CLAUDE.md. |

Tests bridge : 20/20 verts (`cd bridge && npm test`). APK : `cd android && ./gradlew assembleDebug` OK.

## Prochaine session (sur le Mac, téléphone branché)
1. `scripts/mac/installer.sh` puis POC mobile-mcp « active le mode sombre ».
2. `scripts/mac/installer-apk.sh`, permissions, appairage, puis dérouler `docs/CAPACITES.md` et cocher ☑.
3. Corriger les libellés EMUI réels (tuiles réglages rapides, « Vider le cache », déclencheur photo, ids WhatsApp).
