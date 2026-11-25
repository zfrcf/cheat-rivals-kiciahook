# Les 100 capacités

Légende — **Code** : 🟢 implémenté + testé avec téléphone simulé · 🟡 implémenté et compilé · 🟠 implémenté avec limite connue (voir note).
**P30** : ☐ à valider sur le vrai téléphone (aucun test réel possible depuis la session cloud du 25/11/2026) · ☑ validé.

Chemins : **A** = app compagnon (sans câble) · **S** = Shizuku · **U** = USB/ADB.

## Écran & navigation
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 1 | Capture d'écran | `screen_capture` | A S U | 🟡 | ☐ |
| 2 | Structure de l'écran | `ui_tree` | A S U | 🟢 | ☐ |
| 3 | Toucher par texte | `tap` | A S U | 🟢 | ☐ |
| 4 | Appui long | `long_press` | A S U | 🟡 | ☐ |
| 5 | Double tap | `double_tap` | A S U | 🟡 | ☐ |
| 6 | Glisser / balayer | `swipe` | A S U | 🟡 | ☐ |
| 7 | Défiler jusqu'à un texte | `scroll_until` | A S U | 🟡 | ☐ |
| 8 | Pincer pour zoomer | `pinch` | A | 🟡 | ☐ |
| 9 | Taper du texte | `type_text` | A (accents OK) · S U (ASCII seulement) | 🟠 | ☐ |
| 10 | Effacer un champ | `clear_field` | A S U | 🟡 | ☐ |
| 11 | Retour / Accueil / Récents | `press_key` | A S U | 🟡 | ☐ |
| 12 | Volet notifications / réglages rapides | `press_key` (notifications, quick_settings) | A S U | 🟡 | ☐ |
| 13 | Faire pivoter l'écran | `rotate_screen` | S U | 🟡 | ☐ |
| 14 | Vidéo de l'écran | `screen_record` | S U | 🟡 | ☐ |
| 15 | Attendre un élément | `wait_for` | A S U | 🟡 | ☐ |

## Applications
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 16 | Lister les applis | `apps_list` | A S U | 🟡 | ☐ |
| 17 | Ouvrir par nom | `app_open` | A S U | 🟡 | ☐ |
| 18 | Forcer l'arrêt | `app_close` | S U | 🟡 | ☐ |
| 19 | URL / lien profond | `url_open` | A S U | 🟡 | ☐ |
| 20 | Installer un APK du Mac | `app_install` | U S (A : installeur à valider) | 🟡 | ☐ |
| 21 | Désinstaller (confirmé) | `app_uninstall` | S U | 🟡 | ☐ |
| 22 | Vider le cache d'une appli | `app_clear_cache` | A (UI Réglages) | 🟠 libellés EMUI | ☐ |
| 23 | Appli au premier plan | `app_foreground` / `device_state` | A S U | 🟡 | ☐ |
| 24 | Basculer entre deux applis | `app_open` / `press_key recents` | A S U | 🟡 | ☐ |
| 25 | Temps d'écran | `app_usage` | A | 🟡 | ☐ |
| 26 | Autorisations d'une appli | `app_permissions` | A S U | 🟡 | ☐ |
| 27 | Partager vers une appli | `share_to_app` | A | 🟡 | ☐ |

## Fichiers
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 28 | Parcourir l'arborescence | `files_list` | A S U | 🟡 | ☐ |
| 29 | Chercher (nom, ext, date, taille) | `files_search` | A | 🟡 | ☐ |
| 30 | Lire texte / PDF | `file_read` (pdftotext sur le Mac) | A U | 🟡 | ☐ |
| 31 | Copier / déplacer / renommer | `file_move` | A | 🟡 | ☐ |
| 32 | Supprimer (corbeille 30 j) | `file_delete`, `trash_restore` | A | 🟡 | ☐ |
| 33 | Créer des dossiers | `file_mkdir` | A S U | 🟡 | ☐ |
| 34 | Compresser / décompresser | `archive_zip`, `archive_unzip` | A | 🟡 | ☐ |
| 35 | Téléphone → Mac | `file_pull` | U (rapide) · A (4G, par morceaux) | 🟡 | ☐ |
| 36 | Mac → téléphone | `file_push` | U · A | 🟡 | ☐ |
| 37 | M'envoyer un fichier par mail | `file_send via=email` | A | 🟡 | ☐ |
| 38 | WhatsApp / Telegram | `file_send` | A (+ choix du destinataire en UI) | 🟠 | ☐ |
| 39 | Google Drive | `file_send via=drive` | A | 🟡 | ☐ |
| 40 | Espace de stockage | `storage_info` | A S U | 🟡 | ☐ |
| 41 | Gros fichiers et doublons | `files_search sort=size`, `files_duplicates` | A | 🟡 | ☐ |
| 42 | Téléchargements récents | `downloads_recent` | A | 🟡 | ☐ |

## Photos & médias
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 43 | Dernières photos | `photos_list` | A | 🟡 | ☐ |
| 44 | Photos → Mac (date / lieu) | `photos_pull` | A U | 🟡 | ☐ |
| 45 | Prendre une photo | `camera_capture` | A (+S) | 🟠 dépend de l'appli Appareil photo | ☐ |
| 46 | Filmer une vidéo | `video_capture` | A (+S) | 🟠 idem | ☐ |
| 47 | Mémo vocal | `audio_record` | A | 🟡 | ☐ |
| 48 | Contrôler la musique | `media_control` | A S U | 🟡 | ☐ |
| 49 | Volume par canal | `volume_set` | A S U | 🟡 | ☐ |
| 50 | OCR d'une photo | `file_read` (image renvoyée à Claude) | A U | 🟡 | ☐ |
| 51 | Ranger les captures par mois | `screenshots_organize` | A | 🟡 | ☐ |
| 52 | Synthèse vocale | `tts_say` | A | 🟡 | ☐ |

## Messages & appels
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 53 | Lire les SMS | `sms_list` | A | 🟡 | ☐ |
| 54 | Envoyer un SMS | `sms_send` (confirmé si inconnu) | A | 🟢 | ☐ |
| 55 | Code de vérification | `otp_find` | A | 🟡 | ☐ |
| 56 | Passer un appel | `call_start` | A | 🟡 | ☐ |
| 57 | Raccrocher | `call_end` | A | 🟡 | ☐ |
| 58 | Journal / appels manqués | `call_log` | A | 🟡 | ☐ |
| 59 | Lire les notifications | `notifications_list` | A | 🟡 | ☐ |
| 60 | Répondre depuis une notification | `notification_reply` | A | 🟡 | ☐ |
| 61 | Effacer des notifications | `notification_dismiss` | A | 🟡 | ☐ |
| 62 | Lire une conversation WhatsApp | `whatsapp_read` | A | 🟠 ids WhatsApp susceptibles de changer | ☐ |
| 63 | Envoyer un WhatsApp | `whatsapp_send` (wa.me) | A | 🟠 idem | ☐ |
| 64 | Mail depuis Gmail | `gmail_send` | A | 🟠 bouton Envoyer à valider | ☐ |
| 65 | Résumé des notifications du jour | `notifications_history` (+ résumé par Claude) | A | 🟡 historique depuis le dernier démarrage de l'app | ☐ |

## Contacts & agenda
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 66 | Chercher un contact | `contacts_search` | A | 🟡 | ☐ |
| 67 | Créer / modifier | `contacts_create`, `contacts_update` | A | 🟡 | ☐ |
| 68 | Export vCard vers le Mac | `contacts_export` | A | 🟡 | ☐ |
| 69 | Lire l'agenda | `calendar_list` | A | 🟡 | ☐ |
| 70 | Créer / déplacer un RDV | `calendar_create`, `calendar_update` | A | 🟡 | ☐ |
| 71 | Alarme / minuteur | `alarm_create`, `timer_create` | A | 🟡 | ☐ |
| 72 | Rappel | `reminder_create` (événement + alerte) | A | 🟡 | ☐ |

## Réglages & système
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 73 | Wi-Fi | `settings_set wifi` | S U · repli tuile A | 🟡 | ☐ |
| 74 | Bluetooth | `settings_set bluetooth` | S U · tuile A | 🟡 | ☐ |
| 75 | Données mobiles | `settings_set mobile_data` | S U · tuile A | 🟡 | ☐ |
| 76 | Mode avion | `settings_set airplane` | tuile A | 🟠 ⚠️ coupe la 4G → perte de contrôle à distance | ☐ |
| 77 | Ne pas déranger + heure de fin | `settings_set dnd until=` | S U · tuile A | 🟡 (fin gérée par le bridge) | ☐ |
| 78 | Luminosité | `settings_set brightness` | S U | 🟡 | ☐ |
| 79 | Mode sombre | `settings_set dark_mode` | S U | 🟡 | ☐ |
| 80 | Délai de mise en veille | `settings_set screen_timeout` | S U | 🟡 | ☐ |
| 81 | Lampe torche | `torch` | A | 🟡 | ☐ |
| 82 | Batterie et température | `battery_info` | A S U | 🟡 | ☐ |
| 83 | Position GPS | `location_get` | A | 🟡 | ☐ |
| 84 | Point d'accès | `settings_set hotspot` | tuile A | 🟠 tuile EMUI à valider | ☐ |
| 85 | Scanner le Wi-Fi | `wifi_scan` | A | 🟡 (Android 10 limite à 4 scans / 2 min) | ☐ |
| 86 | Appareils Bluetooth appairés | `bluetooth_list` | A | 🟡 | ☐ |
| 87 | Redémarrer (confirmé) | `reboot` | S U | 🟡 (Shizuku à relancer ensuite) | ☐ |
| 88 | Verrouiller l'écran | `lock_screen` | A S U | 🟡 | ☐ |

## Automatisation & intelligence
| # | Capacité | Outil | Chemins | Code | P30 |
|---|---|---|---|---|---|
| 89 | Enregistrer une macro | `macro_record` | bridge | 🟢 | ☐ |
| 90 | Rejouer une macro | `macro_play` | bridge | 🟢 | ☐ |
| 91 | Tâches planifiées | `schedule_task` (cron, Europe/Paris) | bridge (Mac allumé) | 🟢 | ☐ |
| 92 | Déclencheurs (confirmés) | `trigger_create` | A + bridge | 🟢 | ☐ |
| 93 | Remplir un formulaire | `form_fill` | A S U | 🟡 | ☐ |
| 94 | Écran → CSV sur le Mac | `ui_tree` + `csv_save` | bridge | 🟡 | ☐ |
| 95 | Surveiller une valeur | `watch_create` | bridge + A | 🟡 | ☐ |
| 96 | Journal d'audit | `audit_log_tail` (+ captures avant/après) | bridge | 🟢 | ☐ |
| 97 | Trouver mon téléphone | `find_my_phone` | A | 🟡 | ☐ |
| 98 | Sauvegarde quotidienne | `backup_run` + `schedule_task` | A U | 🟡 | ☐ |
| 99 | Nettoyage | `cleanup` (simulation par défaut) | A (+S caches) | 🟡 | ☐ |
| 100 | Rapport quotidien | `daily_report` | A | 🟡 | ☐ |

## Hors périmètre (assumé)
- Enregistrement d'appels : bloqué pour les applis tierces sur Android 10.
- Contournement de `FLAG_SECURE`, réinitialisation usine, désactivation du verrouillage : interdits par conception.
