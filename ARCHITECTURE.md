# Prolongateur de morceaux — Architecture (étape 0, à valider)

Application web qui prolonge un morceau uploadé (MP3/MP4) : analyse, transcription,
génération de paroles, synthèse sur voix clonée, extension instrumentale, montage final.

**Hébergement retenu : 100 % Vercel** (plan Hobby). Ce choix remplace la file
BullMQ + Redis du cahier des charges initial, qui exige un processus permanent que
Vercel ne fournit pas. Tout ce qui suit est adapté à ce contexte.

Aucun code applicatif n'est écrit tant que ce document n'est pas validé.

---

## 1. Contraintes Vercel Hobby et réponses

| Contrainte | Conséquence | Réponse |
|---|---|---|
| Pas de processus permanent | Pas de worker BullMQ | **Inngest** : chaque étape = un `step.run` durable, reprenable, avec retries. État persisté par Inngest **et** en base |
| Fonctions limitées à 300 s (Fluid Compute) | Une étape longue ne peut pas bloquer | Demucs, MusicGen, voix : appels **asynchrones avec webhook**, la fonction n'attend pas |
| Corps de requête limité à 4,5 Mo | Impossible d'uploader 100 Mo via l'API | **Vercel Blob, upload direct navigateur → Blob** avec jeton signé côté serveur |
| Pas de Redis / Postgres intégrés | | **Neon Postgres** (marketplace Vercel) via Prisma. Pas de Redis : Inngest porte la file, la base porte le statut |
| Pas de Python | Pas de librosa | **essentia.js** (WASM) dans une fonction Node : BPM, tonalité, beats. Structure : algorithme maison (nouveauté sur chroma + énergie) |
| Pas de ffmpeg système | | **ffmpeg-static** embarqué dans la fonction (≈ 75 Mo, sous la limite de 250 Mo) |
| Cron Hobby : 1 exécution / jour max | Purge à 24 h imprécise | Purge par **cron Inngest toutes les heures** + refus d'accès dès `expiresAt` dépassé |
| SSE : connexion coupée à 300 s | | Flux SSE qui lit la base toutes les 2 s, se ferme proprement à 280 s, le client se reconnecte |
| Whisper : fichier ≤ 25 Mo | Stem vocal WAV 10 min ≈ 100 Mo | Conversion du stem en MP3 64 kbps avant envoi |

Coût services externes hors Vercel : Inngest, Neon et Vercel Blob ont un palier gratuit
suffisant pour un usage interne. Replicate, OpenAI, Anthropic, ElevenLabs sont facturés à l'usage.

---

## 2. Choix techniques (résumé)

| Sujet | Choix |
|---|---|
| Front + API | Next.js 15 (App Router), TypeScript, Tailwind, déployé sur Vercel |
| Orchestration | Inngest (SDK Next.js, route `/api/inngest`) |
| Base de données | Neon Postgres via Prisma (adaptateur `@prisma/adapter-neon`) |
| Fichiers | Vercel Blob, préfixe `projets/<id>/`, accès privé via URLs signées côté serveur |
| Séparation stems | Demucs sur Replicate, webhook |
| Analyse musicale | essentia.js dans une fonction Node |
| Transcription | Whisper (API OpenAI) |
| Paroles | Claude API (Anthropic SDK) |
| Voix clonée | Interface `VoiceProvider` : `NonConfiguree` + adaptateur ElevenLabs |
| Extension instrumentale | Interface `MusicProvider` : MusicGen sur Replicate, webhook |
| Montage | ffmpeg-static : concat, crossfade, `loudnorm` LUFS |
| Statut temps réel | SSE lisant `PipelineStep` en base |
| Accès projet | Jeton secret par projet en cookie httpOnly, pas de compte utilisateur |
| Dev local | `inngest-cli dev` + Neon (branche dev) + Blob (store dev). Pas de Docker nécessaire |

---

## 3. Arborescence des fichiers

```
.
├── ARCHITECTURE.md
├── README.md                       # installation, variables d'env, déploiement Vercel
├── .env.example                    # toutes les clés, côté serveur uniquement
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts                  # serverExternalPackages: ffmpeg-static, essentia.js
├── tailwind.config.ts
├── postcss.config.mjs
├── vercel.json                     # régions, maxDuration par défaut
│
├── prisma/
│   ├── schema.prisma               # schéma §4
│   └── migrations/
│
├── src/
│   ├── app/                        # Next.js App Router (UI en français)
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                            # Accueil : zone de dépôt + aperçu
│   │   ├── projets/[id]/
│   │   │   ├── layout.tsx                      # Fil d'étapes + abonnement SSE
│   │   │   ├── page.tsx                        # Redirige vers l'écran courant
│   │   │   ├── consentement/page.tsx           # Écran bloquant (droits voix + morceau)
│   │   │   ├── analyse/page.tsx                # BPM, tonalité, structure, paroles éditables
│   │   │   ├── generation/page.tsx             # Section, longueur, 2 variantes éditables
│   │   │   └── rendu/page.tsx                  # Waveform + jointure, A/B, téléchargement
│   │   └── api/
│   │       ├── inngest/route.ts                            # Point d'entrée Inngest (serve)
│   │       ├── sante/route.ts                              # GET  DB / Blob / Inngest / ffmpeg
│   │       ├── upload/route.ts                             # POST jeton d'upload Blob + callback fin d'upload
│   │       ├── webhooks/replicate/route.ts                 # POST prédiction terminée → événement Inngest
│   │       ├── webhooks/elevenlabs/route.ts                # POST (si le fournisseur voix est asynchrone)
│   │       └── projets/
│   │           ├── route.ts                                # POST crée le projet après upload Blob
│   │           └── [id]/
│   │               ├── route.ts                            # GET état complet · DELETE purge immédiate
│   │               ├── evenements/route.ts                 # GET  SSE (progression étape par étape)
│   │               ├── consentement/route.ts               # POST déclaration horodatée → événement Inngest
│   │               ├── paroles/route.ts                    # PATCH paroles transcrites corrigées
│   │               ├── generations/route.ts                # POST  section + longueur → événement Inngest
│   │               ├── generations/[genId]/route.ts        # PATCH variante choisie + texte édité
│   │               ├── generations/[genId]/rendu/route.ts  # POST  lance voix → extension → montage
│   │               └── fichiers/[type]/route.ts            # GET  URL signée ou flux (original, stems, rendu)
│   │
│   ├── components/
│   │   ├── ui/                     # Bouton, Carte, Badge, Alerte, BarreProgression
│   │   ├── depot/                  # ZoneDepot (upload direct Blob), LecteurApercu
│   │   ├── pipeline/               # FilEtapes, ErreurEtape (quelle API, pourquoi, réessayer)
│   │   ├── consentement/           # FormulaireConsentement
│   │   ├── analyse/                # FicheAnalyse, StructureMorceau, EditeurParoles
│   │   ├── generation/             # ChoixSection, VariantesParoles
│   │   └── rendu/                  # FormeOnde, LecteurAB, BoutonTelechargement
│   │
│   ├── hooks/
│   │   └── useEvenementsProjet.ts  # EventSource + reconnexion automatique
│   │
│   ├── inngest/
│   │   ├── client.ts               # Client Inngest + schéma typé des événements
│   │   ├── evenements.ts           # Noms d'événements : projet/cree, projet/consentement.donne,
│   │   │                           # generation/demandee, generation/rendu.demande, replicate/termine…
│   │   └── fonctions/
│   │       ├── preparer-projet.ts          # extraction → attend consentement → stems → analyse → transcription
│   │       ├── generer-paroles.ts          # Claude, 2 variantes
│   │       ├── rendre-generation.ts        # voix → extension → montage
│   │       └── purger-projets.ts           # cron horaire
│   │
│   ├── pipeline/                   # Logique métier de chaque étape, indépendante d'Inngest
│   │   ├── etapes.ts               # Ordre, dépendances, libellés français
│   │   ├── statut.ts               # Écriture PipelineStep (RUNNING/SUCCEEDED/FAILED + erreur explicite)
│   │   └── etapes/
│   │       ├── extraction-audio.ts
│   │       ├── separation-stems.ts
│   │       ├── analyse-musicale.ts
│   │       ├── transcription.ts
│   │       ├── generation-paroles.ts
│   │       ├── synthese-vocale.ts
│   │       ├── extension-instrumentale.ts
│   │       └── montage-final.ts
│   │
│   ├── providers/                  # Fournisseurs externes derrière des interfaces
│   │   ├── types.ts                # StemProvider, AnalysisProvider, TranscriptionProvider,
│   │   │                           # LyricsProvider, VoiceProvider, MusicProvider
│   │   ├── index.ts                # Fabrique : choisit l'implémentation selon l'env
│   │   ├── stems/DemucsReplicate.ts
│   │   ├── analyse/EssentiaJs.ts
│   │   ├── transcription/WhisperOpenAI.ts
│   │   ├── paroles/ClaudeParoles.ts
│   │   ├── voix/
│   │   │   ├── NonConfiguree.ts    # Échec explicite "fournisseur voix non configuré"
│   │   │   └── ElevenLabs.ts       # Clonage instantané depuis le stem vocal + TTS
│   │   └── musique/MusicGenReplicate.ts
│   │
│   ├── lib/
│   │   ├── config.ts               # Lecture/validation des variables d'env (zod)
│   │   ├── db.ts                   # Client Prisma + adaptateur Neon
│   │   ├── blob.ts                 # put/get/del Vercel Blob, URLs signées, listing par projet
│   │   ├── tmp.ts                  # Téléchargement Blob → /tmp de la fonction, nettoyage
│   │   ├── ffmpeg.ts               # Wrapper ffmpeg-static : probe, extraction, concat, crossfade, LUFS
│   │   ├── validation.ts           # Schémas zod : format, taille, durée, sections
│   │   ├── erreurs.ts              # ErreurPipeline { etape, fournisseur, code, message, cause }
│   │   └── acces.ts                # Jeton projet (cookie) + vérification + expiration
│   │
│   └── types/
│       └── domaine.ts              # Types partagés (Analyse, Section, Événement SSE…)
│
└── tests/
    ├── unit/                       # validation, structure musicale, orchestration (Inngest mock)
    └── fixtures/                   # extraits audio courts libres de droits
```

### Flux et fonctions Inngest

```
upload direct Blob ─► POST /api/projets ─► évt projet/cree
   └─► preparer-projet :
         EXTRACTION_AUDIO ─► waitForEvent(consentement, 24 h) ─► SEPARATION_STEMS (Replicate, webhook)
         ─► ANALYSE_MUSICALE ─► TRANSCRIPTION ─► projet READY_FOR_EDIT

POST /api/projets/[id]/generations ─► évt generation/demandee
   └─► generer-paroles : GENERATION_PAROLES (2 variantes) ─► LYRICS_READY

POST /api/projets/[id]/generations/[genId]/rendu ─► évt generation/rendu.demande
   └─► rendre-generation :
         SYNTHESE_VOCALE ─► EXTENSION_INSTRUMENTALE (Replicate, webhook) ─► MONTAGE_FINAL ─► DONE
```

- Chaque `step.run` écrit sa ligne `PipelineStep` (RUNNING → SUCCEEDED / FAILED). Inngest
  rejoue uniquement les steps non terminés : reprise sans refaire le travail déjà fait.
- Retry automatique 2 fois avec backoff sur erreurs réseau/fournisseur ; au-delà, `FAILED`
  avec `provider`, `errorCode`, `errorMessage` affichés dans l'UI, bouton « Réessayer »
  qui réémet l'événement.
- Fichiers de travail : téléchargés depuis Blob vers `/tmp` de la fonction, résultats
  renvoyés vers Blob. Rien ne persiste dans la fonction entre deux steps.
- Le consentement est vérifié **côté serveur** avant tout step qui touche la voix
  (stems inclus, car le stem vocal sert au clonage).

---

## 4. Schéma de base de données (Prisma / Neon Postgres)

```prisma
enum ProjectStatus {
  UPLOADED          // fichier reçu, extraction en cours
  AWAITING_CONSENT  // extraction ok, attend la déclaration de droits
  PROCESSING        // stems / analyse / transcription en cours
  READY_FOR_EDIT    // analyse et transcription disponibles
  GENERATING        // paroles / voix / extension / montage en cours
  RENDERED          // au moins un rendu final disponible
  FAILED            // une étape a échoué sans reprise possible
  EXPIRED           // purgé (fichiers supprimés, ligne conservée pour log)
}

enum StepName {
  EXTRACTION_AUDIO
  SEPARATION_STEMS
  ANALYSE_MUSICALE
  TRANSCRIPTION
  GENERATION_PAROLES
  SYNTHESE_VOCALE
  EXTENSION_INSTRUMENTALE
  MONTAGE_FINAL
}

enum StepStatus {
  PENDING
  QUEUED
  RUNNING
  WAITING_WEBHOOK   // prédiction lancée chez le fournisseur, attente du retour
  SUCCEEDED
  FAILED
  SKIPPED
}

enum FileKind {
  ORIGINAL              // fichier uploadé tel quel
  AUDIO_SOURCE          // wav extrait (ou converti) servant à tout le pipeline
  STEM_VOCALS
  STEM_VOCALS_MP3       // version compressée pour Whisper et le clonage
  STEM_DRUMS
  STEM_BASS
  STEM_OTHER
  STEM_INSTRUMENTAL     // mix drums+bass+other, base de l'extension
  VOICE_GENERATED       // sortie VoiceProvider pour une génération
  INSTRUMENTAL_EXTENDED // sortie MusicProvider pour une génération
  RENDER_FINAL          // fichier étendu téléchargeable
  WAVEFORM              // JSON de pics pour l'affichage
}

enum SectionType {
  COUPLET
  REFRAIN
  PONT
  OUTRO
}

enum GenerationStatus {
  LYRICS_PENDING
  LYRICS_READY      // 2 variantes disponibles, attend le choix
  RENDERING         // voix + extension + montage en cours
  DONE
  FAILED
}

model Project {
  id                 String        @id @default(cuid())
  accessTokenHash    String        // hash du jeton secret remis à l'uploader (cookie)
  status             ProjectStatus @default(UPLOADED)
  title              String?       // nom déduit du fichier, éditable
  originalFilename   String
  originalMime       String
  originalSizeBytes  Int
  durationSec        Float?        // renseigné après probe ffmpeg
  currentStep        StepName?
  inngestRunId       String?       // run de preparer-projet, pour lier les logs
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  expiresAt          DateTime      // createdAt + 24 h, lu par le cron de purge et par acces.ts
  purgedAt           DateTime?

  files         File[]
  steps         PipelineStep[]
  analysis      Analysis?
  transcription Transcription?
  consent       Consent?
  generations   Generation[]
  providerCalls ProviderCall[]

  @@index([expiresAt])
  @@index([status])
}

model File {
  id           String   @id @default(cuid())
  projectId    String
  kind         FileKind
  blobUrl      String   // URL Vercel Blob (accès privé, servie via URL signée)
  blobPathname String   // "projets/<id>/<kind>.<ext>", clé pour la suppression
  mime         String
  sizeBytes    Int
  durationSec  Float?
  sampleRate   Int?
  channels     Int?
  generationId String?  // renseigné pour VOICE_GENERATED, INSTRUMENTAL_EXTENDED, RENDER_FINAL
  createdAt    DateTime @default(now())

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  generation Generation? @relation(fields: [generationId], references: [id], onDelete: Cascade)

  @@index([projectId, kind])
}

/// Une ligne par étape et par projet (ou par génération pour les 4 dernières étapes).
/// Source de vérité de la progression affichée en SSE.
model PipelineStep {
  id            String     @id @default(cuid())
  projectId     String
  generationId  String?    // null pour les étapes de préparation
  step          StepName
  status        StepStatus @default(PENDING)
  attempt       Int        @default(0)
  progress      Int        @default(0)   // 0–100
  provider      String?    // "replicate/demucs", "openai/whisper", "anthropic/claude"…
  inngestRunId  String?
  externalId    String?    // id de prédiction Replicate en attente de webhook
  startedAt     DateTime?
  finishedAt    DateTime?
  errorCode     String?    // PROVIDER_TIMEOUT, PROVIDER_QUOTA, PROVIDER_NOT_CONFIGURED, INVALID_INPUT, FFMPEG_FAILED…
  errorMessage  String?    // phrase lisible en français pour l'UI
  errorDetails  Json?      // payload technique (statut HTTP, id de prédiction…)
  output        Json?      // petites métadonnées de sortie (ids de fichiers, durées)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  generation Generation? @relation(fields: [generationId], references: [id], onDelete: Cascade)

  @@unique([projectId, generationId, step])
  @@index([projectId, status])
  @@index([externalId])
}

model Analysis {
  id              String   @id @default(cuid())
  projectId       String   @unique
  bpm             Float
  bpmConfidence   Float?
  key             String   // "F#", "Bb"…
  mode            String   // "majeur" | "mineur"
  keyConfidence   Float?
  timeSignature   String   @default("4/4")
  loudnessLufs    Float?
  sections        Json     // [{ label, startSec, endSec, bars, energy }]
  beats           Json     // temps (sec) des battements, pour l'alignement au montage
  downbeats       Json     // temps (sec) des premiers temps
  provider        String   // "essentia.js"
  rawOutput       Json?    // sortie complète, pour debug
  createdAt       DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Transcription {
  id          String   @id @default(cuid())
  projectId   String   @unique
  language    String?
  text        String   // texte brut renvoyé par Whisper
  segments    Json     // [{ startSec, endSec, text }]
  editedText  String?  // corrections de l'utilisateur ; prime sur `text` pour la génération
  editedAt    DateTime?
  provider    String   // "openai/whisper-1"
  createdAt   DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

/// Déclaration de droits. Bloquante : aucun step voix ne démarre sans cette ligne.
/// Le texte exact affiché est stocké avec son hash, pour prouver ce qui a été accepté.
model Consent {
  id               String   @id @default(cuid())
  projectId        String   @unique
  ownsVoiceRights  Boolean
  ownsTrackRights  Boolean
  statementVersion String   // ex. "2026-09-v1"
  statementText    String
  statementHash    String   // sha256 du texte
  declaredAt       DateTime @default(now())
  ipAddress        String?
  userAgent        String?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

/// Une demande d'ajout de section. Plusieurs générations possibles par projet.
model Generation {
  id                String           @id @default(cuid())
  projectId         String
  sectionType       SectionType
  targetDurationSec Int              // longueur cible demandée
  targetBars        Int?             // déduit du BPM, arrondi à la mesure
  insertAtSec       Float?           // point de jointure (fin du morceau par défaut)
  status            GenerationStatus @default(LYRICS_PENDING)
  promptContext     Json?            // métrique, rimes, champ lexical fournis à Claude
  selectedVariantId String?          @unique
  crossfadeMs       Int              @default(800)
  lufsTarget        Float            @default(-14)
  inngestRunId      String?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  project  Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  variants LyricsVariant[] @relation("GenerationVariants")
  selected LyricsVariant?  @relation("SelectedVariant", fields: [selectedVariantId], references: [id])
  files    File[]
  steps    PipelineStep[]

  @@index([projectId])
}

model LyricsVariant {
  id            String   @id @default(cuid())
  generationId  String
  index         Int      // 1 ou 2
  text          String   // proposé par Claude
  editedText    String?  // version modifiée par l'utilisateur ; prime pour la synthèse
  editedAt      DateTime?
  meter         Json?    // syllabes par ligne
  rhymeScheme   String?  // "AABB", "ABAB"…
  model         String   // id du modèle Claude utilisé
  createdAt     DateTime @default(now())

  generation   Generation  @relation("GenerationVariants", fields: [generationId], references: [id], onDelete: Cascade)
  selectedFor  Generation? @relation("SelectedVariant")

  @@unique([generationId, index])
}

/// Journal de chaque appel externe. Sert à afficher "quelle API a échoué et pourquoi",
/// à rattacher un webhook Replicate à son step, et à estimer les coûts.
model ProviderCall {
  id           String   @id @default(cuid())
  projectId    String
  stepId       String?
  provider     String   // "replicate", "openai", "anthropic", "elevenlabs"
  operation    String   // "demucs", "whisper", "lyrics", "clone", "tts", "musicgen"
  externalId   String?  // id de prédiction / de requête chez le fournisseur
  status       String   // "started" | "succeeded" | "failed"
  httpStatus   Int?
  durationMs   Int?
  request      Json?    // paramètres, sans clé ni audio brut
  response     Json?    // extrait de réponse, sans audio brut
  errorMessage String?
  createdAt    DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
  @@index([externalId])
}
```

### Purge à 24 h

- `Project.expiresAt` = `createdAt + 24 h`.
- Cron Inngest toutes les heures : pour chaque projet expiré non purgé, supprime les blobs
  `projets/<id>/*`, supprime les lignes `File`, passe le projet en `EXPIRED`, renseigne
  `purgedAt`. Les lignes `Consent` et `ProviderCall` sont conservées (trace).
- `acces.ts` refuse tout accès à un projet dont `expiresAt` est dépassé, même avant
  le passage du cron.
- `DELETE /api/projets/[id]` fait la même chose immédiatement à la demande de l'utilisateur.

---

## 5. Variables d'environnement (Vercel, côté serveur uniquement)

```
DATABASE_URL              Neon (pooled)
BLOB_READ_WRITE_TOKEN     Vercel Blob
INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
REPLICATE_API_TOKEN       Demucs, MusicGen
REPLICATE_WEBHOOK_SECRET  vérification de signature des webhooks
OPENAI_API_KEY            Whisper
ANTHROPIC_API_KEY         paroles
VOICE_PROVIDER            none | elevenlabs
ELEVENLABS_API_KEY
APP_URL                   pour construire les URLs de webhook
PROJECT_TOKEN_SECRET      signature des jetons d'accès projet
```

---

## 6. Points à valider avant d'écrire le code

1. **Inngest** comme orchestrateur à la place de BullMQ + Redis (imposé par le choix 100 % Vercel).
2. **essentia.js** à la place de librosa. Fiable pour BPM, tonalité et beats. La détection
   de structure (couplet / refrain / pont) sera moins fine que librosa + modèle dédié :
   je la livre comme « structure estimée », éditable par l'utilisateur.
3. **Voix clonée** : `NonConfiguree` + adaptateur **ElevenLabs**. À confirmer ou remplacer.
4. **Pas de compte utilisateur** : accès par jeton secret en cookie. Suffisant en interne.
5. **Section `REFRAIN`** ajoutée aux trois demandées (couplet, pont, outro).
6. **Limites d'upload** : 100 Mo, 10 min max, formats `mp3`, `mp4`, `m4a`, `wav`.
7. **Conservation des logs après purge** : `Consent` et `ProviderCall` restent en base
   après suppression des fichiers. À confirmer côté RGPD.
8. **Plan Vercel Hobby** : usage personnel/non commercial selon les conditions Vercel.
   Si l'outil sert à l'activité des salles, il faudra passer en plan Pro.

Dès validation, je livre dans cet ordre, avec un déploiement Vercel à chaque étape :

1. Socle : Next.js, Tailwind, Prisma + Neon, Inngest, Blob, config env, page d'accueil.
2. Upload direct Blob + validation + extraction ffmpeg + SSE + fil d'étapes.
3. Consentement bloquant + séparation stems (Demucs, webhook).
4. Analyse essentia.js + transcription Whisper + écran d'analyse.
5. Génération de paroles (Claude) + écran de génération.
6. VoiceProvider + MusicProvider (MusicGen) + montage final + écran de rendu.
7. Purge, gestion d'erreurs consolidée, tests, README.
