/**
 * Tests für den removeTranscription-Endpunkt (Issue #11).
 *
 * Deckt ab:
 *  (a) pending-Job wird durch manager.remove(id) aus der DB entfernt.
 *  (b) Entfernen eines in-progress-Jobs (Status 'claimed') wirft den erwarteten Fehler.
 *  (c) Unbekannte Job-ID wirft 'Job nicht gefunden.'.
 *
 * Wegen der externen Worker-Abhängigkeit im TranscriptionManager werden die
 * in-progress- und not-found-Guards direkt über das Repo + einen minimalen
 * Manager-Stub getestet.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import type { LearnwebSession } from '../src/learnweb-core/session';
import { TranscriptionManager } from '../src/transcription/manager';

/** Minimales Fixture: In-Memory-SQLite + leere Repos + einen Job einfügen. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ucc-remove-'));
  const db = openDatabase(':memory:');
  const repos = createRepos(db);

  // Kurs und Kandidat anlegen, damit enqueue funktioniert.
  repos.courses.upsertMany([{ courseId: 1, fullname: 'Testkurs', semester: 'SoSe 2026', isSelected: true }]);
  repos.courses.setSelected(1, true);

  // Einen Job direkt über das Repo in die DB einfügen (kein vollständiger Scan nötig).
  const pendingId = repos.transcriptJobs.insert({
    courseId: 1,
    activityCmid: null,
    sourceUrl: 'https://example.com/media.mp4',
    status: 'pending',
  });

  // Einen weiteren Job mit Status 'claimed' (in-progress) einfügen.
  const claimedId = repos.transcriptJobs.insert({
    courseId: 1,
    activityCmid: null,
    sourceUrl: 'https://example.com/media2.mp4',
    status: 'pending',
  });
  const fakeSession = {} as unknown as LearnwebSession;

  /** Minimaler Manager ohne Worker — nur für Guard-Tests. */
  const manager = new TranscriptionManager({
    repos,
    getSession: async () => fakeSession,
    getLibraryPath: () => root,
    workerDir: join(root, 'worker'),
    onStatus: () => undefined,
  });

  // Status auf 'claimed' setzen, um einen laufenden Job zu simulieren.
  // Muss nach der Instanziierung des Managers erfolgen, da dieser im
  // Konstruktor recoverInterrupted() aufruft und 'claimed'-Jobs auf 'pending' zurücksetzt.
  repos.transcriptJobs.setStatus(claimedId, 'claimed');

  return {
    root,
    db,
    repos,
    manager,
    pendingId,
    claimedId,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// --- (a) pending-Job wird erfolgreich entfernt --------------------------------

test('repo.remove löscht einen pending-Job aus der Datenbank', () => {
  const f = fixture();
  try {
    // Vor dem Entfernen muss der Job abrufbar sein.
    assert.ok(f.repos.transcriptJobs.getById(f.pendingId), 'Job sollte existieren');

    f.repos.transcriptJobs.remove(f.pendingId);

    // Nach dem Entfernen darf getById null zurückgeben.
    assert.equal(f.repos.transcriptJobs.getById(f.pendingId), null);
  } finally {
    f.cleanup();
  }
});

test('manager.remove entfernt einen pending-Job und publish wird ausgelöst', () => {
  const f = fixture();
  try {
    let publishCalled = false;
    // Eigenen Manager mit Status-Callback anlegen, um publish zu beobachten.
    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => ({} as unknown as LearnwebSession),
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => { publishCalled = true; },
    });

    manager.remove(f.pendingId);

    assert.equal(f.repos.transcriptJobs.getById(f.pendingId), null, 'Job sollte entfernt sein');
    assert.ok(publishCalled, 'publish() sollte nach remove aufgerufen werden');
  } finally {
    f.cleanup();
  }
});

// --- (b) Entfernen eines in-progress Jobs wirft Fehler -----------------------

test('manager.remove wirft bei in-progress Job (Status claimed)', () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.manager.remove(f.claimedId),
      (err: Error) => err.message === 'Aktive Jobs können nicht entfernt werden.',
    );
    // Job muss nach dem fehlgeschlagenen Entfernen noch in der DB sein.
    assert.ok(f.repos.transcriptJobs.getById(f.claimedId), 'Job darf nicht entfernt worden sein');
  } finally {
    f.cleanup();
  }
});

// --- (c) Unbekannte Job-ID wirft Fehler --------------------------------------

test('manager.remove wirft bei unbekannter Job-ID', () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.manager.remove(99999),
      (err: Error) => err.message === 'Job nicht gefunden.',
    );
  } finally {
    f.cleanup();
  }
});
