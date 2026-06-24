import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import type { LearnwebClient } from '../src/learnweb-core/client';
import {
  LearnwebFileTooLargeError,
  LearnwebTimeoutError,
  type LearnwebSession,
} from '../src/learnweb-core/session';
import type { Activity } from '../src/shared/domain';
import { SyncEngine } from '../src/sync-engine/engine';
import { FilesystemAdapter } from '../src/output-adapters/filesystem-adapter';
import { OutputRouter } from '../src/output-adapters/router';
import type { OutputTarget } from '../src/output-adapters/types';

test('Sync-Engine lädt ausgewählte Kursdateien und protokolliert den Lauf', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik', semester: 'SoSe 2026' }]);
    repos.courses.setSelected(7, true);
    const activity: Activity = {
      cmid: 11,
      courseId: 7,
      modtype: 'resource',
      name: 'Skript',
      sectionName: 'Woche 1',
      sectionIndex: 0,
      viewUrl: 'https://learnweb.example/mod/resource/view.php?id=11',
      isSelected: false,
      status: 'discovered',
      lastSeenAt: null,
    };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/pluginfile.php/skript.pdf',
        filename: 'skript.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => {
        assert.equal(repos.activities.getByCourse(7)[0]?.status, 'download_pending');
        return {
          status: 200,
          contentType: 'application/pdf',
          filename: 'skript.pdf',
          bytes: Buffer.from('PDF-Inhalt'),
        };
      },
    } as unknown as LearnwebSession;

    const statuses: string[] = [];
    const engine = new SyncEngine(repos, {
      getClient: async () => fakeClient,
      getSession: async () => fakeSession,
      getLibraryPath: () => root,
    }, (status) => statuses.push(status.state));

    await engine.run();

    const asset = repos.fileAssets.getAll()[0];
    assert.equal(asset?.status, 'downloaded');
    assert.equal(await readFile(join(root, asset?.localPath ?? ''), 'utf8'), 'PDF-Inhalt');
    assert.equal(repos.downloadJobs.getByStatus('done').length, 1);
    assert.equal(repos.activities.getByCourse(7)[0]?.status, 'downloaded');
    assert.equal(repos.syncRuns.getLast()?.status, 'success');
    assert.deepEqual(statuses.filter((value, index) => index === 0 || value !== statuses[index - 1]), [
      'syncing',
      'idle',
    ]);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Wiederholungssync aktualisiert das bestehende Asset statt ein Duplikat anzulegen', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik' }]);
    repos.courses.setSelected(7, true);
    const activity = {
      cmid: 11,
      courseId: 7,
      modtype: 'resource',
      name: 'Skript',
      sectionName: null,
    };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/pluginfile.php/skript.pdf',
        filename: 'skript.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => ({
        status: 200,
        contentType: 'application/pdf',
        filename: 'skript.pdf',
        bytes: Buffer.from('PDF-Inhalt'),
      }),
    } as unknown as LearnwebSession;
    const engine = new SyncEngine(repos, {
      getClient: async () => fakeClient,
      getSession: async () => fakeSession,
      getLibraryPath: () => root,
    });

    await engine.run();
    await engine.run();

    assert.equal(repos.fileAssets.getAll().length, 1);
    assert.equal(repos.fileAssets.getAll()[0]?.status, 'skipped_duplicate');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Sync-Engine persistiert deferred und failed für fehlgeschlagene Downloads', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik' }]);
    repos.courses.setSelected(7, true);
    const activities = [
      { cmid: 11, courseId: 7, modtype: 'resource', name: 'Zu groß', sectionName: null },
      { cmid: 12, courseId: 7, modtype: 'resource', name: 'Fehler', sectionName: null },
    ];
    const fakeClient = {
      listActivities: async () => activities,
      resolveDownloadTargets: async (activity: { cmid: number }) => [{
        activityCmid: activity.cmid,
        sourceUrl: `https://learnweb.example/${activity.cmid}`,
        filename: `${activity.cmid}.pdf`,
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async (url: string) => {
        if (url.endsWith('/11')) throw new LearnwebFileTooLargeError();
        throw new Error('Netzwerkfehler');
      },
    } as unknown as LearnwebSession;
    const engine = new SyncEngine(repos, {
      getClient: async () => fakeClient,
      getSession: async () => fakeSession,
      getLibraryPath: () => root,
    });

    await engine.run();

    const statusByCmid = new Map(repos.activities.getByCourse(7).map((item) => [item.cmid, item.status]));
    assert.equal(statusByCmid.get(11), 'deferred');
    assert.equal(statusByCmid.get(12), 'failed');
    assert.equal(repos.downloadJobs.getByStatus('skipped_too_large').length, 1);
    assert.equal(repos.downloadJobs.getByStatus('failed_retryable').length, 1);
    assert.equal(repos.syncRuns.getLast()?.status, 'warnings');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Mehrere Targets einer Activity werden parallel verarbeitet und korrekt aggregiert (Issue #18)', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik' }]);
    repos.courses.setSelected(7, true);
    // Ein Ordner mit drei Dateien -> drei Download-Targets für dieselbe Activity.
    const activity = { cmid: 11, courseId: 7, modtype: 'folder', name: 'Ordner', sectionName: null };
    const targets = [
      { activityCmid: 11, sourceUrl: 'https://learnweb.example/a.pdf', filename: 'a.pdf' },
      { activityCmid: 11, sourceUrl: 'https://learnweb.example/b.pdf', filename: 'b.pdf' },
      { activityCmid: 11, sourceUrl: 'https://learnweb.example/c.pdf', filename: 'c.pdf' },
    ];
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => targets,
    } as unknown as LearnwebClient;
    // Künstlich unterschiedliche Auflösungszeiten, damit die Reihenfolge der
    // Promise-Abschlüsse nicht der Reihenfolge der Targets entspricht.
    const delays: Record<string, number> = {
      'https://learnweb.example/a.pdf': 15,
      'https://learnweb.example/b.pdf': 5,
      'https://learnweb.example/c.pdf': 10,
    };
    const fakeSession = {
      downloadFile: async (url: string) => new Promise((resolve) => {
        setTimeout(() => {
          const filename = url.split('/').pop() ?? 'datei.pdf';
          resolve({
            status: 200,
            contentType: 'application/pdf',
            filename,
            bytes: Buffer.from(`Inhalt von ${filename}`),
          });
        }, delays[url] ?? 0);
      }),
    } as unknown as LearnwebSession;
    const engine = new SyncEngine(repos, {
      getClient: async () => fakeClient,
      getSession: async () => fakeSession,
      getLibraryPath: () => root,
    });

    await engine.run();

    assert.equal(repos.fileAssets.getAll().length, 3);
    assert.equal(repos.downloadJobs.getByStatus('done').length, 3);
    assert.equal(repos.activities.getByCourse(7)[0]?.status, 'downloaded');
    assert.equal(repos.syncRuns.getLast()?.status, 'success');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Timeout beim Download führt zu failed_retryable mit spezifischer Fehlermeldung (Issue #19)', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik' }]);
    repos.courses.setSelected(7, true);
    const activity = { cmid: 11, courseId: 7, modtype: 'resource', name: 'Skript', sectionName: null };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/zeitlimit.pdf',
        filename: 'zeitlimit.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => {
        throw new LearnwebTimeoutError();
      },
    } as unknown as LearnwebSession;
    const engine = new SyncEngine(repos, {
      getClient: async () => fakeClient,
      getSession: async () => fakeSession,
      getLibraryPath: () => root,
    });

    await engine.run();

    const job = repos.downloadJobs.getByStatus('failed_retryable')[0];
    assert.equal(job?.status, 'failed_retryable');
    assert.match(job?.errorMessage ?? '', /Zeitlimit/);
    assert.equal(repos.activities.getByCourse(7)[0]?.status, 'failed');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Sync-Engine schreibt output_refs, wenn der Output-Router einen Notion-Push meldet (Issue #23 Part 3)', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik', semester: 'SoSe 2026' }]);
    repos.courses.setSelected(7, true);
    repos.settings.set('output.adapter', 'both');
    repos.settings.set('output.notion.lw_db_id', 'db-xyz');
    const activity = { cmid: 11, courseId: 7, modtype: 'resource', name: 'Skript', sectionName: 'Woche 1' };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/skript.pdf',
        filename: 'skript.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => ({
        status: 200,
        contentType: 'application/pdf',
        filename: 'skript.pdf',
        bytes: Buffer.from('PDF-Inhalt'),
      }),
    } as unknown as LearnwebSession;

    // Echter Filesystem-Adapter (lokaler Schreibpfad bleibt unverändert geprüft) +
    // Fake-Notion-Adapter, der einen Push simuliert, ohne echten Netzwerkzugriff.
    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({
        adapter: 'notion',
        duplicate: false,
        remoteRef: 'notion-page-1',
        hash: 'irrelevant',
        sizeBytes: 0,
        filename: 'skript.pdf',
      }),
      placeTranscript: async () => ({ adapter: 'notion' }),
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(root), notion: fakeNotionAdapter },
      repos.settings,
    );

    const engine = new SyncEngine(
      repos,
      { getClient: async () => fakeClient, getSession: async () => fakeSession, getLibraryPath: () => root },
      undefined,
      async () => router,
    );

    await engine.run();

    const asset = repos.fileAssets.getAll()[0];
    assert.equal(asset?.status, 'downloaded');
    const ref = repos.outputRefs.getBySource('file_asset', asset!.id, 'db-xyz');
    assert.equal(ref?.notionPageId, 'notion-page-1');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Sync-Engine läuft im exklusiven Notion-Modus ohne Bibliothekspfad und speichert nicht lokal', async () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik', semester: 'SoSe 2026' }]);
    repos.courses.setSelected(7, true);

    repos.settings.set('output.adapter', 'notion');
    repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const activity = { cmid: 11, courseId: 7, modtype: 'resource', name: 'Skript', sectionName: 'Woche 1' };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/skript.pdf',
        filename: 'skript.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => ({
        status: 200,
        contentType: 'application/pdf',
        filename: 'skript.pdf',
        bytes: Buffer.from('PDF-Inhalt'),
      }),
    } as unknown as LearnwebSession;

    let notionPlaceFileCalls = 0;
    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => {
        notionPlaceFileCalls++;
        return {
          adapter: 'notion',
          duplicate: false,
          remoteRef: 'notion-page-notion-only',
          hash: 'hash-from-notion-only',
          sizeBytes: 10,
          filename: 'skript.pdf',
        };
      },
      placeTranscript: async () => ({ adapter: 'notion' }),
    };

    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter('/tmp/nonexistent-library'), notion: fakeNotionAdapter },
      repos.settings,
    );

    const engine = new SyncEngine(
      repos,
      {
        getClient: async () => fakeClient,
        getSession: async () => fakeSession,
        getLibraryPath: () => null,
      },
      undefined,
      async () => router,
    );

    await engine.run();
    await engine.run();

    // Idempotenz: zwei Syncs derselben Datei dürfen nur EINEN Notion-Push auslösen
    // (sonst entsteht bei jedem Re-Sync eine doppelte Notion-Seite).
    assert.equal(notionPlaceFileCalls, 1);

    const assets = repos.fileAssets.getAll();
    assert.equal(assets.length, 1);
    const asset = assets[0]!;
    assert.equal(asset.status, 'downloaded');
    assert.equal(asset.localPath, null);
    assert.equal(asset.hash, 'hash-from-notion-only');
    assert.equal(asset.sizeBytes, 10);
    assert.equal(asset.filenameLocal, 'skript.pdf');

    const ref = repos.outputRefs.getBySource('file_asset', asset.id, 'db-xyz');
    assert.equal(ref?.notionPageId, 'notion-page-notion-only');

    const jobs = repos.downloadJobs.getByStatus('done');
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0]?.localPath, null);
    assert.equal(jobs[1]?.localPath, null);
    assert.equal(repos.syncRuns.getLast()?.status, 'success');
  } finally {
    db.close();
  }
});

test('Sync-Engine behandelt fehlgeschlagenen Datei-Notion-Push im notion-only-Modus als Warnung ohne lokale Persistenz', async () => {
  const db = openDatabase(':memory:');
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik', semester: 'SoSe 2026' }]);
    repos.courses.setSelected(7, true);
    repos.settings.set('output.adapter', 'notion');
    repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const activity = { cmid: 11, courseId: 7, modtype: 'resource', name: 'Skript', sectionName: 'Woche 1' };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/skript.pdf',
        filename: 'skript.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => ({
        status: 200,
        contentType: 'application/pdf',
        filename: 'skript.pdf',
        bytes: Buffer.from('PDF-Inhalt'),
      }),
    } as unknown as LearnwebSession;
    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => { throw new Error('Notion API Timeout'); },
      placeTranscript: async () => ({ adapter: 'notion' }),
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter('/tmp/nonexistent-library'), notion: fakeNotionAdapter },
      repos.settings,
    );
    const engine = new SyncEngine(
      repos,
      { getClient: async () => fakeClient, getSession: async () => fakeSession, getLibraryPath: () => null },
      undefined,
      async () => router,
    );

    await engine.run();

    const asset = repos.fileAssets.getAll()[0];
    assert.equal(asset?.status, 'downloaded');
    assert.ok(asset);
    assert.equal(asset.localPath, null);
    assert.equal(asset.hash, null);
    assert.equal(repos.outputRefs.getBySource('file_asset', asset.id, 'db-xyz'), null);

    const job = repos.downloadJobs.getByStatus('done')[0];
    assert.ok(job);
    assert.equal(job.localPath, null);
    assert.equal(repos.syncRuns.getLast()?.status, 'warnings');
  } finally {
    db.close();
  }
});

test('Sync-Engine im "both"-Modus: zweiter Sync derselben Datei schreibt lokal erneut, pusht aber nicht erneut zu Notion', async () => {
  const db = openDatabase(':memory:');
  const root = await mkdtemp(join(tmpdir(), 'unicloud-sync-'));
  try {
    const repos = createRepos(db);
    repos.courses.upsertMany([{ courseId: 7, fullname: 'Softwaretechnik', semester: 'SoSe 2026' }]);
    repos.courses.setSelected(7, true);
    repos.settings.set('output.adapter', 'both');
    repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const activity = { cmid: 11, courseId: 7, modtype: 'resource', name: 'Skript', sectionName: 'Woche 1' };
    const fakeClient = {
      listActivities: async () => [activity],
      resolveDownloadTargets: async () => [{
        activityCmid: 11,
        sourceUrl: 'https://learnweb.example/skript.pdf',
        filename: 'skript.pdf',
      }],
    } as unknown as LearnwebClient;
    const fakeSession = {
      downloadFile: async () => ({
        status: 200,
        contentType: 'application/pdf',
        filename: 'skript.pdf',
        bytes: Buffer.from('PDF-Inhalt'),
      }),
    } as unknown as LearnwebSession;

    let notionPlaceFileCalls = 0;
    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => {
        notionPlaceFileCalls++;
        return {
          adapter: 'notion',
          duplicate: false,
          remoteRef: 'notion-page-both',
          hash: 'hash-from-both',
          sizeBytes: 10,
          filename: 'skript.pdf',
        };
      },
      placeTranscript: async () => ({ adapter: 'notion' }),
    };

    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(root), notion: fakeNotionAdapter },
      repos.settings,
    );

    const engine = new SyncEngine(
      repos,
      { getClient: async () => fakeClient, getSession: async () => fakeSession, getLibraryPath: () => root },
      undefined,
      async () => router,
    );

    await engine.run();
    await engine.run();

    // Lokales Schreiben bleibt bei jedem Lauf aktiv (bestehendes Verhalten) ...
    const assets = repos.fileAssets.getAll();
    assert.equal(assets.length, 1);
    const asset = assets[0]!;
    assert.ok(asset.localPath);

    // ... aber der Notion-Push darf nur beim ersten Lauf passieren.
    assert.equal(notionPlaceFileCalls, 1);
    const refs = repos.outputRefs.getBySource('file_asset', asset.id, 'db-xyz');
    assert.equal(refs?.notionPageId, 'notion-page-both');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
