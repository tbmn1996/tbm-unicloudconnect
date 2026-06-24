/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionAdapter, createNotionAdapter } from '../src/output-adapters/notion-adapter';
import { NOTION_MAX_BLOCKS_PER_REQUEST } from '../src/notion-core/constants';
import type { NotionClient } from '../src/notion-core/client';
import type { OutputCourseInfo, PlaceFileInput, PlaceTranscriptInput } from '../src/output-adapters/types';

/**
 * Default-Schema für den Fake-Client: deckt ALLE Properties ab, die die
 * bestehenden (verhaltens-erhaltenden) Tests unten in `createPage`-Calls
 * erwarten. So bleibt das Standardverhalten "ungefiltert", solange ein Test
 * nicht bewusst ein restriktiveres `schema` übergibt (siehe Filter-Tests).
 */
const DEFAULT_SCHEMA: Record<string, string> = {
  Name: 'title',
  Kurs: 'rich_text',
  Semester: 'rich_text',
  Sektion: 'rich_text',
  Typ: 'rich_text',
  Datum: 'date',
  Modell: 'rich_text',
  'Dauer (s)': 'number',
};

/** Baut ein Fake-NotionClient-Objekt, das Aufrufe aufzeichnet (kein echter Netzwerkzugriff). */
function makeFakeClient(opts?: {
  pageId?: string;
  searchResult?: any;
  newPageId?: string;
  /** Property-Name -> Notion-Property-Typ; Default deckt alle in Tests genutzten Properties ab. */
  schema?: Record<string, string>;
  /** Simuliert einen fehlschlagenden Schema-Abruf (z. B. API-Timeout). */
  schemaError?: Error;
}) {
  const pageId = opts?.pageId ?? 'page-123';
  const newPageId = opts?.newPageId ?? 'new-course-page-999';
  const createPageCalls: any[] = [];
  const appendBlockChildrenCalls: any[] = [];
  const searchCalls: any[] = [];
  const retrieveDatabaseCalls: string[] = [];
  const schema = opts?.schema ?? DEFAULT_SCHEMA;

  const client = {
    createPage: async (body: any) => {
      createPageCalls.push(body);
      if (body.parent?.database_id && body.parent.database_id.includes('course')) {
        return { object: 'page', id: newPageId };
      }
      return { object: 'page', id: pageId };
    },
    appendBlockChildren: async (blockId: string, children: unknown[]) => {
      appendBlockChildrenCalls.push({ blockId, children });
      return { object: 'list', results: [] };
    },
    search: async (params: any) => {
      searchCalls.push(params);
      if (opts?.searchResult !== undefined) {
        return opts.searchResult;
      }
      return { object: 'list', results: [] };
    },
    retrieveDatabase: async (databaseId: string) => {
      retrieveDatabaseCalls.push(databaseId);
      if (opts?.schemaError) throw opts.schemaError;
      const properties: Record<string, { type: string }> = {};
      for (const [name, type] of Object.entries(schema)) properties[name] = { type };
      return { object: 'database', properties };
    },
  };

  return {
    client: client as unknown as NotionClient,
    createPageCalls,
    appendBlockChildrenCalls,
    searchCalls,
    retrieveDatabaseCalls,
  };
}

const course: OutputCourseInfo = {
  courseId: 1,
  fullname: 'Wirtschaftsinformatik Grundlagen',
  semester: 'SoSe 2026',
};

test('placeFile ruft createPage mit korrektem database_id und Properties auf und liefert remoteRef', async () => {
  const { client, createPageCalls } = makeFakeClient({ pageId: 'file-page-1' });
  const adapter = new NotionAdapter(client, 'db-abc');

  const input: PlaceFileInput = {
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  };

  const result = await adapter.placeFile(input);

  assert.equal(createPageCalls.length, 1);
  const call = createPageCalls[0];
  assert.equal(call.parent.database_id, 'db-abc');
  assert.deepEqual(call.properties.Name, { title: [{ text: { content: 'folien.pdf' } }] });
  assert.deepEqual(call.properties.Kurs, { rich_text: [{ text: { content: 'Wirtschaftsinformatik Grundlagen' } }] });
  assert.deepEqual(call.properties.Semester, { rich_text: [{ text: { content: 'SoSe 2026' } }] });
  assert.deepEqual(call.properties.Sektion, { rich_text: [{ text: { content: 'Woche 3' } }] });
  assert.deepEqual(call.properties.Typ, { rich_text: [{ text: { content: '.pdf' } }] });
  assert.ok(call.properties.Datum.date.start.match(/^\d{4}-\d{2}-\d{2}$/));

  assert.equal(result.adapter, 'notion');
  assert.equal(result.duplicate, false);
  assert.equal(result.remoteRef, 'file-page-1');
  assert.equal(result.filename, 'folien.pdf');
  assert.equal(result.sizeBytes, input.bytes.byteLength);
  assert.equal(typeof result.hash, 'string');
  assert.equal(result.hash.length, 64); // SHA-256 Hex-Länge
});

test('placeTranscript ruft createPage und danach appendBlockChildren mit der richtigen pageId auf; Markdown wird gesplittet', async () => {
  const { client, createPageCalls, appendBlockChildrenCalls } = makeFakeClient({ pageId: 'transcript-page-1' });
  const adapter = new NotionAdapter(client, 'db-xyz');

  const input: PlaceTranscriptInput = {
    course,
    title: 'Vorlesung 5',
    recordingDate: '2026-06-10',
    model: 'whisper-large-v3',
    durationSeconds: 3600,
    markdown: 'Erster Absatz.\n\nZweiter Absatz.\n\nDritter Absatz.',
    alreadyWrittenLocalPath: '/tmp/irrelevant.md',
  };

  const result = await adapter.placeTranscript(input);

  assert.equal(createPageCalls.length, 1);
  const pageCall = createPageCalls[0];
  assert.equal(pageCall.parent.database_id, 'db-xyz');
  assert.deepEqual(pageCall.properties.Name, { title: [{ text: { content: 'Vorlesung 5' } }] });
  assert.deepEqual(pageCall.properties.Modell, { rich_text: [{ text: { content: 'whisper-large-v3' } }] });
  assert.deepEqual(pageCall.properties.Datum, { date: { start: '2026-06-10' } });
  assert.deepEqual(pageCall.properties['Dauer (s)'], { number: 3600 });

  assert.equal(appendBlockChildrenCalls.length, 1);
  const appendCall = appendBlockChildrenCalls[0];
  assert.equal(appendCall.blockId, 'transcript-page-1');
  assert.equal(appendCall.children.length, 3);
  assert.equal(appendCall.children[0].type, 'paragraph');
  assert.equal(appendCall.children[0].paragraph.rich_text[0].text.content, 'Erster Absatz.');
  assert.equal(appendCall.children[1].paragraph.rich_text[0].text.content, 'Zweiter Absatz.');
  assert.equal(appendCall.children[2].paragraph.rich_text[0].text.content, 'Dritter Absatz.');

  assert.equal(result.adapter, 'notion');
  assert.equal(result.remoteRef, 'transcript-page-1');
});

test('placeTranscript begrenzt sehr langes Markdown auf NOTION_MAX_BLOCKS_PER_REQUEST Blocks', async () => {
  const { client, appendBlockChildrenCalls } = makeFakeClient({ pageId: 'transcript-page-2' });
  const adapter = new NotionAdapter(client, 'db-xyz');

  // Deutlich mehr Absätze erzeugen, als pro Request erlaubt sind.
  const paragraphCount = NOTION_MAX_BLOCKS_PER_REQUEST + 50;
  const markdown = Array.from({ length: paragraphCount }, (_, i) => `Absatz Nummer ${i}.`).join('\n\n');

  const input: PlaceTranscriptInput = {
    course,
    title: 'Langes Transkript',
    recordingDate: null,
    model: null,
    durationSeconds: null,
    markdown,
    alreadyWrittenLocalPath: '/tmp/irrelevant.md',
  };

  await adapter.placeTranscript(input);

  assert.equal(appendBlockChildrenCalls.length, 1);
  assert.equal(appendBlockChildrenCalls[0].children.length, NOTION_MAX_BLOCKS_PER_REQUEST);
});

test('createNotionAdapter gibt null zurück, wenn credentials.get("notion") null liefert', async () => {
  const repos = {
    credentials: {
      get: (_provider?: string) => null,
    },
    settings: {
      get: (_key: string) => 'sollte-nicht-erreicht-werden',
    },
  };

  const adapter = await createNotionAdapter(repos);
  assert.equal(adapter, null);
});

test('placeTranscript routes to meetingDatabaseId if configured', async () => {
  const { client, createPageCalls } = makeFakeClient({ pageId: 'transcript-page-1' });
  const adapter = new NotionAdapter(client, 'db-xyz', undefined, 'db-meetings');

  const input: PlaceTranscriptInput = {
    course,
    title: 'Vorlesung 5',
    recordingDate: '2026-06-10',
    model: 'whisper-large-v3',
    durationSeconds: 3600,
    markdown: 'Erster Absatz.',
    alreadyWrittenLocalPath: '/tmp/irrelevant.md',
  };

  await adapter.placeTranscript(input);

  assert.equal(createPageCalls.length, 1);
  assert.equal(createPageCalls[0].parent.database_id, 'db-meetings');
});

test('placeFile checks or creates course page in coursesDatabaseId if configured and links Kurs property via relation', async () => {
  const searchResult = {
    object: 'list',
    results: [
      {
        object: 'page',
        id: 'existing-course-page-77',
        parent: {
          type: 'database_id',
          database_id: 'db-courses-uuid',
        },
      },
    ],
  };

  const { client, createPageCalls, searchCalls } = makeFakeClient({
    pageId: 'file-page-1',
    searchResult,
  });

  const adapter = new NotionAdapter(client, 'db-files', 'db-courses-uuid');

  const input: PlaceFileInput = {
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  };

  const result = await adapter.placeFile(input);

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].query, 'Wirtschaftsinformatik Grundlagen');
  assert.equal(createPageCalls.length, 1);
  assert.equal(createPageCalls[0].parent.database_id, 'db-files');
  assert.deepEqual(createPageCalls[0].properties.Kurs, { relation: [{ id: 'existing-course-page-77' }] });
  assert.equal(result.remoteRef, 'file-page-1');
});

test('placeFile creates course page in coursesDatabaseId if not found and links Kurs property via relation', async () => {
  const { client, createPageCalls, searchCalls } = makeFakeClient({
    pageId: 'file-page-1',
    searchResult: { object: 'list', results: [] },
    newPageId: 'new-course-page-999',
  });

  const adapter = new NotionAdapter(client, 'db-files', 'db-courses-uuid');

  const input: PlaceFileInput = {
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  };

  await adapter.placeFile(input);

  assert.equal(searchCalls.length, 1);
  assert.equal(createPageCalls.length, 2);
  assert.equal(createPageCalls[0].parent.database_id, 'db-courses-uuid');
  assert.deepEqual(createPageCalls[0].properties.Name, { title: [{ text: { content: 'Wirtschaftsinformatik Grundlagen' } }] });
  assert.equal(createPageCalls[1].parent.database_id, 'db-files');
  assert.deepEqual(createPageCalls[1].properties.Kurs, { relation: [{ id: 'new-course-page-999' }] });
});

// --- Schema-Awareness (Notion-Push-Fix: Modell/Dauer (s) existierten nicht in der echten Meeting-DB) ---

test('placeTranscript filtert Properties, die im DB-Schema nicht existieren, und meldet eine Warnung pro Property', async () => {
  // Schema ohne 'Modell' und 'Dauer (s)' simuliert exakt die echte Meeting-DB aus dem Bugreport.
  const { client, createPageCalls, retrieveDatabaseCalls } = makeFakeClient({
    pageId: 'transcript-page-3',
    schema: { Name: 'title', Datum: 'date', Kurs: 'rich_text' },
  });
  const adapter = new NotionAdapter(client, 'db-xyz', undefined, 'db-meetings');

  const input: PlaceTranscriptInput = {
    course,
    title: 'Vorlesung 7',
    recordingDate: '2026-06-10',
    model: 'whisper-large-v3',
    durationSeconds: 3600,
    markdown: 'Erster Absatz.',
    alreadyWrittenLocalPath: '/tmp/irrelevant.md',
  };

  const result = await adapter.placeTranscript(input);

  assert.deepEqual(retrieveDatabaseCalls, ['db-meetings']);
  const properties = createPageCalls[0].properties;
  assert.ok(properties.Name, 'Title-Property muss trotz Filterung erhalten bleiben');
  assert.equal(properties.Modell, undefined, 'Modell ist nicht im Schema und muss gedroppt werden');
  assert.equal(properties['Dauer (s)'], undefined, "'Dauer (s)' ist nicht im Schema und muss gedroppt werden");
  assert.ok(properties.Datum, 'Datum ist im Schema und muss erhalten bleiben');

  assert.ok(result.warnings, 'Ergebnis muss Warnings über gedroppte Properties enthalten');
  assert.equal(result.warnings?.length, 2);
  assert.ok(result.warnings?.some((w) => w.includes("'Modell'")));
  assert.ok(result.warnings?.some((w) => w.includes("'Dauer (s)'")));
});

test('placeFile filtert Properties analog gegen das DB-Schema und meldet eine Warnung', async () => {
  const { client, createPageCalls } = makeFakeClient({
    pageId: 'file-page-9',
    schema: { Name: 'title', Kurs: 'rich_text', Datum: 'date' },
  });
  const adapter = new NotionAdapter(client, 'db-files');

  const input: PlaceFileInput = {
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  };

  const result = await adapter.placeFile(input);

  const properties = createPageCalls[0].properties;
  assert.equal(properties.Semester, undefined, 'Semester ist nicht im Schema und muss gedroppt werden');
  assert.equal(properties.Sektion, undefined, 'Sektion ist nicht im Schema und muss gedroppt werden');
  assert.equal(properties.Typ, undefined, "Typ ist nicht im Schema und muss gedroppt werden");
  assert.ok(properties.Name);
  assert.ok(properties.Kurs);

  assert.equal(result.warnings?.length, 3);
});

test('placeTranscript sendet Properties ungefiltert, wenn der Schema-Abruf fehlschlägt (kein Datenverlust bei API-Timeout)', async () => {
  const { client, createPageCalls } = makeFakeClient({
    pageId: 'transcript-page-4',
    schemaError: new Error('Notion API Timeout'),
  });
  const adapter = new NotionAdapter(client, 'db-xyz', undefined, 'db-meetings');

  const input: PlaceTranscriptInput = {
    course,
    title: 'Vorlesung 8',
    recordingDate: '2026-06-11',
    model: 'whisper-large-v3',
    durationSeconds: 1800,
    markdown: 'Inhalt.',
    alreadyWrittenLocalPath: '/tmp/irrelevant.md',
  };

  const result = await adapter.placeTranscript(input);

  const properties = createPageCalls[0].properties;
  // Fallback auf Title-Property 'Name', da die Schema-Erkennung denselben fehlgeschlagenen Abruf nutzt.
  assert.ok(properties.Name, "Title-Property-Fallback 'Name' muss trotz Schema-Fehler gesetzt sein");
  assert.deepEqual(properties.Modell, { rich_text: [{ text: { content: 'whisper-large-v3' } }] });
  assert.deepEqual(properties['Dauer (s)'], { number: 1800 });

  assert.equal(result.warnings?.length, 1);
  assert.ok(result.warnings?.[0]?.includes('Schema-Abruf fehlgeschlagen'));
});
