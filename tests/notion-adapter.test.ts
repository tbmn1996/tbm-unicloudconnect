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
  URL: 'url',
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
  queryDatabaseImpl?: (databaseId: string, params: any) => any;
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
  const queryDatabaseCalls: Array<{ databaseId: string; params: any }> = [];
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
    queryDatabase: async (databaseId: string, params: any) => {
      queryDatabaseCalls.push({ databaseId, params });
      if (opts?.queryDatabaseImpl) return opts.queryDatabaseImpl(databaseId, params);
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
    queryDatabaseCalls,
    retrieveDatabaseCalls,
  };
}

const course: OutputCourseInfo = {
  courseId: 1,
  fullname: 'Wirtschaftsinformatik Grundlagen',
  semester: 'SoSe 2026',
  courseUrl: 'https://www.uni-muenster.de/LearnWeb/learnweb2/course/view.php?id=91465',
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

test('placeFile findet Kursseite per URL in coursesDatabaseId und verlinkt Kurs property via relation', async () => {
  const { client, createPageCalls, queryDatabaseCalls } = makeFakeClient({
    pageId: 'file-page-1',
    queryDatabaseImpl: () => ({ object: 'list', results: [{ object: 'page', id: 'existing-course-page-77' }] }),
  });

  const adapter = new NotionAdapter(client, 'db-files', 'db-courses-uuid');

  const input: PlaceFileInput = {
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  };

  const result = await adapter.placeFile(input);

  assert.equal(queryDatabaseCalls.length, 1);
  const queryCall = queryDatabaseCalls[0];
  assert.ok(queryCall);
  assert.equal(queryCall.databaseId, 'db-courses-uuid');
  assert.deepEqual(queryCall.params, {
    filter: { property: 'URL', url: { equals: course.courseUrl } },
    page_size: 1,
  });
  assert.equal(createPageCalls.length, 1);
  assert.equal(createPageCalls[0].parent.database_id, 'db-files');
  assert.deepEqual(createPageCalls[0].properties.Kurs, { relation: [{ id: 'existing-course-page-77' }] });
  assert.equal(result.remoteRef, 'file-page-1');
});

test('placeFile creates course page in coursesDatabaseId if not found and links Kurs property via relation', async () => {
  const { client, createPageCalls, queryDatabaseCalls } = makeFakeClient({
    pageId: 'file-page-1',
    queryDatabaseImpl: () => ({ object: 'list', results: [] }),
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

  assert.equal(queryDatabaseCalls.length, 2);
  assert.equal(createPageCalls.length, 2);
  assert.equal(createPageCalls[0].parent.database_id, 'db-courses-uuid');
  assert.deepEqual(createPageCalls[0].properties.Name, { title: [{ text: { content: 'Wirtschaftsinformatik Grundlagen' } }] });
  assert.deepEqual(createPageCalls[0].properties.URL, { url: course.courseUrl });
  assert.equal(createPageCalls[1].parent.database_id, 'db-files');
  assert.deepEqual(createPageCalls[1].properties.Kurs, { relation: [{ id: 'new-course-page-999' }] });
});

test('placeFile nutzt exakten Title-Fallback, wenn URL keinen Treffer liefert', async () => {
  const { client, createPageCalls, queryDatabaseCalls } = makeFakeClient({
    pageId: 'file-page-1',
    queryDatabaseImpl: (_databaseId, params) => {
      if (params.filter?.title?.equals === course.fullname) {
        return { object: 'list', results: [{ object: 'page', id: 'title-course-page-88' }] };
      }
      return { object: 'list', results: [] };
    },
  });

  const adapter = new NotionAdapter(client, 'db-files', 'db-courses-uuid');

  await adapter.placeFile({
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  });

  assert.equal(queryDatabaseCalls.length, 2);
  const titleQueryCall = queryDatabaseCalls[1];
  assert.ok(titleQueryCall);
  assert.deepEqual(titleQueryCall.params, {
    filter: { property: 'Name', title: { equals: course.fullname } },
    page_size: 1,
  });
  assert.equal(createPageCalls.length, 1);
  assert.deepEqual(createPageCalls[0].properties.Kurs, { relation: [{ id: 'title-course-page-88' }] });
});

test('placeFile überspringt URL-Lookup, wenn die Kurs-DB keine URL-Property hat', async () => {
  const { client, queryDatabaseCalls } = makeFakeClient({
    schema: { Name: 'title', Kurs: 'rich_text', Semester: 'rich_text', Sektion: 'rich_text', Typ: 'rich_text', Datum: 'date' },
    queryDatabaseImpl: () => ({ object: 'list', results: [{ object: 'page', id: 'title-only-page-1' }] }),
  });
  const adapter = new NotionAdapter(client, 'db-files', 'db-courses-uuid');

  await adapter.placeFile({
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  });

  assert.equal(queryDatabaseCalls.length, 1);
  const titleOnlyQueryCall = queryDatabaseCalls[0];
  assert.ok(titleOnlyQueryCall);
  assert.deepEqual(titleOnlyQueryCall.params, {
    filter: { property: 'Name', title: { equals: course.fullname } },
    page_size: 1,
  });
});

test('placeFile meldet fehlgeschlagenen Kurs-DB-Schema-Abruf statt falscher Relation', async () => {
  const { client, createPageCalls, queryDatabaseCalls } = makeFakeClient({
    pageId: 'file-page-schema-fallback',
    schemaError: new Error('Notion API Timeout'),
  });
  const adapter = new NotionAdapter(client, 'db-files', 'db-courses-uuid');

  const result = await adapter.placeFile({
    course,
    sectionName: 'Woche 3',
    filename: 'folien.pdf',
    bytes: new TextEncoder().encode('hallo welt'),
  });

  assert.equal(queryDatabaseCalls.length, 0);
  assert.deepEqual(createPageCalls[0].properties.Kurs, { rich_text: [{ text: { content: course.fullname } }] });
  assert.ok(result.warnings?.some((warning) => warning.includes('Schema-Abruf fehlgeschlagen')));
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
