# jersey-club — guide

Skill Claude Code qui transforme un morceau (fichier local) en remix **Jersey club** et qui
**apprend** de vos retours d'un rendu à l'autre. Chaque passage produit 3 variantes (A, B, C),
un rapport de mesures, des spectrogrammes, les stems et le MIDI de la batterie.

## Installation

```bash
cd ~/.claude/skills/jersey-club     # lien vers le dépôt (jersey-club/)
bash install.sh                     # ffmpeg, rubberband-cli, venv .venv/, torch CPU, Demucs
.venv/bin/python -m pytest -q       # 16 tests, ~4 min (-m "not lent" : ~30 s)
```

## Utilisation

En conversation : « transforme `~/Musique/titre.mp3` en jersey » suffit. À la main :

```bash
PY=~/.claude/skills/jersey-club/.venv/bin/python
$PY ~/.claude/skills/jersey-club/scripts/jerseyfy.py titre.mp3            # Demucs, 3 variantes
$PY ~/.claude/skills/jersey-club/scripts/jerseyfy.py titre.mp3 --fast     # séparation rapide
```

Options : `--variants N`, `--bpm 140`, `--length court|complet`, `--seed N`,
`--pitch preserve|follow|+N`, `--bpm-source N`, `--profil rap|rnb|pop|electro|variete_fr|acoustique`,
`--sortie dossier`, `--depuis-session session_A.json` (rejeu identique).

Sortie dans `./jersey_out/<titre>/` :

| Fichier | Contenu |
|---|---|
| `<titre>_jersey_A.wav/.mp3` (B, C) | les rendus (24 bits / MP3 320 kbps) |
| `stems/A/{drums,chops,basse,instru}.wav` | bus du mix, même gain que le master |
| `drums_A.mid` | la batterie en MIDI (canal 10 GM) |
| `session_A.json` | TOUS les paramètres + seed + versions des libs + empreinte audio |
| `rapport.md` | analyse, choix, métriques, avertissements, corrections, spectrogrammes |
| `spectro_A.png` | spectrogramme + forme d'onde avec les sections |
| `feedback.md` | modèle de retour à remplir |
| `analyse.json` | analyse de la source (aucun audio) |

## Donner un retour pour que le skill apprenne

Le plus simple : répondre à Claude en langage libre (« A 4/5, B trop chargée, C top mais le kick
est trop sec »). Claude convertit et lance `learn.py`. À la main :

```bash
$PY scripts/learn.py --dossier jersey_out/titre --notes A=4,B=2,C=5 --preferee C --commentaire "kick trop sec"
$PY scripts/learn.py --feedback jersey_out/titre/feedback.md      # modèle rempli
$PY scripts/learn.py --regle "squeak_amount:-" --note "squeak agaçant"
$PY scripts/status.py                                             # ce qui a été appris
$PY scripts/learn.py --historique ; $PY scripts/learn.py --rollback <date>
```

## Comment ça marche

### Pipeline (`scripts/jerseyfy.py`)
1. **Décodage** ffmpeg → 44,1 kHz stéréo float, normalisé pour l'analyse.
2. **Tempo** (`analyze.py`) : beat tracking librosa, affiné par régression sur les beats indexés
   (précision < 0,01 BPM sur piste stable), phase recalée sur les onsets ; downbeat choisi par
   énergie de grave + changement d'harmonie.
3. **Séparation** (`separate.py`) : Demucs htdemucs (4 stems) ou HPSS + centre stéréo (`--fast`),
   avec cache.
4. **Profil de source** (heuristique transparente : ratio percussif, sub, voix, centroïde, tempo).
5. **Paramètres** (`params.py`) : défauts → recentrage par les références → préférences apprises
   (profil, repli sur global) → règles → options CLI. A = exploitation, B = exploration
   (Thompson sampling / tirage gaussien, ≥ 15 % hors optimum), C = joker (un paramètre
   structurant change franchement).
6. **Recalage** (`stretch.py`) : multiplicateur m ∈ {0,5 ; 1 ; 2} minimisant |t/(b·m) − 1| ;
   time-map rubberband (chaque beat source → son temps cible, donc les tempos flottants sont
   recalés aussi) ; pitch preserve / follow (sped-up) / +N. Avertissement au-delà de ±20 %.
7. **Analyse par mesure** sur l'audio recalé : tonalité (Krumhansl), accords (templates + chroma
   de basse), segments (matrice d'auto-similarité), hook = fenêtre de 8 mesures la plus vocale
   × la plus répétée.
8. **Arrangement** (`arrange.py`, gabarits YAML) : court = intro 8 → build 8 → drop 16 →
   break 8 → build 4 → drop 16 → outro 8 (≈ 2 min à 140 BPM) ; `court_intense` ; complet = suit
   les segments du morceau.
9. **Batterie & FX** (`drums.py`) : one-shots synthétisés (kick à enveloppe de pitch + click,
   clap multi-impulsions, hats, bed squeak en deux chirps, crash, horn, sirène, riser, souffle),
   grille de 48 ticks/mesure, rolls à densité croissante, humanisation, swing. Les samples de
   `assets/user_packs/` (kick*.wav, clap*.wav…) remplacent la synthèse.
10. **Vocal chops** (`chop.py`) : syllabes du hook (onsets), fondus 3/5 ms, motifs appel/réponse,
    stutter en triolets (pas de 4 ou 2 ticks), répétition de la dernière syllabe, roll avant le
    drop, reverse ponctuel, chops pitchés +3/+5/+7 par rééchantillonnage.
11. **Basse** (`bass.py`) : 808 par kick ou par temps sur la racine de l'accord, glide ; ou basse
    d'origine filtrée ; ou aucune.
12. **Mix** (`mix.py`) : niveaux de bus normalisés, EQ/compression (pedalboard), sidechain du
    kick (profondeur apprise), bus comp, saturation douce, loudness cible et limiteur true-peak
    sur-échantillonné ×4.
13. **Évaluation** (`evaluate.py`) et auto-correction (2 tentatives) : voir ci-dessous.

### Métriques (`evaluate.py`)
Bloquantes : BPM mesuré (autocorrélation affinée sur 4/8/16 temps, tolérance ±0,5), timing des
kicks (médiane < 10 ms, détecteur à enveloppe de Hilbert), true peak ≤ −1 dBTP sans clipping,
aucun clic aux points de coupe des chops. Indicatives : LUFS (±1 LU), corrélation de phase > 0,
basse dans la gamme, corrélation tonale des chops, distance spectrale aux références (5 bandes).
Corrections automatiques : plafond du limiteur abaissé, fondus doublés, humanisation coupée.

### Mémoire (`memory/`)
- `lessons.md` : règles explicites datées (priorité haute). Continu : `cible` = plancher (`+`) ou
  plafond (`-`) ; catégoriel : `=v` impose, `!v` évite. Une règle plus récente sur le même
  paramètre et profil archive l'ancienne.
- `preferences.json` : par profil (et global `*`) ; continus = moyenne mobile exponentielle
  pondérée par la note ((note−1)/4 × taux 0,35) et écart-type qui se resserre (plancher à 70 %
  tant que < 3 retours) ; catégoriels = Beta(α, β) par option.
- `feedback_log.jsonl` : un retour par ligne (notes, commentaire, règles créées, paramètres, seeds).
- `references/*.json` : analyses de références (jamais d'audio). Les patterns extraits rejoignent
  `config/patterns.yaml` (source + score) ; BPM, LUFS et densité recentrent les défauts.
- `history/<date>/` : snapshot de `preferences.json` + `lessons.md` avant chaque mise à jour.

### Tests
`tests/` génère son propre audio (clic, chanson synthétique avec accords + voix formantique +
batterie, morceau Jersey synthétique) : aucune musique protégée dans le dépôt.

## Limites connues
Voir la section « Fragile » de `PROGRESS.md` (mesure de timing sur master bruitée par la 808,
voix approximative en `--fast`, downbeat heuristique, lexique sans gestion de la négation…).

## Droits
Un remix d'un morceau dont vous n'avez pas les droits est réservé à un usage privé ; une
publication nécessite l'accord des ayants droit (sauf sur vos propres morceaux).
