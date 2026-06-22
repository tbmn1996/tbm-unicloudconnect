import type { Repos } from '../db/repos';
import type { LearnwebClient } from '../learnweb-core/client';
import {
  LearnwebFileTooLargeError,
  type LearnwebSession,
} from '../learnweb-core/session';
import { buildRelativeLibraryPath } from '../local-library/paths';
import { storeFile } from '../local-library/store';
import type { ActivityStatus, Course, DownloadJob, SyncRun, SyncStatus } from '../shared/domain';

type DownloadOutcome = Extract<ActivityStatus, 'downloaded' | 'deferred' | 'failed'>;

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
  ) {}

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
    const libraryPath = this.access.getLibraryPath();
    if (!libraryPath) throw new Error('Kein Bibliotheksordner konfiguriert.');

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
          const outcomes: DownloadOutcome[] = [];
          for (const target of targets) {
            outcomes.push(await this.processDownload({
              course,
              activity,
              target,
              libraryPath,
              session,
              counters,
            }));
          }
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
    libraryPath: string;
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
      const download = await input.session.downloadFile(input.target.sourceUrl);
      const relativePath = buildRelativeLibraryPath({
        semester: input.course.semester,
        courseName: input.course.fullname,
        sectionName: input.activity.sectionName,
        filename: download.filename ?? input.target.filename,
      });
      const stored = await storeFile({
        rootPath: input.libraryPath,
        relativePath,
        bytes: download.bytes,
        findExistingByHash: (hash) => this.repos.fileAssets.findByHash(hash),
      });
      this.repos.fileAssets.upsertBySourceUrl({
        activityCmid: input.target.activityCmid,
        courseId: input.course.courseId,
        sourceUrl: input.target.sourceUrl,
        filenameOriginal: download.filename ?? input.target.filename,
        filenameLocal: stored.filename,
        localPath: stored.relativePath,
        sizeBytes: stored.sizeBytes,
        hash: stored.hash,
        status: stored.duplicate ? 'skipped_duplicate' : 'downloaded',
        downloadedAt: new Date().toISOString(),
      });
      this.updateJob(jobId, {
        status: stored.duplicate ? 'skipped_duplicate' : 'done',
        localPath: stored.relativePath,
        sizeBytes: stored.sizeBytes,
      });
      if (!stored.duplicate) input.counters.downloaded++;
      return 'downloaded';
    } catch (error) {
      const tooLarge = error instanceof LearnwebFileTooLargeError;
      this.updateJob(jobId, {
        status: tooLarge ? 'skipped_too_large' : 'failed_retryable',
        errorMessage: tooLarge ? 'Datei überschreitet das Größenlimit.' : 'Download fehlgeschlagen.',
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
