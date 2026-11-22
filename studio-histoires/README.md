# 🎬 Studio Histoires

Ce logiciel fabrique de courtes **vidéos d'histoires animées** : vous partez d'une idée et vous obtenez un MP4 prêt à publier. Le style vient de deux vidéos de référence analysées dans [`docs/analyse_videos.md`](docs/analyse_videos.md).

| Style | Rendu | Format type |
|---|---|---|
| `plat2d` | dessin animé vectoriel 2D (personnages grosse tête, décors pastel, sous-titres à côté de la tête) | 16:9 dialogue à chute émouvante |
| `cube3d` | 3D low-poly avec personnages cubiques et coupe à chaque phrase (sous-titres « un mot ») | 9:16 narration absurde |

**Chaîne complète :** idée → scénario (Claude) → voix neuronales FR/EN avec timing mot à mot → animation (bouche synchronisée, gestes, émotions, caméra auto, inserts graphiques) → musique et bruitages générés (sans droits) → mixage avec ducking → MP4 H.264 normalisé à −14 LUFS → planche de contrôle.

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
> « Fais-moi une vidéo animée 9:16 en 3D sur un coach de salle qui a peur des haltères »

Claude écrit le scénario, vérifie, prend des instantanés, corrige, puis rend la vidéo.

### En ligne de commande
```bash
python studio.py nouveau "idée" --format 9:16 --style cube3d   # scénario (API Claude si clé, sinon modèle)
python studio.py verifier projets/<nom>                         # contrôle du JSON + durée estimée
python studio.py voix     projets/<nom>                         # voix + timeline
node moteur/rendu.js projets/<nom>/build --instantanes auto     # 1 image par réplique pour relire
python studio.py tout     projets/<nom> [--apercu]              # vidéo finale
python studio.py voix-liste                                     # voix conseillées
```

### Interface web
```bash
python studio.py interface      # http://127.0.0.1:8765
```
Dans l'interface, vous pouvez créer un projet, modifier le scénario, vérifier, lancer les voix, voir les instantanés, faire un aperçu rapide ou la vidéo finale, puis la lire.

## Exemples fournis
- `exemples/papy_salle.json` : *Le papy du bus* (2D, 16:9, environ 40 s). Une jeune femme qui n'a plus de motivation pour le sport rencontre un papy de 82 ans.
- `exemples/baillement.json` : *Le bâillement* (3D, 9:16, environ 42 s). Le seul talent du narrateur est de bâiller… jusqu'à ce que la ville en ait besoin.

```bash
mkdir -p projets/papy && cp exemples/papy_salle.json projets/papy/projet.json && python studio.py tout projets/papy
```

## Temps de fabrication (mesurés sur un serveur à 4 cœurs sans GPU)
| | 2D 40 s | 3D 42 s |
|---|---|---|
| Voix | environ 50 s (puis en cache) | environ 50 s |
| Rendu | environ 30 s | environ 6 min (bien plus rapide avec un GPU) |

## Architecture
```
studio.py              CLI (FR) : nouveau / verifier / voix / rendu / montage / tout / planche / interface
moteur/voix.py         edge-tts (+ repli Piper hors-ligne), timing mot à mot, enveloppe de bouche, timeline
moteur/audio.py        musique procédurale (7 ambiances), 19 bruitages, mixage, ducking, loudnorm
moteur/rendu.js        Chromium headless (Playwright), rendu parallèle image par image → ffmpeg
moteur/page/commun.js  sous-titres animés, inserts (notif, badge, panneau, écran, compteur…), transitions
moteur/page/plat2d.js  moteur 2D : 14 décors, personnages paramétriques, caméra auto
moteur/page/cube3d.js  moteur 3D (three.js) : 7 décors, personnages cubiques, foule, caméra auto
moteur/interface.py    interface web locale
skill/                 skill Claude (méthode d'écriture + format du projet)
```

## Personnaliser
- **Votre musique :** mettez un MP3 dans le dossier du projet et ajoutez `"musique_fichier": "ma_musique.mp3"`.
- **Nouveau décor 2D :** ajoutez une fonction `DECORS.mon_decor = (t, o) => {...}` dans `plat2d.js` et la hauteur du sol dans `solDe()`.
- **Votre marque :** utilisez `"logo"` dans le look d'un personnage, `enseigne` dans les décors `salle_sport` / `rue`, et un insert `titre` pour la fin.

## Licences
- three.js : MIT (`moteur/page/lib/LICENSE-three.txt`)
- police Fredoka : SIL OFL
- Les voix edge-tts sont un service Microsoft : vérifiez leurs conditions avant un usage commercial intensif. La voix de secours Piper est sous licence libre.
