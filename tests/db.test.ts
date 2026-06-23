import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import { SCHEMA_VERSION } from '../src/db/schema';

const EXPECTED_TABLES = [
  'activities',
  'courses',
  'credential_refs',
  'download_jobs',
  'file_assets',
  'mcp_status',
  'output_refs',
  'profiles',
  'selection_rules',
  'settings',
  'sync_runs',
  'transcript_jobs',
];

test('Schema legt alle elf Tabellen idempotent mit korrekter Version an', () => {
  const db = openDatabase(':memory:');
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((row) => row.name), EXPECTED_TABLES);
    assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);

    // Das Basisschema muss bei erneutem Ausführen unverändert gültig bleiben.
    const before = tables.length;
    db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY)');
    const after = db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).get() as { count: number };
    assert.equal(after.count, before);
  } finally {
    db.close();
  }
});

test('Repositories speichern Kernentitäten und Secrets bleiben außerhalb der DB', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);
    const profile = repos.profiles.create('Thomas', '/tmp/library');
    assert.equal(repos.profiles.get()?.id, profile.id);

    repos.credentials.set({ serviceName: 'tbm-unicloudconnect', accountName: 'tnierma2' });
    assert.deepEqual(repos.credentials.get()?.accountName, 'tnierma2');
    const credentialColumns = db.prepare('PRAGMA table_info(credential_refs)').all() as Array<{ name: string }>;
    assert.ok(!credentialColumns.some((column) => /password|secret_value/i.test(column.name)));

    repos.courses.upsertMany([{ courseId: 42, fullname: 'Testkurs' }]);
    repos.courses.setSelected(42, true);
    assert.equal(repos.courses.getSelected()[0]?.courseId, 42);

    repos.activities.upsertMany([{ cmid: 100, courseId: 42, modtype: 'resource', name: 'Skript' }]);
    repos.activities.setSelected(100, true);
    repos.activities.setStatus(100, 'download_pending');
    assert.equal(repos.activities.getSelected()[0]?.status, 'download_pending');

    const ruleId = repos.selectionRules.insert({
      courseId: 42,
      scope: 'course',
      scopeRef: null,
      syncFiles: true,
      transcribeRecordings: false,
      includeNewItems: true,
      isActive: true,
    });
    assert.equal(repos.selectionRules.getByCourse(42)[0]?.id, ruleId);

    const transcriptId = repos.transcriptJobs.insert({
      courseId: 42,
      activityCmid: 100,
      sourceUrl: 'https://example.invalid/media',
    });
    assert.equal(repos.transcriptJobs.getByStatus('pending')[0]?.id, transcriptId);

    assert.equal(repos.mcp.get().enabled, false);
  } finally {
    db.close();
  }
});

test('SQLite-CHECK-Constraints weisen ungültige Statuswerte ab', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO courses (course_id, fullname) VALUES (?, ?)').run(1, 'Kurs');
    assert.throws(() => {
      db.prepare(
        "INSERT INTO download_jobs (course_id, source_url, status) VALUES (1, 'https://example.invalid', 'kaputt')",
      ).run();
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

test('Kontodaten werden per Kurs-Cascade gelöscht, lokale Einstellungen bleiben erhalten', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);
    repos.profiles.create('Thomas', '/tmp/library');
    repos.settings.set('default_library_path', '/tmp/library');
    repos.courses.upsertMany([{ courseId: 42, fullname: 'Testkurs' }]);
    repos.activities.upsertMany([{ cmid: 100, courseId: 42, modtype: 'resource', name: 'Skript' }]);
    db.prepare("INSERT INTO file_assets (activity_cmid, course_id, source_url, filename_original, filename_local, local_path) VALUES (100, 42, 'https://example.invalid/file', 'a.pdf', 'a.pdf', '/tmp/a.pdf')").run();
    db.prepare("INSERT INTO transcript_jobs (course_id, activity_cmid, source_url) VALUES (42, 100, 'https://example.invalid/recording')").run();
    db.prepare("INSERT INTO selection_rules (course_id, scope) VALUES (42, 'course')").run();
    db.prepare("INSERT INTO download_jobs (course_id, activity_cmid, source_url) VALUES (42, 100, 'https://example.invalid/file')").run();
    repos.syncRuns.start('manual');

    db.transaction(() => {
      repos.courses.clear();
      repos.syncRuns.clear();
    })();

    for (const table of ['courses', 'activities', 'file_assets', 'transcript_jobs', 'selection_rules', 'download_jobs', 'sync_runs']) {
      const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
      assert.equal(row.count, 0, `${table} wurde nicht geleert`);
    }
    assert.equal(repos.settings.get('default_library_path'), '/tmp/library');
    assert.equal(repos.profiles.get()?.displayName, 'Thomas');
  } finally {
    db.close();
  }
});

test('Credentials: get, set, clear sind nach Provider getrennt', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);
    
    // Setze LearnWeb credential
    repos.credentials.set({ serviceName: 'learnweb-service', accountName: 'lw-user', provider: 'learnweb' });
    // Setze Notion credential
    repos.credentials.set({ serviceName: 'notion-service', accountName: 'notion-user', provider: 'notion' });
    
    // Prüfe, ob beide unabhängig voneinander gelesen werden können
    const lwCred = repos.credentials.get('learnweb');
    const notionCred = repos.credentials.get('notion');
    
    assert.ok(lwCred);
    assert.equal(lwCred.accountName, 'lw-user');
    assert.ok(notionCred);
    assert.equal(notionCred.accountName, 'notion-user');
    
    // Lösche nur Notion-Credentials
    repos.credentials.clear('notion');
    assert.equal(repos.credentials.get('notion'), null);
    assert.ok(repos.credentials.get('learnweb')); // Learnweb muss noch da sein!
    
    // Lösche LearnWeb-Credentials
    repos.credentials.clear('learnweb');
    assert.equal(repos.credentials.get('learnweb'), null);
  } finally {
    db.close();
  }
});

test('outputRefs-Repository speichert, holt und dedupliziert Referenzen', () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);
    
    // Versuche getBySource auf leere DB
    const emptyRef = repos.outputRefs.getBySource('file_asset', 123, 'db-notion-1');
    assert.equal(emptyRef, null);
    
    // Insert eine Referenz
    const refId = repos.outputRefs.insert({
      sourceEntityType: 'file_asset',
      sourceEntityId: 123,
      notionDatabaseId: 'db-notion-1',
      notionPageId: 'page-notion-1'
    });
    assert.ok(refId > 0);
    
    // Hole sie ab
    const ref = repos.outputRefs.getBySource('file_asset', 123, 'db-notion-1');
    assert.ok(ref);
    assert.equal(ref.id, refId);
    assert.equal(ref.sourceEntityType, 'file_asset');
    assert.equal(ref.sourceEntityId, 123);
    assert.equal(ref.notionDatabaseId, 'db-notion-1');
    assert.equal(ref.notionPageId, 'page-notion-1');
    
    // Versuche dieselbe Kombination (entity_type, entity_id, notion_database_id) einzufügen (Unique constraint check)
    assert.throws(() => {
      repos.outputRefs.insert({
        sourceEntityType: 'file_asset',
        sourceEntityId: 123,
        notionDatabaseId: 'db-notion-1',
        notionPageId: 'page-notion-2'
      });
    }, /UNIQUE constraint failed/);
    
    // Delete
    repos.outputRefs.delete(refId);
    assert.equal(repos.outputRefs.getBySource('file_asset', 123, 'db-notion-1'), null);
    
  } finally {
    db.close();
  }
});

