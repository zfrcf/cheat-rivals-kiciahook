# Prolongateur de morceaux — Architecture (étape 0, à valider)

Application web qui prolonge un morceau uploadé (MP3/MP4) : analyse, transcription,
génération de paroles, synthèse sur voix clonée, extension instrumentale, montage final.

Ce document est la **proposition d'arborescence et de schéma de base de données**.
Aucun code applicatif n'est écrit tant qu'elle n'est pas validée.

---

## 1. Choix techniques (résumé)

| Sujet | Choix | Pourquoi |
|---|---|---|
| Front + API | Next.js 15 (App Router), TypeScript, Tailwind | Imposé |
| Base de données | PostgreSQL via Prisma | Statuts persistés, JSON natif, migrations propres |
| File d'attente | BullMQ + Redis | Imposé. Un worker Node **séparé** du serveur Next |
| Analyse musicale | Script Python `librosa` lancé par le worker (`child_process`) | Pas de service HTTP à maintenir, isolable en conteneur plus tard |
| Séparation stems | Demucs sur Replicate | Imposé |
| Transcription | Whisper (API OpenAI) | Imposé |
| Paroles | Claude API (Anthropic SDK) | Imposé |
| Voix clonée | Interface `VoiceProvider`, implémentation "non configurée" + adaptateur ElevenLabs en second | À brancher (clé fournie par vous) |
| Extension instrumentale | Interface `MusicProvider`, implémentation MusicGen (Replicate) en premier | Imposé |
| Montage | ffmpeg (`fluent-ffmpeg` + binaire système) | Imposé |
| Stockage fichiers | Disque local `storage/<projetId>/`, purge après 24 h par job répétable BullMQ | Simple, remplaçable par S3 derrière `lib/storage.ts` |
| Statut temps réel | SSE alimenté par Redis pub/sub | Imposé |
| Accès projet | Jeton secret par projet (cookie httpOnly), pas de compte utilisateur | Pas d'auth demandée ; empêche qu'un tiers ouvre un projet par son id |
| Dev local | `docker-compose` : postgres + redis | Démarrage en une commande |

Points que je vous demande de trancher, en bas du document (§4).

---

## 2. Arborescence des fichiers

```
.
├── ARCHITECTURE.md                 # ce document
├── README.md                       # installation, variables d'env, lancement
├── .env.example                    # toutes les clés, côté serveur uniquement
├── .gitignore
├── docker-compose.yml              # postgres + redis pour le dev
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
│
├── prisma/
│   ├── schema.prisma               # schéma §3
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
│   │       ├── sante/route.ts                              # GET  état DB / Redis / ffmpeg / python
│   │       └── projets/
│   │           ├── route.ts                                # POST upload → projet + 1er job
│   │           └── [id]/
│   │               ├── route.ts                            # GET état complet · DELETE purge immédiate
│   │               ├── evenements/route.ts                 # GET  SSE (progression étape par étape)
│   │               ├── consentement/route.ts               # POST déclaration horodatée → lance stems
│   │               ├── paroles/route.ts                    # PATCH paroles transcrites corrigées
│   │               ├── generations/route.ts                # POST  section + longueur → job paroles
│   │               ├── generations/[genId]/route.ts        # PATCH variante choisie + texte édité
│   │               ├── generations/[genId]/rendu/route.ts  # POST  lance voix → extension → montage
│   │               └── fichiers/[type]/route.ts            # GET  flux audio (original, stems, rendu)
│   │
│   ├── components/
│   │   ├── ui/                     # Bouton, Carte, Badge, Alerte, BarreProgression
│   │   ├── depot/                  # ZoneDepot, LecteurApercu
│   │   ├── pipeline/               # FilEtapes, ErreurEtape (quelle API, pourquoi, réessayer)
│   │   ├── consentement/           # FormulaireConsentement
│   │   ├── analyse/                # FicheAnalyse, StructureMorceau, EditeurParoles
│   │   ├── generation/             # ChoixSection, VariantesParoles
│   │   └── rendu/                  # FormeOnde, LecteurAB, BoutonTelechargement
│   │
│   ├── hooks/
│   │   └── useEvenementsProjet.ts  # EventSource + reconnexion
│   │
│   ├── lib/
│   │   ├── config.ts               # Lecture/validation des variables d'env (zod)
│   │   ├── db.ts                   # Client Prisma singleton
│   │   ├── redis.ts                # Connexions ioredis (queue, pub, sub)
│   │   ├── queue.ts                # Files BullMQ, noms de jobs, options de retry
│   │   ├── evenements.ts           # publish/subscribe d'événements projet → SSE
│   │   ├── stockage.ts             # Chemins, écriture atomique, listing, suppression
│   │   ├── validation.ts           # Schémas zod : format, taille, durée, sections
│   │   ├── ffmpeg.ts               # Wrapper : probe, extraction, concat, crossfade, LUFS
│   │   ├── erreurs.ts              # ErreurPipeline { etape, fournisseur, code, message, cause }
│   │   └── acces.ts                # Jeton projet (cookie) + vérification
│   │
│   ├── providers/                  # Fournisseurs externes derrière des interfaces
│   │   ├── types.ts                # StemProvider, AnalysisProvider, TranscriptionProvider,
│   │   │                           # LyricsProvider, VoiceProvider, MusicProvider
│   │   ├── index.ts                # Fabrique : choisit l'implémentation selon l'env
│   │   ├── stems/DemucsReplicate.ts
│   │   ├── analyse/Librosa.ts      # spawn python/analyse.py, parse JSON
│   │   ├── transcription/WhisperOpenAI.ts
│   │   ├── paroles/ClaudeParoles.ts
│   │   ├── voix/
│   │   │   ├── NonConfiguree.ts    # Échec explicite "fournisseur voix non configuré"
│   │   │   └── ElevenLabs.ts       # Adaptateur, activé par VOICE_PROVIDER=elevenlabs
│   │   └── musique/MusicGenReplicate.ts
│   │
│   ├── pipeline/
│   │   ├── etapes.ts               # Ordre, dépendances, étape → file/job
│   │   ├── orchestrateur.ts        # Enchaînement, reprise après échec, idempotence
│   │   └── jobs/                   # Un fichier = un job isolé et reprenable
│   │       ├── extraction-audio.ts
│   │       ├── separation-stems.ts
│   │       ├── analyse-musicale.ts
│   │       ├── transcription.ts
│   │       ├── generation-paroles.ts
│   │       ├── synthese-vocale.ts
│   │       ├── extension-instrumentale.ts
│   │       ├── montage-final.ts
│   │       └── purge.ts            # Job répétable : supprime projets expirés (> 24 h)
│   │
│   └── types/
│       └── domaine.ts              # Types partagés front/worker (Analyse, Section, Événement…)
│
├── worker/
│   ├── index.ts                    # Processus BullMQ Worker (npm run worker)
│   └── python/
│       ├── requirements.txt        # librosa, numpy, soundfile
│       └── analyse.py              # BPM, tonalité, beats, structure → JSON sur stdout
│
├── storage/                        # Fichiers temporaires (gitignored), purgés à 24 h
└── tests/
    ├── unit/                       # validation, ffmpeg (mock), orchestrateur
    └── fixtures/                   # extraits audio courts libres de droits
```

### Flux et jobs

```
upload ─► EXTRACTION_AUDIO ─► [écran consentement, bloquant] ─► SEPARATION_STEMS
      ─► ANALYSE_MUSICALE ─► TRANSCRIPTION ─► [écran analyse, paroles éditables]
      ─► GENERATION_PAROLES (2 variantes) ─► [écran génération, choix + édition]
      ─► SYNTHESE_VOCALE ─► EXTENSION_INSTRUMENTALE ─► MONTAGE_FINAL ─► [écran rendu]
```

- Chaque job : lit son entrée en base, écrit sa sortie (fichiers + ligne `PipelineStep`),
  publie un événement SSE. Un job relancé sur une étape déjà `SUCCEEDED` est ignoré.
- Retry automatique 2 fois avec backoff sur erreurs réseau/fournisseur ; au-delà,
  `FAILED` avec `provider`, `errorCode`, `errorMessage` visibles dans l'UI, bouton "Réessayer".
- Le consentement est vérifié **côté serveur** avant tout job qui touche la voix
  (`SEPARATION_STEMS` inclus, car il produit le stem vocal utilisé pour le clonage).

---

## 3. Schéma de base de données (Prisma / PostgreSQL)

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
  SUCCEEDED
  FAILED
  SKIPPED
}

enum FileKind {
  ORIGINAL              // fichier uploadé tel quel
  AUDIO_SOURCE          // wav extrait (ou converti) servant à tout le pipeline
  STEM_VOCALS
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
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  expiresAt          DateTime      // createdAt + 24 h, lu par le job de purge
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
  id          String   @id @default(cuid())
  projectId   String
  kind        FileKind
  path        String   // relatif à STORAGE_ROOT
  mime        String
  sizeBytes   Int
  durationSec Float?
  sampleRate  Int?
  channels    Int?
  generationId String? // renseigné pour VOICE_GENERATED, INSTRUMENTAL_EXTENDED, RENDER_FINAL
  createdAt   DateTime @default(now())

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  generation Generation? @relation(fields: [generationId], references: [id], onDelete: Cascade)

  @@index([projectId, kind])
}

/// Une ligne par étape et par projet (ou par génération pour les 4 dernières étapes).
/// C'est la source de vérité de la progression affichée en SSE.
model PipelineStep {
  id            String     @id @default(cuid())
  projectId     String
  generationId  String?    // null pour les étapes de préparation
  step          StepName
  status        StepStatus @default(PENDING)
  attempt       Int        @default(0)
  progress      Int        @default(0)   // 0–100
  provider      String?    // "replicate/demucs", "openai/whisper", "anthropic/claude"…
  bullJobId     String?
  startedAt     DateTime?
  finishedAt    DateTime?
  errorCode     String?    // ex. PROVIDER_TIMEOUT, PROVIDER_QUOTA, INVALID_INPUT, FFMPEG_FAILED
  errorMessage  String?    // phrase lisible en français pour l'UI
  errorDetails  Json?      // payload technique (statut HTTP, id de prédiction…)
  output        Json?      // petites métadonnées de sortie (ids de fichiers, durées)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  generation Generation? @relation(fields: [generationId], references: [id], onDelete: Cascade)

  @@unique([projectId, generationId, step])
  @@index([projectId, status])
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
  provider        String   // "librosa"
  rawOutput       Json?    // sortie complète du script, pour debug
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

/// Déclaration de droits. Bloquante : aucun job voix ne démarre sans cette ligne.
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
/// à reprendre une prédiction Replicate en cours, et à estimer les coûts.
model ProviderCall {
  id           String   @id @default(cuid())
  projectId    String
  stepId       String?
  provider     String   // "replicate", "openai", "anthropic", "elevenlabs"
  operation    String   // "demucs", "whisper", "lyrics", "tts", "musicgen"
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
- Job répétable `purge` toutes les 15 min : pour chaque projet expiré non purgé,
  supprime `storage/<id>/`, supprime les lignes `File`, passe le projet en `EXPIRED`,
  renseigne `purgedAt`. Les lignes `Consent` et `ProviderCall` sont conservées (trace).
- `DELETE /api/projets/[id]` fait la même chose immédiatement à la demande de l'utilisateur.

---

## 4. Points à valider avant d'écrire le code

1. **Python via `child_process`** pour librosa (script lancé par le worker) plutôt qu'un
   micro-service HTTP. Plus simple à déployer ; à revoir si vous visez un hébergement
   serverless où le worker ne peut pas embarquer Python.
2. **Voix clonée** : je livre `NonConfiguree` (erreur explicite) + un adaptateur
   **ElevenLabs** (clonage instantané à partir du stem vocal). Vous confirmez ce
   fournisseur, ou vous m'en donnez un autre.
3. **Pas de compte utilisateur** : accès par jeton secret en cookie. Suffisant pour un
   usage interne ; à remplacer par une vraie auth si l'outil devient public.
4. **Section `REFRAIN`** ajoutée aux trois demandées (couplet, pont, outro). À retirer si
   vous voulez rester strict.
5. **Limites d'upload proposées** : 100 Mo, 10 min max, formats `mp3`, `mp4`, `m4a`, `wav`.
6. **Conservation des logs après purge** : `Consent` et `ProviderCall` restent en base
   après suppression des fichiers. Nécessaire pour la traçabilité, à confirmer côté RGPD.

Dès validation, je livre dans cet ordre :

1. Socle : Next.js, Tailwind, Prisma, docker-compose, config env, page d'accueil vide.
2. Upload + validation + stockage + extraction ffmpeg + SSE + fil d'étapes.
3. Consentement bloquant + séparation stems (Demucs).
4. Analyse librosa + transcription Whisper + écran d'analyse.
5. Génération de paroles (Claude) + écran de génération.
6. VoiceProvider + MusicProvider (MusicGen) + montage final + écran de rendu.
7. Purge, gestion d'erreurs consolidée, tests, README.
