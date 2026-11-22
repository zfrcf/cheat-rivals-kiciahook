# Analyse des deux vidéos de référence

Méthode : transcription automatique (faster-whisper) avec horodatage, extraction d'une image par seconde, détection des coupes, mesure de la sonie (EBU R128).

## Vidéo A — « Fête des mères » (FR, 16:9, 1920×1080, 30 i/s, 56 s)

| Élément | Observation |
|---|---|
| Style visuel | Motion design 2D vectoriel « flat » : formes arrondies, aplats sans dégradé, palette pastel (bleu nuit, bleu siège, jaune, rose), personnages grosse tête / petit corps, yeux ronds expressifs, joues roses. |
| Lieu principal | Intérieur de bus : sièges bleus, barres jaunes, ville colorée qui défile dans les vitres (parallaxe = mouvement permanent). |
| Personnages | 2 inconnus côte à côte : un jeune (sweat vert, téléphone) et un papy (béret, lunettes, barbe blanche, bouquet de roses). |
| Histoire | Plainte (« ma mère est gênante ») → questions du papy → flashbacks illustrés (cuisine, lessive, potes qui ont leur appart) → « c'est la fête des mères aujourd'hui » → panique → décide d'acheter des roses → descend → **chute muette** : le jeune offre les fleurs à sa mère sur le pas de la porte, le papy dépose son bouquet sur une tombe « MAMAN ». « Ah, les mamans. Merci d'avoir regardé. » |
| Dialogue | 2 voix, répliques de 2 à 8 mots, ping-pong rapide, humour de décalage (« Et alors, tu as mangé ? »). |
| Caméra | Plans fixes à légère respiration ; alternance plan large (les deux) / plan moyen (celui qui parle) ; écran partagé à la fin. |
| Sous-titres | Mots qui apparaissent un par un **à côté de la tête du locuteur**, blanc à contour sombre, police ronde grasse ; mots-clés en **jaune** (gênante, cinq, mangé, honte, aujourd'hui…). |
| Inserts | Notification d'appel « Maman », rangée d'icônes d'appels manqués (8h, 10h, 12h…), bulle-souvenir ronde, badge « 25 », panneau « AUJOURD'HUI FÊTE DES MÈRES », points d'interrogation, cœur. |
| Son | Voix claires très présentes, musique douce discrète qui monte sur la chute (≈ 8 s sans parole), sonie −14,6 LUFS. |

## Vidéo B — « Doom scroll » (EN, 9:16, 576×1024, 30 i/s, 99 s)

| Élément | Observation |
|---|---|
| Style visuel | 3D low-poly « jeu de blocs » : personnages cubiques, textures simples, couleurs saturées, éclairage doux + ombres. |
| Narration | 1 narrateur à la 1ʳᵉ personne, débit rapide, phrases très courtes. |
| Structure | « Dans ma ville tout le monde bosse sauf moi, je scrolle » → exemples absurdes chiffrés (maison en 1 semaine, ado de 12 ans qui guérit le hoquet, 3000 vidéos avant midi, pouce musclé, téléphone qui demande « ça va ? ») → fête sur la place → panne d'électricité → son pouce produit de l'électricité → héros de la ville → devient « centrale électrique » 8 h/jour → n'aime plus scroller → jour de repos, touche l'herbe… et essaie de la scroller. |
| Refrain | « Hush hush hush… » (bruit de scroll) récurrent = signature sonore. |
| Montage | Une coupe à chaque phrase (≈ 1–2 s), plans très variés (drone, gros plan, plongée, contre-plongée, écran de téléphone plein cadre). |
| Sous-titres | **Un seul mot** à la fois, centré, blanc contour noir, police ronde. |
| Inserts | Écrans de téléphone géants (titres de vidéos, temps d'écran 23 h 59, batterie 100 %, facture d'électricité), gros compteurs (« 3000 VIDEOS TODAY », « 12:00 », « 3 HOURS »). |
| Son | Musique rythmée continue, bruitages (scroll, électricité, foule), sonie élevée −9,3 LUFS. |

## Points communs = recette
1. Histoire complète avec **retournement final** en < 100 s.
2. **Personnages simples et reconnaissables** (un accessoire signature chacun).
3. **Image toujours en mouvement** (parallaxe, respiration, coupes fréquentes).
4. **Sous-titres animés synchronisés** avec mots-clés colorés → regardable sans le son.
5. **Inserts graphiques** pour chaque chiffre ou information.
6. Voix naturelles, musique d'ambiance qui suit l'émotion, bruitages sur les gags.

## Ce que le logiciel reproduit
- `plat2d` ↔ vidéo A : décors vectoriels, personnages paramétriques, bouche synchronisée sur l'amplitude de la voix, clignements, gestes, caméra auto (large/moyen/gros + secousses), sous-titres « bulle » à côté de la tête avec mots-clés jaunes, inserts.
- `cube3d` ↔ vidéo B : moteur three.js, personnages cubiques, décors (ville, chambre, place de nuit avec guirlandes/DJ/foule, pelouse, salle), caméra auto qui change de plan à chaque phrase, sous-titres « mot ».
- Voix neuronales gratuites (edge-tts) avec horodatage mot à mot, musique et bruitages générés (aucun droit d'auteur), ducking, normalisation −14 LUFS.

## Limites honnêtes
- Le rendu reste « procédural » : moins de finition qu'un animateur humain (pas de lip-sync phonétique, poses limitées, pas de profils de personnages).
- Les décors sont une bibliothèque fixe : un lieu nouveau = un décor à coder (≈ 20 lignes).
- Le rendu 3D est lent sans GPU (≈ 8× la durée de la vidéo sur un serveur sans carte graphique ; bien plus rapide sur un Mac).
- La musique générée est simple ; pour un rendu pro, fournir un fichier libre de droits via `musique_fichier`.
