# Écrire une histoire animée qui retient l'attention

Règles tirées de l'analyse de deux vidéos de référence (voir `docs/analyse_videos.md`).

## Les deux formats qui marchent

### A. Dialogue émouvant à chute — `plat2d`, 16:9 (≈ 45–60 s)
- 2 personnages qui ne se connaissent pas (lieu de passage : bus, salle d'attente, banc, file d'attente).
- Le personnage A se plaint de quelque chose (souvent quelqu'un qu'il aime sans le dire).
- Le personnage B (plus âgé, plus calme) pose des questions courtes, ne juge pas.
- 1 ou 2 **flashbacks** illustrés (autre décor, narration par la voix du personnage).
- Prise de conscience → A agit (part, achète, appelle…).
- **Chute** : la scène finale révèle la situation de B (souvent muette, musique seule, 5–8 s), qui recadre toute l'histoire.
- Dernière réplique douce + « Merci d'avoir regardé ! ».

### B. Narration absurde en escalade — `cube3d`, 9:16 (≈ 40–100 s)
- Narrateur à la 1ʳᵉ personne, phrases très courtes, un plan par phrase (coupe toutes les 1–2 s).
- Structure : « Dans ma ville tout le monde fait X… sauf moi, je fais Y (défaut) » → exemples comiques chiffrés → un événement collectif (fête, panne, catastrophe) → le défaut devient un super-pouvoir qui sauve tout le monde → récompense (travail, titre) → **ironie finale** : le défaut devenu obligation n'est plus drôle / il ne sait plus faire autrement.
- Une **onomatopée ou phrase-refrain** qui revient (ex. « Hush hush hush ») crée la signature sonore.
- Chiffres absurdes affichés en gros (inserts `compteur` / `ecran`) : « 3000 vidéos aujourd'hui », « 23 h 59 de temps d'écran ».

### Autres structures éprouvées
| Structure | Déroulé | Style conseillé |
|---|---|---|
| **Le malentendu** | A croit X, B parle de Y, révélation drôle à la fin | plat2d 16:9 |
| **Avant / après** | « Il y a un an je… » → déclic → aujourd'hui (contraste visuel fort) | plat2d ou cube3d |
| **La règle absurde** | « Dans ce monde, il est interdit de… » → le héros enfreint la règle → conséquence inattendue | cube3d 9:16 |
| **Le compte à rebours** | un délai affiché (« 3 heures avant… ») qui fait monter la tension | les deux |
| **Le point de vue inattendu** | l'histoire racontée par un objet, un animal, un enfant | cube3d |
| **La leçon du sage** | un jeune impatient, un ancien qui répond par une histoire | plat2d 16:9 |

### Banque d'accroches (à adapter)
- « Frère, [personne proche] est tellement [défaut]. »
- « Dans ma ville, tout le monde [qualité]. Sauf moi. »
- « J'ai fait [action banale] et ça a [conséquence énorme]. »
- « Personne ne me croit, mais [affirmation absurde]. »
- « Il me restait [délai] pour [enjeu]. »
- « Tu sais pourquoi [question intrigante] ? »

## Règles d'écriture
1. **Accroche en 2 secondes** : la 1ʳᵉ réplique pose un conflit ou une absurdité. Jamais de présentation.
2. **Répliques ≤ 12 mots**, oralité (« Mec, », « Frère, », « Bref, »), questions-réponses rapides.
3. **Une idée par réplique** = un plan = un mot-clé surligné (`cles`).
4. **Chiffres** : écrits en toutes lettres dans `texte` si on veut un sous-titre exact (« quatre-vingt-deux »), et affichés en gros via `insert`.
5. **Rythme** : alterner répliques longues / très courtes (« Peut-être. », « Ma mère. »). Utiliser `"texte": "…"` pour un silence gêné.
6. **Humour de contraste** : la réplique de B répond à côté (« Et alors, tu as mangé ? »).
7. **Émotion visible** : chaque réplique a une `emotion` ; les écouteurs ont des `reactions`.
8. **Chute** préparée par un détail planté au début (objet tenu : bouquet, sac, téléphone…).
9. Fin : 1 réplique de morale implicite, jamais de leçon appuyée.

## Mise en scène (ce que voit le spectateur)
- Ouverture en plan large, puis alternance moyen/gros sur celui qui parle (la caméra `auto` le fait).
- `gros` + secousse sur surprise/colère (automatique pour `surpris`, `choque`, `fache`).
- Inserts graphiques au moment exact du mot : notification d'appel, badge chiffre, panneau, écran de téléphone géant, compteur.
- Symboles : `?` (incompréhension), `!` (révélation), `goutte` (gêne), `coeur`, `etoiles`, `zzz`.
- Bruitages sur les inserts (automatiques) et `sfx` explicites pour les gags (`boing`, `tada`, `coupure`…).
- Musique : `comique` pour la mise en place, `tendre`/`triste` pour la révélation, `fete` pour une foule, `tension` avant le climax.

## Voix (edge-tts, gratuites)
| Rôle | Voix | Réglages |
|---|---|---|
| jeune homme | `fr-FR-RemyMultilingualNeural` | `debit` +8 à +15 % |
| homme | `fr-FR-HenriNeural` | |
| papy | `fr-FR-HenriNeural` | `debit` −5 %, `hauteur` −8Hz |
| femme | `fr-FR-DeniseNeural` | |
| jeune femme / enfant | `fr-FR-EloiseNeural` | `hauteur` +10Hz pour un enfant |
| narrateur posé | `fr-FR-VivienneMultilingualNeural` | |
| accent belge / suisse / québécois | `fr-BE-GerardNeural`, `fr-CH-FabriceNeural`, `fr-CA-AntoineNeural` | |
Anglais : `en-US-AndrewNeural` (narrateur B), `en-US-AvaNeural`.

## Grille d'auto-évaluation (note chaque critère /5 avant d'écrire le JSON)
1. **Accroche** : donne-t-elle envie de rester dès la 1ʳᵉ phrase ?
2. **Enjeu** : sait-on ce que veut le personnage / ce qui coince ?
3. **Escalade** : chaque réplique ajoute-t-elle une info ou un rire ?
4. **Chute** : surprend-elle ET recadre-t-elle ce qu'on a vu ?
5. **Visuel** : chaque idée a-t-elle une image (insert, geste, symbole, décor) ?
Moins de 20/25 → réécris avant de fabriquer.

## Check-list avant rendu
- [ ] Accroche ≤ 2 s ? Chute claire ? Durée cible respectée (`verifier` l'estime) ?
- [ ] Chaque réplique : émotion + au moins un élément visuel (geste, insert, symbole, caméra, réaction).
- [ ] Pas plus de 3 répliques d'affilée sans changement visuel.
- [ ] Noms de marques / personnes réelles évités (sauf accord explicite).
