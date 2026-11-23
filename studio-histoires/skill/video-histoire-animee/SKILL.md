---
name: video-histoire-animee
description: Crée de A à Z une courte vidéo d'histoire animée (style motion design 2D « plat » façon dessin animé, ou 3D « cubique » low-poly) avec dialogues doublés, sous-titres animés mot à mot, musique, bruitages et montage final MP4 prêt pour TikTok, Reels, Shorts ou YouTube. Utiliser dès que l'utilisateur veut faire une vidéo animée, un dessin animé court, une histoire avec personnages, une vidéo virale « storytime », un sketch animé, une vidéo pédagogique ou publicitaire racontée par des personnages, ou demande « fais-moi une vidéo dans ce style » — même sans dire « skill » ni « animation ».
---

# Vidéo d'histoire animée — de l'idée au MP4 final

Ce skill pilote le logiciel **Studio Histoires** (dossier `studio-histoires/`). Le travail créatif (idée → scénario → mise en scène) est fait par toi ; la fabrication (voix, animation, musique, montage) est automatique.

## 0. Pré-requis (une seule fois)
```bash
cd studio-histoires
pip install -r requirements.txt          # edge-tts, numpy, (piper-tts en secours hors-ligne)
npm install                              # playwright
npx playwright install chromium          # si Chromium n'est pas déjà présent
```
`ffmpeg` doit être installé (`brew install ffmpeg` / `apt install ffmpeg`).
Si `edge-tts` échoue derrière un proxy d'entreprise : ajouter le certificat du proxy au fichier de `python -c "import certifi;print(certifi.where())"`.

## 1. Cadrer (2 minutes, pas plus)
Demande seulement ce qui manque vraiment, sinon choisis toi-même et annonce tes choix :
- **Format** : `16:9` (YouTube, style dialogue « bus ») ou `9:16` (TikTok/Reels/Shorts).
- **Style** : `plat2d` (dessin animé vectoriel, émotion/dialogue) ou `cube3d` (3D cubique, narration absurde rapide).
- **Durée** : 30–60 s conseillé (≈ 2,6 mots/seconde).
- **Ton** : émouvant à chute / comique absurde / pédagogique / promo.

## 2. Écrire le scénario
Lis `references/ecriture.md` (structure qui marche, règles de rythme, exemples) **avant** d'écrire.
Puis écris le `projet.json` selon `references/format_projet.md`. Points non négociables :
- accroche dans la 1ʳᵉ réplique (problème, conflit ou phrase absurde) ;
- répliques courtes (≤ 12 mots), langage oral ;
- une chute (retournement émotionnel ou absurde) + phrase de fin ;
- chaque réplique porte de la mise en scène : `emotion`, `geste`, `cles` (mots surlignés en jaune), `insert`, `camera`, `sfx`, `symbole`, `reactions`.

Crée le dossier `studio-histoires/projets/<nom_court>/projet.json`.

## 3. Contrôler AVANT de rendre (boucle courte)
```bash
cd studio-histoires
python studio.py verifier projets/<nom>      # erreurs ❌ bloquantes
python studio.py controle projets/<nom>      # note /100 + recommandations + build/planche_instantanes.jpg
```
- **Lis** `build/rapport.md` et **regarde** `build/planche_instantanes.jpg` (1 image par réplique) : personnage caché, plan mal cadré, sous-titre sur un insert, émotion à contre-sens.
- Corrige le JSON et relance `controle` jusqu'à **≥ 85/100** et zéro défaut visuel. Ne lance pas le rendu complet avant.
- Relis aussi le texte à voix haute mentalement : chaque réplique doit pouvoir être dite d'un souffle.

## 4. Fabriquer
```bash
python studio.py tout projets/<nom> --formats 16:9,9:16   # vidéo(s) + .srt + miniature(s) + planche
# itération rapide : --apercu  (demi-résolution) ; 3D : --rapide (sans ombres, 2-3x plus vite)
```
Sorties dans `projets/<nom>/` : `<titre>.mp4` (+ `_9x16.mp4`), `<titre>.srt`, `miniature*.jpg`. Son normalisé −14 LUFS (deux passes), stéréo, voix traitées.
**Regarde** `build/planche.jpg` avant de livrer.

## 5. Livrer (kit de publication)
Donne : chemins des fichiers, durée, résumé, puis un **kit de publication** :
- 3 titres au choix (≤ 60 caractères, curiosité sans mentir) ;
- description courte (2 lignes) + 5 à 8 hashtags pertinents ;
- l'instant de la vidéo à utiliser en couverture si la miniature auto ne convient pas ;
- 2–3 pistes concrètes d'amélioration (accroche alternative, chute plus forte, plan à changer).

## Sans Claude Code
`python studio.py nouveau "idée" --format 9:16 --style cube3d` écrit le scénario via l'API Claude si une clé est disponible (`ANTHROPIC_API_KEY` ou `ant auth login`), sinon copie un modèle à adapter. `python studio.py interface` ouvre une interface web locale en français.

## Dépannage rapide
| Symptôme | Cause / correction |
|---|---|
| `décor inconnu` | voir la liste par style dans `references/format_projet.md` |
| voix robotique | edge-tts inaccessible → repli Piper ; vérifier réseau/proxy |
| rendu 3D lent | normal sans GPU (≈ 8 s de calcul par seconde de vidéo) ; `--rapide` ou `--apercu` pour itérer |
| sous-titre décalé | le texte affiché doit être identique au texte dit ; éviter les abréviations (« 3 » → « trois ») |
| personnage hors champ | `camera: "large"` ou `focus` (3D), ou ajuster `x` |
