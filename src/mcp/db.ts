/**
 * MCP-Datenbankverbindung (read-only).
 *
 * Öffnet die lokale SQLite-Datenbank im READ-ONLY-Modus.
 * DB-Pfad wird aus `process.env.UCC_DB_PATH` gelesen, sonst Standard:
 * `~/Library/Application Support/tbm-unicloudconnect/state.sqlite`
 */
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Pfad zur lokalen UCC-Datenbank bestimmen.
 * Standardpfad unter macOS: ~/Library/Application Support/tbm-unicloudconnect/state.sqlite
 */
export function getDbPath(): string {
  if (process.env.UCC_DB_PATH) {
    return process.env.UCC_DB_PATH;
  }
  return join(homedir(), 'Library', 'Application Support', 'tbm-unicloudconnect', 'state.sqlite');
}

/**
 * Öffnet die UCC-Datenbank im read-only-Modus.
 * Wirft einen Fehler, wenn die DB-Datei nicht existiert.
 *
 * @param dbPath Dateipfad (oder undefined für Default)
 * @returns better-sqlite3 Database-Instanz
 */
export function openReadonlyDatabase(dbPath?: string): Database.Database {
  const path = dbPath || getDbPath();
  const db = new Database(path, { readonly: true, fileMustExist: true });
  return db;
}
