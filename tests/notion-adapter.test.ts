/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionAdapter, createNotionAdapter } from '../src/output-adapters/notion-adapter';
import { NOTION_MAX_BLOCKS_PER_REQUEST } from '../src/notion-core/constants';
import type { NotionClient } from '../src/notion-core/client';
import type { OutputCourseInfo, PlaceFileInput, PlaceTranscriptInput } from '../src/output-adapters/types';

/** Baut ein Fake-NotionClient-Objekt, das Aufrufe aufzeichnet (kein echter Netzwerkzugriff). */
function makeFakeClient(opts?: { pageId?: string }) {
  const pageId = opts?.pageId ?? 'page-123';
  const createPageCalls: any[] = [];
  const appendBlockChildrenCalls: any[] = [];

  const client = {
    createPage: async (body: any) => {
      createPageCalls.push(body);
      return { object: 'page', id: pageId };
    },
    appendBlockChildren: async (blockId: string, children: unknown[]) => {
      appendBlockChildrenCalls.push({ blockId, children });
      return { object: 'list', results: [] };
    },
  };

  return { client: client as unknown as NotionClient, createPageCalls, appendBlockChildrenCalls };
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
