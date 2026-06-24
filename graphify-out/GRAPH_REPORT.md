# Graph Report - tbm-unicloudconnect  (2026-06-24)

## Corpus Check
- 119 files · ~92,449 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1047 nodes · 1945 edges · 64 communities (53 shown, 11 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `10e81955`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]

## God Nodes (most connected - your core abstractions)
1. `LearnwebSession` - 35 edges
2. `TranscriptionManager` - 26 edges
3. `createRepos()` - 23 edges
4. `AppRuntime` - 22 edges
5. `process_request()` - 20 edges
6. `normalizeText()` - 18 edges
7. `getPassword()` - 16 edges
8. `LearnwebClient` - 16 edges
9. `NotionClient` - 16 edges
10. `SyncEngine` - 16 edges

## Surprising Connections (you probably didn't know these)
- `storeFile()` --calls--> `resolve()`  [INFERRED]
  src/local-library/store.ts → GUI Design/support.js
- `seedDatabase()` --calls--> `openDatabase()`  [EXTRACTED]
  tests/mcp.test.ts → src/db/db.ts
- `fixture()` --calls--> `openDatabase()`  [EXTRACTED]
  tests/transcription-remove.test.ts → src/db/db.ts
- `fixture()` --calls--> `createRepos()`  [EXTRACTED]
  tests/transcription-manager.test.ts → src/db/repos.ts
- `resolveNotionAdapter()` --calls--> `getPassword()`  [EXTRACTED]
  tests/notion-push.it.test.ts → src/keychain/keychain.ts

## Import Cycles
- None detected.

## Communities (64 total, 11 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (44): DownloadTarget, escapeHtmlAttribute(), LearnwebClient, absoluteUrl(), decodeHtmlEntities(), extractText(), normalizeText(), truncate() (+36 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (40): boot(), collectProps(), compileAttr(), compileTemplate(), createComponentFactory(), createExternalModules(), createHelmetManager(), createPseudoSheet() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (31): getDbPath(), openReadonlyDatabase(), createMcpServer(), listenWithRetry(), SseServerHandle, SseServerOptions, startSseServer(), startStdioServer() (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (48): dependencies, axios, axios-cookiejar-support, better-sqlite3, cheerio, @modelcontextprotocol/sdk, tough-cookie, zod (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (23): checkLibraryPath(), createAndCheckLibraryPath(), buildRelativeLibraryPath(), LibraryPathInput, sanitizePathSegment(), assertInsideRoot(), exists(), hasHash() (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (25): Repos, assertSafeIdentifier(), assertSafePassword(), buildAddArgs(), buildDeleteArgs(), buildFindArgs(), deleteCredential(), execFileAsync (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (16): App(), Dashboard(), DashboardTab, dashboardTitle(), DEFAULT_TRANSCRIPTION_SETTINGS, EMPTY_MCP, EMPTY_SYNC, EMPTY_TRANSCRIPTION (+8 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (14): TranscriptionPhase, TranscriptionSettings, TranscriptionWorkerStatus, TranscriptJob, DEFAULT_SETTINGS, fileExists(), resolveMediaUrl(), runCommand() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (15): decodeBodyBuffer(), DownloadFileResult, DownloadToPathResult, extractFilenameFromContentDisposition(), fixLatin1Mojibake(), isAxiosTimeoutError(), isRedirect(), LearnwebAuthError (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (25): Ablauf:, Ablauf:, Ablauf:, Ablauf:, Ablauf:, Inhalt im UI:, Optionen im MVP 1:, Schritt 1: Willkommen (+17 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (23): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (22): 1. Motivation, 2. Design-Entscheidungen (fixiert), 3.1 Output-Pfad im Code, 3.2 Relevante Entitäten, 3.3 Transkripte in learnweb_sync (Referenz), 3. Ist-Zustand in MVP 1, 4.1 Adapter-Verantwortlichkeiten, 4.2 Adapter-Auswahl (+14 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (32): appendLog(), getLogFilePath(), isElectronRuntime(), LogLevel, FilesystemAdapter, createNotionAdapter(), dateProperty(), extractPageId() (+24 more)

### Community 13 - "Community 13"
Cohesion: 0.19
Nodes (7): ActivityStatus, DownloadJob, SyncRun, DownloadOutcome, finalActivityStatus(), SyncAccess, SyncEngine

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (13): Any, emit_event(), get_transcription_backend(), main(), normalize_audio(), process_request(), Lese Audio-/Videodatei mit PyAV ein und schreibe als 16 kHz Mono WAV.     Nutze, Transkribiere Audio mit Whisper-Backend.     Gibt (transcript, backend_label) zu (+5 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (14): AppDatabase, getUserVersion(), initSchema(), MIGRATIONS, openDatabase(), runMigrations(), TranscriptJobStatus, EXPECTED_TABLES (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (26): AppRuntimeOptions, api, EMPTY_CONFIG, NotionSettingsPanel(), AppSettings, CredentialRef, DownloadJobStatus, FileAsset (+18 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (16): createRepos(), makeActivitiesRepo(), makeCoursesRepo(), makeCredentialRefsRepo(), makeDownloadJobsRepo(), makeFileAssetsRepo(), makeMcpStatusRepo(), makeOutputRefsRepo() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (15): compilerOptions, composite, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noUncheckedIndexedAccess (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (15): compilerOptions, composite, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module, moduleResolution (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (10): Test Segment-Normalisierung auf ~30-Sekunden-Absätze., Test [HH:MM:SS]-Formatierung., Test Segmentierung für mlx-whisper (ohne Zeitmarken)., Test Segmentierung für faster-whisper (mit Zeitmarken)., Leere Transkripte sollten keine Absätze generieren oder einen leeren zurückgeben, TestSegmentation, Teile Transkript in ~30-Sekunden-Absätze auf mit [HH:MM:SS]-Zeitmarken.      Bei, Konvertiere Sekunden in [HH:MM:SS]-Format. (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (9): Umfassende Tests für den Transkriptions-Worker.  Teste Kern-Funktionen ohne echt, Test PyAV-basierte Audio-Normalisierung., PyAV sollte eine gültige 16 kHz Mono-WAV erzeugen., Test atomares Schreiben von Dateien., Test, dass keine Secrets/URLs/Cookies geloggt werden., Cookies sollten nicht in Events auftauchen., TestAtomicWrite, TestAudioNormalization (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.19
Nodes (9): YouTube-JSON3-Tracks werden ohne Metadaten in Text umgewandelt., Leere oder ungültige Inhalte sollten None zurückgeben., Wenn yt_dlp nicht verfügbar, sollte None zurückgegeben werden., Test YouTube-Untertitel-Verarbeitung., TestYouTubeSubtitles, get_youtube_subtitles(), _parse_subtitle_content(), Konvertiere VTT/SRT-Subtiteldaten in einfachen Text.     Gibt den Transkript-Str (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.21
Nodes (8): Test Markdown-Transkript-Generierung., Teste Markdown-Header-Struktur nach MVP1_SCOPE.md., Fehlende Metadaten sollten als 'Unbekannt' ausgegeben werden., Die Quell-URL gehört gemäß MVP1_SCOPE in den lokalen Markdown-Header., Paragraph-Struktur sollte mit Zeitmarken erhalten bleiben., TestMarkdownGeneration, build_markdown_transcript(), Baue Markdown-Transkript nach MVP1_SCOPE.md-Spezifikation.     Nur Metadaten-Hea

### Community 25 - "Community 25"
Cohesion: 0.21
Nodes (8): Test mlx-whisper Modell-zu-Repo-Abbildung., Modell 'tiny' sollte auf tiny-mlx gemappt werden., Modell 'large-v3' sollte auf large-v3-mlx gemappt werden., Das offizielle Turbo-Repo trägt kein zusätzliches -mlx-Suffix., Unbekanntes Modell sollte auf small-mlx defaulten., TestMlxModelMapping, _map_model_to_mlx_repo(), Bilde Whisper-Modellnamen auf MLX-Community Hugging Face Repos ab.     Default:

### Community 26 - "Community 26"
Cohesion: 0.20
Nodes (8): courses, listeners, state, syncStatus, transcriptionListeners, Window, Course, UniCloudApi

### Community 27 - "Community 27"
Cohesion: 0.24
Nodes (8): Path, Test Path-Sicherheit gegen Directory-Traversal., Pfade sollten zu absoluten Pfaden aufgelöst werden., Directory-Traversal sollte durch resolve() verhindert werden., Atomes Schreiben sollte die Datei erzeugen., TestPathSecurity, Validiere output_path gegen Directory-Traversal.     Gibt absoluten Path zurück, validate_output_path()

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (22): extractIcon(), extractPlainTitle(), extractWorkspaceName(), getConfig(), normalizeAdapterMode(), NotionClientLike, NotionSetupRepos, resolveDeps() (+14 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (13): 1. `learnweb-get-courses`, 2. `learnweb-get-course-overview`, 3. `learnweb-read-activity`, 4. `learnweb-read-quiz-review`, 5. `learnweb-get-timeline`, 6. `learnweb-search-courses`, 7. `learnweb-get-page`, 8. `learnweb-get-calendar-month` (+5 more)

### Community 31 - "Community 31"
Cohesion: 0.20
Nodes (9): 1. Setup-Wizard (8 Schritte laut SETUP_FLOW.md), 2. MCP-Tools (9 read-only Tools laut MCP_SPEC.md), 3. Sync-Engine (`src/sync-engine/`), 4. Local-Library (`src/local-library/`), 5. Tray/Statusbar (`src/main/tray.ts`), 6. SQLite-Schema (`src/db/schema.ts` gegen ARCHITECTURE.md), 7. Transkription (`src/transcription/`, `transcription-worker/`), MVP1-Lücken-Report (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (11): Abschluss, Arbeitsregeln, Befehle, graphify, Guardrails (MVP 1), Live-Tests & Builds (verbindlich), Sicherheit und Zugriffe, Stack (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (7): Test Request-Verarbeitung auf höherer Ebene., Request ohne output_path sollte Error-Event zurückgeben., YouTube ohne Untertitel sollte media_url benötigen., YouTube mit verfügbaren Untertiteln sollte erfolgreich sein., Requests mit Exceptions sollten Error-Events zurückgeben., Regressionstest für Issue #14/#16: Opencast-Jobs mit Auth liefern         media_, TestProcessRequest

### Community 34 - "Community 34"
Cohesion: 0.24
Nodes (7): Test Modell-Name-Mapping für Backends., Auf Intel sollte 'large-v3-turbo' zu 'large-v3' gemappt werden., Nicht-Turbo-Modelle sollten unverändert bleiben., MLX-Backend sollte alle Modelle unverändert lassen., TestModelMapping, map_model_for_backend(), Bilde Modellnamen für das Backend um. Intel kennt 'turbo' nicht.

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 36 - "Community 36"
Cohesion: 0.17
Nodes (11): 1. Generierung der macOS-Icons (.icns & Tray Templates), 2. Statusbar (Tray) Code-Implementierung, 3. Frontend-Integration (React Dashboard), 4. Build-Konfiguration aktualisieren, 🎯 Akzeptanzkriterien, 📋 Arbeitspakete (Subtasks), Epic: TBM Cloud Logo und Branding in der App & Statusleiste integrieren, Script zur Erstellung des `.icns`-Ordners (macOS native) (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (17): 1. macOS App Shell, 2. LearnWeb Core, 3. Sync Engine, 4. Local Library, 5. Transcription Worker, 6. MCP-Modul, `activities` (Kurs-Aktivitäten), App-Modell & UI-Struktur (+9 more)

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (6): 1. Kontext (Context), 2. Entscheidung (Decision), 3. Konsequenzen (Consequences), ADR 0001: macOS-only, Local-first und Notion-Ausschluss für MVP 1, Negative Konsequenzen:, Positive Konsequenzen:

### Community 39 - "Community 39"
Cohesion: 0.17
Nodes (11): 1. `electron-builder` Konfiguration erstellen, 2. DMG-Hintergrundbild (Tutorial) entwerfen, 3. Build-Skripte in `package.json` erweitern, 4. Kompatibilitätstests (Universal / ARM64 / x64), 🎯 Akzeptanzkriterien, 📋 Arbeitspakete (Subtasks), 📘 Dokumentation für den Nutzer (README.md / Downloadseite), Epic: Unsigniertes macOS-Packaging (DMG) für Laien einrichten (+3 more)

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (7): 1. Zustände für Kursaktivitäten (`activities.status`), 2. Zustände für Download-Jobs (`download_jobs.status`), 3. Zustände für Transkriptionen (`transcript_jobs.status`), Scope-Abgrenzung, Scope: TBM UniCloudConnect MVP 1, Statusübergänge & Definitionen, Transkriptionsspezifikationen

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (7): Befehle, Features, JSONL-Protokoll, Stack, Tests, transcription-worker, Zugriffe

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (6): Datenschutz- & Vertrauensmodell, Kurzfassung, Nordstern: TBM UniCloudConnect, Pflicht-Ergebnisse (MVP 1):, Produktziel, Zielnutzer

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (6): Test Architektur-Erkennung., Architektur sollte entweder 'arm64' oder 'x86_64' sein., Architektur sollte platform.machine() entsprechen., TestArchitectureDetection, detect_architecture(), Erkenne Architektur: 'arm64' (Apple Silicon) oder 'x86_64' (Intel).     Gibt den

### Community 45 - "Community 45"
Cohesion: 0.40
Nodes (5): Architektur (Module), Befehle, Produktspezifikation & Nordstern, Status, TBM UniCloudConnect

### Community 46 - "Community 46"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 47 - "Community 47"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 48 - "Community 48"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 62 - "Community 62"
Cohesion: 0.22
Nodes (8): Abschluss, Arbeitsregeln, Befehle, Sicherheit und Zugriffe, Stack, transcription-worker - Agentenanleitung, Vor dem Arbeiten, Zweck

### Community 63 - "Community 63"
Cohesion: 0.29
Nodes (7): 1. Kontext (Context), 2. Entscheidung (Decision), 3. Konsequenzen (Consequences), 4. Folgeschritte (nicht Teil dieser ADR), ADR 0002: Aufhebung des Notion-Ausschlusses — Notion-Output-Adapter für MVP 2, Negative Konsequenzen / Risiken:, Positive Konsequenzen:

## Knowledge Gaps
- **312 isolated node(s):** `name`, `version`, `private`, `type`, `description` (+307 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Path` connect `Community 27` to `Community 33`, `Community 2`, `Community 22`, `Community 14`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `process_request()` connect `Community 14` to `Community 33`, `Community 34`, `Community 44`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 27`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `storeFile()` connect `Community 4` to `Community 1`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _370 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08018648018648018 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06918238993710692 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10676532769556026 - nodes in this community are weakly interconnected._