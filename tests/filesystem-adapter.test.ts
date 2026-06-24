import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { FilesystemAdapter } from '../src/output-adapters/filesystem-adapter';
import type { OutputCourseInfo } from '../src/output-adapters/types';

const course: OutputCourseInfo = {
  courseId: 1,
  fullname: 'Softwaretechnik',
  semester: 'SoSe 2026',
  courseUrl: null,
};

test('placeFile schreibt eine neue Datei in die lokale Bibliothek', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-fs-adapter-'));
  try {
    const adapter = new FilesystemAdapter(root);
    const result = await adapter.placeFile({
      course,
      sectionName: 'Woche 1',
      filename: 'Skript.pdf',
      bytes: Buffer.from('Inhalt'),
    });

    assert.equal(result.adapter, 'filesystem');
    assert.equal(result.duplicate, false);
    assert.equal(result.relativePath, join('SoSe 2026', 'Softwaretechnik', 'Woche 1', 'Skript.pdf'));
    assert.equal(result.filename, 'Skript.pdf');
    assert.equal(result.sizeBytes, Buffer.from('Inhalt').byteLength);
    assert.equal(typeof result.hash, 'string');
    assert.ok(result.hash.length > 0);

    const written = await readFile(join(root, result.relativePath!), 'utf8');
    assert.equal(written, 'Inhalt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('placeFile erkennt ein Duplikat über findExistingByHash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-fs-adapter-'));
  try {
    const adapter = new FilesystemAdapter(root);
    const first = await adapter.placeFile({
      course,
      sectionName: 'Woche 1',
      filename: 'Skript.pdf',
      bytes: Buffer.from('Inhalt'),
    });

    const second = await adapter.placeFile({
      course,
      sectionName: 'Woche 2',
      filename: 'Kopie.pdf',
      bytes: Buffer.from('Inhalt'),
      findExistingByHash: (hash) => (hash === first.hash ? { localPath: first.relativePath! } : null),
    });

    assert.equal(second.duplicate, true);
    assert.equal(second.relativePath, first.relativePath);
    assert.equal(second.hash, first.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('placeTranscript liefert nur den relativen Pfad ohne eigene I/O', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-fs-adapter-'));
  try {
    const adapter = new FilesystemAdapter(root);
    const alreadyWrittenLocalPath = join(root, 'SoSe 2026', 'Softwaretechnik', 'Aufzeichnung.md');

    const result = await adapter.placeTranscript({
      course,
      title: 'Vorlesung 1',
      recordingDate: '2026-04-01',
      model: 'whisper-large-v3',
      durationSeconds: 3600,
      markdown: '# Vorlesung 1',
      alreadyWrittenLocalPath,
    });

    assert.equal(result.adapter, 'filesystem');
    assert.equal(result.relativePath, join('SoSe 2026', 'Softwaretechnik', 'Aufzeichnung.md'));

    // Der Adapter darf hier keine Datei geschrieben oder gelesen haben.
    await assert.rejects(stat(alreadyWrittenLocalPath), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
