import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkLibraryPath } from '../src/local-library/access';
import { buildRelativeLibraryPath, sanitizePathSegment } from '../src/local-library/paths';
import { storeFile } from '../src/local-library/store';

test('Pfadsegmente werden macOS-tauglich und ohne Traversal erzeugt', () => {
  assert.equal(sanitizePathSegment('../../Woche: 1/2'), 'Woche- 1-2');
  const relativePath = buildRelativeLibraryPath({
    semester: 'SoSe 2026',
    courseName: 'Software/Technik',
    sectionName: 'Woche 1',
    filename: '../Skript.pdf',
  });
  assert.equal(relativePath, join('SoSe 2026', 'Software-Technik', 'Woche 1', 'Skript.pdf'));
});

test('Unbekannte Semester erzeugen keine künstliche Zwischenebene', () => {
  const relativePath = buildRelativeLibraryPath({
    semester: null,
    courseName: 'Softwaretechnik',
    sectionName: null,
    filename: 'Skript.pdf',
  });
  assert.equal(relativePath, join('Softwaretechnik', 'Skript.pdf'));
});

test('Schreibprobe und atomisches Speichern mit Dedupe funktionieren', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-library-'));
  try {
    assert.deepEqual(await checkLibraryPath(root), { ok: true, exists: true, writable: true });
    const first = await storeFile({
      rootPath: root,
      relativePath: join('Kurs', 'Skript.txt'),
      bytes: Buffer.from('Inhalt'),
    });
    assert.equal(first.duplicate, false);
    assert.equal(await readFile(first.absolutePath, 'utf8'), 'Inhalt');

    const duplicate = await storeFile({
      rootPath: root,
      relativePath: join('Anderer Kurs', 'Kopie.txt'),
      bytes: Buffer.from('Inhalt'),
      findExistingByHash: (hash) => hash === first.hash ? { localPath: first.relativePath } : null,
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.absolutePath, first.absolutePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Speicherziel darf die Bibliothek nicht verlassen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-library-'));
  try {
    await assert.rejects(
      storeFile({ rootPath: root, relativePath: '../escape.txt', bytes: Buffer.from('x') }),
      /außerhalb/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Ein veralteter Hash-Treffer stellt eine gelöschte Datei wieder her', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-library-'));
  try {
    const first = await storeFile({
      rootPath: root,
      relativePath: join('Kurs', 'Skript.txt'),
      bytes: Buffer.from('Inhalt'),
    });
    await unlink(first.absolutePath);

    const restored = await storeFile({
      rootPath: root,
      relativePath: first.relativePath,
      bytes: Buffer.from('Inhalt'),
      findExistingByHash: () => ({ localPath: first.relativePath }),
    });

    assert.equal(restored.duplicate, false);
    assert.equal(await readFile(restored.absolutePath, 'utf8'), 'Inhalt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Ein Hash-Treffer mit verändertem Dateiinhalt gilt nicht als Duplikat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unicloud-library-'));
  try {
    const first = await storeFile({
      rootPath: root,
      relativePath: join('Kurs', 'Skript.txt'),
      bytes: Buffer.from('Original'),
    });
    await writeFile(first.absolutePath, 'Manuell geändert');

    const restored = await storeFile({
      rootPath: root,
      relativePath: first.relativePath,
      bytes: Buffer.from('Original'),
      findExistingByHash: () => ({ localPath: first.relativePath }),
    });

    assert.equal(restored.duplicate, false);
    assert.notEqual(restored.absolutePath, first.absolutePath);
    assert.equal(await readFile(restored.absolutePath, 'utf8'), 'Original');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
