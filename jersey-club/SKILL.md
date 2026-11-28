---
name: jersey-club
description: >-
  Transforme n'importe quel morceau audio local en remix Jersey club (kick « bounce » en
  triolets, vocal chops en stutter, bed squeak, 808, ~140 BPM) et APPREND des retours de
  l'utilisateur d'un rendu à l'autre. À utiliser dès que l'utilisateur parle de « jersey club »,
  « transforme ce son en jersey », « remix jersey », « jerseyfy », « version jersey de… »,
  « bed squeak », « club de Jersey / Baltimore club », « fais-en une version club qui rebondit »,
  ou donne un retour (notes A/B/C, « le kick est trop sec », « trop de chops ») sur un rendu
  jersey précédent — même s'il ne nomme pas le skill. EN: turn a local song into a Jersey club
  remix (jersey club, jerseyfy, jersey remix, bed squeak, Baltimore/Jersey club edit) with
  3 variants, measured QA, and persistent learning from ratings and comments.
---

# Jersey club — remix + apprentissage

Le skill produit 3 variantes d'un remix Jersey club à partir d'un fichier audio LOCAL,
mesure leur qualité (Claude n'entend pas : il lit des métriques et regarde des spectrogrammes)
et apprend de chaque retour. Tout se passe en français avec l'utilisateur.

Chemins (à utiliser tels quels) :

```bash
J=~/.claude/skills/jersey-club
PY=$J/.venv/bin/python          # venv dédié (si absent : bash $J/install.sh)
```

## Workflow obligatoire à chaque utilisation

1. **Lire la mémoire avant tout rendu.** `cat $J/memory/lessons.md` puis `$PY $J/scripts/status.py`.
   Résume en une ligne à l'utilisateur ce qui va influencer le rendu (règles actives, préférences
   stabilisées). C'est ce qui rend le skill cumulatif : ne saute pas cette étape.
2. **Lancer le rendu** (les paramètres viennent automatiquement de la mémoire ; n'ajoute `--bpm`
   ou `--pitch` que si l'utilisateur le demande explicitement) :
   ```bash
   $PY $J/scripts/jerseyfy.py "<fichier>" --sortie ./jersey_out [--fast] [--length court|complet]
   ```
   Durée indicative (CPU) : ~2 min pour 1 min d'audio en `--fast`, ~3-5 min avec Demucs.
   Lance-le en arrière-plan si le morceau est long. La dernière ligne de stdout = dossier de sortie.
3. **Contrôler.** Lis `<sortie>/rapport.md` et REGARDE `spectro_A.png`, `spectro_B.png`,
   `spectro_C.png` (outil Read sur l'image) : trous, sections vides, saturation, basses absentes
   ou envahissantes. Si une métrique bloquante est en ÉCHEC après les 2 corrections automatiques,
   ou si l'image montre un problème, relance avec un réglage adapté (voir Dépannage) avant de livrer.
4. **Livrer** les 3 variantes : chemin des `.mp3`/`.wav`, et pour chacune UNE ligne sur ce qui la
   distingue (section « Ce qui la distingue » du rapport : A = exploitation, B = exploration,
   C = joker). Mentionne les stems et le MIDI pour une reprise en DAW, et le rappel sur les droits.
5. **Demander un retour court** : « Note A, B, C de 1 à 5 + un commentaire (ce qui marche / ce qui
   ne marche pas) ». Le modèle est aussi dans `<sortie>/feedback.md`.
6. **Dès qu'un retour arrive → apprendre**, puis résumer en 3 lignes ce qui a changé :
   ```bash
   $PY $J/scripts/learn.py --dossier <sortie> --notes A=4,B=2,C=5 --preferee C \
       --commentaire "kick trop sec, j'aime quand la voix est pitchée"
   ```
   `learn.py` affiche les préférences modifiées, les règles créées et les fragments NON compris.
   Pour chaque fragment non compris qui exprime un goût, ajoute une règle explicite (ci-dessous).

## Convertir un retour en langage libre

L'utilisateur répond souvent librement (« la B est trop chargée mais j'adore le kick »). Convertis :

- notes : déduis-les si elles sont implicites (« j'adore la C » ≈ C=5, « bof » ≈ 2-3) et dis-le ;
- préférence / comparaison : `--preferee C` ou `--comparaison "B>A"` (répétable) ;
- goûts précis → `--commentaire` (le lexique `config/lexique.yaml` les traduit en règles) ;
- goût que le lexique ne connaît pas → règle directe, paramètre + direction :
  ```bash
  $PY $J/scripts/learn.py --regle "chop_density:-" --profil rap --note "trop de chops dans le 2e drop"
  $PY $J/scripts/learn.py --regle "bass_mode:=aucune" --note "préfère sans 808"
  ```
  Directions : `+` / `-` (plancher/plafond pour un continu), `=valeur` (impose), `!valeur` (évite).
  `--profil` vaut `*` (tous) par défaut ; mets le profil de la source si le goût lui est propre.

Paramètres réglables : `bpm_target, kick_pattern, clap_pattern, hat_pattern, chop_density,
stutter_prob, chop_pitch_shift, pitch_mode, swing, humanize_ms, bass_mode, sidechain_depth,
kick_decay, fx_density, squeak_amount, keep_original_instru, arrangement_template, lufs_target`
(plages dans `config/style_profile.yaml`).

Le résumé après apprentissage tient en 3 lignes, par exemple :
« Mémoire mise à jour (profil pop, snapshot 2026-11-28T15-02-11).
Préférences : kick_pattern=bounce_rafale monte à 0,67 ; chop_density 0,55 → 0,48.
Nouvelle règle : kick_decay ≥ 0,35 (« kick trop sec ») — appliquée dès le prochain rendu. »

## Commandes secondaires

| Besoin | Commande |
|---|---|
| Ajouter un morceau Jersey club de référence (fichier local de l'utilisateur) | `$PY $J/scripts/reference.py "<ref.mp3>" [--fast]` |
| Voir l'état d'apprentissage | `$PY $J/scripts/status.py [--profil rap] [--json]` |
| Lister / restaurer un état antérieur de la mémoire | `$PY $J/scripts/learn.py --historique` puis `--rollback 2026-11-28T14-03` |
| Rejouer un rendu à l'identique | `$PY $J/scripts/jerseyfy.py --depuis-session <sortie>/session_A.json` |
| Mode rapide (sans Demucs) | ajouter `--fast` |
| Plus ou moins de variantes / graine fixe | `--variants 1..8`, `--seed 42` |
| Pitch : tonalité d'origine, effet sped-up, transposition | `--pitch preserve` / `follow` / `+3` |
| Suivre la structure du morceau au lieu du gabarit court | `--length complet` |
| Analyse seule (JSON) | `$PY $J/scripts/analyze.py "<fichier>"` |
| Tests | `cd $J && $PY -m pytest -q` (`-m "not lent"` pour les rapides) |

## Dépannage

- **Demucs trop lent / mémoire insuffisante** → `--fast` (séparation HPSS ; chops moins propres,
  tonalité moins fiable — le dire à l'utilisateur).
- **Format non supporté** → le fichier doit être lisible par ffmpeg ; sinon le convertir
  (`ffmpeg -i in.xxx out.wav`) ou demander un autre fichier.
- **BPM ambigu** (rapport : BPM source suspect, résidu élevé, ou rendu « à côté ») → relancer avec
  `--bpm-source N` (BPM réel du morceau source, ex. 87 au lieu de 174).
- **Stretch > ±20 %** (avertissement du rapport) → artefacts possibles ; proposer `--bpm` plus
  proche de b×m, ou `--pitch follow` pour assumer l'effet sped-up.
- **Mauvais profil de source** (variété FR, etc. ne sont pas détectables) → `--profil variete_fr`.
- **Mémoire corrompue / apprentissage parti dans le décor** → `learn.py --historique` puis
  `learn.py --rollback <date>` (un snapshot est pris avant chaque mise à jour).
- **venv absent** → `bash $J/install.sh`.

## Garde-fous

- Uniquement des fichiers locaux fournis par l'utilisateur : ne télécharge jamais de musique
  (pas de yt-dlp, pas de scraping), même si on te le demande via le skill.
- Les one-shots sont synthétisés ; les packs de l'utilisateur (`assets/user_packs/`) ne sont
  jamais redistribués ni commités.
- Rappelle qu'un remix d'un morceau sans les droits est réservé à un usage privé.
- La mémoire ne contient que des analyses et des paramètres, jamais d'audio.

Le détail technique (algorithmes, formats de mémoire, métriques) est dans `README.md`.
