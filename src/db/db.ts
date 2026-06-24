/**
 * SQLite-Anbindung (better-sqlite3) inkl. Schema-Initialisierung und
 * Migrationslogik über PRAGMA user_version.
 *
 * `openDatabase` ist idempotent: ein erneuter Start legt nichts doppelt an
 * (CREATE TABLE IF NOT EXISTS + user_version-Gate).
 */
import Database from 'better-sqlite3';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

/** Instanztyp einer geöffneten better-sqlite3-Datenbank. */
export type AppDatabase = Database.Database;

/**
 * Migrationsschritte: je Eintrag eine Funktion, die von Version (index) auf
 * (index+1) hebt. Migration 1→2 erweitert transcript_jobs um v2-Felder.
 */
const MIGRATIONS: Readonly<Partial<Record<number, (db: AppDatabase) => void>>> = {
  2: (db) => {
    // Erweitere transcript_jobs um Schema-v2-Felder (Migration 1→2)
    db.exec(`
      ALTER TABLE transcript_jobs ADD COLUMN recording_key TEXT;
      ALTER TABLE transcript_jobs ADD COLUMN title TEXT;
      ALTER TABLE transcript_jobs ADD COLUMN source_type TEXT CHECK (source_type IN ('opencast','youtube','media'));
      ALTER TABLE transcript_jobs ADD COLUMN media_url TEXT;
      ALTER TABLE transcript_jobs ADD COLUMN needs_auth INTEGER NOT NULL DEFAULT 0 CHECK (needs_auth IN (0,1));
      ALTER TABLE transcript_jobs ADD COLUMN section_name TEXT;
      ALTER TABLE transcript_jobs ADD COLUMN section_index INTEGER;
      ALTER TABLE transcript_jobs ADD COLUMN recording_date TEXT;
      ALTER TABLE transcript_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_jobs_recording_key ON transcript_jobs(recording_key) WHERE recording_key IS NOT NULL;
    `);
  },
  3: (db) => {
    // Erstelle output_refs Tabelle (Migration 2→3)
    db.exec(`
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
    `);
  },
  4: (db) => {
    // Erweitere transcript_jobs um das persistierte Notion-Push-Ergebnis (Migration 3→4)
    db.exec(`
      ALTER TABLE transcript_jobs ADD COLUMN notion_push_status TEXT CHECK (notion_push_status IN ('ok','warnings','failed','skipped'));
      ALTER TABLE transcript_jobs ADD COLUMN notion_push_error TEXT;
    `);
  },
  5: (db) => {
    db.exec(`
      CREATE TABLE file_assets_dg_tmp (
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
      INSERT INTO file_assets_dg_tmp (id, activity_cmid, course_id, source_url, filename_original, filename_local, local_path, size_bytes, hash, status, downloaded_at)
      SELECT id, activity_cmid, course_id, source_url, filename_original, filename_local, local_path, size_bytes, hash, status, downloaded_at
      FROM file_assets;
      DROP TABLE file_assets;
      ALTER TABLE file_assets_dg_tmp RENAME TO file_assets;
      CREATE INDEX IF NOT EXISTS idx_file_assets_course ON file_assets(course_id);
      CREATE INDEX IF NOT EXISTS idx_file_assets_hash ON file_assets(hash);
    `);
  },
  6: (db) => {
    db.exec('ALTER TABLE transcript_jobs ADD COLUMN pending_local_path TEXT;');
  },
};

/**
 * Öffnet (bzw. erstellt) die Datenbank am angegebenen Pfad, setzt sichere
 * PRAGMAs, initialisiert das Schema und wendet ausstehende Migrationen an.
 *
 * @param dbPath Dateipfad oder ':memory:' (für Tests)
 */
export function openDatabase(dbPath: string): AppDatabase {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  runMigrations(db);

  return db;
}

/** Legt das Basis-Schema an, sofern noch nicht geschehen, und setzt user_version. */
function initSchema(db: AppDatabase): void {
  const currentVersion = getUserVersion(db);
  if (currentVersion === 0) {
    db.transaction(() => {
      db.exec(SCHEMA_SQL);
      setUserVersion(db, SCHEMA_VERSION);
    })();
  }
}

/** Wendet alle Migrationen an, deren Zielversion > aktueller user_version ist. */
function runMigrations(db: AppDatabase): void {
  let version = getUserVersion(db);
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `Datenbank-Schema ${version} ist neuer als die unterstützte Version ${SCHEMA_VERSION}.`,
    );
  }

  while (version < SCHEMA_VERSION) {
    const targetVersion = version + 1;
    const migrate = MIGRATIONS[targetVersion];
    if (!migrate) {
      db.close();
      throw new Error(`Migration auf Schema-Version ${targetVersion} fehlt.`);
    }
    const tx = db.transaction(() => {
      migrate(db);
      setUserVersion(db, targetVersion);
    });
    tx();
    version = getUserVersion(db);
  }
}

function getUserVersion(db: AppDatabase): number {
  const row = db.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}

function setUserVersion(db: AppDatabase, version: number): void {
  // PRAGMA akzeptiert keinen Parameter-Bind -> Wert ist eine geprüfte Zahl.
  db.pragma(`user_version = ${Math.trunc(version)}`);
}
