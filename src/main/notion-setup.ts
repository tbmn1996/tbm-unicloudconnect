/**
 * Notion-Anbindung — Setup-Service (Issue #27, Part 4).
 *
 * Kapselt die Logik hinter den `notion:*`-IPC-Handlern: Token verifizieren +
 * sicher ablegen, Datenbanken suchen, Konfiguration lesen/schreiben.
 *
 * Sicherheits-Leitplanken (CLAUDE.md §5):
 * - Das Notion-Token wird AUSSCHLIESSLICH in der macOS-Keychain gespeichert,
 *   nie in der SQLite-DB, nie in Logs/Fehlermeldungen, nie zurück an den Renderer.
 * - In der DB liegt nur ein Credential-Verweis (Service-/Account-Name), analog
 *   zum LearnWeb-Login.
 *
 * Der gespeicherte Token/Settings-Stand wird vom Notion-Output-Adapter (Part 3,
 * `src/output-adapters/`) gelesen — der Schreib-Vertrag hier muss exakt zu
 * dessen Lese-Vertrag passen (`provider:'notion'`, `accountName:'notion_token'`,
 * Settings-Key `output.notion.lw_db_id`).
 */
import {
  KEYCHAIN_SERVICE,
  setCredential as realSetCredential,
  getPassword as realGetPassword,
  hasCredential as realHasCredential,
} from '../keychain/keychain';
import { NotionClient } from '../notion-core/client';
import { NotionAuthError } from '../notion-core/errors';
import { OUTPUT_NOTION_DATABASE_ID_SETTING_KEY } from '../output-adapters/types';
import type { NotionConfigState, NotionDatabaseSummary, OutputAdapterMode } from '../shared/domain';

/** Keychain-Account des Notion-Tokens (vom Output-Adapter erwartet). */
export const NOTION_TOKEN_ACCOUNT = 'notion_token';
/** Provider-Schlüssel des Credential-Verweises (vom Output-Adapter erwartet). */
export const NOTION_PROVIDER = 'notion';
/** Settings-Key für den Ausgabe-Modus (vom OutputRouter gelesen). */
export const OUTPUT_ADAPTER_SETTING_KEY = 'output.adapter';
/** Settings-Key für den (rein anzeigenden) Workspace-Namen. */
export const NOTION_WORKSPACE_NAME_SETTING_KEY = 'output.notion.workspace_name';

/** Minimaler Repos-Vertrag, den dieser Service braucht (Duck-Typing, siehe src/db/repos.ts). */
export interface NotionSetupRepos {
  credentials: {
    get(provider?: string): { serviceName: string; accountName: string } | null;
    set(input: { serviceName: string; accountName: string; provider?: string }): void;
  };
  settings: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
}

/** Schlanker Client-Vertrag (nur die hier genutzten Methoden) — erlaubt Mocking in Tests. */
export interface NotionClientLike {
  getUser(): Promise<Record<string, unknown>>;
  search(params: {
    query?: string;
    sort?: { direction: 'ascending' | 'descending'; timestamp: 'last_edited_time' };
    filter?: { value: 'page' | 'database'; property: 'object' };
    page_size?: number;
  }): Promise<Record<string, unknown>>;
}

/** Injizierbare Abhängigkeiten (Default = echte Implementierungen). Erleichtert Unit-Tests. */
export interface NotionSetupDeps {
  createClient?: (token: string) => NotionClientLike;
  setCredential?: typeof realSetCredential;
  getPassword?: typeof realGetPassword;
  hasCredential?: typeof realHasCredential;
}

function resolveDeps(deps?: NotionSetupDeps): Required<NotionSetupDeps> {
  return {
    createClient: deps?.createClient ?? ((token: string) => new NotionClient(token)),
    setCredential: deps?.setCredential ?? realSetCredential,
    getPassword: deps?.getPassword ?? realGetPassword,
    hasCredential: deps?.hasCredential ?? realHasCredential,
  };
}

/**
 * Notions Such-API liefert den Titel als Rich-Text-Array (`[{plain_text}]`),
 * nicht als String. Diese Funktion löst ihn deterministisch zu einem String auf.
 */
function extractPlainTitle(raw: unknown): string {
  if (!Array.isArray(raw)) return '(ohne Titel)';
  const text = raw
    .map((part) =>
      part && typeof part === 'object' && typeof (part as { plain_text?: unknown }).plain_text === 'string'
        ? (part as { plain_text: string }).plain_text
        : '',
    )
    .join('')
    .trim();
  return text.length > 0 ? text : '(ohne Titel)';
}

/** Extrahiert ein anzeigbares Icon (Emoji oder URL) aus dem Notion-`icon`-Objekt. */
function extractIcon(icon: unknown): string | null {
  if (!icon || typeof icon !== 'object') return null;
  const i = icon as { emoji?: unknown; external?: { url?: unknown }; file?: { url?: unknown } };
  if (typeof i.emoji === 'string') return i.emoji;
  if (i.external && typeof i.external.url === 'string') return i.external.url;
  if (i.file && typeof i.file.url === 'string') return i.file.url;
  return null;
}

/** Normalisiert ein einzelnes Such-Ergebnis zu einer UI-tauglichen Summary (oder null, wenn keine DB). */
function toDatabaseSummary(raw: unknown): NotionDatabaseSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as {
    object?: unknown;
    id?: unknown;
    title?: unknown;
    icon?: unknown;
    last_edited_time?: unknown;
  };
  if (obj.object !== 'database' || typeof obj.id !== 'string') return null;
  return {
    id: obj.id,
    title: extractPlainTitle(obj.title),
    icon: extractIcon(obj.icon),
    lastEdited: typeof obj.last_edited_time === 'string' ? obj.last_edited_time : null,
  };
}

/** Liest den Workspace-Namen aus der `/users/me`-Antwort (Bot-Token). */
function extractWorkspaceName(user: Record<string, unknown>): string | undefined {
  const bot = user.bot as { workspace_name?: unknown } | undefined;
  if (bot && typeof bot.workspace_name === 'string' && bot.workspace_name.length > 0) {
    return bot.workspace_name;
  }
  if (typeof user.name === 'string' && user.name.length > 0) return user.name;
  return undefined;
}

/**
 * Prüft ein Notion-Integration-Token (GET /users/me). Bei Erfolg wird das Token
 * in der Keychain abgelegt und der Credential-Verweis + Workspace-Name persistiert.
 * Das Token wird nie zurückgegeben oder geloggt.
 */
export async function verifyAndStoreToken(
  token: unknown,
  repos: NotionSetupRepos,
  deps?: NotionSetupDeps,
): Promise<{ ok: boolean; workspaceName?: string; message?: string }> {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { ok: false, message: 'Bitte ein Notion-Integration-Token eingeben.' };
  }
  const trimmed = token.trim();
  if (trimmed.length > 1_024) {
    return { ok: false, message: 'Das Token ist zu lang.' };
  }

  const d = resolveDeps(deps);
  let user: Record<string, unknown>;
  try {
    user = await d.createClient(trimmed).getUser();
  } catch (error) {
    if (error instanceof NotionAuthError) {
      return { ok: false, message: 'Token ist ungültig oder hat keinen Zugriff.' };
    }
    // Bewusst generische Meldung — niemals Originalfehler (könnte Token-Header leaken).
    return { ok: false, message: 'Verbindung zu Notion fehlgeschlagen. Bitte später erneut versuchen.' };
  }

  const workspaceName = extractWorkspaceName(user);

  // Reihenfolge: zuerst Secret in die Keychain, dann der Verweis in die DB.
  await d.setCredential(NOTION_TOKEN_ACCOUNT, trimmed);
  repos.credentials.set({
    provider: NOTION_PROVIDER,
    serviceName: KEYCHAIN_SERVICE,
    accountName: NOTION_TOKEN_ACCOUNT,
  });
  if (workspaceName) repos.settings.set(NOTION_WORKSPACE_NAME_SETTING_KEY, workspaceName);

  return { ok: true, workspaceName };
}

/**
 * Inkrementelle Datenbank-Suche über das gespeicherte Token. Gibt eine leere
 * Liste zurück, wenn (noch) kein Token hinterlegt ist (UI rendert „nicht verbunden").
 */
export async function searchDatabases(
  query: unknown,
  repos: NotionSetupRepos,
  deps?: NotionSetupDeps,
): Promise<NotionDatabaseSummary[]> {
  const d = resolveDeps(deps);
  const credential = repos.credentials.get(NOTION_PROVIDER);
  if (!credential) return [];
  const token = await d.getPassword(credential.accountName, credential.serviceName);
  if (!token) return [];

  const search = typeof query === 'string' ? query.trim() : '';
  const response = await d.createClient(token).search({
    query: search,
    filter: { value: 'database', property: 'object' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 25,
  });

  const results = (response as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results
    .map(toDatabaseSummary)
    .filter((item): item is NotionDatabaseSummary => item !== null);
}

/** Normalisiert einen rohen Settings-Wert zu einem gültigen Ausgabe-Modus. */
function normalizeAdapterMode(value: string | null): OutputAdapterMode {
  return value === 'notion' || value === 'both' ? value : 'filesystem';
}

/** Liest den aktuellen Konfigurationsstand der Notion-Anbindung für den Settings-Tab. */
export async function getConfig(repos: NotionSetupRepos, deps?: NotionSetupDeps): Promise<NotionConfigState> {
  const d = resolveDeps(deps);
  const connected = await d.hasCredential(NOTION_TOKEN_ACCOUNT);
  return {
    connected,
    workspaceName: repos.settings.get(NOTION_WORKSPACE_NAME_SETTING_KEY),
    selectedDbId: repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY),
    adapterMode: normalizeAdapterMode(repos.settings.get(OUTPUT_ADAPTER_SETTING_KEY)),
  };
}

/** Hinterlegt die Ziel-Datenbank-ID (settings-Key `output.notion.lw_db_id`). */
export function setDatabase(databaseId: unknown, repos: NotionSetupRepos): void {
  if (typeof databaseId !== 'string' || databaseId.trim().length === 0 || databaseId.length > 256) {
    throw new Error('Datenbank-ID ist ungültig.');
  }
  repos.settings.set(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY, databaseId.trim());
}

/** Setzt den Ausgabe-Modus (settings-Key `output.adapter`). */
export function setOutputMode(mode: unknown, repos: NotionSetupRepos): void {
  if (mode !== 'filesystem' && mode !== 'notion' && mode !== 'both') {
    throw new Error('Ausgabe-Modus ist ungültig.');
  }
  repos.settings.set(OUTPUT_ADAPTER_SETTING_KEY, mode);
}
