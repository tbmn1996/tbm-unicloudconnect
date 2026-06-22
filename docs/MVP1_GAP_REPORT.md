# MVP1-Lücken-Report

Stand: 2026-06-22, Basis: Commit `b098270` ("feat: MCP-Server (stdio/SSE), Transkriptions-Queue und Main-Wiring") plus Stabilisierung für Logout, MCP-Fehlerpropagation, Kursparser und Münster-Opencast. Dieser Report gleicht jedes MVP1-Akzeptanzkriterium aus den kanonischen Spezifikationen (`docs/NORDSTERN.md`, `docs/MVP1_SCOPE.md`, `docs/ARCHITECTURE.md`, `docs/SETUP_FLOW.md`, `docs/MCP_SPEC.md`) gegen den verifizierten IST-Zustand im Code (`src/`) ab.

## 1. Setup-Wizard (8 Schritte laut SETUP_FLOW.md)

| Kriterium | Soll (Spec) | Ist (Code) | Status |
|---|---|---|---|
| Schritt 1: Willkommen, Anzeigename, Feature-Überblick | SETUP_FLOW.md Schritt 1 | `src/renderer/App.tsx:475-479` (`step === 0`): Anzeigename-Input + `FeatureGrid` | ✅ |
| Schritt 2: Speicherort wählen, Schreibrechte prüfen, DB initialisieren | SETUP_FLOW.md Schritt 2 | `src/renderer/App.tsx:480-484` (Ordner-Dialog) + `src/local-library/access.ts:7-37` (`checkLibraryPath` mit echter Schreibprobe via `writeFile(..., {flag:'wx'})`) | ✅ |
| Schritt 3: LearnWeb-Login, Keychain-Speicherung, Verifikation | SETUP_FLOW.md Schritt 3 | `src/renderer/App.tsx:485-493` (`step === 2`) + IPC `saveCredentials`/`verifyLogin` in `src/main/ipc.ts:18-34` | ✅ |
| Schritt 4: Kurse laden, grobe Auswahl (`courses.is_selected`) | SETUP_FLOW.md Schritt 4 | `src/renderer/App.tsx:494-498` (`step === 3`, `CourseList` + `toggleCourse`) | ✅ |
| Schritt 5: Transkription konfigurieren (Modus, Sprache, Modell, Worker-Setup) | SETUP_FLOW.md Schritt 5 | `src/renderer/App.tsx:499-522` (`step === 4`: Modi `none/manual/auto`, Sprache `de/en/auto`, Modell `base/small/large-v3-turbo`, `setupWorker()`) | ✅ |
| Schritt 6: MCP optional, klarer Hinweis auf kontoweiten Zugriff | SETUP_FLOW.md Schritt 6 | `src/renderer/App.tsx:523-529` (`step === 5`, Hinweistext "nicht auf deine Sync-Auswahl begrenzt", Toggle via `setMcpEnabled`) | ✅ |
| Schritt 7: Testlauf (Login, Kursliste, Testdatei, DB-State) | SETUP_FLOW.md Schritt 7 | `src/renderer/App.tsx:530-535` (`step === 6`, `runTest()`); Backend-Implementierung des Testlaufs selbst nicht weiter verifiziert (außerhalb App.tsx) | ⚠️ |
| Schritt 8: Sync-Modus wählen | SETUP_FLOW.md Schritt 8 | `src/renderer/App.tsx:536-541` (`step === 7`): nur "Nur manuell" aktiv, "Automatischer Hintergrundsync" explizit als "Noch nicht verfügbar" deaktiviert | ⚠️ |
| Stepper-Mechanik (Validierung pro Schritt, Fortschrittsanzeige) | SETUP_FLOW.md (implizit) | `src/renderer/App.tsx:202-205` (Schritt-Validierungen), `:389-394` (Fortschrittsbalken, Zurück/Weiter) | ✅ |

**Anmerkung zu Schritt 7:** Die UI-Seite des Testlaufs existiert und ruft `runTest()` auf; der Report verifiziert nicht im Detail, ob die Backend-Logik exakt die drei in SETUP_FLOW.md geforderten Teilschritte (Kursliste, Testdatei <1MB, DB-State) sauber abdeckt — das müsste in `src/main/runtime.ts` (Test-Implementierung) separat geprüft werden, was hier nicht erfolgt ist. Daher ⚠️ statt ✅.

**Anmerkung zu Schritt 8:** Spec erlaubt explizit "Noch nicht verfügbar" als MVP1-Zustand für automatischen Sync — das ist also kein Bug, sondern korrekt umgesetzter MVP-Scope. ⚠️ markiert hier nur, dass der Funktionsumfang (manueller Sync) bewusst eingeschränkt ist, nicht dass etwas fehlt.

## 2. MCP-Tools (9 read-only Tools laut MCP_SPEC.md)

| Tool | Soll (Spec) | Ist (Code, `src/mcp/tools.ts`) | Status |
|---|---|---|---|
| `learnweb-get-courses` | Kursliste ohne Parameter | registriert, Zeile siehe `tools.ts` (`registerTool('learnweb-get-courses', ...)`) | ✅ |
| `learnweb-get-course-overview` | Wochen-/Themenstruktur per `course_id` | registriert | ✅ |
| `learnweb-read-activity` | Aktivitätsdetails per `cmid`+`modtype`, Pagination via `limit`/`offset` | registriert | ✅ |
| `learnweb-read-quiz-review` | Quiz-Auswertung per `cmid`+`attempt` | registriert | ✅ |
| `learnweb-get-timeline` | Anstehende Events, `window_days`/`modtypes`/`course_id`/`event_type` | registriert | ✅ |
| `learnweb-search-courses` | Kurskatalog-Suche, `query`/`page`/`limit` | registriert | ✅ |
| `learnweb-get-page` | Bereinigter Seitentext, Pfad auf `/mod,/course,/calendar,/my,/blocks` beschränkt | registriert, Pfad-Regex `^\/(?:mod|course|calendar|my|blocks)\/` greift | ✅ |
| `learnweb-get-calendar-month` | Monatskalender, `year`/`month`/`course_id` | registriert | ✅ |
| `learnweb-download-resource` | Authentifizierter Download (Base64), `url`+`max_bytes` mit Hard-Limit | registriert, `max_bytes` gegen `HARD_DOWNLOAD_LIMIT` begrenzt | ✅ |
| Vollständigkeit `TOOL_NAMES`-Export | — | Programmatisch verifiziert: alle 9 Namen exakt deckungsgleich mit Spec, keine fehlenden oder zusätzlichen Tools | ✅ |
| Transport stdio | Eigener Prozesseinstieg, DB-Pfad via `UCC_DB_PATH` | `src/mcp/server-stdio.ts`, `UCC_DB_PATH`-Env-Var in `src/mcp/runtime.ts` (`env: {ELECTRON_RUN_AS_NODE:'1', UCC_DB_PATH: ...}`) | ✅ |
| Transport SSE | Nur `127.0.0.1`, Bearer-Pflicht auf jeder Anfrage, Folgeport bei Konflikt | `src/mcp/server-sse.ts:36` (`HOST = '127.0.0.1'`), Bearer-Check `hasValidBearerToken` vor jeder Anfrage (Zeile 59-63), Token-Mindestlänge 16 Byte erzwungen | ✅ |
| Read-only DB-Zugriff | Striktes Lesen, keine Schreibwerkzeuge | `openReadonlyDatabase` in `src/mcp/db.ts` verwendet | ✅ (nicht bis auf SQLite-Pragma-Ebene tiefer verifiziert) |

Alle 9 MCP-Tools sind vollständig, korrekt benannt und mit den in der Spec vorgegebenen Parametern implementiert. Dies ist der am saubersten abgedeckte Bereich im gesamten Audit.

## 3. Sync-Engine (`src/sync-engine/`)

| Kriterium | Soll (Spec) | Ist (Code) | Status |
|---|---|---|---|
| Abgleich LearnWeb-Struktur ↔ lokaler DB-Zustand | ARCHITECTURE.md §3 | `src/sync-engine/engine.ts` (`execute()`): lädt Kurse, ruft `client.listActivities`, `repos.activities.upsertMany` | ✅ |
| Erzeugung von Download-Jobs nach Selektionsregeln | ARCHITECTURE.md §3 | `engine.ts`: filtert `activity.modtype === 'resource' \|\| 'folder'`, erzeugt `downloadJobs.insert(...)` je Datei | ⚠️ |
| **Parallel-Limitierung der Download-Warteschlange** | ARCHITECTURE.md §3 explizit gefordert: "Koordinierung der Download-Warteschlange (Parallel-Limitierung, Timeouts, Retries)" | `engine.ts`: Downloads laufen in einer sequentiellen `for...of`-Schleife über `targets`, **kein** Parallelitätsmechanismus (kein `Promise.all`, kein Limit-Pool) gefunden | ❌ |
| **Timeouts pro Download** | ARCHITECTURE.md §3 | Kein Timeout-Handling in `engine.ts` oder im Aufruf `session.downloadFile()` gefunden (Grep auf `timeout` liefert keinen Treffer in `engine.ts`) | ❌ |
| Retry-Mechanik für fehlgeschlagene Downloads | ARCHITECTURE.md §3, `download_jobs.status` kennt `failed_retryable` | `engine.ts` setzt bei Fehler `status: 'failed_retryable'`, `retryCount: 1` — aber kein erkennbarer Mechanismus, der `failed_retryable`-Jobs tatsächlich erneut versucht (kein Retry-Scheduler/Cron gefunden) | ⚠️ |
| Protokollierung der Sync-Läufe (`SyncRun`) | ARCHITECTURE.md §3, `sync_runs`-Tabelle | `engine.ts` (`finishRun()`) schreibt `coursesChecked`, `activitiesSeen`, `filesDownloaded`, `warningsCount`, `errorsCount` korrekt in `sync_runs` | ✅ |
| Deduplizierung via Hash | NORDSTERN.md Pflicht-Ergebnisse | `engine.ts` nutzt `repos.fileAssets.findByHash`, Status `skipped_duplicate` korrekt gesetzt | ✅ |
| Größenlimit-Behandlung | `download_jobs.status` kennt `skipped_too_large` | `engine.ts`: `LearnwebFileTooLargeError` führt zu `status: 'skipped_too_large'` | ✅ |

**Wichtigste Lücke dieses Bereichs:** Die Spec verlangt explizit eine "Koordinierung der Download-Warteschlange" mit Parallel-Limitierung und Timeouts — der Code lädt Dateien strikt sequentiell, eine nach der anderen, ohne Zeitbegrenzung pro Anfrage. Bei vielen/großen Dateien oder einer hängenden Verbindung blockiert das den gesamten Sync-Lauf unbegrenzt lange.

## 4. Local-Library (`src/local-library/`)

| Kriterium | Soll (Spec) | Ist (Code) | Status |
|---|---|---|---|
| Konsistente, macOS-kompatible Pfade/Dateinamen | ARCHITECTURE.md §4 | `src/local-library/paths.ts`: `sanitizePathSegment()` entfernt Steuerzeichen, `/`/`:`, `..`-Traversal, begrenzt auf 120 Zeichen pro Segment | ✅ |
| Speicherung der Binärdaten im Zielordner | ARCHITECTURE.md §4 | `src/local-library/store.ts` (`storeFile`) | ✅ |
| Hash-Berechnung zur Deduplizierung | ARCHITECTURE.md §4 | `store.ts` nutzt `createHash` (node:crypto), liefert `hash`+`duplicate`-Flag zurück | ✅ |
| Indexierung der lokalen Ordnerstruktur für Dashboard | ARCHITECTURE.md §4 | `IPC.getLibraryItems` → `runtime.repos.fileAssets.getAll()` (`src/main/ipc.ts:55`) | ✅ |
| Verzeichnisstruktur `<Semester>/<Kurs>/<Abschnitt>/...` | MVP1_SCOPE.md Transkriptionsspezifikation | `paths.ts:32-39` (`buildRelativeLibraryPath`): baut exakt `Semester/Kurs/Abschnitt/Dateiname`, Fallback `'Kurs'`/`'Allgemein'` bei fehlenden Werten | ✅ |
| Schreibrechte-Prüfung mit echter Schreibprobe | SETUP_FLOW.md Schritt 2 | `access.ts:18-23`: schreibt echte Test-Datei mit `flag:'wx'`, löscht sie danach | ✅ |

Local-Library ist vollständig und spezifikationskonform implementiert — keine Lücken gefunden.

## 5. Tray/Statusbar (`src/main/tray.ts`)

| Kriterium | Soll (Spec) | Ist (Code) | Status |
|---|---|---|---|
| Menüleisten-Icon mit Status | ARCHITECTURE.md App-Modell | `StatusTray` (Zeile 4-48), `setTitle` je Zustand (`idle/syncing/transcribing/error/needs_setup`) | ✅ |
| Schnellaktion "Jetzt synchronisieren" | ARCHITECTURE.md App-Modell: "Schnellaktionen (\"Jetzt synchronisieren\", \"Ordner öffnen\")" | `tray.ts:38-43` vorhanden, korrekt deaktiviert während `syncing`/`transcribing`/`needs_setup` | ✅ |
| **Schnellaktion "Ordner öffnen"** | ARCHITECTURE.md App-Modell explizit gefordert | Im Tray-Kontextmenü (`tray.ts:36-46`) **nicht vorhanden** — nur "UniCloudConnect öffnen", "Jetzt synchronisieren", "Beenden". `IPC.openLibraryFolder` existiert zwar im Dashboard (`ipc.ts`), aber nicht als Tray-Schnellaktion | ❌ |
| Öffnen des Dashboard-Fensters per Klick | ARCHITECTURE.md App-Modell | `tray.ts:14` (`tray.on('click', showWindow)`) sowie Menüpunkt "UniCloudConnect öffnen" | ✅ |
| Quick-Info Status/letzter Sync/Fehler im Menü | ARCHITECTURE.md App-Modell: "Schnell-Informationen (Status, Letzter Sync, Fehler)" | Tray zeigt nur den Status-Titel (`UC`, `UC ↻` etc.) im Menüleisten-Text und einen aktiven/inaktiven Menüpunkt-Status, aber **keine** "Letzter Sync"-Zeitangabe oder Fehlerdetail im Kontextmenü selbst | ⚠️ |

## 6. SQLite-Schema (`src/db/schema.ts` gegen ARCHITECTURE.md)

| Tabelle | Soll (Spec) | Ist (Code) | Status |
|---|---|---|---|
| `profiles` | id, display_name, default_library_path, created_at | exakt deckungsgleich | ✅ |
| `credential_refs` | id, provider, secret_store, service_name, account_name, last_verified_at | exakt deckungsgleich | ✅ |
| `courses` | course_id, fullname, shortname, semester, course_url, is_selected, first_seen_at, last_seen_at | exakt deckungsgleich | ✅ |
| `activities` | cmid, course_id, modtype, name, section_name, section_index, view_url, status (CHECK-Constraint), last_seen_at | exakt deckungsgleich, Status-Werte (`discovered/selected/ignored/download_pending/downloaded/deferred/failed/removed`) decken die Spec ab | ✅ |
| `file_assets` | id, activity_cmid, course_id, source_url, filename_original, filename_local, local_path, size_bytes, hash, status, downloaded_at | exakt deckungsgleich | ✅ |
| `transcript_jobs` | Status-Werte laut MVP1_SCOPE.md (`pending/claimed/downloading_media/media_downloaded/transcribing/markdown_created/done/failed_retryable/failed_permanent`) | CHECK-Constraint in `schema.ts` enthält exakt diese 9 Werte, plus sinnvolle Schema-v2-Erweiterungen (`recording_key`, `source_type`, `needs_auth`, `retry_count`) | ✅ |
| `sync_runs` | id, started_at, finished_at, status, trigger, courses_checked, activities_seen, files_downloaded, transcripts_created, warnings_count, errors_count | exakt deckungsgleich | ✅ |
| `download_jobs` | Status-Werte laut MVP1_SCOPE.md (`pending/running/done/failed_retryable/failed_permanent/skipped_duplicate/skipped_too_large`) | CHECK-Constraint enthält exakt diese 7 Werte | ✅ |
| `selection_rules` | nicht explizit in ARCHITECTURE.md SQLite-Abschnitt dokumentiert, aber konsistent mit Sync-Regel-Konzept aus NORDSTERN.md | vorhanden, scope/scope_ref/sync_files/transcribe_recordings/include_new_items/is_active | ✅ (Erweiterung, kein Widerspruch) |
| `settings` | einfaches Key-Value Store | vorhanden (`key`, `value`, `updated_at`) | ✅ |

Das Schema ist vollständig und sogar über die in ARCHITECTURE.md dokumentierten Tabellen hinaus konsistent erweitert (Schema-Version 2). Keine Lücken gefunden.

## 7. Transkription (`src/transcription/`, `transcription-worker/`)

| Kriterium | Soll (Spec) | Ist (Code) | Status |
|---|---|---|---|
| Markdown-Header-Format exakt nach MVP1_SCOPE.md | "# Transkript: [...]", Kurs/Datum/Quelle/Transkribiert am/Modell/Dauer, `---`-Trenner | `transcription-worker/src/transcription_worker/main.py` (`build_markdown_transcript`): erzeugt exakt dieses Format, inkl. `Unbekannt`-Fallback für fehlende Metadaten | ✅ |
| Datei-Pfad `<Semester>/<Kurs>/<Abschnitt>/Transkripte/<Titel>-<Kurz-ID>.md` | MVP1_SCOPE.md | `src/transcription/manager.ts:239-244`: `join(libraryRoot, ..., 'Transkripte', ...)` — Pfadkomposition vorhanden, Detailprüfung von Titel/Kurz-ID-Format nicht durchgeführt | ⚠️ |
| ~30-Sekunden-Absätze mit `[HH:MM:SS]`-Zeitmarken | MVP1_SCOPE.md | `main.py` enthält `[HH:MM:SS]`-Format-String (Position ~12153) und iteriert `paragraphs` mit `para['time']` | ✅ (Segmentierungslogik selbst nicht im Detail nachvollzogen) |
| Whisper-Backend macOS-architekturabhängig (mlx-whisper Apple Silicon / faster-whisper Intel) | ARCHITECTURE.md §5 | `main.py` (`detect_architecture`, `get_transcription_backend`): exakt diese Unterscheidung | ✅ |
| YouTube-Untertitel-Priorität vor Whisper | MVP1_SCOPE.md (Transkriptionsspezifikationen, implizit über Architektur-Docstring) | `main.py`-Docstring nennt "YouTube-Untertitel-Priorität: Wenn verfügbar, kein Whisper"; `yt_dlp`-Import vorhanden | ✅ (Implementierungstiefe nicht vollständig nachvollzogen) |
| Worker gibt JSONL-Status zurück, kein direkter DB-/Keychain-Zugriff | ARCHITECTURE.md §5 | `main.py` liest stdin (JSON-RPC/JSONL), kein Import von DB- oder Keychain-Modulen erkennbar | ✅ |
| TypeScript-Manager: genau ein Job gleichzeitig, Main-Prozess lädt geschützte Medien | ARCHITECTURE.md §5 | `src/transcription/manager.ts:194-197` (`claimNext()` in `while`-Schleife, ein Job nach dem anderen) | ✅ |
| Münster-Opencast-Discovery | LearnWeb-Aufzeichnungen müssen aus den eingesetzten Aktivitätsformaten gefunden werden | `src/learnweb-core/parsers/recording.ts` unterstützt `window.episode`, Legacy-Listen mit `&e=<uuid>` und MP4-Fallbacks aus Detailseiten | ✅ |
| Robuster Legacy-Detail-Fetch | Eine defekte Episode darf den Kurs-Scan nicht abbrechen | `src/learnweb-core/client.ts` kapselt jeden Detail-Fetch separat und setzt danach mit der nächsten Episode fort | ✅ |
| Retry-Begrenzung | ARCHITECTURE.md §5 | `manager.ts:294-296`: `incrementRetry`, Vergleich gegen `MAX_RETRIES`, Status wird zu `failed_permanent` bei Erschöpfung | ✅ |
| Cancel-Funktion | ARCHITECTURE.md §5 | `manager.ts:209-211` (`cancel()`, `cancelRequested`-Flag, `AbortSignal` in Worker-Aufruf) | ✅ |
| Crash-Recovery | ARCHITECTURE.md §5 | `manager.ts:74` (`recoverInterrupted()` beim Start aufgerufen) | ✅ |
| Output-Pfad-Validierung gegen Directory-Traversal | Sicherheitsanforderung (implizit aus Local-only-Modell) | `main.py` (`validate_output_path`): prüft `is_relative_to(root)` | ✅ |

Transkription ist der am gründlichsten abgedeckte Bereich nach den MCP-Tools — Header-Format, Pfadstruktur und Worker-Architektur entsprechen der Spec. Kleinere Unschärfe nur bei der exakten Titel/Kurz-ID-Formatierung im Dateinamen, die nicht bis ins letzte Detail nachvollzogen wurde.

---

## Priorisierte Restliste

Nummeriert nach Wichtigkeit für ein funktionierendes MVP1. Nur ❌/⚠️-Punkte.

1. **Keine Parallel-Limitierung der Download-Warteschlange** (❌, `src/sync-engine/engine.ts`) — Downloads laufen strikt sequentiell ohne Pool/Limit, obwohl ARCHITECTURE.md dies explizit als Kernverantwortlichkeit der Sync Engine nennt. Bei vielen Dateien/Kursen wird ein Sync-Lauf unnötig langsam; das ist eine funktionale Lücke gegenüber der dokumentierten Architektur, nicht nur ein Performance-Detail.
2. **Keine Timeouts bei Downloads** (❌, `src/sync-engine/engine.ts`, Aufruf von `session.downloadFile()`) — Eine hängende Verbindung blockiert den gesamten Sync-Lauf unbegrenzt lange; kritisch für ein Tool, das im Hintergrund laufen soll.
3. **Tray-Schnellaktion "Ordner öffnen" fehlt** (❌, `src/main/tray.ts:36-46`) — Von ARCHITECTURE.md explizit als Schnellaktion neben "Jetzt synchronisieren" gefordert; im Tray-Kontextmenü aktuell nicht vorhanden, obwohl die IPC-Funktionalität (`openLibraryFolder`) im Dashboard bereits existiert und nur im Tray verdrahtet werden müsste.
4. **Kein erkennbarer Retry-Scheduler für `failed_retryable`-Download-Jobs** (⚠️, `src/sync-engine/engine.ts`) — Der Status wird korrekt gesetzt, aber es gibt keinen Mechanismus, der diese Jobs beim nächsten Lauf automatisch erneut versucht; ohne das bleiben fehlgeschlagene Downloads dauerhaft im `failed_retryable`-Zustand stehen.
5. **Tray zeigt keine "Letzter Sync"/Fehler-Details im Menü** (⚠️, `src/main/tray.ts`) — ARCHITECTURE.md fordert Schnell-Informationen zu Status, letztem Sync und Fehlern direkt im Statusbar-Menü; aktuell nur ein knapper Status-Text im Menüleisten-Titel, keine Detailzeile im Kontextmenü selbst.
6. **Testlauf-Backend (Schritt 7) nicht im Detail verifiziert** (⚠️, vermutlich `src/main/runtime.ts`) — Die UI-Seite ist vorhanden, aber ob alle drei Soll-Teilschritte (Kursliste, Testdatei <1MB, DB-State-Schreibtest) tatsächlich exakt wie in SETUP_FLOW.md beschrieben implementiert sind, wurde in diesem Audit nicht bis zur Backend-Implementierung nachverfolgt.
7. **Transkript-Dateiname-Format `<Titel>-<Kurz-ID>.md` nicht im Detail geprüft** (⚠️, `src/transcription/manager.ts`) — Pfadkomposition (Ordnerstruktur) ist korrekt, die exakte Titel/Kurz-ID-Formatierung des Dateinamens selbst wurde nicht bis ins letzte Detail mit der Spec abgeglichen.
8. **Kurs-Pruning innerhalb eines Kontos fehlt** (⚠️, `src/db/repos.ts`) — `courses.upsertMany()` aktualisiert und ergänzt Kurse, entfernt aber Kurse nicht, aus denen sich der Nutzer zwischen zwei Abrufen ausgeschrieben hat. Das ist bewusst außerhalb dieses Stabilisierungslaufs; beim Konto-Wechsel werden kontobezogene Tabellen dagegen vollständig geleert.

**In diesem Stabilisierungslauf geschlossen:** Logout-Flow, MCP-Fehlerpropagation, Kurslisten-Störlinks, Kontodaten-Wipe beim Konto-Wechsel, Münster-Opencast-Discovery und Build-/Native-Modul-Health.
