# PhonePilot

Donner à Claude le contrôle complet d'un **Huawei P30 (Android 10, EMUI, non rooté)** : voir l'écran, toucher, taper, ouvrir les applis,
accéder aux fichiers, SMS, contacts, agenda, notifications… depuis Claude Code sur le Mac **et** à distance (4G).

```
[Claude Code (Mac) ← Remote Control ← app Claude mobile]
        │ MCP stdio (local)
        ▼
[bridge/ — Node/TypeScript sur le Mac]  ── ADB (câble / Wi-Fi) ──┐
        ▲ WebSocket via Tailscale, jeton d'appairage             │
        │ (connexion SORTANTE du téléphone, aucun port ouvert)   ▼
[android/ — app PhonePilot : accessibilité, capture, notifications, Shizuku, fichiers, SMS…]
```

## Démarrage rapide
1. `scripts/mac/installer.sh` — outils, bridge, tests, démon Shizuku, ajout du MCP à Claude Code.
2. `scripts/mac/installer-apk.sh` — installe l'app sur le téléphone branché.
3. Permissions dans l'app + appairage QR (`node bridge/dist/index.js pair`).
Guide détaillé avec les chemins EMUI : **[docs/INSTALL.md](docs/INSTALL.md)**.

## Ce qui est livré
- **~90 outils MCP** couvrant les 100 capacités → [docs/CAPACITES.md](docs/CAPACITES.md)
- **Routeur à 3 chemins** : app compagnon (sans câble) › Shizuku › ADB, repli automatique.
- **Sécurité** : STOP (notification + app, reprise uniquement par toi), confirmations Oui/Non sur le téléphone, journal d'audit avec captures avant/après, anti-injection, liste noire shell, jetons hors Git.
- **Automatisation** : macros, tâches planifiées, déclencheurs, surveillance de valeur, sauvegarde et rapport quotidiens.
- Tests : `cd bridge && npm test` (téléphone simulé). CI GitHub : tests + APK téléchargeable.

## Documentation
[INSTALL](docs/INSTALL.md) · [DECISIONS](docs/DECISIONS.md) · [CAPACITES](docs/CAPACITES.md) · [EVALUATION de l'existant](docs/EVALUATION.md) · [PROTOCOLE](docs/PROTOCOLE.md) · [PROGRESS](PROGRESS.md)

## Commandes du bridge
```
node bridge/dist/index.js stdio          # serveur MCP (lancé par Claude Code)
node bridge/dist/index.js pair [--rotate]# QR d'appairage (--rotate = révoque l'ancien)
node bridge/dist/index.js adb-wifi       # passe ADB en Wi-Fi
node bridge/dist/index.js http           # MCP HTTP + Bearer (option, voir DECISIONS D8)
```
