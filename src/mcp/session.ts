/**
 * Lazy-Session-Provider fuer den MCP-Server.
 *
 * Baut bei Bedarf eine LearnwebSession auf: Benutzername aus credential_refs
 * (lokale read-only DB), Passwort aus der macOS-Keychain. Die Session wird
 * gecacht, damit nicht jedes Tool neu einloggt. Secrets bleiben im Speicher und
 * werden nie geloggt.
 */
import type Database from 'better-sqlite3';
import { LearnwebSession } from '../learnweb-core/session';
import { LEARNWEB_BASE_URL } from '../learnweb-core/constants';
import { getPassword } from '../keychain/keychain';

/** Liefert (und cached) eine authentifizierte LearnwebSession. */
export type SessionProvider = () => Promise<LearnwebSession>;

/**
 * Erzeugt einen Session-Provider auf Basis der lokalen DB + Keychain.
 * Wirft erst beim ersten Aufruf, wenn keine Zugangsdaten vorhanden sind.
 */
export function makeSessionProvider(db: Database.Database): SessionProvider {
  let cached: LearnwebSession | null = null;
  return async (): Promise<LearnwebSession> => {
    if (cached) return cached;
    const row = db
      .prepare('SELECT account_name AS account, service_name AS service FROM credential_refs ORDER BY id LIMIT 1')
      .get() as { account: string; service: string } | undefined;
    if (!row) {
      throw new Error('Keine LearnWeb-Zugangsdaten konfiguriert. Bitte zuerst in der App einrichten.');
    }
    const password = await getPassword(row.account, row.service);
    if (!password) {
      throw new Error('Kein LearnWeb-Passwort in der Keychain gefunden.');
    }
    cached = new LearnwebSession(row.account, password, LEARNWEB_BASE_URL);
    return cached;
  };
}
