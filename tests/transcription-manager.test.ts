import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import type { LearnwebSession } from '../src/learnweb-core/session';
import { TranscriptionManager } from '../src/transcription/manager';
import { FilesystemAdapter } from '../src/output-adapters/filesystem-adapter';
import { OutputRouter } from '../src/output-adapters/router';
import type { OutputTarget } from '../src/output-adapters/types';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ucc-manager-'));
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  repos.courses.upsertMany([{
    courseId: 7,
    fullname: 'Softwaretechnik',
    semester: 'SoSe 2026',
    isSelected: true,
  }]);
  repos.courses.setSelected(7, true);
  const fakeSession = {
    getBaseUrl: () => 'https://learnweb.example',
    get: async (path: string) => {
      if (path.includes('/course/view.php')) {
        return response(path, `
          <li class="course-section" data-sectionname="Woche 1">
            <ul data-for="cmlist"><li data-for="cmitem" data-id="42" class="activity modtype_page">
              <div data-activityname="Aufzeichnung"></div>
              <a class="aalink" href="/mod/page/view.php?id=42"></a>
            </li></ul>
          </li>`);
      }
      return response(path, '<h1>Vorlesung</h1><a href="/media/lecture.mp4">Video</a>');
    },
    downloadFileToPath: async (_url: string, destination: string) => {
      writeFileSync(destination, Buffer.from('fake-media'));
      return { status: 200, contentType: 'video/mp4', filename: 'lecture.mp4', sizeBytes: 10 };
    },
  } as unknown as LearnwebSession;
  return {
    root,
    db,
    repos,
    fakeSession,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('TranscriptionManager scannt, reiht ein und verarbeitet genau einen Job', async () => {
  const f = fixture();
  try {
    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      runWorker: async (request, onProgress) => {
        assert.ok(request.media_path);
        assert.equal(request.library_root, f.root);
        onProgress({ phase: 'transcribing', done: 50, total: 100 });
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    assert.equal(candidates.length, 1);
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    const jobs = manager.getJobs();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.status, 'done');
    assert.equal(jobs[0]!.durationSeconds, 61);
    assert.match(jobs[0]!.transcriptLocalPath ?? '', /Transkripte/);
    assert.equal(readFileSync(jobs[0]!.transcriptLocalPath!, 'utf8'), '# Transkript');
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager begrenzt automatische Fehlversuche', async () => {
  const f = fixture();
  try {
    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      runWorker: async () => { throw new Error('kaputt'); },
    });
    const candidate = (await manager.scanRecordings())[0]!;
    manager.enqueue([candidate.recordingKey]);
    await manager.start();
    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'failed_permanent');
    assert.equal(job.retryCount, 3);
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager lässt einen abgebrochenen Job pending und claimt ihn nicht sofort erneut', async () => {
  const f = fixture();
  try {
    let workerStarted!: () => void;
    const started = new Promise<void>((resolve) => { workerStarted = resolve; });
    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      runWorker: (_request, _onProgress, signal) => new Promise((_resolve, reject) => {
        workerStarted();
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
    });
    const candidate = (await manager.scanRecordings())[0]!;
    manager.enqueue([candidate.recordingKey]);
    const run = manager.start();
    await started;
    manager.cancel();
    await run;
    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'pending');
    assert.equal(job.retryCount, 0);
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager meldet Fortschritt beim Scannen und beim Download', async () => {
  const f = fixture();
  try {
    const statuses: Array<{ phase: string; progress?: { done: number; total: number }; message?: string }> = [];
    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => {
        return {
          ...f.fakeSession,
          downloadFileToPath: async (_url: string, destination: string, options?: { onProgress?: (downloaded: number, total?: number) => void }) => {
            if (options?.onProgress) {
              options.onProgress(50 * 1024 * 1024, 100 * 1024 * 1024);
            }
            writeFileSync(destination, Buffer.from('fake-media'));
            return { status: 200, contentType: 'video/mp4', filename: 'lecture.mp4', sizeBytes: 10 };
          },
        } as unknown as LearnwebSession;
      },
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: (status) => {
        statuses.push({ phase: status.phase, progress: status.progress, message: status.message });
      },
      runWorker: async (request, _onProgress) => {
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript');
        return { transcriptPath: request.output_path, model: 'small', durationSeconds: 10 };
      },
    });

    const candidates = await manager.scanRecordings();
    assert.equal(candidates.length, 1);

    // Scan-Fortschritt prüfen
    const scanStatuses = statuses.filter(s => s.phase === 'scanning');
    assert.ok(scanStatuses.length > 0);
    const firstScan = scanStatuses[0];
    assert.ok(firstScan);
    assert.deepEqual(firstScan.progress, { done: 0, total: 1 });
    assert.match(firstScan.message ?? '', /Softwaretechnik/);

    // Enqueue und verarbeiten
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    // Download-Fortschritt prüfen
    const downloadStatuses = statuses.filter(s => s.phase === 'downloading' && s.progress !== undefined);
    assert.ok(downloadStatuses.length > 0);
    const firstDownload = downloadStatuses[0];
    assert.ok(firstDownload);
    assert.deepEqual(firstDownload.progress, { done: 50 * 1024 * 1024, total: 100 * 1024 * 1024 });
    assert.match(firstDownload.message ?? '', /50.0 MB von 100.0 MB/);
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager schreibt output_refs, wenn der Output-Router einen Notion-Push meldet (Issue #23 Part 3)', async () => {
  const f = fixture();
  try {
    f.repos.settings.set('output.adapter', 'both');
    f.repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({ adapter: 'notion', duplicate: false, remoteRef: 'irrelevant', hash: '', sizeBytes: 0, filename: '' }),
      placeTranscript: async () => ({ adapter: 'notion', remoteRef: 'transcript-page-1' }),
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(f.root), notion: fakeNotionAdapter },
      f.repos.settings,
    );

    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      outputRouterFactory: async () => router,
      runWorker: async (request, onProgress) => {
        onProgress({ phase: 'transcribing', done: 50, total: 100 });
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'done');
    const ref = f.repos.outputRefs.getBySource('transcript_job', job.id, 'db-xyz');
    assert.equal(ref?.notionPageId, 'transcript-page-1');
    assert.equal(job.notionPushStatus, 'ok');
    assert.equal(job.notionPushError, null);
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager persistiert notion_push_status="warnings" + notion_push_error, wenn der Notion-Adapter Warnungen meldet (Notion-Push-Fix)', async () => {
  const f = fixture();
  try {
    f.repos.settings.set('output.adapter', 'both');
    f.repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({ adapter: 'notion', duplicate: false, remoteRef: 'irrelevant', hash: '', sizeBytes: 0, filename: '' }),
      placeTranscript: async () => ({
        adapter: 'notion',
        remoteRef: 'transcript-page-warn',
        warnings: ["Property 'Modell' existiert nicht in Ziel-DB und wurde übersprungen."],
      }),
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(f.root), notion: fakeNotionAdapter },
      f.repos.settings,
    );

    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      outputRouterFactory: async () => router,
      runWorker: async (request, onProgress) => {
        onProgress({ phase: 'transcribing', done: 50, total: 100 });
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'done', 'Notion-Warnungen dürfen den lokal erfolgreichen Job nicht als fehlgeschlagen markieren');
    assert.equal(job.notionPushStatus, 'warnings');
    assert.match(job.notionPushError ?? '', /Modell/);
    const ref = f.repos.outputRefs.getBySource('transcript_job', job.id, 'db-xyz');
    assert.equal(ref?.notionPageId, 'transcript-page-warn', 'Bei warnings wurde trotzdem eine Seite erstellt -> output_refs muss erfasst werden');
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager persistiert notion_push_status="failed" + notion_push_error, ohne den lokal erfolgreichen Job fehlschlagen zu lassen', async () => {
  const f = fixture();
  try {
    f.repos.settings.set('output.adapter', 'both');
    f.repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({ adapter: 'notion', duplicate: false, remoteRef: 'irrelevant', hash: '', sizeBytes: 0, filename: '' }),
      placeTranscript: async () => { throw new Error('Notion API Timeout'); },
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(f.root), notion: fakeNotionAdapter },
      f.repos.settings,
    );

    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      outputRouterFactory: async () => router,
      runWorker: async (request, onProgress) => {
        onProgress({ phase: 'transcribing', done: 50, total: 100 });
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'done', 'Ein gescheiterter Notion-Push darf den lokal erfolgreichen Job nicht als fehlgeschlagen markieren');
    assert.equal(job.notionPushStatus, 'failed');
    assert.match(job.notionPushError ?? '', /Notion API Timeout/);
    const ref = f.repos.outputRefs.getBySource('transcript_job', job.id, 'db-xyz');
    assert.equal(ref, null, 'Bei failed darf keine output_refs-Zeile entstehen');
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager löscht Notion-only-Transkripte nach erfolgreichem Push ohne Bibliothekspfad', async () => {
  const f = fixture();
  try {
    f.repos.settings.set('output.adapter', 'notion');
    f.repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({ adapter: 'notion', duplicate: false, remoteRef: 'irrelevant', hash: '', sizeBytes: 0, filename: '' }),
      placeTranscript: async () => ({ adapter: 'notion', remoteRef: 'transcript-page-1' }),
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(f.root), notion: fakeNotionAdapter },
      f.repos.settings,
    );
    let workerPath = '';

    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => null,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      outputRouterFactory: async () => router,
      pendingTranscriptDir: join(f.root, 'pending'),
      runWorker: async (request) => {
        assert.notEqual(request.library_root, f.root);
        workerPath = request.output_path;
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'done');
    assert.equal(job.notionPushStatus, 'ok');
    assert.equal(job.transcriptLocalPath, null);
    assert.equal(job.pendingLocalPath, null);
    assert.equal(existsSync(workerPath), false);
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager bewahrt Notion-only-Transkripte nach fehlgeschlagenem Push als pendingLocalPath auf', async () => {
  const f = fixture();
  try {
    f.repos.settings.set('output.adapter', 'notion');
    f.repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({ adapter: 'notion', duplicate: false, remoteRef: 'irrelevant', hash: '', sizeBytes: 0, filename: '' }),
      placeTranscript: async () => { throw new Error('Notion API Timeout'); },
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(f.root), notion: fakeNotionAdapter },
      f.repos.settings,
    );

    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => null,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      outputRouterFactory: async () => router,
      pendingTranscriptDir: join(f.root, 'pending'),
      runWorker: async (request) => {
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    manager.enqueue([candidates[0]!.recordingKey]);
    await manager.start();

    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'done');
    assert.equal(job.notionPushStatus, 'failed');
    assert.match(job.notionPushError ?? '', /Notion API Timeout/);
    assert.equal(job.transcriptLocalPath, null);
    assert.match(job.pendingLocalPath ?? '', /pending/);
    assert.equal(readFileSync(job.pendingLocalPath!, 'utf8'), '# Transkript');
  } finally {
    f.cleanup();
  }
});

test('TranscriptionManager überspringt den Notion-Push, wenn für den Job bereits ein output_ref existiert', async () => {
  const f = fixture();
  try {
    f.repos.settings.set('output.adapter', 'both');
    f.repos.settings.set('output.notion.lw_db_id', 'db-xyz');

    let notionPlaceTranscriptCalls = 0;
    const fakeNotionAdapter: OutputTarget = {
      kind: 'notion',
      placeFile: async () => ({ adapter: 'notion', duplicate: false, remoteRef: 'irrelevant', hash: '', sizeBytes: 0, filename: '' }),
      placeTranscript: async () => {
        notionPlaceTranscriptCalls++;
        return { adapter: 'notion', remoteRef: 'sollte-nicht-entstehen' };
      },
    };
    const router = new OutputRouter(
      { filesystem: new FilesystemAdapter(f.root), notion: fakeNotionAdapter },
      f.repos.settings,
    );

    const manager = new TranscriptionManager({
      repos: f.repos,
      getSession: async () => f.fakeSession,
      getLibraryPath: () => f.root,
      workerDir: join(f.root, 'worker'),
      onStatus: () => undefined,
      outputRouterFactory: async () => router,
      runWorker: async (request, onProgress) => {
        onProgress({ phase: 'transcribing', done: 50, total: 100 });
        mkdirSync(dirname(request.output_path), { recursive: true });
        writeFileSync(request.output_path, '# Transkript', { encoding: 'utf8', flag: 'w' });
        return { transcriptPath: request.output_path, model: 'mlx-whisper:small', durationSeconds: 61 };
      },
    });
    const candidates = await manager.scanRecordings();
    manager.enqueue([candidates[0]!.recordingKey]);

    // Simuliert einen bereits erfolgreichen Push aus einem (z. B. durch Crash)
    // unterbrochenen vorherigen Lauf: der output_ref existiert schon, bevor
    // der Worker für DIESEN Lauf überhaupt fertig ist.
    const pendingJob = manager.getJobs()[0]!;
    f.repos.outputRefs.insert({
      sourceEntityType: 'transcript_job',
      sourceEntityId: pendingJob.id,
      notionDatabaseId: 'db-xyz',
      notionPageId: 'transcript-page-aus-vorherigem-lauf',
    });

    await manager.start();

    assert.equal(notionPlaceTranscriptCalls, 0, 'Bei vorhandenem output_ref darf kein erneuter Notion-Push erfolgen');
    const job = manager.getJobs()[0]!;
    assert.equal(job.status, 'done');
    assert.equal(job.notionPushStatus, 'skipped');
    const ref = f.repos.outputRefs.getBySource('transcript_job', job.id, 'db-xyz');
    assert.equal(ref?.notionPageId, 'transcript-page-aus-vorherigem-lauf', 'der bestehende Ref darf nicht überschrieben werden');
  } finally {
    f.cleanup();
  }
});

function response(path: string, data: string) {
  return { status: 200, url: `https://learnweb.example${path}`, headers: {}, data };
}
