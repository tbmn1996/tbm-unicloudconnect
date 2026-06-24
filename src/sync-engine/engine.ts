import type { Repos } from '../db/repos';
import type { LearnwebClient } from '../learnweb-core/client';
import {
  LearnwebFileTooLargeError,
  LearnwebTimeoutError,
  type LearnwebSession,
} from '../learnweb-core/session';
import { FilesystemAdapter } from '../output-adapters/filesystem-adapter';
import { createNotionAdapter } from '../output-adapters/notion-adapter';
import { OutputRouter } from '../output-adapters/router';
import { OUTPUT_NOTION_DATABASE_ID_SETTING_KEY } from '../output-adapters/types';
import type { ActivityStatus, Course, DownloadJob, SyncRun, SyncStatus } from '../shared/domain';

type DownloadOutcome = Extract<ActivityStatus, 'downloaded' | 'deferred' | 'failed'>;

/** Timeout pro Download-Aufruf (ms). Begrenzt hängende Downloads (Issue #19). */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface SyncAccess {
  getClient(): Promise<LearnwebClient>;
  getSession(): Promise<LearnwebSession>;
  getLibraryPath(): string | null;
}

export class SyncEngine {
  private running: Promise<void> | null = null;
  private status: SyncStatus = { state: 'idle', lastRun: null, activeJobs: 0 };

  constructor(
    private readonly repos: Repos,
    private readonly access: SyncAccess,
    private readonly onStatus: (status: SyncStatus) => void = () => undefined,
    /**
     * Baut den Output-Router für einen Sync-Lauf. Optional, damit bestehende
     * Aufrufstellen/Tests unverändert bleiben — Default baut intern aus
     * `this.repos` (Filesystem immer aktiv, Notion additiv falls konfiguriert).
     */
    private readonly outputRouterFactory?: (libraryPath: string) => Promise<OutputRouter>,
  ) {}

  private async buildDefaultRouter(libraryPath: string): Promise<OutputRouter> {
    const notion = await createNotionAdapter(this.repos);
    return new OutputRouter(
      { filesystem: new FilesystemAdapter(libraryPath), notion: notion ?? undefined },
      this.repos.settings,
    );
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  notifyCurrentStatus(): void {
    this.onStatus(this.status);
  }

  start(): void {
    void this.run('manual').catch(() => undefined);
  }

  async run(trigger: 'manual' | 'startup' | 'scheduled' = 'manual'): Promise<void> {
    if (this.running) return this.running;
    const task = this.execute(trigger);
    this.running = task;
    try {
      await task;
    } finally {
      if (this.running === task) this.running = null;
    }
  }

  private async execute(trigger: 'manual' | 'startup' | 'scheduled'): Promise<void> {
    const isNotionOnly = this.repos.settings.get('output.adapter') === 'notion';
    const libraryPath = this.access.getLibraryPath();
    if (!libraryPath && !isNotionOnly) {
      throw new Error('Kein Bibliotheksordner konfiguriert.');
    }
    // Einmal pro Lauf bauen (nicht pro Datei) — vermeidet wiederholte Keychain-/Settings-Lookups.
    const router = await (this.outputRouterFactory
      ? this.outputRouterFactory(libraryPath ?? '')
      : this.buildDefaultRouter(libraryPath ?? ''));

    const courses = this.repos.courses.getSelected();
    const runId = this.repos.syncRuns.start(trigger);
    this.setStatus({ state: 'syncing', lastRun: this.repos.syncRuns.getLast(), activeJobs: 0 });
    const counters = { activities: 0, downloaded: 0, warnings: 0, errors: 0 };

    try {
      const client = await this.access.getClient();
      const session = await this.access.getSession();
      for (const [courseIndex, course] of courses.entries()) {
        const activities = await client.listActivities(course.courseId);
        this.repos.activities.upsertMany(activities);
        counters.activities += activities.length;

        const downloadable = activities.filter((activity) =>
          activity.modtype === 'resource' || activity.modtype === 'folder');
        for (const activity of downloadable) {
          const targets = await client.resolveDownloadTargets(activity);
          if (targets.length === 0) continue;
          this.repos.activities.setStatus(activity.cmid, 'download_pending');
          // Targets derselben Activity (z. B. Dateien in einem Ordner) parallel verarbeiten.
          // Die echte Netzwerk-Parallelität wird bereits in downloadFile() durch den
          // Semaphore (INTRA_CALL_CONCURRENCY = 3) begrenzt — hier ist kein eigener
          // Limiter nötig (Issue #18).
          const outcomes: DownloadOutcome[] = await Promise.all(targets.map((target) =>
            this.processDownload({
              course,
              activity,
              target,
              router,
              session,
              counters,
            })));
          this.repos.activities.setStatus(activity.cmid, finalActivityStatus(outcomes));
        }
        this.setStatus({
          ...this.status,
          message: `${courseIndex + 1} von ${courses.length} Kursen verarbeitet`,
          progress: { done: courseIndex + 1, total: courses.length },
        });
      }

      this.finishRun(runId, courses.length, counters, counters.warnings > 0 ? 'warnings' : 'success');
      this.setStatus({
        state: counters.errors > 0 ? 'error' : 'idle',
        lastRun: this.repos.syncRuns.getLast(),
        activeJobs: 0,
        message: `${counters.downloaded} Dateien synchronisiert`,
      });
    } catch (error) {
      counters.errors++;
      this.finishRun(runId, courses.length, counters, 'failed');
      this.setStatus({
        state: 'error',
        lastRun: this.repos.syncRuns.getLast(),
        activeJobs: 0,
        message: error instanceof Error ? error.message : 'Synchronisation fehlgeschlagen.',
      });
      throw error;
    }
  }

  private async processDownload(input: {
    course: Course;
    activity: { cmid: number; sectionName: string | null };
    target: { activityCmid: number; sourceUrl: string; filename: string };
    router: OutputRouter;
    session: LearnwebSession;
    counters: { downloaded: number; warnings: number; errors: number };
  }): Promise<DownloadOutcome> {
    const jobId = this.repos.downloadJobs.insert({
      activityCmid: input.target.activityCmid,
      courseId: input.course.courseId,
      sourceUrl: input.target.sourceUrl,
      status: 'running',
    });
    this.setStatus({ ...this.status, activeJobs: this.status.activeJobs + 1 });
    try {
      const download = await input.session.downloadFile(input.target.sourceUrl, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      const notionDatabaseId = this.repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY);
      const existingAsset = this.repos.fileAssets.findBySourceUrl(input.target.sourceUrl);
      const alreadyPushedToNotion = !!(existingAsset && notionDatabaseId
        && this.repos.outputRefs.getBySource('file_asset', existingAsset.id, notionDatabaseId));
      const placed = await input.router.placeFile({
        course: {
          courseId: input.course.courseId,
          fullname: input.course.fullname,
          semester: input.course.semester,
        },
        sectionName: input.activity.sectionName,
        filename: download.filename ?? input.target.filename,
        bytes: download.bytes,
        findExistingByHash: (hash) => {
          const found = this.repos.fileAssets.findByHash(hash);
          return found && found.localPath ? { localPath: found.localPath } : null;
        },
      }, { skipNotion: alreadyPushedToNotion });
      input.counters.warnings += placed.warnings.length;
      const stored = placed.filesystem;
      const fileAsset = this.repos.fileAssets.upsertBySourceUrl({
        activityCmid: input.target.activityCmid,
        courseId: input.course.courseId,
        sourceUrl: input.target.sourceUrl,
        filenameOriginal: download.filename ?? input.target.filename,
        filenameLocal: stored
          ? stored.filename
          : (placed.notion?.filename ?? existingAsset?.filenameLocal ?? download.filename ?? input.target.filename),
        localPath: stored ? (stored.relativePath ?? '') : null,
        sizeBytes: stored
          ? stored.sizeBytes
          : (placed.notion?.sizeBytes ?? existingAsset?.sizeBytes ?? download.bytes.byteLength),
        hash: stored ? stored.hash : (placed.notion?.hash ?? existingAsset?.hash ?? null),
        status: (stored && stored.duplicate) ? 'skipped_duplicate' : 'downloaded',
        downloadedAt: new Date().toISOString(),
      });
      if (placed.notion?.remoteRef) {
        if (notionDatabaseId && !this.repos.outputRefs.getBySource('file_asset', fileAsset.id, notionDatabaseId)) {
          this.repos.outputRefs.insert({
            sourceEntityType: 'file_asset',
            sourceEntityId: fileAsset.id,
            notionDatabaseId,
            notionPageId: placed.notion.remoteRef,
          });
        }
      }
      // Reine Quelldateien haben keinen Pending-Speicher: scheitert nur der
      // Notion-Push, lädt der nächste Sync-Lauf die Datei erneut aus LearnWeb.
      this.updateJob(jobId, {
        status: (stored && stored.duplicate) ? 'skipped_duplicate' : 'done',
        localPath: stored ? (stored.relativePath ?? null) : null,
        sizeBytes: stored ? stored.sizeBytes : (placed.notion?.sizeBytes ?? download.bytes.byteLength),
      });
      if (!stored || !stored.duplicate) input.counters.downloaded++;
      return 'downloaded';
    } catch (error) {
      const tooLarge = error instanceof LearnwebFileTooLargeError;
      const timedOut = !tooLarge && error instanceof LearnwebTimeoutError;
      this.updateJob(jobId, {
        status: tooLarge ? 'skipped_too_large' : 'failed_retryable',
        errorMessage: tooLarge
          ? 'Datei überschreitet das Größenlimit.'
          : timedOut
            ? 'Zeitlimit beim Download überschritten.'
            : 'Download fehlgeschlagen.',
        retryCount: tooLarge ? 0 : 1,
      });
      input.counters.warnings++;
      if (!tooLarge) input.counters.errors++;
      return tooLarge ? 'deferred' : 'failed';
    } finally {
      this.setStatus({ ...this.status, activeJobs: Math.max(0, this.status.activeJobs - 1) });
    }
  }

  private updateJob(id: number, patch: Partial<DownloadJob>): void {
    const job = this.repos.downloadJobs.getById(id);
    if (!job) throw new Error(`Download-Job ${id} wurde nicht gefunden.`);
    this.repos.downloadJobs.update({ ...job, ...patch });
  }

  private finishRun(
    id: number,
    coursesChecked: number,
    counters: { activities: number; downloaded: number; warnings: number; errors: number },
    status: SyncRun['status'],
  ): void {
    const run = this.repos.syncRuns.getLast();
    if (!run || run.id !== id) return;
    this.repos.syncRuns.finish({
      ...run,
      status,
      coursesChecked,
      activitiesSeen: counters.activities,
      filesDownloaded: counters.downloaded,
      warningsCount: counters.warnings,
      errorsCount: counters.errors,
    });
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}

function finalActivityStatus(outcomes: DownloadOutcome[]): DownloadOutcome {
  if (outcomes.includes('failed')) return 'failed';
  if (outcomes.includes('deferred')) return 'deferred';
  return 'downloaded';
}
