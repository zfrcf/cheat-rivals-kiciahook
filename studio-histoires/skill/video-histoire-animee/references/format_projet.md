# Format de `projet.json`

Exemples complets : `exemples/papy_salle.json` (plat2d 16:9) et `exemples/baillement.json` (cube3d 9:16).

```jsonc
{
  "titre": "Le papy du bus",
  "format": "16:9",              // "16:9" ou "9:16"
  "style": "plat2d",             // "plat2d" (2D vectoriel) ou "cube3d" (3D cubique)
  "langue": "fr",                // "fr" ou "en" (choix des voix par défaut)
  "sous_titres": "bulle",        // "bulle" (à côté de la tête, 2D), "mot" (1 mot au centre), "phrase" (bas d'écran), "aucun"
  "musique": {"ambiance": "comique", "volume": 0.22},  // ambiance par défaut
  "musique_fichier": "ma_musique.mp3",                  // optionnel : remplace la musique générée
  "rythme": 1.0,                 // multiplie les pauses entre répliques (0.7 = plus nerveux)
  "personnages": {
    "<id>": {
      "nom": "Inès",
      "voix": "fr-FR-DeniseNeural",   // nom edge-tts ou alias : homme, homme_jeune, homme_grave, femme, femme_jeune, femme_douce, enfant, papy, narrateur, belge, suisse, quebec
      "debit": "+8%", "hauteur": "+2Hz",
      "look": { ... }                 // voir plus bas
    },
    "narrateur": {"nom": "Narrateur", "voix": "narrateur"}   // nécessaire si "qui": "narrateur"
  },
  "scenes": [
    {
      "decor": "bus",                       // ou objet {"nom": "rue", "enseigne": "FLEURISTE", "ambiance": "coucher"}
      "acteurs": [{"id": "ines", "x": 0.42, "tient": "telephone"}],
      "musique": "tendre",                  // change l'ambiance à partir de cette scène
      "transition": "fondu",                // "coupe" (défaut), "fondu", "flash", "glisse"
      "camera": "auto",                     // plan par défaut de la scène
      "intro": 0.3, "tenue": 0.4,           // secondes avant la 1re / après la dernière réplique
      "duree": 4,                           // scène muette (sans lignes) : durée en s
      "lignes": [
        {
          "qui": "ines",
          "texte": "J'en peux plus, ma salle de sport me harcèle.",
          "emotion": "blase",
          "cles": ["harcèle"],              // mots surlignés en jaune (ou *mot* dans le texte)
          "geste": "pointe",
          "camera": "gros",
          "insert": {"type": "notif", "titre": "Ta salle", "texte": "Tu nous manques…"},
          "symbole": "?",
          "reactions": {"papy": "surpris"}, // émotion des autres pendant la réplique (persiste)
          "bouge": [{"id": "ines", "x": 0.7, "pose": "debout", "tient": "rien"}],
          "sfx": "pop",                     // ou ["pop", {"nom": "ding", "t": 0.5}]
          "pause": 0.3, "avant": 0,         // silence après / avant la réplique
          "volume": 1.0
        }
      ]
    }
  ]
}
```

## Valeurs autorisées

**Émotions** : neutre, content, heureux, rire, joie (saute), triste, pleure (3D), surpris, choque, gene, blase, fatigue, fache.

**Symboles** : `?`, `!`, `coeur`, `goutte`, `etoiles`, `zzz` (+ `symbole_qui` pour le mettre sur un autre perso).

**Inserts** (`insert.type`) :
| type | champs | usage |
|---|---|---|
| notif | titre, texte, couleur, x, y | appel / notification de téléphone |
| badge | texte, couleur | pastille chiffre près de la tête (« 25 », « 82 ») |
| panneau | titre, texte (\n), couleur, x, y | annonce, date, lieu (« AUJOURD'HUI / FÊTE DES MÈRES ») |
| ecran | pseudo, titre, gros, texte, fond, fond2, likes, couleur_gros | téléphone géant plein écran (vidéo, temps d'écran, batterie…) |
| compteur / titre | texte (\n = sous-ligne), couleur, y | gros texte animé (« 3000 VIDÉOS », titre de fin) |
| bulle | texte | bulle de pensée près du perso |
| icones | liste, legendes, couleur, y | rangée d'icônes qui apparaissent (appels manqués…) |
Options communes : `prolonge` (s après la réplique), `son` (false = pas de bruitage auto).

**Bruitages** : pop, bulle, whoosh, swipe, ding, notif, sonnerie, vibreur, boing, clic, tada, triste, applaudissements, coupure, electricite, bebe, porte, pas, bus.

**Musiques** : tendre, comique, tension, fete, triste, aventure, lofi, aucune.

---

## Style `plat2d`
Monde 1920×1080 ; `x` des acteurs = fraction de largeur (0 → 1). En 9:16 la caméra recadre automatiquement en plans serrés.

**Décors** : bus (`vitesse`, `panneau`, `ambiance:nuit`), rue (`enseigne`, `ambiance` jour/coucher/nuit/matin, `arret`, `banc`), cuisine, chambre (`ambiance:nuit`), buanderie, salon, parc (`ambiance`, `banc`, `cloture`), cimetiere (`nom`), salle_sport (`enseigne`, `couleur`), bureau, ville_nuit, porte (`texte` du paillasson, `ouverte`), immeuble (`couleur`), couleur (`couleur`, `couleur2`).

**Acteur** : `id`, `x`, `pose` (assis/debout ; dans le bus : assis par défaut, aimanté aux sièges), `tient` (telephone, bouquet, tasse, haltere, sac, livre, cadeau, gourde, rien), `emotion`, `regard` (gauche/droite), `echelle`, `entre`/`sort` (gauche/droite : entrée/sortie en marchant).

**Gestes** : pointe, explique, salue, leve_bras, joie, bras_croises, mains_hanches, tete, haussement, saute.

**Caméra** : auto, large, moyen, gros, deux. Scène : `centre` (0–1), `zoom`.

**Look** :
```json
{"peau": "#f2c39b", "cheveux": "epi|court|long|queue|chignon|boucle|chauve", "couleur_cheveux": "#2a2238",
 "haut": "sweat|veste|tshirt|chemise|robe|debardeur", "couleur_haut": "#2bb39a", "couleur_dessous": "#f1e6d0",
 "couleur_bas": "#2c3e70", "chaussures": "#e8e8f0", "lunettes": true, "couleur_lunettes": "#5a3a22",
 "barbe": true, "moustache": true, "couleur_barbe": "#f4f4f4",
 "chapeau": "beret|casquette|bonnet|haut_de_forme", "couleur_chapeau": "#7a5a3c",
 "age": "enfant|jeune|adulte|vieux", "logo": "texte sur le haut"}
```

## Style `cube3d`
Monde en mètres, sol à y = 0. `x`, `z` en mètres (−6…6), `rot` en degrés (0 = face à +z).

**Décors** : ville (`nuit`, `batiment`), chambre (`mur`, `mur2`, `affiche`, `canape`), place_nuit (`scene_dj`, `eteint`), pelouse, salle (`enseigne`), salle_sport, couleur (`couleur`).

**Scène** : `foule` (nombre de figurants), `foule_anim` (danse, bras_leves, saute, assis, scroll), `foule_emotion`, `ouverture` (plan de la 1re réplique), `focus` (acteur suivi), `camera_pos` / `camera_cible` ([x,y,z] pour un plan fixe), `narrateur_visible`.

**Acteur** : `id`, `x`, `z`, `rot`, `pose` (debout/assis), `anim` (scroll, danse, saute, joie, bras_leves, porte, explique), `tient` (telephone), `emotion`.

**Réplique** (en plus des champs communs) : `focus` (qui la caméra montre), `anim` (anim du locuteur), `anims` ({id: anim} pour les autres), `bouge` ([{id, x, z, rot, anim, pose}]).

**Caméra** : auto (varie automatiquement à chaque réplique), large, moyen, gros, trois_quart, plongee, bas, dos, orbite, drone.

**Look** : `peau`, `cheveux` (court, epi, boucle, long, queue, chignon, chauve), `couleur_cheveux`, `couleur_haut`, `couleur_bas`, `couleur_dessous`, `manches: "courtes"`, `chaussures`, `lunettes` (lunettes rondes colorées), `couleur_lunettes`, `chapeau` (casque, casquette, haut_de_forme), `couleur_chapeau`, `age: "enfant"`.
