import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/db/db';
import { createRepos } from '../src/db/repos';
import type { LearnwebSession } from '../src/learnweb-core/session';
import { TranscriptionManager } from '../src/transcription/manager';

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

function response(path: string, data: string) {
  return { status: 200, url: `https://learnweb.example${path}`, headers: {}, data };
}
