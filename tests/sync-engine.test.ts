import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import type { LearnwebClient } from '../src/learnweb-core/client';
import { LearnwebFileTooLargeError, type LearnwebSession } from '../src/learnweb-core/session';
import type { Activity } from '../src/shared/domain';
import { SyncEngine } from '../src/sync-engine/engine';

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
