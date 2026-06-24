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
import { appendLog } from '../main/logger';
import { NotionClient } from '../notion-core/client';
import { NOTION_MAX_BLOCKS_PER_REQUEST, NOTION_MAX_RICH_TEXT_CHARS } from '../notion-core/constants';
import { getPassword } from '../keychain/keychain';
import {
  OUTPUT_NOTION_DATABASE_ID_SETTING_KEY,
  OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY,
  OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY,
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
  private readonly schemaCache = new Map<string, Map<string, string>>();

  constructor(
    private readonly client: NotionClient,
    private readonly databaseId: string, // output.notion.lw_db_id (Inhalte)
    private readonly coursesDatabaseId?: string, // output.notion.courses_db_id (Kurse)
    private readonly meetingDatabaseId?: string, // output.notion.meeting_db_id (Transkripte)
  ) {}

  /**
   * Ruft (gecacht) das Property-Schema einer Notion-DB ab: Property-Name ->
   * Notion-Property-Typ. Wirft bei Fehlschlag weiter — `resolveSchema` regelt
   * die Fallback-Strategie für die Caller.
   */
  private async getDatabaseSchema(databaseId: string): Promise<Map<string, string>> {
    const cached = this.schemaCache.get(databaseId);
    if (cached) return cached;

    const db = await this.client.retrieveDatabase(databaseId);
    const rawProperties = db.properties as Record<string, Record<string, unknown>> | undefined;
    const schema = new Map<string, string>();
    if (rawProperties) {
      for (const [name, prop] of Object.entries(rawProperties)) {
        if (typeof prop?.type === 'string') schema.set(name, prop.type);
      }
    }
    this.schemaCache.set(databaseId, schema);
    return schema;
  }

  /**
   * Löst das Schema einer DB auf, ohne bei Fehlschlag zu werfen. `schema:
   * null` signalisiert den Callern, dass sie auf Filterung verzichten sollen
   * (siehe applySchemaFilter) statt versehentlich alle Properties zu droppen.
   */
  private async resolveSchema(databaseId: string): Promise<{ schema: Map<string, string> | null; error?: string }> {
    try {
      return { schema: await this.getDatabaseSchema(databaseId) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[notion-adapter] Schema-Abruf für DB ${databaseId} fehlgeschlagen, verwende Fallback 'Name' + ungefiltert:`, err);
      appendLog('WARN', `[notion-adapter] Schema-Abruf für DB ${databaseId} fehlgeschlagen: ${message}`);
      return { schema: null, error: message };
    }
  }

  private titleFromSchema(schema: Map<string, string> | null): string {
    if (schema) {
      for (const [name, type] of schema) {
        if (type === 'title') return name;
      }
    }
    return 'Name';
  }

  private async getTitlePropertyName(databaseId: string): Promise<string> {
    const { schema } = await this.resolveSchema(databaseId);
    return this.titleFromSchema(schema);
  }

  /**
   * Filtert `desired` gegen das tatsächliche Schema der Ziel-DB. Properties,
   * die dort nicht existieren, werden entfernt (Notion lehnt sonst den
   * gesamten createPage-Request per HTTP 400 ab) und als Klartext-Warnung
   * gesammelt. Die Title-Property bleibt immer erhalten. Ist `schema` null
   * (Abruf-Fehler statt leerem Schema), wird NICHT gefiltert — sonst
   * entstünden leere Metadaten-Seiten bei z. B. einem API-Timeout.
   */
  private applySchemaFilter(
    schema: Map<string, string> | null,
    schemaError: string | undefined,
    titlePropName: string,
    desired: Record<string, unknown>,
  ): { properties: Record<string, unknown>; warnings: string[] } {
    if (!schema) {
      return {
        properties: desired,
        warnings: schemaError
          ? [`Schema-Abruf fehlgeschlagen (${schemaError}), Properties wurden ungefiltert gesendet.`]
          : [],
      };
    }

    const properties: Record<string, unknown> = {};
    const warnings: string[] = [];
    for (const [name, value] of Object.entries(desired)) {
      if (name === titlePropName || schema.has(name)) {
        properties[name] = value;
      } else {
        const warning = `Property '${name}' existiert nicht in Ziel-DB und wurde übersprungen.`;
        warnings.push(warning);
        console.warn(`[notion-adapter] ${warning}`);
        appendLog('WARN', `[notion-adapter] ${warning}`);
      }
    }
    return { properties, warnings };
  }

  private async getOrCreateCoursePage(course: { courseId: number; fullname: string }): Promise<string> {
    const response = await this.client.search({
      query: course.fullname,
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    });

    const results = (response as { results?: unknown[] }).results || [];
    for (const p of results) {
      const page = p as Record<string, unknown>;
      const parent = page.parent as Record<string, unknown> | undefined;
      const databaseId = parent?.database_id;
      if (
        parent?.type === 'database_id' &&
        typeof databaseId === 'string' &&
        databaseId.replace(/-/g, '') === this.coursesDatabaseId!.replace(/-/g, '') &&
        typeof page.id === 'string'
      ) {
        return page.id;
      }
    }

    const titlePropName = await this.getTitlePropertyName(this.coursesDatabaseId!);
    const newPage = await this.client.createPage({
      parent: { database_id: this.coursesDatabaseId! },
      properties: {
        [titlePropName]: titleProperty(course.fullname),
      },
    });
    return extractPageId(newPage);
  }

  async placeFile(input: PlaceFileInput): Promise<PlaceFileResult> {
    const hash = sha256(input.bytes);
    const today = new Date().toISOString().slice(0, 10);

    const { schema, error: schemaError } = await this.resolveSchema(this.databaseId);
    const titlePropName = this.titleFromSchema(schema);
    const desired: Record<string, unknown> = {
      [titlePropName]: titleProperty(input.filename),
      Semester: richTextProperty(input.course.semester ?? ''),
      Sektion: richTextProperty(input.sectionName ?? ''),
      Typ: richTextProperty(extname(input.filename)),
      Datum: dateProperty(today),
    };

    if (this.coursesDatabaseId) {
      try {
        const coursePageId = await this.getOrCreateCoursePage(input.course);
        desired['Kurs'] = { relation: [{ id: coursePageId }] };
      } catch (err) {
        console.warn(`[notion-adapter] Kursverknüpfung fehlgeschlagen, weiche auf Text aus:`, err);
        desired['Kurs'] = richTextProperty(input.course.fullname);
      }
    } else {
      desired['Kurs'] = richTextProperty(input.course.fullname);
    }

    const { properties, warnings } = this.applySchemaFilter(schema, schemaError, titlePropName, desired);

    const response = await this.client.createPage({
      parent: { database_id: this.databaseId },
      properties,
    });

    return {
      adapter: 'notion',
      duplicate: false,
      remoteRef: extractPageId(response),
      hash,
      sizeBytes: input.bytes.byteLength,
      filename: input.filename,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  async placeTranscript(input: PlaceTranscriptInput): Promise<PlaceTranscriptResult> {
    const targetDbId = this.meetingDatabaseId || this.databaseId;
    const { schema, error: schemaError } = await this.resolveSchema(targetDbId);
    const titlePropName = this.titleFromSchema(schema);
    const desired: Record<string, unknown> = {
      [titlePropName]: titleProperty(input.title ?? 'Aufzeichnung'),
      Modell: richTextProperty(input.model ?? ''),
      'Dauer (s)': numberProperty(input.durationSeconds ?? null),
    };
    if (input.recordingDate) {
      desired.Datum = dateProperty(input.recordingDate);
    }

    if (this.coursesDatabaseId) {
      try {
        const coursePageId = await this.getOrCreateCoursePage(input.course);
        desired['Kurs'] = { relation: [{ id: coursePageId }] };
      } catch (err) {
        console.warn(`[notion-adapter] Kursverknüpfung für Transkript fehlgeschlagen, weiche auf Text aus:`, err);
        desired['Kurs'] = richTextProperty(input.course.fullname);
      }
    } else {
      desired['Kurs'] = richTextProperty(input.course.fullname);
    }

    const { properties, warnings } = this.applySchemaFilter(schema, schemaError, titlePropName, desired);

    const response = await this.client.createPage({
      parent: { database_id: targetDbId },
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

    return { adapter: 'notion', remoteRef: pageId, ...(warnings.length > 0 ? { warnings } : {}) };
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

  const coursesDatabaseId = repos.settings.get(OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY) || undefined;
  const meetingDatabaseId = repos.settings.get(OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY) || undefined;

  return new NotionAdapter(new NotionClient(token), databaseId, coursesDatabaseId, meetingDatabaseId);
}
