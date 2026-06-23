/**
 * Notion-Output-Adapter (Issue #23 Part 3).
 *
 * Platziert synchronisierte Dateien und Aufzeichnungs-Transkripte als Seiten
 * in einer Notion-Datenbank. Nutzt ausschließlich den bereits fertig
 * reviewten `NotionClient` aus src/notion-core/ (nur lesend importiert).
 *
 * Bewusste Scope-Entscheidung (vom Nutzer abgesegnet): Ein echter Datei-Upload
 * zu Notion ist NICHT Teil dieser Aufgabe — der NotionClient hat dafür keine
 * Methode. `placeFile()` legt nur eine Metadaten-Seite an (Kursname, Sektion,
 * Dateiname, Typ, Datum) ohne Pfad-/Upload-Verweis, da diese Information an
 * dieser Stelle nicht verfügbar ist (Filesystem- und Notion-Adapter werden
 * unabhängig mit demselben Input aufgerufen).
 */
import { extname } from 'node:path';
import { sha256 } from '../local-library/store';
import { NotionClient } from '../notion-core/client';
import { NOTION_MAX_BLOCKS_PER_REQUEST, NOTION_MAX_RICH_TEXT_CHARS } from '../notion-core/constants';
import { getPassword } from '../keychain/keychain';
import {
  OUTPUT_NOTION_DATABASE_ID_SETTING_KEY,
  type OutputTarget,
  type PlaceFileInput,
  type PlaceFileResult,
  type PlaceTranscriptInput,
  type PlaceTranscriptResult,
} from './types';

/** Notion-Property-Value für eine Title-Property. */
function titleProperty(content: string) {
  return { title: [{ text: { content } }] };
}

/** Notion-Property-Value für eine Rich-Text-Property. */
function richTextProperty(content: string) {
  return { rich_text: [{ text: { content } }] };
}

/** Notion-Property-Value für eine Date-Property (YYYY-MM-DD). */
function dateProperty(start: string) {
  return { date: { start } };
}

/** Notion-Property-Value für eine Number-Property. */
function numberProperty(value: number | null) {
  return { number: value };
}

/** Liest das `id`-Feld einer createPage-Response vorsichtig als string aus. */
function extractPageId(response: Record<string, unknown>): string {
  const id = response.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Notion-Output-Adapter: legt Metadaten-Seiten in einer fest konfigurierten
 * Notion-Datenbank an (kein Datei-Upload, siehe Modulkommentar oben).
 */
export class NotionAdapter implements OutputTarget {
  readonly kind = 'notion' as const;

  constructor(
    private readonly client: NotionClient,
    private readonly databaseId: string,
  ) {}

  async placeFile(input: PlaceFileInput): Promise<PlaceFileResult> {
    const hash = sha256(input.bytes);
    const today = new Date().toISOString().slice(0, 10);

    const response = await this.client.createPage({
      parent: { database_id: this.databaseId },
      properties: {
        Name: titleProperty(input.filename),
        Kurs: richTextProperty(input.course.fullname),
        Semester: richTextProperty(input.course.semester ?? ''),
        Sektion: richTextProperty(input.sectionName ?? ''),
        Typ: richTextProperty(extname(input.filename)),
        Datum: dateProperty(today),
      },
    });

    return {
      adapter: 'notion',
      duplicate: false,
      remoteRef: extractPageId(response),
      hash,
      sizeBytes: input.bytes.byteLength,
      filename: input.filename,
    };
  }

  async placeTranscript(input: PlaceTranscriptInput): Promise<PlaceTranscriptResult> {
    const properties: Record<string, unknown> = {
      Name: titleProperty(input.title ?? 'Aufzeichnung'),
      Kurs: richTextProperty(input.course.fullname),
      Modell: richTextProperty(input.model ?? ''),
      'Dauer (s)': numberProperty(input.durationSeconds ?? null),
    };
    if (input.recordingDate) {
      properties.Datum = dateProperty(input.recordingDate);
    }

    const response = await this.client.createPage({
      parent: { database_id: this.databaseId },
      properties,
    });
    const pageId = extractPageId(response);

    // Markdown an Leerzeilen in Absätze splitten, jeden Absatz auf die
    // Notion-Rich-Text-Zeichengrenze kürzen und auf die maximale Blockanzahl
    // pro Request begrenzen. Bewusst keine Mehrfach-Batches/Pagination in
    // diesem Sprint (siehe Modulkommentar) — überlanges Markdown wird
    // abgeschnitten.
    const paragraphs = input.markdown
      .split('\n\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, NOTION_MAX_BLOCKS_PER_REQUEST)
      .map((p) => p.slice(0, NOTION_MAX_RICH_TEXT_CHARS));

    const children = paragraphs.map((content) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content } }] },
    }));

    if (children.length > 0) {
      await this.client.appendBlockChildren(pageId, children);
    }

    return { adapter: 'notion', remoteRef: pageId };
  }
}

/** Minimaler Vertrag der hier benötigten Repos (siehe src/db/repos.ts). */
interface NotionAdapterRepos {
  credentials: {
    get(provider?: string): { serviceName: string; accountName: string } | null;
  };
  settings: {
    get(key: string): string | null;
  };
}

/**
 * Baut einen NotionAdapter aus gespeicherten Credentials/Settings.
 *
 * Gibt `null` zurück, wenn Notion nicht konfiguriert ist (kein Credential-Ref,
 * kein Token in der Keychain oder keine Ziel-Datenbank-ID hinterlegt). Das
 * Token wird niemals geloggt oder in Fehlermeldungen eingebettet.
 */
export async function createNotionAdapter(repos: NotionAdapterRepos): Promise<NotionAdapter | null> {
  const credential = repos.credentials.get('notion');
  if (!credential) return null;

  const token = await getPassword(credential.accountName, credential.serviceName);
  if (!token) return null;

  const databaseId = repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY);
  if (!databaseId) return null;

  return new NotionAdapter(new NotionClient(token), databaseId);
}
