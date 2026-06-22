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
