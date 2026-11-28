# PROGRESS — skill jersey-club

## Reprendre
```bash
cd ~/.claude/skills/jersey-club   # = /home/user/cheat-rivals-kiciahook/jersey-club
./install.sh                      # si le venv n'existe pas
.venv/bin/python -m pytest -q tests -W ignore
```

## Fait
- [x] Jalon 1 — installation : ffmpeg, rubberband-cli (apt), venv, numpy/scipy/librosa/pedalboard/pyloudnorm/mido/matplotlib, torch CPU + demucs (modèle htdemucs téléchargé), squelette, config.
- [x] Jalon 2 — analyze.py (tempo, downbeats, tonalité, accords, segments, hook, profil) + stretch.py (time-map rubberband, pitch preserve/follow/+N) + tests tempo (2/2).

- [x] Jalon 3 — drums.py (synthèse kick/clap/hats/squeak/crash/horn/sirène/riser/souffle, patterns YAML, rolls, humanisation, swing, MIDI) + tests timing (médiane 3-5 ms).
- [x] Jalon 4 — separate.py (Demucs htdemucs ~28 s pour 60 s CPU, mode rapide HPSS ~15 s, cache) + chop.py (banque de syllabes, motifs stutter/roll/reverse/pitch, rendu sans chevauchement).
- [x] Jalon 5 — params.py (résolution mémoire A/B/C), bass.py (808 kick/temps, origine, aucune), arrange.py (court, court_intense, complet), mix.py (bus, sidechain, limiteur TP, loudness), jerseyfy.py → premier rendu complet (3 variantes, ~105 s en --fast sur 60 s).
- [x] Jalon 6 — evaluate.py (BPM par autocorrélation, kicks par enveloppe de Hilbert, LUFS, TP, clics, phase, tonalité, bandes, PNG) + boucle d'auto-correction (2 tentatives) consignée dans rapport.md et session.json.

- [x] Jalon 7 — learn.py (notes → EMA/Beta, comparaisons, commentaires → règles via lexique, snapshots + rollback), reference.py (BPM, patterns par vote + correction de downbeat, densité, bandes, LUFS, LRA, structure), status.py, lessons.md. Tests : 16/16 (dont pipeline complet normal/--fast/complet + rejeu identique, ~4 min).

- [x] Jalon 8 — SKILL.md (121 lignes, déclenchement vérifié par `claude -p` : « version jersey club qui rebondit » → Skill jersey-club), README.md, install.sh, démonstration de la boucle d'apprentissage (docs/demo_boucle.md : −28 % de chops, kick_decay 0,22 → 0,35, pattern de la variante préférée adopté).

## Definition of Done
- [x] tous les tests passent (17/17, ~4 min)
- [x] rendu de bout en bout sur la chanson synthétique (aucun fichier utilisateur fourni à ce jour)
- [x] skill installé dans ~/.claude/skills/jersey-club (lien symbolique vers le dépôt) et déclenché par une phrase naturelle
- [x] boucle rendu → retour → apprentissage → rendu démontrée avec différence mesurable
- [x] README.md, PROGRESS.md, DECISIONS.md à jour, tout commité et poussé

## Reste à faire (pistes)
1. Premier essai sur un VRAI morceau de l'utilisateur + 2-3 références Jersey club réelles (calibre profils, patterns, LUFS).
2. Gestion de la négation dans le lexique et validation des règles créées par Claude.
3. Détection de downbeat apprise (ou guidée par l'utilisateur via --downbeat) ; pénalité de hook en mesure 0.

## Note mémoire
La mémoire livrée (memory/) est VIERGE : la démo a utilisé une mémoire isolée. Les premiers retours réels de l'utilisateur seront donc les seuls signaux appris.

## Fragile (autocritique)
- Références : le downbeat d'un morceau sans harmonie est ambigu ; corrigé par une rotation heuristique (pattern connu, sinon « kick sur le 1 + rafale en fin de mesure »). Un vrai pattern inédit peut être enregistré décalé d'un temps.
- Lexique commentaires → règles : simple recherche de sous-chaînes ; une négation (« pas trop sec ») déclenche quand même « trop sec ». Claude doit relire les règles créées (learn.py les affiche) et corriger avec --regle.
- Mesure du timing des kicks sur le master : la 808 déclenchée au même instant brouille le détecteur (≈ 7 ms sur master contre 3 ms sur le stem batterie). Le placement réel est exact à l'échantillon ; c'est la MESURE qui est bruitée et pourrait déclencher une fausse « correction ».
- Mode --fast : la « voix » HPSS contient nappes et synthés ⇒ tonalité peu fiable (D mineur au lieu de La mineur sur la chanson synthétique, confiance 0,23) et chops moins propres.
- Hook en mesure 0 possible (pas de pénalité de début de morceau).
- Le stretch au-delà de ±20 % est fréquent (100 → 140 BPM = −30 %) : seulement averti, pas évité.
- Downbeat : heuristique (grave + changement d'accord). Sur un clic sans grave, la phase est fausse (3 au lieu de 0) — sans conséquence pour un clic, mais un vrai morceau sans grave marqué peut être décalé d'1 à 3 temps.
- Accords : détection C/G parfois confondue sur la chanson synthétique ; la basse 808 peut donc suivre une fausse racine sur certaines mesures.
- Profil de source : heuristique à seuils, non calibrée sur de vrais morceaux ; « variété FR » seulement manuel (--profil).
