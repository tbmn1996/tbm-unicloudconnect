import assert from 'node:assert/strict';
import test from 'node:test';

import { OutputRouter } from '../src/output-adapters/router';
import type {
  OutputTarget,
  PlaceFileInput,
  PlaceFileResult,
  PlaceTranscriptInput,
  PlaceTranscriptResult,
} from '../src/output-adapters/types';

/** Baut einen minimalen, aber vertragskonformen PlaceFileInput für Tests. */
function makeFileInput(): PlaceFileInput {
  return {
    course: { courseId: 1, fullname: 'Testkurs', semester: 'SoSe26', courseUrl: null },
    sectionName: 'Vorlesungen',
    filename: 'folie.pdf',
    bytes: new Uint8Array([1, 2, 3]),
  };
}

/** Baut einen minimalen, aber vertragskonformen PlaceTranscriptInput für Tests. */
function makeTranscriptInput(): PlaceTranscriptInput {
  return {
    course: { courseId: 1, fullname: 'Testkurs', semester: 'SoSe26', courseUrl: null },
    title: 'Vorlesung 1',
    recordingDate: '2026-06-01',
    model: 'whisper',
    durationSeconds: 1200,
    markdown: '# Transkript',
    alreadyWrittenLocalPath: '/tmp/transkript.md',
  };
}

/** Fake-OutputTarget: zeichnet Aufrufe auf, antwortet mit fixem Result oder wirft optional. */
function makeFakeTarget(
  kind: 'filesystem' | 'notion',
  options: {
    throwOnFile?: Error;
    throwOnTranscript?: Error;
    /** Simuliert einen Adapter, der Properties gegen das DB-Schema gefiltert hat (Erfolg, aber mit Warnungen). */
    fileWarnings?: string[];
    transcriptWarnings?: string[];
  } = {},
): OutputTarget & { placeFileCalls: PlaceFileInput[]; placeTranscriptCalls: PlaceTranscriptInput[] } {
  const placeFileCalls: PlaceFileInput[] = [];
  const placeTranscriptCalls: PlaceTranscriptInput[] = [];
  return {
    kind,
    placeFileCalls,
    placeTranscriptCalls,
    async placeFile(input: PlaceFileInput): Promise<PlaceFileResult> {
      placeFileCalls.push(input);
      if (options.throwOnFile) throw options.throwOnFile;
      return {
        adapter: kind,
        duplicate: false,
        hash: 'hash-123',
        sizeBytes: input.bytes.byteLength,
        filename: input.filename,
        ...(kind === 'filesystem' ? { relativePath: 'kurs/folie.pdf' } : { remoteRef: 'page-id-1' }),
        ...(options.fileWarnings ? { warnings: options.fileWarnings } : {}),
      };
    },
    async placeTranscript(input: PlaceTranscriptInput): Promise<PlaceTranscriptResult> {
      placeTranscriptCalls.push(input);
      if (options.throwOnTranscript) throw options.throwOnTranscript;
      return {
        adapter: kind,
        ...(kind === 'filesystem' ? { relativePath: 'kurs/transkript.md' } : { remoteRef: 'page-id-2' }),
        ...(options.transcriptWarnings ? { warnings: options.transcriptWarnings } : {}),
      };
    },
  };
}

/** Settings-Stub: liefert einen fest konfigurierten Wert für 'output.adapter'. */
function makeSettings(mode: string | null): { get(key: string): string | null } {
  return { get: () => mode };
}

// --- placeFile ---

test('placeFile: settings.get liefert null -> nur Filesystem-Adapter läuft, notion undefined, keine warnings', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings(null));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(notion.placeFileCalls.length, 0);
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.filesystem);
  assert.equal(result.filesystem.adapter, 'filesystem');
  assert.equal(result.notionStatus, 'skipped');
  assert.equal(result.notionError, undefined);
});

test('placeFile: settings.get liefert "filesystem" -> identisch zum null-Fall', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('filesystem'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(notion.placeFileCalls.length, 0);
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeFile: unbekannter settings-Wert fällt auf Filesystem zurück', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('kaputt'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(notion.placeFileCalls.length, 0);
  assert.equal(result.filesystem?.adapter, 'filesystem');
  assert.equal(result.notionStatus, 'skipped');
});

test('placeFile: settings.get liefert "notion" -> nur Notion-Adapter läuft, filesystem ist undefined', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('notion'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 0);
  assert.equal(notion.placeFileCalls.length, 1);
  assert.equal(result.filesystem, undefined);
  assert.ok(result.notion);
  assert.equal(result.notion?.adapter, 'notion');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'ok');
});

test('placeFile: settings.get liefert "both" -> beide Adapter laufen, beide Ergebnisse vorhanden', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(notion.placeFileCalls.length, 1);
  assert.ok(result.filesystem);
  assert.ok(result.notion);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'ok');
});

test('placeFile: "both" mit Notion-Adapter-Warnings (z. B. gegen Schema gefilterte Property) -> notionStatus="warnings", Warnings werden gemerged', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion', { fileWarnings: ["Property 'Modell' existiert nicht in Ziel-DB und wurde übersprungen."] });
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput());

  assert.ok(result.notion);
  assert.equal(result.notionStatus, 'warnings');
  assert.equal(result.notionError, undefined);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], "Property 'Modell' existiert nicht in Ziel-DB und wurde übersprungen.");
});

test('placeFile: "both" mit Notion-Adapter-Error -> filesystem-Ergebnis bleibt korrekt, genau 1 warning, kein Throw', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion', { throwOnFile: new Error('API down') });
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput());

  assert.ok(result.filesystem);
  assert.equal(result.filesystem.adapter, 'filesystem');
  assert.equal(result.filesystem.relativePath, 'kurs/folie.pdf');
  assert.equal(result.notion, undefined);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], 'Notion-Push fehlgeschlagen: API down');
  assert.equal(result.notionStatus, 'failed');
  assert.equal(result.notionError, 'API down');
});

test('placeFile: "notion" aber adapters.notion ist undefined -> wirft Error', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('notion'));

  await assert.rejects(async () => {
    await router.placeFile(makeFileInput());
  }, /Notion-Adapter ist nicht initialisiert/);
});

test('placeFile: "both" aber adapters.notion ist undefined -> Filesystem läuft, Notion wird übersprungen', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(result.filesystem?.adapter, 'filesystem');
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeFile: "notion" mit skipNotion:true -> Notion-Adapter wird nicht aufgerufen, notionStatus="skipped"', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('notion'));

  const result = await router.placeFile(makeFileInput(), { skipNotion: true });

  assert.equal(filesystem.placeFileCalls.length, 0);
  assert.equal(notion.placeFileCalls.length, 0);
  assert.equal(result.filesystem, undefined);
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeFile: "both" mit skipNotion:true -> Filesystem läuft trotzdem, Notion wird übersprungen', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput(), { skipNotion: true });

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(notion.placeFileCalls.length, 0);
  assert.equal(result.filesystem?.adapter, 'filesystem');
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeFile: "notion" mit skipNotion:true und adapters.notion ist undefined -> wirft NICHT', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('notion'));

  const result = await router.placeFile(makeFileInput(), { skipNotion: true });

  assert.equal(filesystem.placeFileCalls.length, 0);
  assert.equal(result.filesystem, undefined);
  assert.equal(result.notion, undefined);
  assert.equal(result.notionStatus, 'skipped');
});

// --- placeTranscript ---

test('placeTranscript: settings.get liefert null -> nur Filesystem-Adapter läuft, notion undefined, keine warnings', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings(null));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.equal(filesystem.placeTranscriptCalls.length, 1);
  assert.equal(notion.placeTranscriptCalls.length, 0);
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeTranscript: settings.get liefert "notion" -> nur Notion-Adapter läuft, filesystem ist undefined', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('notion'));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.equal(filesystem.placeTranscriptCalls.length, 0);
  assert.equal(notion.placeTranscriptCalls.length, 1);
  assert.equal(result.filesystem, undefined);
  assert.ok(result.notion);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'ok');
});

test('placeTranscript: settings.get liefert "both" -> beide Adapter laufen, beide Ergebnisse vorhanden', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.equal(filesystem.placeTranscriptCalls.length, 1);
  assert.equal(notion.placeTranscriptCalls.length, 1);
  assert.ok(result.filesystem);
  assert.ok(result.notion);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'ok');
});

test('placeTranscript: "both" mit Notion-Adapter-Warnings (z. B. gegen Schema gefilterte Property) -> notionStatus="warnings"', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion', {
    transcriptWarnings: [
      "Property 'Modell' existiert nicht in Ziel-DB und wurde übersprungen.",
      "Property 'Dauer (s)' existiert nicht in Ziel-DB und wurde übersprungen.",
    ],
  });
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.ok(result.notion);
  assert.equal(result.notionStatus, 'warnings');
  assert.equal(result.notionError, undefined);
  assert.equal(result.warnings.length, 2);
});

test('placeTranscript: "both" mit Notion-Adapter-Error -> filesystem-Ergebnis bleibt korrekt, genau 1 warning, kein Throw', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion', { throwOnTranscript: new Error('Timeout') });
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.ok(result.filesystem);
  assert.equal(result.filesystem.adapter, 'filesystem');
  assert.equal(result.filesystem.relativePath, 'kurs/transkript.md');
  assert.equal(result.notion, undefined);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], 'Notion-Push fehlgeschlagen: Timeout');
  assert.equal(result.notionStatus, 'failed');
  assert.equal(result.notionError, 'Timeout');
});

test('placeTranscript: "notion" aber adapters.notion ist undefined -> wirft Error', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('notion'));

  await assert.rejects(async () => {
    await router.placeTranscript(makeTranscriptInput());
  }, /Notion-Adapter ist nicht initialisiert/);
});

test('placeTranscript: "both" aber adapters.notion ist undefined -> Filesystem läuft, Notion wird übersprungen', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('both'));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.equal(filesystem.placeTranscriptCalls.length, 1);
  assert.equal(result.filesystem?.adapter, 'filesystem');
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeTranscript: "notion" mit skipNotion:true -> Notion-Adapter wird nicht aufgerufen, notionStatus="skipped"', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('notion'));

  const result = await router.placeTranscript(makeTranscriptInput(), { skipNotion: true });

  assert.equal(filesystem.placeTranscriptCalls.length, 0);
  assert.equal(notion.placeTranscriptCalls.length, 0);
  assert.equal(result.filesystem, undefined);
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeTranscript: "both" mit skipNotion:true -> Filesystem läuft trotzdem, Notion wird übersprungen', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeTranscript(makeTranscriptInput(), { skipNotion: true });

  assert.equal(filesystem.placeTranscriptCalls.length, 1);
  assert.equal(notion.placeTranscriptCalls.length, 0);
  assert.equal(result.filesystem?.adapter, 'filesystem');
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notionStatus, 'skipped');
});

test('placeTranscript: "notion" mit skipNotion:true und adapters.notion ist undefined -> wirft NICHT', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('notion'));

  const result = await router.placeTranscript(makeTranscriptInput(), { skipNotion: true });

  assert.equal(filesystem.placeTranscriptCalls.length, 0);
  assert.equal(result.filesystem, undefined);
  assert.equal(result.notion, undefined);
  assert.equal(result.notionStatus, 'skipped');
});
