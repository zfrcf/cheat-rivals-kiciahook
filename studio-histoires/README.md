# 🎬 Studio Histoires

Ce logiciel fabrique de courtes **vidéos d'histoires animées** : vous partez d'une idée et vous obtenez un MP4 prêt à publier. Le style vient de deux vidéos de référence analysées dans [`docs/analyse_videos.md`](docs/analyse_videos.md).

| Style | Rendu | Format type |
|---|---|---|
| `plat2d` | dessin animé vectoriel 2D (personnages grosse tête, décors pastel, sous-titres à côté de la tête) | 16:9 dialogue à chute émouvante |
| `cube3d` | 3D low-poly avec personnages cubiques et coupe à chaque phrase (sous-titres « un mot ») | 9:16 narration absurde |

**Chaîne complète :** idée → scénario (Claude) → **contrôle qualité noté /100** → voix neuronales FR/EN avec timing mot à mot → animation → musique et bruitages générés (sans droits) → mixage stéréo → **MP4 en 16:9 et/ou 9:16**, **sous-titres .srt**, **miniature**, planche de contrôle.

**Ce qui rend l'animation vivante :**
- bouche par visèmes (A/O/E/M selon les lettres prononcées) ;
- sourcils levés sur les mots-clés ;
- hochements de tête des personnages qui écoutent ;
- clignements et respiration ;
- « punch » de caméra à chaque coupe ;
- parallaxe dans les décors.

**Ce qui rend le son propre :**
- voix traitées (coupe-bas, compression, présence, légère acoustique de pièce) ;
- musique en couches (accords, basse, mélodie, percussions) avec réverbération stéréo ;
- la musique baisse automatiquement quand quelqu'un parle ;
- limiteur doux et normalisation EBU R128 en deux passes : −14 LUFS mesurés.

## Installation
```bash
cd studio-histoires
pip install -r requirements.txt
npm install                 # installe Playwright + Chromium
# ffmpeg requis : brew install ffmpeg   (Mac)   |   sudo apt install ffmpeg   (Linux)
```

## Utilisation

### Avec Claude Code (recommandé)
Le skill `video-histoire-animee` est fourni dans `.claude/skills/` à la racine du dépôt. Il suffit de demander :
> « Fais-moi une vidéo animée 9:16 en 3D sur un pigeon qui veut devenir maire »

Claude écrit le scénario, vérifie, prend des instantanés, corrige, puis rend la vidéo.

### En ligne de commande
```bash
python studio.py nouveau "idée" --format 9:16 --style cube3d   # scénario (API Claude si clé, sinon modèle)
python studio.py verifier projets/<nom>                         # contrôle du JSON + durée estimée
python studio.py controle projets/<nom>                         # note /100, conseils, 1 image par réplique
python studio.py tout     projets/<nom> --formats 16:9,9:16     # vidéos + .srt + miniatures + planche
#   --apercu : demi-résolution   |   --rapide : 3D sans ombres (2-3x plus vite)
python studio.py miniature projets/<nom>                        # (re)générer la miniature seule
python studio.py voix-liste                                     # voix conseillées
```

### Interface web
```bash
python studio.py interface      # http://127.0.0.1:8765
```
Dans l'interface, vous pouvez créer un projet, modifier le scénario, lancer le contrôle qualité (note, conseils et planche), faire un aperçu rapide, produire la vidéo finale en un ou deux formats, puis voir les vidéos et les miniatures.

## Exemples fournis
- `exemples/blagues_papa.json` : *Les blagues de papa* (2D, 16:9, environ 50 s). Tom trouve nulles les blagues que son père lui envoie chaque matin… jusqu'à ce qu'un papy du bus lui raconte son histoire.
- `exemples/baillement.json` : *Le bâillement* (3D, 9:16, environ 42 s). Le seul talent du narrateur est de bâiller… jusqu'à ce que la ville en ait besoin.

```bash
mkdir -p projets/blagues && cp exemples/blagues_papa.json projets/blagues/projet.json && python studio.py tout projets/blagues
```

## Temps de fabrication (mesurés sur un serveur à 4 cœurs sans GPU)
| | 2D 50 s | 3D 42 s |
|---|---|---|
| Voix | environ 50 s (puis en cache) | environ 50 s |
| Rendu (par format) | environ 30 s | environ 6 min, environ 2 min avec `--rapide` (bien plus rapide avec un GPU) |

## Architecture
```
studio.py              CLI (FR) : nouveau / verifier / controle / voix / rendu / montage / tout / miniature / planche / interface
moteur/voix.py         edge-tts (+ repli Piper hors-ligne), timing mot à mot, enveloppe de bouche, timeline
moteur/audio.py        musique en couches + réverb stéréo (7 ambiances), 19 bruitages, traitement voix, ducking, loudnorm 2 passes
moteur/rendu.js        Chromium headless (Playwright), rendu parallèle image par image → ffmpeg
moteur/page/commun.js  sous-titres animés, inserts (notif, badge, panneau, écran, compteur…), transitions
moteur/page/plat2d.js  moteur 2D : 19 décors, personnages paramétriques, visèmes, caméra auto
moteur/page/cube3d.js  moteur 3D (three.js) : 9 décors, personnages cubiques, foule, caméra anti-occlusion
moteur/interface.py    interface web locale
skill/                 skill Claude (méthode d'écriture + format du projet)
```

## Personnaliser
- **Votre musique :** mettez un MP3 dans le dossier du projet et ajoutez `"musique_fichier": "ma_musique.mp3"`.
- **Nouveau décor 2D :** ajoutez une fonction `DECORS.mon_decor = (t, o) => {...}` dans `plat2d.js` et la hauteur du sol dans `solDe()`.
- **Habillage :** utilisez `"logo"` dans le look d'un personnage, `enseigne` dans les décors `rue` / `salle_sport`, et un insert `titre` pour la fin.

## Licences
- three.js : MIT (`moteur/page/lib/LICENSE-three.txt`)
- police Fredoka : SIL OFL
- Les voix edge-tts sont un service Microsoft : vérifiez leurs conditions avant un usage commercial intensif. La voix de secours Piper est sous licence libre.
