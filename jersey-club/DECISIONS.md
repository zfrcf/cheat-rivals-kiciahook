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
17. Snapshots = preferences.json ET lessons.md ensemble — un rollback doit restaurer l'état complet de la mémoire — snapshot de preferences.json seul.
18. Les règles issues d'un commentaire sont liées au profil de la source commentée (conformément à §5.2) ; les règles manuelles (--regle) valent pour tous les profils par défaut — une remarque de goût général s'applique partout — tout lier au profil.
19. Patterns de référence extraits par vote par tick (≥ 50 % des mesures) — robuste aux attaques parasites — ensemble exact le plus fréquent (trop fragile).
20. `JERSEY_MEMORY_DIR` / `JERSEY_CONFIG_DIR` surchargent les dossiers — tests isolés, la mémoire réelle n'est jamais touchée par pytest — monkeypatch des modules.
21. Démonstration de la boucle sur une mémoire isolée — ne pas biaiser les rendus futurs de l'utilisateur avec un faux retour — démo sur la mémoire réelle.
22. Lexique : correspondance « mots dans l'ordre, ≤ 2 mots intercalés » — « le kick est trop sec » doit matcher « kick trop sec » — sous-chaîne exacte.
23. Pas de boucle d'évaluation skill-creator (sous-agents + visionneuse) — le livrable est un outil audio mesuré par pytest et par les métriques ; le déclenchement a été vérifié par `claude -p` — boucle complète avec revue humaine (impossible sans écoute de l'utilisateur).
24. Après le retour « horrible » : pattern de kick de référence = jersey_classique [0,12,24,33,42] (16es 1-5-9-12-15, grille droite, d'après les tutoriels Native Instruments / beatstorapon / orphiq) ; les patterns « bounce_* » en triolets étaient des hypothèses erronées, conservées comme options d'exploration — alternative écartée : garder les triolets par défaut.
25. Défauts v2 : kick 808 long (0,38 s) qui porte le grave, bass_mode=aucune, instru d'origine à 0,3, FX à 0,15, squeak dans les 2 plus grands trous entre kicks — tutoriels : kick « avec beaucoup de grave », squeak = percussion qui comble les trous — alternative : 808 doublée sur chaque kick (boue dans le grave).
26. Nouveau paramètre chop_style (kick_lock par défaut) : mot de 2-3 syllabes rejoué sur les kicks — « le motif de chops fait l'identité du morceau, moins de notes vaut mieux » — motifs aléatoires denses.
27. Une moyenne continue apprise ne remplace le défaut qu'avec un signal positif cumulé ≥ 0,15 — sinon des notes de 1 figent les anciens défauts — utiliser toute entrée apprise.
