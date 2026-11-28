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

## En cours
- Jalon 7 — mémoire : learn.py, reference.py, status.py, lessons.md + tests.

## Reste à faire
- Jalon 7, puis jalon 8 (SKILL.md, README.md, install.sh, démonstration de la boucle d'apprentissage).

## Fragile (autocritique)
- Mesure du timing des kicks sur le master : la 808 déclenchée au même instant brouille le détecteur (≈ 7 ms sur master contre 3 ms sur le stem batterie). Le placement réel est exact à l'échantillon ; c'est la MESURE qui est bruitée et pourrait déclencher une fausse « correction ».
- Mode --fast : la « voix » HPSS contient nappes et synthés ⇒ tonalité peu fiable (D mineur au lieu de La mineur sur la chanson synthétique, confiance 0,23) et chops moins propres.
- Hook en mesure 0 possible (pas de pénalité de début de morceau).
- Le stretch au-delà de ±20 % est fréquent (100 → 140 BPM = −30 %) : seulement averti, pas évité.
- Downbeat : heuristique (grave + changement d'accord). Sur un clic sans grave, la phase est fausse (3 au lieu de 0) — sans conséquence pour un clic, mais un vrai morceau sans grave marqué peut être décalé d'1 à 3 temps.
- Accords : détection C/G parfois confondue sur la chanson synthétique ; la basse 808 peut donc suivre une fausse racine sur certaines mesures.
- Profil de source : heuristique à seuils, non calibrée sur de vrais morceaux ; « variété FR » seulement manuel (--profil).
