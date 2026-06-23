import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Repos } from '../db/repos';
import { LearnwebClient } from '../learnweb-core/client';
import type { LearnwebSession } from '../learnweb-core/session';
import { sanitizePathSegment } from '../local-library/paths';
import { FilesystemAdapter } from '../output-adapters/filesystem-adapter';
import { createNotionAdapter } from '../output-adapters/notion-adapter';
import { OutputRouter } from '../output-adapters/router';
import { OUTPUT_NOTION_DATABASE_ID_SETTING_KEY } from '../output-adapters/types';
import type {
  Course,
  RecordingCandidate,
  TranscriptJob,
  TranscriptionPhase,
  TranscriptionSettings,
  TranscriptionStatus,
  TranscriptionWorkerStatus,
} from '../shared/domain';

const DEFAULT_SETTINGS: TranscriptionSettings = { mode: 'none', language: 'de', model: 'small' };
const MAX_RETRIES = 3;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

interface WorkerProgress {
  phase: 'downloading' | 'transcribing' | 'writing';
  done: number;
  total: number;
}

interface WorkerResult {
  transcriptPath: string;
  model: string;
  durationSeconds: number;
}

interface WorkerRequest {
  id: number;
  source_kind: string;
  media_url: string | null;
  media_path?: string;
  source_url: string;
  language: string;
  model: string;
  output_path: string;
  library_root: string;
  title: string;
  metadata: { course_name: string; recording_date: string | null };
}

export interface TranscriptionManagerOptions {
  repos: Repos;
  getSession(): Promise<LearnwebSession>;
  getLibraryPath(): string | null;
  workerDir: string;
  onStatus(status: TranscriptionStatus): void;
  runWorker?: (
    request: WorkerRequest,
    onProgress: (progress: WorkerProgress) => void,
    signal: AbortSignal,
  ) => Promise<WorkerResult>;
  /**
   * Baut den Output-Router für den Notion-Push nach erfolgreicher
   * Transkription. Optional, damit bestehende Aufrufstellen/Tests
   * unverändert bleiben — Default baut intern aus `repos`.
   */
  outputRouterFactory?: (libraryPath: string) => Promise<OutputRouter>;
}

export class TranscriptionManager {
  private readonly candidates = new Map<string, RecordingCandidate>();
  private running = false;
  private cancelRequested = false;
  private activeJob: TranscriptJob | null = null;
  private activeAbort: AbortController | null = null;
  private phase: TranscriptionPhase = 'idle';
  private message: string | undefined;
  private progress: { done: number; total: number } | undefined;

  constructor(private readonly options: TranscriptionManagerOptions) {
    options.repos.transcriptJobs.recoverInterrupted();
  }

  getSettings(): TranscriptionSettings {
    const mode = this.options.repos.settings.get('transcription_mode');
    const language = this.options.repos.settings.get('transcription_language');
    const model = this.options.repos.settings.get('transcription_model');
    return {
      mode: mode === 'manual' || mode === 'auto' || mode === 'none' ? mode : DEFAULT_SETTINGS.mode,
      language: language === 'de' || language === 'en' || language === 'auto'
        ? language
        : DEFAULT_SETTINGS.language,
      model: model === 'base' || model === 'small' || model === 'large-v3-turbo'
        ? model
        : DEFAULT_SETTINGS.model,
    };
  }

  setSettings(settings: TranscriptionSettings): TranscriptionSettings {
    this.options.repos.settings.set('transcription_mode', settings.mode);
    this.options.repos.settings.set('transcription_language', settings.language);
    this.options.repos.settings.set('transcription_model', settings.model);
    return this.getSettings();
  }

  async getWorkerStatus(): Promise<TranscriptionWorkerStatus> {
    const python = join(this.options.workerDir, '.venv', 'bin', 'python');
    const installed = await fileExists(python);
    return {
      installed,
      backend: process.arch === 'arm64' ? 'mlx-whisper' : 'faster-whisper',
      downloadedModels: [],
      message: installed ? undefined : 'Worker-Umgebung ist noch nicht eingerichtet.',
    };
  }

  async setupWorker(): Promise<TranscriptionWorkerStatus> {
    await runCommand('/usr/bin/env', ['uv', 'sync', '--frozen'], this.options.workerDir);
    return this.getWorkerStatus();
  }

  async scanRecordings(): Promise<RecordingCandidate[]> {
    this.phase = 'scanning';
    const courses = this.options.repos.courses.getSelected();
    const total = courses.length;
    if (total > 0 && courses[0]) {
      this.progress = { done: 0, total };
      this.message = `Ausgewählte Kurse werden nach Aufzeichnungen durchsucht: "${courses[0].fullname}" (1/${total})`;
    } else {
      this.message = 'Ausgewählte Kurse werden nach Aufzeichnungen durchsucht.';
    }
    this.publish();
    try {
      const client = new LearnwebClient(await this.options.getSession());
      const candidates: RecordingCandidate[] = [];
      const failedCourseIds: number[] = [];
      let done = 0;
      for (const course of courses) {
        try {
          this.progress = { done, total };
          this.message = `Ausgewählte Kurse werden nach Aufzeichnungen durchsucht: "${course.fullname}" (${done + 1}/${total})`;
          this.publish();
          const activities = await client.listActivities(course.courseId);
          this.options.repos.activities.upsertMany(activities);
          candidates.push(...await client.scanRecordings(activities));
        } catch (error) {
          failedCourseIds.push(course.courseId);
          console.error(`[transcription] Aufzeichnungs-Scan für Kurs ${course.courseId} fehlgeschlagen:`, error);
        } finally {
          done++;
        }
      }
      this.progress = { done, total };
      this.publish();
      this.candidates.clear();
      for (const candidate of candidates) this.candidates.set(candidate.recordingKey, candidate);
      this.phase = 'idle';
      this.message = failedCourseIds.length === 0
        ? `${this.candidates.size} Aufzeichnungen gefunden.`
        : `${this.candidates.size} Aufzeichnungen gefunden. ${failedCourseIds.length} Kurs(e) konnten nicht durchsucht werden.`;
      return [...this.candidates.values()];
    } finally {
      if (this.phase === 'scanning') this.phase = 'idle';
      this.progress = undefined;
      this.publish();
    }
  }

  enqueue(recordingKeys: string[]): TranscriptJob[] {
    for (const recordingKey of new Set(recordingKeys)) {
      const candidate = this.candidates.get(recordingKey);
      if (!candidate) throw new Error(`Unbekannte Aufzeichnung: ${recordingKey}`);
      this.options.repos.transcriptJobs.enqueueFromCandidate({
        courseId: candidate.courseId,
        activityCmid: candidate.activityCmid,
        sourceUrl: candidate.mediaUrl,
        recordingKey: candidate.recordingKey,
        title: candidate.title,
        sourceType: candidate.sourceKind,
        mediaUrl: candidate.mediaUrl,
        needsAuth: candidate.needsAuth,
        sectionName: candidate.sectionName,
        sectionIndex: candidate.sectionIndex,
        recordingDate: candidate.recordingDate,
      });
    }
    this.publish();
    return this.options.repos.transcriptJobs.getAll();
  }

  getJobs(): TranscriptJob[] {
    return this.options.repos.transcriptJobs.getAll();
  }

  getStatus(): TranscriptionStatus {
    const jobs = this.getJobs();
    const status: TranscriptionStatus = {
      phase: this.phase,
      activeJob: this.activeJob,
      queued: jobs.filter((job) => job.status === 'pending' || job.status === 'claimed').length,
      done: jobs.filter((job) => job.status === 'done').length,
      failed: jobs.filter((job) => job.status === 'failed_permanent' || job.status === 'failed_retryable').length,
      message: this.message,
    };
    if (this.progress) status.progress = this.progress;
    return status;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelRequested = false;
    try {
      let job = this.options.repos.transcriptJobs.claimNext();
      while (job && !this.cancelRequested) {
        await this.processJob(job);
        job = this.cancelRequested ? null : this.options.repos.transcriptJobs.claimNext();
      }
    } finally {
      this.running = false;
      this.activeJob = null;
      this.activeAbort = null;
      this.phase = 'idle';
      this.progress = undefined;
      this.publish();
    }
  }

  cancel(): void {
    if (!this.activeJob || !this.activeAbort) return;
    this.cancelRequested = true;
    this.activeAbort.abort();
    this.options.repos.transcriptJobs.setStatus(this.activeJob.id, 'pending', {
      errorCode: null,
      mediaLocalPath: null,
    });
    this.message = 'Transkription abgebrochen.';
  }

  retry(jobId: number): void {
    const job = this.options.repos.transcriptJobs.getById(jobId);
    if (!job || (job.status !== 'failed_retryable' && job.status !== 'failed_permanent')) {
      throw new Error('Nur fehlgeschlagene Jobs können wiederholt werden.');
    }
    this.options.repos.transcriptJobs.setStatus(jobId, 'pending', { errorCode: null });
    this.options.repos.transcriptJobs.resetRetry(jobId);
    this.publish();
  }

  /** Entfernt einen nicht-aktiven Job dauerhaft aus der Queue. */
  remove(jobId: number): void {
    const job = this.options.repos.transcriptJobs.getById(jobId);
    if (!job) throw new Error('Job nicht gefunden.');
    const inProgress = job.status === 'claimed'
      || job.status === 'downloading_media'
      || job.status === 'media_downloaded'
      || job.status === 'transcribing'
      || job.status === 'markdown_created';
    if (jobId === this.activeJob?.id || inProgress) {
      throw new Error('Aktive Jobs können nicht entfernt werden.');
    }
    this.options.repos.transcriptJobs.remove(jobId);
    this.publish();
  }

  private async processJob(job: TranscriptJob): Promise<void> {
    this.activeJob = job;
    this.activeAbort = new AbortController();
    let tempDir: string | null = null;
    try {
      const libraryRoot = this.options.getLibraryPath();
      if (!libraryRoot) throw new Error('Kein Bibliothekspfad konfiguriert.');
      const course = this.options.repos.courses.getAll().find((item) => item.courseId === job.courseId);
      if (!course) throw new Error('Kurs zum Transkriptionsjob fehlt.');
      const outputPath = join(
        libraryRoot,
        ...(course.semester ? [sanitizePathSegment(course.semester)] : []),
        sanitizePathSegment(course.fullname, 'Kurs'),
        ...(job.sectionName ? [sanitizePathSegment(job.sectionName, 'Allgemein')] : []),
        'Transkripte',
        `${sanitizePathSegment(job.title ?? 'Aufzeichnung')}-${sanitizePathSegment(job.recordingKey ?? String(job.id)).slice(0, 8)}.md`,
      );

      let mediaPath: string | undefined;
      if (job.needsAuth) {
        this.setPhase('downloading', 'Geschütztes Medium wird lokal bereitgestellt.');
        this.options.repos.transcriptJobs.setStatus(job.id, 'downloading_media');
        tempDir = await mkdtemp(join(tmpdir(), 'ucc-transcription-'));
        const session = await this.options.getSession();
        const mediaUrl = await resolveMediaUrl(session, job.mediaUrl ?? job.sourceUrl);
        mediaPath = join(tempDir, 'media.bin');
        let lastPublishTime = 0;
        await session.downloadFileToPath(mediaUrl, mediaPath, {
          maxBytes: MAX_MEDIA_BYTES,
          onProgress: (downloaded, total) => {
            const now = Date.now();
            const shouldPublish = now - lastPublishTime > 150 || downloaded === total;
            if (shouldPublish) {
              lastPublishTime = now;
              if (total) {
                this.progress = { done: downloaded, total };
                const pct = Math.round((downloaded / total) * 100);
                const mbDownloaded = (downloaded / (1024 * 1024)).toFixed(1);
                const mbTotal = (total / (1024 * 1024)).toFixed(1);
                this.message = `Geschütztes Medium wird lokal bereitgestellt: ${mbDownloaded} MB von ${mbTotal} MB (${pct}%)`;
              } else {
                this.progress = undefined;
                const mbDownloaded = (downloaded / (1024 * 1024)).toFixed(1);
                this.message = `Geschütztes Medium wird lokal bereitgestellt: ${mbDownloaded} MB heruntergeladen`;
              }
              this.publish();
            }
          },
        });
        this.options.repos.transcriptJobs.setStatus(job.id, 'media_downloaded', { mediaLocalPath: mediaPath });
      }
      if (this.activeAbort.signal.aborted) throw new WorkerError('CANCELLED');

      this.setPhase('transcribing', 'Lokale Transkription läuft.');
      this.options.repos.transcriptJobs.setStatus(job.id, 'transcribing');
      const settings = this.getSettings();
      const request: WorkerRequest = {
        id: job.id,
        source_kind: job.sourceType ?? 'media',
        media_url: job.needsAuth ? null : job.mediaUrl,
        source_url: job.sourceUrl,
        language: settings.language,
        model: settings.model,
        output_path: outputPath,
        library_root: libraryRoot,
        title: job.title ?? 'Aufzeichnung',
        metadata: { course_name: course.fullname, recording_date: job.recordingDate },
      };
      if (mediaPath) request.media_path = mediaPath;
      const runWorker = this.options.runWorker ?? ((workerRequest, onProgress, signal) =>
        runWorkerProcess(this.options.workerDir, workerRequest, onProgress, signal));
      const result = await runWorker(request, (workerProgress) => {
        this.phase = workerProgress.phase;
        this.progress = { done: workerProgress.done, total: workerProgress.total };
        this.publish();
      }, this.activeAbort.signal);

      this.options.repos.transcriptJobs.setStatus(job.id, 'markdown_created', {
        transcriptLocalPath: result.transcriptPath,
        model: result.model,
        durationSeconds: result.durationSeconds,
      });
      // Worker hat die .md-Datei bereits geschrieben (Subprozess-Vertrag bleibt
      // unverändert) — Notion-Push ist ein zusätzlicher, additiver Schritt danach.
      await this.pushTranscriptToOutputRouter(job, course, libraryRoot, result);
      this.options.repos.transcriptJobs.setStatus(job.id, 'done', { mediaLocalPath: null });
      this.message = 'Transkript wurde erstellt.';
    } catch (error) {
      if (this.activeAbort?.signal.aborted) return;
      const retries = this.options.repos.transcriptJobs.incrementRetry(job.id);
      const retryable = retries < MAX_RETRIES;
      this.options.repos.transcriptJobs.setStatus(job.id, retryable ? 'pending' : 'failed_permanent', {
        errorCode: error instanceof WorkerError ? error.code : 'TRANSCRIPTION_FAILED',
        mediaLocalPath: null,
      });
      this.phase = retryable ? 'idle' : 'error';
      this.message = retryable
        ? `Transkription fehlgeschlagen, neuer Versuch ${retries + 1}/${MAX_RETRIES}.`
        : 'Transkription nach mehreren Versuchen fehlgeschlagen.';
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
      this.activeJob = null;
      this.activeAbort = null;
      this.progress = undefined;
      this.publish();
    }
  }

  /**
   * Liest die vom Worker geschriebene .md-Datei zurück und reicht sie an den
   * Output-Router weiter (Notion-Leg läuft nur, wenn konfiguriert — das
   * entscheidet der Router selbst). Schlägt dieser zusätzliche Schritt fehl,
   * darf das einen bereits erfolgreich transkribierten Job NICHT als
   * fehlgeschlagen markieren — Fehler werden nur geloggt.
   */
  private async pushTranscriptToOutputRouter(
    job: TranscriptJob,
    course: Course,
    libraryRoot: string,
    result: WorkerResult,
  ): Promise<void> {
    try {
      const router = await (this.options.outputRouterFactory
        ? this.options.outputRouterFactory(libraryRoot)
        : this.buildDefaultRouter(libraryRoot));
      const markdown = await readFile(result.transcriptPath, 'utf-8');
      const placed = await router.placeTranscript({
        course: { courseId: course.courseId, fullname: course.fullname, semester: course.semester },
        title: job.title,
        recordingDate: job.recordingDate,
        model: result.model,
        durationSeconds: result.durationSeconds,
        markdown,
        alreadyWrittenLocalPath: result.transcriptPath,
      });
      if (placed.notion?.remoteRef) {
        const notionDatabaseId = this.options.repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY);
        if (notionDatabaseId) {
          this.options.repos.outputRefs.insert({
            sourceEntityType: 'transcript_job',
            sourceEntityId: job.id,
            notionDatabaseId,
            notionPageId: placed.notion.remoteRef,
          });
        }
      }
    } catch (error) {
      console.error(`[transcription] Output-Router-Push für Job ${job.id} fehlgeschlagen:`, error);
    }
  }

  private async buildDefaultRouter(libraryPath: string): Promise<OutputRouter> {
    const notion = await createNotionAdapter(this.options.repos);
    return new OutputRouter(
      { filesystem: new FilesystemAdapter(libraryPath), notion: notion ?? undefined },
      this.options.repos.settings,
    );
  }

  private setPhase(phase: TranscriptionPhase, message: string): void {
    this.phase = phase;
    this.message = message;
    this.progress = undefined;
    this.publish();
  }

  private publish(): void {
    this.options.onStatus(this.getStatus());
  }
}

class WorkerError extends Error {
  constructor(readonly code: string) {
    super('Transkriptions-Worker meldete einen Fehler.');
  }
}

async function runWorkerProcess(
  workerDir: string,
  request: WorkerRequest,
  onProgress: (progress: WorkerProgress) => void,
  signal: AbortSignal,
): Promise<WorkerResult> {
  const python = join(workerDir, '.venv', 'bin', 'python');
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new WorkerError('CANCELLED'));
      return;
    }
    const child: ChildProcessWithoutNullStreams = spawn(python, ['-m', 'transcription_worker.main'], {
      cwd: workerDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let settled = false;
    let errorOutput = '';
    const lines = createInterface({ input: child.stdout });
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      lines.close();
      callback();
    };
    signal.addEventListener('abort', () => {
      child.kill('SIGTERM');
      finish(() => reject(new WorkerError('CANCELLED')));
    }, { once: true });
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput = `${errorOutput}${chunk.toString('utf8')}`.slice(-4_096);
    });
    lines.on('line', (line) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        child.kill('SIGTERM');
        finish(() => reject(new WorkerError('INVALID_WORKER_OUTPUT')));
        return;
      }
      if (event.type === 'ready') {
        child.stdin.write(`${JSON.stringify(request)}\n`);
      } else if (event.type === 'progress') {
        onProgress({
          phase: event.phase as WorkerProgress['phase'],
          done: Number(event.done ?? 0),
          total: Number(event.total ?? 100),
        });
      } else if (event.type === 'error') {
        child.kill('SIGTERM');
        finish(() => reject(new WorkerError(String(event.code ?? 'WORKER_ERROR'))));
      } else if (event.type === 'result') {
        child.kill('SIGTERM');
        finish(() => resolve({
          transcriptPath: String(event.transcript_path),
          model: String(event.model),
          durationSeconds: Number(event.duration_seconds ?? 0),
        }));
      }
    });
    child.once('error', () => finish(() => reject(new WorkerError('WORKER_START_FAILED'))));
    child.once('exit', (code) => {
      if (settled) return;
      void errorOutput;
      finish(() => reject(new WorkerError(code === 0 ? 'WORKER_NO_RESULT' : 'WORKER_EXITED')));
    });
  });
}

async function resolveMediaUrl(session: LearnwebSession, candidateUrl: string): Promise<string> {
  if (/\.(?:mp4|m4a|mp3|webm|mov)(?:[?#]|$)/i.test(candidateUrl)) return candidateUrl;
  const response = await session.get(candidateUrl, { allowRedirects: true });
  const match = response.data.match(/(?:src|href)=["']([^"']+\.(?:mp4|m4a|mp3|webm|mov)(?:\?[^"']*)?)["']/i);
  if (!match?.[1]) throw new Error('Keine direkte Mediendatei in der Aufzeichnung gefunden.');
  return new URL(match[1], response.url).toString();
}

async function fileExists(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(path);
    stream.once('open', () => { stream.close(); resolve(true); });
    stream.once('error', () => resolve(false));
  });
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Worker-Setup fehlgeschlagen.')));
  });
}
