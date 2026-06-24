/**
 * Tests für Schema-Migration v1 → v5.
 *
 * Prüft:
 * - Neuinstallation legt direkt die aktuelle Version mit allen Spalten an
 * - Migration v1 → v2 via ALTER TABLE lädt die neuen Spalten + Index
 * - Migration v2 → v3 legt output_refs an
 * - Migration v3 → v4 lädt notion_push_status/notion_push_error (Notion-Push-Fix)
 * - Migration v4 → v5 macht file_assets.local_path nullable
 * - claimNext() liefert aufeinanderfolgend verschiedene Job-IDs
 * - enqueueFromCandidate() ist idempotent (doppelt derselbe recording_key = nur ein Job)
 * - recoverInterrupted() setzt unterbrochene Jobs auf 'pending'
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';

import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import { SCHEMA_VERSION } from '../src/db/schema';
import type { TranscriptJobStatus } from '../src/shared/domain';

/**
 * Erstelle eine v1-Datenbank: lege das alte transcript_jobs-Schema ohne
 * v2-Felder an und setze PRAGMA user_version=1.
 */
function createV1Database(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Minimal-Schema für v1 (ohne die v2-Felder)
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      course_id INTEGER PRIMARY KEY,
      fullname TEXT NOT NULL,
      shortname TEXT,
      semester TEXT,
      course_url TEXT,
      is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
      first_seen_at TEXT,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activities (
      cmid INTEGER PRIMARY KEY,
      course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
      modtype TEXT NOT NULL,
      name TEXT NOT NULL,
      section_name TEXT,
      section_index INTEGER,
      view_url TEXT,
      is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'discovered'
        CHECK (status IN ('discovered','selected','ignored','download_pending','downloaded','deferred','failed','removed')),
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS file_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_cmid INTEGER REFERENCES activities(cmid) ON DELETE SET NULL,
      course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      filename_original TEXT NOT NULL,
      filename_local TEXT NOT NULL,
      local_path TEXT NOT NULL,
      size_bytes INTEGER,
      hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','downloaded','skipped_duplicate','failed','removed')),
      downloaded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_file_assets_course ON file_assets(course_id);
    CREATE INDEX IF NOT EXISTS idx_file_assets_hash ON file_assets(hash);

    -- v1-Schema: OHNE recording_key, title, source_type, media_url, needs_auth, sectionName, sectionIndex, recordingDate, retry_count
    CREATE TABLE IF NOT EXISTS transcript_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
      activity_cmid INTEGER REFERENCES activities(cmid) ON DELETE SET NULL,
      source_url TEXT NOT NULL,
      media_local_path TEXT,
      transcript_local_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','claimed','downloading_media','media_downloaded','transcribing','markdown_created','done','failed_retryable','failed_permanent')),
      model TEXT,
      duration_seconds INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Setze user_version = 1
  db.pragma('user_version = 1');

  return db;
}

/**
 * Erstelle eine v2-Datenbank: erstelle v1 und wende die v2-Migrationsänderungen an,
 * setze PRAGMA user_version = 2.
 */
function createV2Database(path: string): Database.Database {
  const db = createV1Database(path);
  db.exec(`
    ALTER TABLE transcript_jobs ADD COLUMN recording_key TEXT;
    ALTER TABLE transcript_jobs ADD COLUMN title TEXT;
    ALTER TABLE transcript_jobs ADD COLUMN source_type TEXT CHECK (source_type IN ('opencast','youtube','media'));
    ALTER TABLE transcript_jobs ADD COLUMN media_url TEXT;
    ALTER TABLE transcript_jobs ADD COLUMN needs_auth INTEGER NOT NULL DEFAULT 0 CHECK (needs_auth IN (0,1));
    ALTER TABLE transcript_jobs ADD COLUMN section_name TEXT;
    ALTER TABLE transcript_jobs ADD COLUMN section_index INTEGER;
    ALTER TABLE transcript_jobs ADD COLUMN recording_date TEXT;
    ALTER TABLE transcript_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_jobs_recording_key ON transcript_jobs(recording_key) WHERE recording_key IS NOT NULL;
  `);
  db.pragma('user_version = 2');
  return db;
}

/**
 * Erstelle eine v3-Datenbank: erstelle v2 und wende die v3-Migrationsänderung
 * (output_refs-Tabelle) an, setze PRAGMA user_version = 3.
 */
function createV3Database(path: string): Database.Database {
  const db = createV2Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS output_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('file_asset', 'transcript_job')),
      source_entity_id INTEGER NOT NULL,
      notion_database_id TEXT NOT NULL,
      notion_page_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_output_refs_source ON output_refs(source_entity_type, source_entity_id, notion_database_id);
  `);
  db.pragma('user_version = 3');
  return db;
}

/**
 * Erstelle eine v4-Datenbank: erstelle v3 und wende die v4-Migrationsänderungen an,
 * setze PRAGMA user_version = 4.
 */
function createV4Database(path: string): Database.Database {
  const db = createV3Database(path);
  db.exec(`
    ALTER TABLE transcript_jobs ADD COLUMN notion_push_status TEXT CHECK (notion_push_status IN ('ok','warnings','failed','skipped'));
    ALTER TABLE transcript_jobs ADD COLUMN notion_push_error TEXT;
  `);
  db.pragma('user_version = 4');
  return db;
}

test('Migration v1→v2: simulierte v1-DB wird auf v2 gehoben', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ucc-migration-'));
  const path = join(dir, 'state.sqlite');
  const v1 = createV1Database(path);
  assert.equal(v1.pragma('user_version', { simple: true }), 1);
  v1.close();

  const db = openDatabase(path);
  try {
    // Prüfe: alle v2-Spalten sind jetzt vorhanden
    const tableInfo = db.prepare("PRAGMA table_info(transcript_jobs)").all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((c) => c.name);

    assert.ok(columnNames.includes('recording_key'), 'recording_key sollte vorhanden sein');
    assert.ok(columnNames.includes('title'), 'title sollte vorhanden sein');
    assert.ok(columnNames.includes('source_type'), 'source_type sollte vorhanden sein');
    assert.ok(columnNames.includes('media_url'), 'media_url sollte vorhanden sein');
    assert.ok(columnNames.includes('needs_auth'), 'needs_auth sollte vorhanden sein');
    assert.ok(columnNames.includes('section_name'), 'section_name sollte vorhanden sein');
    assert.ok(columnNames.includes('section_index'), 'section_index sollte vorhanden sein');
    assert.ok(columnNames.includes('recording_date'), 'recording_date sollte vorhanden sein');
    assert.ok(columnNames.includes('retry_count'), 'retry_count sollte vorhanden sein');

    // Prüfe: user_version ist jetzt SCHEMA_VERSION
    const versionAfter = db.pragma('user_version', { simple: true });
    assert.equal(versionAfter, SCHEMA_VERSION);

    // Prüfe: der UNIQUE INDEX existiert
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transcript_jobs_recording_key'",
    ).all() as Array<{ name: string }>;
    assert.equal(indexes.length, 1, 'UNIQUE INDEX idx_transcript_jobs_recording_key sollte existieren');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Neuinstallation legt direkt v5 mit allen Spalten an', () => {
  const db = openDatabase(':memory:');
  try {
    // Prüfe: user_version ist die aktuelle Schema-Version
    const version = db.pragma('user_version', { simple: true });
    assert.equal(version, SCHEMA_VERSION, `user_version sollte ${SCHEMA_VERSION} sein`);
    assert.equal(SCHEMA_VERSION, 5);

    // Prüfe: alle v2-Spalten sind in der neu erstellten Tabelle vorhanden
    const tableInfo = db.prepare("PRAGMA table_info(transcript_jobs)").all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((c) => c.name);

    assert.ok(columnNames.includes('recording_key'), 'recording_key sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('title'), 'title sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('source_type'), 'source_type sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('media_url'), 'media_url sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('needs_auth'), 'needs_auth sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('section_name'), 'section_name sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('section_index'), 'section_index sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('recording_date'), 'recording_date sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('retry_count'), 'retry_count sollte direkt in v2 vorhanden sein');
    assert.ok(columnNames.includes('notion_push_status'), 'notion_push_status sollte direkt in v4 vorhanden sein');
    assert.ok(columnNames.includes('notion_push_error'), 'notion_push_error sollte direkt in v4 vorhanden sein');

    // Prüfe: der UNIQUE INDEX existiert
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transcript_jobs_recording_key'",
    ).all() as Array<{ name: string }>;
    assert.equal(indexes.length, 1, 'UNIQUE INDEX idx_transcript_jobs_recording_key sollte existieren');

    // Prüfe output_refs
    const outputRefsInfo = db.prepare("PRAGMA table_info(output_refs)").all() as Array<{ name: string }>;
    const outputRefsCols = outputRefsInfo.map((c) => c.name);
    assert.ok(outputRefsCols.includes('id'));
    assert.ok(outputRefsCols.includes('source_entity_type'));
    assert.ok(outputRefsCols.includes('source_entity_id'));
    assert.ok(outputRefsCols.includes('notion_database_id'));
    assert.ok(outputRefsCols.includes('notion_page_id'));
    assert.ok(outputRefsCols.includes('created_at'));
    assert.ok(outputRefsCols.includes('updated_at'));
  } finally {
    db.close();
  }
});

test('Migration v2→v5: simulierte v2-DB nimmt v3, v4 und v5 mit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ucc-migration-'));
  const path = join(dir, 'state.sqlite');
  const v2 = createV2Database(path);
  assert.equal(v2.pragma('user_version', { simple: true }), 2);
  v2.close();

  const db = openDatabase(path);
  try {
    // Prüfe: die neue Tabelle output_refs (Migration 2→3) ist vorhanden
    const tableInfo = db.prepare("PRAGMA table_info(output_refs)").all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((c) => c.name);

    assert.ok(columnNames.includes('id'), 'id sollte vorhanden sein');
    assert.ok(columnNames.includes('source_entity_type'), 'source_entity_type sollte vorhanden sein');
    assert.ok(columnNames.includes('source_entity_id'), 'source_entity_id sollte vorhanden sein');
    assert.ok(columnNames.includes('notion_database_id'), 'notion_database_id sollte vorhanden sein');
    assert.ok(columnNames.includes('notion_page_id'), 'notion_page_id sollte vorhanden sein');
    assert.ok(columnNames.includes('created_at'), 'created_at sollte vorhanden sein');
    assert.ok(columnNames.includes('updated_at'), 'updated_at sollte vorhanden sein');

    // Prüfe: die v4-Spalten (Migration 3→4) sind ebenfalls vorhanden — openDatabase()
    // migriert von v2 immer bis zur aktuellen SCHEMA_VERSION durch, nie nur bis v3.
    const jobColumns = db.prepare("PRAGMA table_info(transcript_jobs)").all() as Array<{ name: string }>;
    const jobColumnNames = jobColumns.map((c) => c.name);
    assert.ok(jobColumnNames.includes('notion_push_status'), 'notion_push_status sollte vorhanden sein');
    assert.ok(jobColumnNames.includes('notion_push_error'), 'notion_push_error sollte vorhanden sein');

    // Prüfe: user_version ist jetzt die aktuelle Schema-Version
    const versionAfter = db.pragma('user_version', { simple: true });
    assert.equal(versionAfter, SCHEMA_VERSION);
    assert.equal(versionAfter, 5);

    // Prüfe: der UNIQUE INDEX existiert
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_output_refs_source'",
    ).all() as Array<{ name: string }>;
    assert.equal(indexes.length, 1, 'UNIQUE INDEX idx_output_refs_source sollte existieren');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Migration v3→v5: simulierte v3-DB wird auf v5 gehoben', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ucc-migration-'));
  const path = join(dir, 'state.sqlite');
  const v3 = createV3Database(path);
  assert.equal(v3.pragma('user_version', { simple: true }), 3);
  v3.close();

  const db = openDatabase(path);
  try {
    // Prüfe: die neuen Spalten für das persistierte Notion-Push-Ergebnis sind vorhanden
    const tableInfo = db.prepare("PRAGMA table_info(transcript_jobs)").all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((c) => c.name);

    assert.ok(columnNames.includes('notion_push_status'), 'notion_push_status sollte vorhanden sein');
    assert.ok(columnNames.includes('notion_push_error'), 'notion_push_error sollte vorhanden sein');

    // Prüfe: user_version ist jetzt 5
    const versionAfter = db.pragma('user_version', { simple: true });
    assert.equal(versionAfter, SCHEMA_VERSION);
    assert.equal(versionAfter, 5);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Migration v4→v5: local_path in file_assets wird nullable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ucc-migration-'));
  const path = join(dir, 'state.sqlite');
  const v4 = createV4Database(path);
  assert.equal(v4.pragma('user_version', { simple: true }), 4);
  v4.exec(`
    INSERT INTO courses (course_id, fullname) VALUES (42, 'Testkurs');
    INSERT INTO activities (cmid, course_id, modtype, name) VALUES (100, 42, 'resource', 'Skript');
    INSERT INTO file_assets (
      activity_cmid, course_id, source_url, filename_original, filename_local,
      local_path, size_bytes, hash, status, downloaded_at
    ) VALUES (
      100, 42, 'https://example.invalid/file.pdf', 'file.pdf', 'file.pdf',
      'Testkurs/file.pdf', 123, 'hash-before', 'downloaded', '2026-06-24T10:00:00.000Z'
    );
  `);
  v4.close();

  const db = openDatabase(path);
  try {
    const tableInfo = db.prepare("PRAGMA table_info(file_assets)").all() as Array<{ name: string; notnull: number }>;
    const localPathCol = tableInfo.find((c) => c.name === 'local_path');
    assert.ok(localPathCol);
    assert.equal(localPathCol.notnull, 0, 'local_path sollte nullable sein');
    db.prepare(`
      INSERT INTO file_assets (
        activity_cmid, course_id, source_url, filename_original, filename_local, local_path
      ) VALUES (100, 42, 'https://example.invalid/notion-only.pdf', 'notion-only.pdf', 'notion-only.pdf', NULL)
    `).run();

    const rows = db.prepare('SELECT source_url, local_path, hash FROM file_assets ORDER BY id').all() as Array<{
      source_url: string;
      local_path: string | null;
      hash: string | null;
    }>;
    assert.deepEqual(rows, [
      { source_url: 'https://example.invalid/file.pdf', local_path: 'Testkurs/file.pdf', hash: 'hash-before' },
      { source_url: 'https://example.invalid/notion-only.pdf', local_path: null, hash: null },
    ]);

    // Prüfe: user_version ist jetzt 5
    const versionAfter = db.pragma('user_version', { simple: true });
    assert.equal(versionAfter, SCHEMA_VERSION);
    assert.equal(versionAfter, 5);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claimNext(): zwei Aufrufe liefern verschiedene Job-IDs', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);

    // Lege einen Testcours an
    repos.courses.upsertMany([{
      courseId: 42,
      fullname: 'Test Course',
      shortname: 'TC',
      semester: 'SS24',
      courseUrl: 'https://example.invalid',
      isSelected: true,
    }]);

    // Erstelle zwei pending Jobs
    const id1 = repos.transcriptJobs.insert({
      courseId: 42,
      activityCmid: null,
      sourceUrl: 'https://example.invalid/media1.mp4',
    });
    const id2 = repos.transcriptJobs.insert({
      courseId: 42,
      activityCmid: null,
      sourceUrl: 'https://example.invalid/media2.mp4',
    });

    // claimNext() sollte unterschiedliche Jobs liefern
    const claimed1 = repos.transcriptJobs.claimNext();
    assert.ok(claimed1, 'claimNext() sollte einen Job liefern');
    assert.equal(claimed1.id, id1, 'Erster Aufruf sollte Job 1 liefern');
    assert.equal(claimed1.status, 'claimed', 'Status sollte auf claimed gesetzt sein');

    const claimed2 = repos.transcriptJobs.claimNext();
    assert.ok(claimed2, 'claimNext() sollte den zweiten Job liefern');
    assert.equal(claimed2.id, id2, 'Zweiter Aufruf sollte Job 2 liefern');
    assert.equal(claimed2.status, 'claimed', 'Status sollte auf claimed gesetzt sein');

    // Ohne weitere pending Jobs sollte claimNext() null zurückgeben
    const claimed3 = repos.transcriptJobs.claimNext();
    assert.equal(claimed3, null, 'claimNext() sollte null zurückgeben, wenn keine pending Jobs');
  } finally {
    db.close();
  }
});

test('enqueueFromCandidate() ist idempotent bei gleichem recording_key', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);

    // Lege einen Testcours an
    repos.courses.upsertMany([{
      courseId: 42,
      fullname: 'Test Course',
      shortname: 'TC',
      semester: 'SS24',
      courseUrl: 'https://example.invalid',
      isSelected: true,
    }]);

    const recordingKey = 'opencast-12345-abcde';

    // Erstes Enqueue
    repos.transcriptJobs.enqueueFromCandidate({
      courseId: 42,
      activityCmid: null,
      sourceUrl: 'https://example.invalid/opencast/12345',
      recordingKey,
      title: 'Lecture 1',
      sourceType: 'opencast',
      mediaUrl: 'https://opencast.invalid/media.mp4',
      needsAuth: true,
      sectionName: 'Woche 1',
      sectionIndex: 1,
      recordingDate: '2024-04-15T10:00:00Z',
    });

    // Zweites Enqueue mit denselben Schlüssel (sollte NOTHING bewirken)
    repos.transcriptJobs.enqueueFromCandidate({
      courseId: 42,
      activityCmid: null,
      sourceUrl: 'https://example.invalid/opencast/12345',
      recordingKey,
      title: 'Lecture 1 (updated)',
      sourceType: 'opencast',
      mediaUrl: 'https://opencast.invalid/media2.mp4',
      needsAuth: false,
      sectionName: 'Woche 2',
      sectionIndex: 2,
      recordingDate: '2024-04-16T10:00:00Z',
    });

    // Prüfe: nur ein Job sollte existieren
    const all = repos.transcriptJobs.getAll();
    assert.equal(all.length, 1, 'Genau ein Job sollte nach zweimalem enqueueFromCandidate existieren');

    // Prüfe: das Feld sollte nicht aktualisiert sein (ON CONFLICT DO NOTHING)
    const job = all[0]!;
    assert.equal(job.recordingKey, recordingKey);
    assert.equal(job.title, 'Lecture 1', 'Title sollte Original bleiben (ON CONFLICT DO NOTHING)');
    assert.equal(job.sectionIndex, 1, 'sectionIndex sollte Original bleiben');
  } finally {
    db.close();
  }
});

test('recoverInterrupted(): setzt unterbrochene Jobs auf pending', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);

    // Lege einen Testcours an
    repos.courses.upsertMany([{
      courseId: 42,
      fullname: 'Test Course',
      shortname: 'TC',
      semester: 'SS24',
      courseUrl: 'https://example.invalid',
      isSelected: true,
    }]);

    // Erstelle mehrere Jobs in verschiedenen Zuständen
    const statuses: TranscriptJobStatus[] = [
      'pending',
      'claimed',
      'downloading_media',
      'media_downloaded',
      'transcribing',
      'markdown_created',
      'done',
      'failed_retryable',
    ];

    const jobIds: number[] = [];
    for (const status of statuses) {
      const id = repos.transcriptJobs.insert({
        courseId: 42,
        activityCmid: null,
        sourceUrl: `https://example.invalid/media${jobIds.length}.mp4`,
        status,
      });
      jobIds.push(id);
    }

    // Rufe recoverInterrupted() auf
    repos.transcriptJobs.recoverInterrupted();

    // Prüfe: Jobs in ['claimed', 'downloading_media', 'media_downloaded', 'transcribing', 'markdown_created']
    // sollten auf 'pending' sein; andere bleiben unverändert
    for (let i = 0; i < jobIds.length; i++) {
      const job = repos.transcriptJobs.getById(jobIds[i]!)!;
      const originalStatus = statuses[i]!;

      if (['claimed', 'downloading_media', 'media_downloaded', 'transcribing', 'markdown_created'].includes(originalStatus)) {
        assert.equal(job.status, 'pending', `Job mit ursprünglichem Status ${originalStatus} sollte auf pending gesetzt sein`);
      } else {
        assert.equal(job.status, originalStatus, `Job mit Status ${originalStatus} sollte unverändert bleiben`);
      }
    }
  } finally {
    db.close();
  }
});

test('incrementRetry(): erhöht retry_count und gibt neuen Wert zurück', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);

    // Lege einen Testcours an
    repos.courses.upsertMany([{
      courseId: 42,
      fullname: 'Test Course',
      shortname: 'TC',
      semester: 'SS24',
      courseUrl: 'https://example.invalid',
      isSelected: true,
    }]);

    // Erstelle einen Job
    const id = repos.transcriptJobs.insert({
      courseId: 42,
      activityCmid: null,
      sourceUrl: 'https://example.invalid/media.mp4',
    });

    // Prüfe: initial retry_count = 0
    let job = repos.transcriptJobs.getById(id)!;
    assert.equal(job.retryCount, 0);

    // Inkrementiere
    const count1 = repos.transcriptJobs.incrementRetry(id);
    assert.equal(count1, 1);

    // Prüfe: Job sollte retry_count = 1 haben
    job = repos.transcriptJobs.getById(id)!;
    assert.equal(job.retryCount, 1);

    // Inkrementiere noch mal
    const count2 = repos.transcriptJobs.incrementRetry(id);
    assert.equal(count2, 2);

    job = repos.transcriptJobs.getById(id)!;
    assert.equal(job.retryCount, 2);
  } finally {
    db.close();
  }
});

test('setStatus(): aktualisiert Status und optionale Felder', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);

    // Lege einen Testcours an
    repos.courses.upsertMany([{
      courseId: 42,
      fullname: 'Test Course',
      shortname: 'TC',
      semester: 'SS24',
      courseUrl: 'https://example.invalid',
      isSelected: true,
    }]);

    // Erstelle einen Job
    const id = repos.transcriptJobs.insert({
      courseId: 42,
      activityCmid: null,
      sourceUrl: 'https://example.invalid/media.mp4',
    });

    // Setze Status + Felder
    repos.transcriptJobs.setStatus(id, 'transcribing', {
      mediaLocalPath: '/tmp/media.mp4',
      durationSeconds: 3600,
    });

    const job = repos.transcriptJobs.getById(id)!;
    assert.equal(job.status, 'transcribing');
    assert.equal(job.mediaLocalPath, '/tmp/media.mp4');
    assert.equal(job.durationSeconds, 3600);
  } finally {
    db.close();
  }
});
