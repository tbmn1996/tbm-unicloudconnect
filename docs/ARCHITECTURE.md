# Architektur: TBM UniCloudConnect

Dieses Dokument beschreibt die interne Modularchitektur, das Domänenmodell und die Zuständigkeiten der einzelnen Komponenten von TBM UniCloudConnect.

---

## App-Modell & UI-Struktur

Die App läuft als hybride Desktop-Anwendung mit zwei Hauptkomponenten:

```
[ macOS Menüleisten-Icon (Statusbar) ]
       │
       ├─► Schnell-Informationen (Status, Letzter Sync, Fehler)
       ├─► Schnellaktionen ("Jetzt synchronisieren", "Ordner öffnen")
       └─► Öffnet Haupt-UI
               │
               ▼
[ Vollwertiges Dashboard-Fenster (GUI) ]
       ├── Setup-Wizard (Erst-Einrichtung)
       ├── Kurs- & Inhaltsauswahl (Sync-Regeln)
       ├── Status- & Job-Monitore (Downloads & Transkripte)
       ├── Log- & Diagnose-Konsole
       └── MCP-Einrichtungsbereich
```

---

## Modul-Zuständigkeiten

Die Funktionalität ist in sechs strikt getrennte TypeScript-Module und einen isolierten Python-Worker aufgeteilt.

### 1. macOS App Shell
* **Dateipfad-Scaffold:** `src/index.ts` (Haupt-Einstiegspunkt)
* **Verantwortlichkeiten:**
  * Initialisierung des Menüleisten-Icons in der macOS-Statusbar.
  * Steuerung des App-Lifecycles (Starten, Schließen, Hintergrundbetrieb).
  * Fenster-Management (Erzeugen und Fokussieren des Dashboard-Fensters).
  * Registrierung als macOS-Anmeldeobjekt ("Beim Login starten").

### 2. LearnWeb Core
* **Dateipfad-Scaffold:** [src/learnweb-core/index.ts](../src/learnweb-core/index.ts)
* **Verantwortlichkeiten:**
  * Sichere Login-Prüfung gegen das Münster LearnWeb.
  * Session-Verwaltung und Cookie-Erneuerung (MoodleSession).
  * HTML-Parsing von Kurslisten und der Kurs-Struktur (Themen, Abschnitte).
  * Erkennung von Aktivitätstypen (PDFs, Ordner, Links, Opencast-Videos).
* *Darf nicht:* Lokale Pfade berechnen oder Dateien speichern.

### 3. Sync Engine
* **Dateipfad-Scaffold:** [src/sync-engine/index.ts](../src/sync-engine/index.ts)
* **Verantwortlichkeiten:**
  * Abgleich der im LearnWeb gefundenen Struktur mit dem lokalen DB-Zustand.
  * Erzeugung von Download- und Transkriptions-Jobs basierend auf den Selektions-Regeln des Nutzers.
  * Koordinierung der Download-Warteschlange (Parallel-Limitierung, Timeouts, Retries).
  * Protokollierung der Sync-Läufe (`SyncRun`).

### 4. Local Library
* **Dateipfad-Scaffold:** [src/local-library/index.ts](../src/local-library/index.ts)
* **Verantwortlichkeiten:**
  * Generierung konsistenter, macOS-kompatibler Verzeichnispfade und Dateinamen.
  * Speicherung der heruntergeladenen Binärdaten im Zielordner.
  * Berechnung von Hashes zur Deduplizierung.
  * Indexierung der lokalen Ordnerstruktur für das Dashboard.

### 5. Transcription Worker
* **Dateipfad-Scaffold:** `transcription-worker/` (isoliertes Python-Subprojekt)
* **Verantwortlichkeiten:**
  * Lokales Herunterladen oder Bereitstellen von Audio-/Videodateien aus Opencast/Moodle.
  * Durchführung der Whisper-Transkription.
  * Schreiben des Transkripts als Markdown-Datei.
  * Rückmeldung des Job-Status an die SQLite-Datenbank.

### 6. MCP-Modul
* **Dateipfad-Scaffold:** [src/mcp/index.ts](../src/mcp/index.ts)
* **Verantwortlichkeiten:**
  * Bereitstellung des lokalen Model Context Protocols (stdio-basiert).
  * Bereitstellung strukturierter read-only Abfragewerkzeuge für lokale Agenten (z. B. Claude/Codex) über das LearnWeb-Konto.

---

## Lokales Domänenmodell (SQLite Schema)

Die Datenbank speichert den Zustand der Synchronisation. Die Tabellen sind wie folgt definiert:

### `profiles` (Nutzerprofile)
* `id` (INTEGER, Primary Key)
* `display_name` (TEXT)
* `default_library_path` (TEXT - Absoluter Pfad zum Sync-Ordner)
* `created_at` (DATETIME)

### `credential_refs` (Verweis auf Keychain)
* `id` (INTEGER, Primary Key)
* `provider` (TEXT - standardmäßig "learnweb")
* `secret_store` (TEXT - "macos_keychain")
* `service_name` (TEXT - Name des Keychain-Dienstes)
* `account_name` (TEXT - Username)
* `last_verified_at` (DATETIME)

### `courses` (LearnWeb-Kurse)
* `course_id` (INTEGER, Primary Key - LearnWeb-interne ID)
* `fullname` (TEXT - Voller Kursname)
* `shortname` (TEXT)
* `semester` (TEXT - Semesterbezeichnung, z. B. "SoSe 2026")
* `course_url` (TEXT)
* `is_selected` (BOOLEAN - Ob der Kurs synchronisiert werden soll)
* `first_seen_at` (DATETIME)
* `last_seen_at` (DATETIME)

### `activities` (Kurs-Aktivitäten)
* `cmid` (INTEGER, Primary Key - Moodle Course Module ID)
* `course_id` (INTEGER - Foreign Key)
* `modtype` (TEXT - Typ, z. B. "resource", "folder", "opencast")
* `name` (TEXT - Name im LearnWeb)
* `section_name` (TEXT - Name des Kursabschnitts)
* `section_index` (INTEGER - Position des Abschnitts im Kurs)
* `view_url` (TEXT - URL zur Aktivitätsseite)
* `is_selected` (BOOLEAN - Ob dieses spezifische Element sync-aktiv ist)
* `status` (TEXT - Zustand der Aktivität, siehe Scope-Definition)
* `last_seen_at` (DATETIME)

### `file_assets` (Lokale Dateien)
* `id` (INTEGER, Primary Key)
* `activity_cmid` (INTEGER - Foreign Key)
* `course_id` (INTEGER - Foreign Key)
* `source_url` (TEXT)
* `filename_original` (TEXT)
* `filename_local` (TEXT - Bereinigter lokaler Dateiname)
* `local_path` (TEXT - Relativer Pfad im Bibliotheksordner)
* `size_bytes` (INTEGER)
* `hash` (TEXT - Datei-Prüfsumme zur Deduplizierung)
* `status` (TEXT)
* `downloaded_at` (DATETIME)

### `transcript_jobs` (Transkriptionsaufträge)
* `id` (INTEGER, Primary Key)
* `course_id` (INTEGER - Foreign Key)
* `activity_cmid` (INTEGER - Foreign Key)
* `source_url` (TEXT)
* `media_local_path` (TEXT - Temporärer lokaler Medienpfad)
* `transcript_local_path` (TEXT - Pfad zur fertigen `.md`-Datei)
* `status` (TEXT - Zustand des Jobs)
* `model` (TEXT - Verwendetes Whisper-Modell)
* `duration_seconds` (INTEGER)
* `error_code` (TEXT)
* `created_at` (DATETIME)
* `updated_at` (DATETIME)

### `sync_runs` (Synchronisationsverlauf)
* `id` (INTEGER, Primary Key)
* `started_at` (DATETIME)
* `finished_at` (DATETIME)
* `status` (TEXT - "success", "failed", "warnings")
* `trigger` (TEXT - "manual", "startup", "scheduled")
* `courses_checked` (INTEGER)
* `activities_seen` (INTEGER)
* `files_downloaded` (INTEGER)
* `transcripts_created` (INTEGER)
* `warnings_count` (INTEGER)
* `errors_count` (INTEGER)
