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

## En cours
- Jalon 3 — drums.py

## Reste à faire
- Jalons 3 à 8 (voir mission §11).

## Fragile (autocritique)
- Downbeat : heuristique (grave + changement d'accord). Sur un clic sans grave, la phase est fausse (3 au lieu de 0) — sans conséquence pour un clic, mais un vrai morceau sans grave marqué peut être décalé d'1 à 3 temps.
- Accords : détection C/G parfois confondue sur la chanson synthétique ; la basse 808 peut donc suivre une fausse racine sur certaines mesures.
- Profil de source : heuristique à seuils, non calibrée sur de vrais morceaux ; « variété FR » seulement manuel (--profil).
