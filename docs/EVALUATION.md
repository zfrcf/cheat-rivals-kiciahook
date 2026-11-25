# §3 — Évaluation de l'existant (novembre 2026)

| Projet | Ce qu'il fait | Verdict pour PhonePilot |
|---|---|---|
| **mobile-next/mobile-mcp** (npm `@mobilenext/mobile-mcp`) | MCP ADB + UI Automator, Android/iOS, une commande `claude mcp add mobile-mcp -- npx -y @mobilenext/mobile-mcp@latest` | **Retenu pour le POC Phase 1** : mature, zéro code, câble ou `adb tcpip`. Ne couvre ni sans-câble/4G, ni SMS/contacts/agenda, ni sécurité. |
| **srmorete/mobile-device-mcp** | Même approche (UIAutomator), multi-appareils, inspiré de mobile-mcp | Jeune (v0.1.x, créé avril 2026). Pas d'avantage décisif → écarté. |
| **DroidRun / mobilerun** + app *Portal* | Framework d'agent LLM Python + appli accessibilité (arbre UI, clavier) ; MCP communautaires | Bonne idée (appli accessibilité) mais orienté « agent autonome », dépendance Python, pas de données perso ni de sécurité. Inspire notre app compagnon, pas réutilisé. |

**Décision** : Phase 1 = `mobile-mcp` (POC < 1 h, voir `docs/INSTALL.md` §1). Ensuite on ne construit que ce qui manque :
app compagnon autonome (sans câble), données perso (SMS, contacts, agenda, fichiers), accès distant, sécurité (audit, STOP, confirmations, anti-injection).
Notre bridge garde un **repli ADB** compatible avec le même câble, donc mobile-mcp devient optionnel après la Phase 2.

Sources : [mobile-mcp](https://github.com/mobile-next/mobile-mcp) · [npm](https://npmjs.com/package/@mobilenext/mobile-mcp) · [mobile-device-mcp](https://mcpservers.org/servers/srmorete/mobile-device-mcp) · [droidrun-portal](https://github.com/droidrun/droidrun-portal) · [mobilerun](https://raw.githubusercontent.com/droidrun/mobilerun/main/README.md)
