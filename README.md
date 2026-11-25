# PhonePilot

Donner à Claude le contrôle complet d'un **Huawei P30 (Android 10, EMUI, non rooté)** : voir l'écran, toucher, taper, ouvrir les applis,
accéder aux fichiers, SMS, contacts, agenda, notifications… depuis Claude Code sur le Mac **et** à distance (4G).

```
[app Claude / claude.ai]  — connecteur MCP personnalisé (HTTPS + OAuth approuvé sur le téléphone)
        │
        ▼
[cloud/ — serveur PhonePilot sur Cloudflare Workers (gratuit, toujours allumé)]
        ▲  WebSocket sécurisé, connexion SORTANTE du téléphone (4G / Wi-Fi), rien d'ouvert sur le P30
        │
[android/ — app PhonePilot : accessibilité, capture, notifications, fichiers, SMS, contacts, agenda…]
```
**Jamais branché, aucun Mac** : tout s'installe depuis le téléphone → **[docs/INSTALL.md](docs/INSTALL.md)**.

## Ce qui est livré
- **102 outils MCP** couvrant les 100 capacités → [docs/CAPACITES.md](docs/CAPACITES.md)
- **Serveur cloud** (`cloud/`) : MCP Streamable HTTP, OAuth 2.1 (DCR + PKCE) dont chaque autorisation est approuvée **sur le téléphone**, liens de téléchargement temporaires, planifications, audit 30 jours.
- **Sécurité** : STOP (notification + app, reprise uniquement par toi), confirmations Oui/Non pour les actions sensibles, anti-injection, révocation des accès Claude depuis l'app, aucun secret dans le dépôt.
- **Automatisation** : macros, tâches planifiées, déclencheurs, surveillance de valeur, rapport quotidien.
- **Déploiement automatique** : GitHub Actions compile l'APK signée et déploie serveur + APK (`.github/workflows/deploy.yml`).
- Tests : `cd bridge && npm test` (20) · `cd cloud && npm run e2e` (20, bout en bout avec téléphone simulé).

## Documentation
[INSTALL](docs/INSTALL.md) · [INSTALL-MAC (ancien mode câblé)](docs/INSTALL-MAC.md) · [DECISIONS](docs/DECISIONS.md) · [CAPACITES](docs/CAPACITES.md) · [EVALUATION de l'existant](docs/EVALUATION.md) · [PROTOCOLE](docs/PROTOCOLE.md) · [PROGRESS](PROGRESS.md)
