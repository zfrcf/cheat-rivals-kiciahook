# Démonstration — boucle rendu → retour → apprentissage → nouveau rendu

Exécutée le 2026-11-28 sur la chanson synthétique de test (60 s, 100 BPM, La mineur), mode
`--fast`, seed 21, avec une **mémoire de démo isolée** (`JERSEY_MEMORY_DIR`) pour ne pas
polluer la mémoire réelle du skill avec un faux retour.

## 1. Premier rendu
`jerseyfy.py chanson_synth.wav --fast --seed 21` → A, B, C : toutes métriques bloquantes OK
(A : −8,08 LUFS, TP −1,32 dBTP, 140,0 BPM mesurés, kicks 7,1 ms, 0 clic).

## 2. Retour (langage libre converti)
« A bof (2), B moyen (3), C top (5) ; le kick est trop sec, trop de chops, j'aime quand la voix est pitchée »

```
learn.py --dossier …/chanson_synth --notes A=2,B=3,C=5 --preferee C \
         --commentaire "le kick est trop sec, trop de chops, j'aime quand la voix est pitchée"
```
Sortie :
```
Profil « rnb » — snapshot avant mise à jour : 2026-11-28T01-14-46
Préférences : kick_pattern=bounce_syncope : score 0.67 (note 5.0 de C); clap_pattern=backbeat : score 0.67 (note 5.0 de C); hat_pattern=doubles : score 0.67 (note 5.0 de C); chop_pitch_shift=5 : score 0.67 (note 5.0 de C); pitch_mode=preserve : score 0.67 (note 5.0 de C); bass_mode=808_kick : score 0.67 (note 5.0 de C) …
Règles : kick_decay + (cible 0.35); chop_density - (cible 0.325); chop_pitch_shift =7
```

## 3. Second rendu (même seed) — différence mesurable sur la variante A

| | Rendu 1 (A) | Rendu 2 (A) | Origine du changement |
|---|---|---|---|
| kick_pattern | bounce_classique | **bounce_syncope** | C (préférée, note 5) utilisait la syncope : Beta 0,36 → 0,67 |
| kick_decay (s) | 0,22 | **0,35** | règle « kick trop sec » → plancher 0,35 |
| chop_density | 0,55 | **0,325** | règle « trop de chops » → plafond 0,325 |
| chop_pitch_shift | +5 | **+7** | règle « voix pitchée » → =7 |
| attaques détectées dans le stem chops | 141 | **102 (−28 %)** | mesuré sur `stems/A/chops.wav` |
| métriques bloquantes | OK | OK | |

La variante B du rendu 2 a tiré `lufs_target` = −10,8 (exploration, 15 % de tirages hors optimum) :
c'est voulu, l'exploration ne tombe jamais à zéro.
