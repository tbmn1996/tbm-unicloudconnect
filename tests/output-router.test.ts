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
    course: { courseId: 1, fullname: 'Testkurs', semester: 'SoSe26' },
    sectionName: 'Vorlesungen',
    filename: 'folie.pdf',
    bytes: new Uint8Array([1, 2, 3]),
  };
}

/** Baut einen minimalen, aber vertragskonformen PlaceTranscriptInput für Tests. */
function makeTranscriptInput(): PlaceTranscriptInput {
  return {
    course: { courseId: 1, fullname: 'Testkurs', semester: 'SoSe26' },
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
  options: { throwOnFile?: Error; throwOnTranscript?: Error } = {},
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
      };
    },
    async placeTranscript(input: PlaceTranscriptInput): Promise<PlaceTranscriptResult> {
      placeTranscriptCalls.push(input);
      if (options.throwOnTranscript) throw options.throwOnTranscript;
      return {
        adapter: kind,
        ...(kind === 'filesystem' ? { relativePath: 'kurs/transkript.md' } : { remoteRef: 'page-id-2' }),
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
  assert.equal(result.filesystem.adapter, 'filesystem');
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
});

test('placeFile: settings.get liefert "notion" -> beide Adapter laufen (Filesystem trotzdem Pflicht), notion-Ergebnis vorhanden', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion');
  const router = new OutputRouter({ filesystem, notion }, makeSettings('notion'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(notion.placeFileCalls.length, 1);
  assert.ok(result.notion);
  assert.equal(result.notion?.adapter, 'notion');
  assert.deepEqual(result.warnings, []);
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
});

test('placeFile: "both" mit Notion-Adapter-Error -> filesystem-Ergebnis bleibt korrekt, genau 1 warning, kein Throw', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion', { throwOnFile: new Error('API down') });
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(result.filesystem.adapter, 'filesystem');
  assert.equal(result.filesystem.relativePath, 'kurs/folie.pdf');
  assert.equal(result.notion, undefined);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], 'Notion-Push fehlgeschlagen: API down');
});

test('placeFile: "both" aber adapters.notion ist undefined -> kein Crash, Notion-Leg übersprungen, keine warnings', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const router = new OutputRouter({ filesystem, notion: undefined }, makeSettings('both'));

  const result = await router.placeFile(makeFileInput());

  assert.equal(filesystem.placeFileCalls.length, 1);
  assert.equal(result.notion, undefined);
  assert.deepEqual(result.warnings, []);
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
});

test('placeTranscript: "both" mit Notion-Adapter-Error -> filesystem-Ergebnis bleibt korrekt, genau 1 warning, kein Throw', async () => {
  const filesystem = makeFakeTarget('filesystem');
  const notion = makeFakeTarget('notion', { throwOnTranscript: new Error('Timeout') });
  const router = new OutputRouter({ filesystem, notion }, makeSettings('both'));

  const result = await router.placeTranscript(makeTranscriptInput());

  assert.equal(result.filesystem.adapter, 'filesystem');
  assert.equal(result.filesystem.relativePath, 'kurs/transkript.md');
  assert.equal(result.notion, undefined);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0], 'Notion-Push fehlgeschlagen: Timeout');
});
