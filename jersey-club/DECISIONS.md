# Décisions structurantes

Format : décision — raison — alternative écartée.

1. Le skill vit dans le dépôt Git (`jersey-club/`) et `~/.claude/skills/jersey-club` est un lien symbolique vers lui — le conteneur est éphémère, seul le dépôt poussé survit — copie directe dans ~/.claude (perdue à la fin de session).
2. `.venv/`, `cache/` et `jersey_out/` sont ignorés par Git ; `install.sh` recrée le venv — un venv de 2 Go (torch) ne se versionne pas — commit du venv.
3. Torch CPU (index pytorch whl/cpu) + Demucs 4.1 htdemucs — séparation de qualité sans GPU — spleeter (abandonné, TF lourd).
4. Tonalité/accords : chroma librosa + profils de Krumhansl + chroma de basse pour la racine — essentia non nécessaire et lourd à installer — essentia.
5. Time-stretch par time-map rubberband (chaque beat source → temps cible) — suit aussi les tempos flottants, pas seulement un ratio global — ratio global unique.
6. Les analyses par mesure (accords, segments, hook) se font sur l'audio déjà recalé sur la grille cible — une mesure source = une mesure de sortie, plus de conversion d'index — analyse sur l'original puis conversion.
7. Préroll avant le premier downbeat supprimé — simplifie la grille ; perte d'une éventuelle anacrouse vocale — décaler la grille d'une mesure.
8. BPM affiné par régression linéaire sur beats indexés + recalage de phase sur onsets — précision < 0,01 BPM sur pistes stables — tempo brut librosa (±1 BPM).
9. `measure_bpm` replie les erreurs d'octave (×2, ×1,5) vers la cible — l'ambiguïté demi/double tempo est une limite de mesure, pas du rendu — BPM brut.
10. Détection de kicks d'évaluation : pic de flux spectral puis montée la plus raide de l'enveloppe de Hilbert (30-150 Hz) — une enveloppe RMS courte oscille avec la période de la 808 — RMS 1 ms.
11. Chops pitchés par rééchantillonnage (plus aigus ET plus courts) — c'est le son « sample accéléré » typique et c'est rapide — pitch-shift à durée constante (rubberband par chop, lent).
12. Paramètres résolus dans params.py (module ajouté à l'architecture) — partagé par jerseyfy, learn et status — logique dupliquée dans jerseyfy.
13. Règle continue = plancher/plafond (`cible`) calculé à la création — idempotente, ne dérive pas quand la moyenne apprise bouge — décalage relatif réappliqué à chaque rendu (dérive cumulative).
14. Les références recentrent les défauts à la résolution (poids n/(n+2)) au lieu de réécrire style_profile.yaml — réversible, traçable, aucune perte des hypothèses de départ — réécriture du YAML.
15. keep_original_instru est un niveau continu 0-1 (0 = coupé) plutôt qu'un booléen — apprenable finement — booléen.
16. Pré-roll de 0,5 s de silence avant rubberband — supprime le trou d'attaque en début de fichier — accepter le trou.
