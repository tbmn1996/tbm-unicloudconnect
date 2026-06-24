/**
 * Kanonisches SQLite-Schema (Version 1) als String-Konstante.
 *
 * Bewusst als TS-String statt .sql-Datei: so ist das DDL sowohl im
 * electron-vite-Bundle (Main-Prozess) als auch unter `tsx`-Tests verfügbar,
 * ohne zur Laufzeit eine Datei vom Dateisystem lesen zu müssen.
 *
 * Enthält ALLE 11 Tabellen aus PRD/MVP1_SCOPE (auch transcript_jobs und
 * mcp_status, deren Logik erst spätere Schnitte füllen) — so werden spätere
 * Migrationen vermieden. Die CHECK-Constraints spiegeln exakt die Status-Enum-
 * Arrays aus src/shared/domain.ts.
 */

/** Aktuelle Schema-Version; wird in PRAGMA user_version geschrieben. */
export const SCHEMA_VERSION = 5;

export const SCHEMA_SQL = `
-- profiles: Nutzerprofile (i. d. R. genau eines im MVP)
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  default_library_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- credential_refs: Verweis auf das Keychain-Item (NIE das Secret selbst)
CREATE TABLE IF NOT EXISTS credential_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'learnweb',
  secret_store TEXT NOT NULL DEFAULT 'macos_keychain',
  service_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  last_verified_at TEXT
);

-- courses: LearnWeb-Kurse
CREATE TABLE IF NOT EXISTS courses (
  course_id INTEGER PRIMARY KEY,
  fullname TEXT NOT NULL,
  shortname TEXT,
  semester TEXT,
  course_url TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  first_seen_at TEXT,
  last_seen_at TEXT
);

-- activities: Kurs-Aktivitäten (Moodle course modules)
CREATE TABLE IF NOT EXISTS activities (
  cmid INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  modtype TEXT NOT NULL,
  name TEXT NOT NULL,
  section_name TEXT,
  section_index INTEGER,
  view_url TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','selected','ignored','download_pending','downloaded','deferred','failed','removed')),
  last_seen_at TEXT
);

-- file_assets: lokal gespeicherte Dateien
CREATE TABLE IF NOT EXISTS file_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_cmid INTEGER REFERENCES activities(cmid) ON DELETE SET NULL,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  filename_original TEXT NOT NULL,
  filename_local TEXT NOT NULL,
  local_path TEXT,
  size_bytes INTEGER,
  hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','downloaded','skipped_duplicate','failed','removed')),
  downloaded_at TEXT
);

-- transcript_jobs: lokale Transkriptionsaufträge
CREATE TABLE IF NOT EXISTS transcript_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  activity_cmid INTEGER REFERENCES activities(cmid) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  media_local_path TEXT,
  transcript_local_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','downloading_media','media_downloaded','transcribing','markdown_created','done','failed_retryable','failed_permanent')),
  model TEXT,
  duration_seconds INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Schema-v2-Erweiterungen
  recording_key TEXT,
  title TEXT,
  source_type TEXT CHECK (source_type IN ('opencast','youtube','media')),
  media_url TEXT,
  needs_auth INTEGER NOT NULL DEFAULT 0 CHECK (needs_auth IN (0,1)),
  section_name TEXT,
  section_index INTEGER,
  recording_date TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  -- Schema-v4-Erweiterung: persistiertes Notion-Push-Ergebnis (kein Silent Fail)
  notion_push_status TEXT CHECK (notion_push_status IN ('ok','warnings','failed','skipped')),
  notion_push_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_jobs_recording_key ON transcript_jobs(recording_key) WHERE recording_key IS NOT NULL;

-- sync_runs: Synchronisationsverlauf
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','failed','warnings')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','startup','scheduled')),
  courses_checked INTEGER NOT NULL DEFAULT 0,
  activities_seen INTEGER NOT NULL DEFAULT 0,
  files_downloaded INTEGER NOT NULL DEFAULT 0,
  transcripts_created INTEGER NOT NULL DEFAULT 0,
  warnings_count INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0
);

-- selection_rules: Sync-Selektionsregeln pro Kurs/Abschnitt/Aktivität/Modtyp
CREATE TABLE IF NOT EXISTS selection_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('course','section','activity','modtype')),
  scope_ref TEXT,
  sync_files INTEGER NOT NULL DEFAULT 1 CHECK (sync_files IN (0, 1)),
  transcribe_recordings INTEGER NOT NULL DEFAULT 0 CHECK (transcribe_recordings IN (0, 1)),
  include_new_items INTEGER NOT NULL DEFAULT 1 CHECK (include_new_items IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- download_jobs: Download-Warteschlange
CREATE TABLE IF NOT EXISTS download_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_cmid INTEGER REFERENCES activities(cmid) ON DELETE SET NULL,
  course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  local_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed_retryable','failed_permanent','skipped_duplicate','skipped_too_large')),
  size_bytes INTEGER,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- settings: schlichtes Key-Value (z. B. Sync-Intervall)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- mcp_status: Zustand der optionalen lokalen MCP-Einrichtung (Platzhalter)
CREATE TABLE IF NOT EXISTS mcp_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  configured_at TEXT,
  last_checked_at TEXT
);

-- output_refs: Notion-Output-Referenzen für synchronisierte Items
CREATE TABLE IF NOT EXISTS output_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('file_asset', 'transcript_job')),
  source_entity_id INTEGER NOT NULL,
  notion_database_id TEXT NOT NULL,
  notion_page_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_output_refs_source ON output_refs(source_entity_type, source_entity_id, notion_database_id);

CREATE INDEX IF NOT EXISTS idx_activities_course ON activities(course_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_course ON file_assets(course_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_hash ON file_assets(hash);
CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status);
CREATE INDEX IF NOT EXISTS idx_selection_rules_course ON selection_rules(course_id);
`;
