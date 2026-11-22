# EV6 Miroir

Appli Android qui recopie **tout l'écran du téléphone** (Huawei P30, Android 10) sur l'écran de la **Kia EV6** via Android Auto, avec le tactile. C'est l'équivalent logiciel d'un boîtier « AI box ».

APK prêt à installer : `release/EV6Miroir-1.0.apk`

## Fonctionnement
- **Image** : la capture d'écran Android (MediaProjection) est projetée directement dans la surface qu'Android Auto donne aux applis de navigation (Car App Library). Il n'y a pas de recompression côté appli.
- **Tactile** : les appuis, glissements et pincements faits sur l'écran de la voiture sont rejoués sur le téléphone par un service d'accessibilité.
- **Paysage** : une fenêtre invisible de 1 pixel force le téléphone en paysage pour remplir l'écran large de l'EV6, et garde l'écran allumé.
- **Sécurité** : seuls les hôtes officiels Android Auto/Automotive peuvent se connecter (HostValidator), donc aucune autre appli ne peut récupérer l'écran.

## Installation (une seule fois)
1. Copier l'APK sur le téléphone et l'installer (autoriser « sources inconnues » pour le gestionnaire de fichiers).
2. Dans l'appli EV6 Miroir, valider les 3 réglages : accessibilité, affichage par-dessus, batterie.
3. Huawei : Paramètres → Batterie → Lancement d'applications → EV6 Miroir → Gestion manuelle (tout activer).
4. Android Auto : toucher 10 fois « Version », puis menu ⋮ → Paramètres pour les développeurs → cocher **Sources inconnues**.

## Utilisation
1. Brancher le téléphone à l'EV6 et le déverrouiller.
2. Dans EV6 Miroir : **Démarrer la recopie**, puis accepter.
3. Sur l'EV6 : ouvrir **EV6 Miroir** dans le lanceur Android Auto.

Commandes sur l'écran de la voiture :
- **Appui** : touche le téléphone.
- **Bouton ✥ puis glisser** : défiler.
- **Pincer** : zoomer.
- **▲ / ▼** : page précédente / suivante.
- **Boutons de droite** : Retour, Accueil, Applis récentes, Paysage/libre.

## Limites connues
- Les applis protégées contre la capture (Netflix, Disney+, Canal+, banques) s'affichent en **noir**. C'est un blocage voulu par ces applis. YouTube, navigateur, Waze, etc. fonctionnent.
- L'appui long n'existe pas : Android Auto ne transmet pas ce geste.
- L'autorisation de capture se redemande à chaque démarrage (règle d'Android).
- L'écran du téléphone reste allumé pendant la recopie.

## Compiler
```
export EV6_KEYSTORE=/chemin/cle.jks EV6_KEYSTORE_PASS=...
gradle assembleRelease
```
Sans clé, `gradle assembleDebug` produit un APK de test.
