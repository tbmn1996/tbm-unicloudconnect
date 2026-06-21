/**
 * Repository-Schicht über better-sqlite3.
 *
 * Jede Factory `makeXRepo(db)` kapselt prepared statements und mappt zwischen
 * der SQLite-Zeilenform (snake_case, 0/1) und den Domänen-Typen (camelCase,
 * boolean) aus src/shared/domain.ts.
 */
import type { AppDatabase } from './db';
import type {
  Activity,
  ActivityStatus,
  Course,
  CredentialRef,
  DownloadJob,
  DownloadJobStatus,
  FileAsset,
  McpStatus,
  Profile,
  SelectionRule,
  SyncRun,
  SyncTrigger,
  TranscriptJob,
  TranscriptJobStatus,
} from '../shared/domain';

// --- Konvertierungshelfer ---------------------------------------------------

const toBool = (v: unknown): boolean => v === 1 || v === true;
const toInt = (v: boolean): number => (v ? 1 : 0);
const nowIso = (): string => new Date().toISOString();

// --- profiles ---------------------------------------------------------------

export function makeProfilesRepo(db: AppDatabase) {
  const get = db.prepare('SELECT * FROM profiles ORDER BY id LIMIT 1');
  const insert = db.prepare(
    'INSERT INTO profiles (display_name, default_library_path) VALUES (?, ?)',
  );
  const updatePath = db.prepare('UPDATE profiles SET default_library_path = ? WHERE id = ?');
  const updateName = db.prepare('UPDATE profiles SET display_name = ? WHERE id = ?');

  const map = (r: Record<string, unknown>): Profile => ({
    id: r.id as number,
    displayName: r.display_name as string,
    defaultLibraryPath: (r.default_library_path as string | null) ?? null,
    createdAt: r.created_at as string,
  });

  return {
    get(): Profile | null {
      const row = get.get() as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
    create(displayName: string, defaultLibraryPath: string | null = null): Profile {
      const info = insert.run(displayName, defaultLibraryPath);
      return { id: Number(info.lastInsertRowid), displayName, defaultLibraryPath, createdAt: nowIso() };
    },
    setLibraryPath(id: number, path: string): void {
      updatePath.run(path, id);
    },
    setDisplayName(id: number, name: string): void {
      updateName.run(name, id);
    },
  };
}

// --- credential_refs --------------------------------------------------------

export function makeCredentialRefsRepo(db: AppDatabase) {
  const get = db.prepare('SELECT * FROM credential_refs ORDER BY id LIMIT 1');
  const upsert = db.prepare(
    `INSERT INTO credential_refs (provider, secret_store, service_name, account_name)
     VALUES (@provider, @secretStore, @serviceName, @accountName)`,
  );
  const clear = db.prepare('DELETE FROM credential_refs');
  const setVerified = db.prepare('UPDATE credential_refs SET last_verified_at = ? WHERE id = ?');

  const map = (r: Record<string, unknown>): CredentialRef => ({
    id: r.id as number,
    provider: r.provider as string,
    secretStore: r.secret_store as string,
    serviceName: r.service_name as string,
    accountName: r.account_name as string,
    lastVerifiedAt: (r.last_verified_at as string | null) ?? null,
  });

  return {
    get(): CredentialRef | null {
      const row = get.get() as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
    /** Es gibt im MVP genau einen LearnWeb-Credential-Verweis -> ersetzen. */
    set(input: { serviceName: string; accountName: string; provider?: string }): void {
      const tx = db.transaction(() => {
        clear.run();
        upsert.run({
          provider: input.provider ?? 'learnweb',
          secretStore: 'macos_keychain',
          serviceName: input.serviceName,
          accountName: input.accountName,
        });
      });
      tx();
    },
    markVerified(id: number): void {
      setVerified.run(nowIso(), id);
    },
  };
}

// --- courses ----------------------------------------------------------------

export function makeCoursesRepo(db: AppDatabase) {
  const upsert = db.prepare(
    `INSERT INTO courses (course_id, fullname, shortname, semester, course_url, first_seen_at, last_seen_at)
     VALUES (@courseId, @fullname, @shortname, @semester, @courseUrl, @now, @now)
     ON CONFLICT(course_id) DO UPDATE SET
       fullname = excluded.fullname,
       shortname = excluded.shortname,
       semester = excluded.semester,
       course_url = excluded.course_url,
       last_seen_at = excluded.last_seen_at`,
  );
  const all = db.prepare('SELECT * FROM courses ORDER BY fullname');
  const selected = db.prepare('SELECT * FROM courses WHERE is_selected = 1 ORDER BY fullname');
  const setSel = db.prepare('UPDATE courses SET is_selected = ? WHERE course_id = ?');

  const map = (r: Record<string, unknown>): Course => ({
    courseId: r.course_id as number,
    fullname: r.fullname as string,
    shortname: (r.shortname as string | null) ?? null,
    semester: (r.semester as string | null) ?? null,
    courseUrl: (r.course_url as string | null) ?? null,
    isSelected: toBool(r.is_selected),
    firstSeenAt: (r.first_seen_at as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
  });

  return {
    upsertMany(courses: Array<Pick<Course, 'courseId' | 'fullname'> & Partial<Course>>): void {
      const now = nowIso();
      const tx = db.transaction(() => {
        for (const c of courses) {
          upsert.run({
            courseId: c.courseId,
            fullname: c.fullname,
            shortname: c.shortname ?? null,
            semester: c.semester ?? null,
            courseUrl: c.courseUrl ?? null,
            now,
          });
        }
      });
      tx();
    },
    getAll(): Course[] {
      return (all.all() as Record<string, unknown>[]).map(map);
    },
    getSelected(): Course[] {
      return (selected.all() as Record<string, unknown>[]).map(map);
    },
    setSelected(courseId: number, isSelected: boolean): void {
      setSel.run(toInt(isSelected), courseId);
    },
  };
}

// --- activities -------------------------------------------------------------

export function makeActivitiesRepo(db: AppDatabase) {
  const upsert = db.prepare(
    `INSERT INTO activities (cmid, course_id, modtype, name, section_name, section_index, view_url, last_seen_at)
     VALUES (@cmid, @courseId, @modtype, @name, @sectionName, @sectionIndex, @viewUrl, @now)
     ON CONFLICT(cmid) DO UPDATE SET
       modtype = excluded.modtype,
       name = excluded.name,
       section_name = excluded.section_name,
       section_index = excluded.section_index,
       view_url = excluded.view_url,
       last_seen_at = excluded.last_seen_at`,
  );
  const byCourse = db.prepare('SELECT * FROM activities WHERE course_id = ? ORDER BY section_index, name');
  const selected = db.prepare('SELECT * FROM activities WHERE is_selected = 1');
  const setSel = db.prepare('UPDATE activities SET is_selected = ? WHERE cmid = ?');
  const setStatus = db.prepare('UPDATE activities SET status = ? WHERE cmid = ?');

  const map = (r: Record<string, unknown>): Activity => ({
    cmid: r.cmid as number,
    courseId: r.course_id as number,
    modtype: r.modtype as string,
    name: r.name as string,
    sectionName: (r.section_name as string | null) ?? null,
    sectionIndex: (r.section_index as number | null) ?? null,
    viewUrl: (r.view_url as string | null) ?? null,
    isSelected: toBool(r.is_selected),
    status: r.status as ActivityStatus,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
  });

  return {
    upsertMany(items: Array<Pick<Activity, 'cmid' | 'courseId' | 'modtype' | 'name'> & Partial<Activity>>): void {
      const now = nowIso();
      const tx = db.transaction(() => {
        for (const a of items) {
          upsert.run({
            cmid: a.cmid,
            courseId: a.courseId,
            modtype: a.modtype,
            name: a.name,
            sectionName: a.sectionName ?? null,
            sectionIndex: a.sectionIndex ?? null,
            viewUrl: a.viewUrl ?? null,
            now,
          });
        }
      });
      tx();
    },
    getByCourse(courseId: number): Activity[] {
      return (byCourse.all(courseId) as Record<string, unknown>[]).map(map);
    },
    getSelected(): Activity[] {
      return (selected.all() as Record<string, unknown>[]).map(map);
    },
    setSelected(cmid: number, isSelected: boolean): void {
      setSel.run(toInt(isSelected), cmid);
    },
    setStatus(cmid: number, status: ActivityStatus): void {
      setStatus.run(status, cmid);
    },
  };
}

// --- file_assets ------------------------------------------------------------

export function makeFileAssetsRepo(db: AppDatabase) {
  const insert = db.prepare(
    `INSERT INTO file_assets (activity_cmid, course_id, source_url, filename_original, filename_local, local_path, size_bytes, hash, status, downloaded_at)
     VALUES (@activityCmid, @courseId, @sourceUrl, @filenameOriginal, @filenameLocal, @localPath, @sizeBytes, @hash, @status, @downloadedAt)`,
  );
  const all = db.prepare('SELECT * FROM file_assets ORDER BY downloaded_at DESC');
  const byHash = db.prepare('SELECT * FROM file_assets WHERE hash = ? LIMIT 1');
  const bySourceUrl = db.prepare('SELECT * FROM file_assets WHERE source_url = ? ORDER BY id LIMIT 1');
  const update = db.prepare(
    `UPDATE file_assets SET activity_cmid = @activityCmid, course_id = @courseId,
       filename_original = @filenameOriginal, filename_local = @filenameLocal,
       local_path = @localPath, size_bytes = @sizeBytes, hash = @hash,
       status = @status, downloaded_at = @downloadedAt WHERE id = @id`,
  );

  const map = (r: Record<string, unknown>): FileAsset => ({
    id: r.id as number,
    activityCmid: (r.activity_cmid as number | null) ?? null,
    courseId: r.course_id as number,
    sourceUrl: r.source_url as string,
    filenameOriginal: r.filename_original as string,
    filenameLocal: r.filename_local as string,
    localPath: r.local_path as string,
    sizeBytes: (r.size_bytes as number | null) ?? null,
    hash: (r.hash as string | null) ?? null,
    status: r.status as FileAsset['status'],
    downloadedAt: (r.downloaded_at as string | null) ?? null,
  });

  return {
    insert(asset: Omit<FileAsset, 'id'>): FileAsset {
      const info = insert.run({
        activityCmid: asset.activityCmid,
        courseId: asset.courseId,
        sourceUrl: asset.sourceUrl,
        filenameOriginal: asset.filenameOriginal,
        filenameLocal: asset.filenameLocal,
        localPath: asset.localPath,
        sizeBytes: asset.sizeBytes,
        hash: asset.hash,
        status: asset.status,
        downloadedAt: asset.downloadedAt,
      });
      return { ...asset, id: Number(info.lastInsertRowid) };
    },
    upsertBySourceUrl(asset: Omit<FileAsset, 'id'>): FileAsset {
      const existingRow = bySourceUrl.get(asset.sourceUrl) as Record<string, unknown> | undefined;
      if (!existingRow) return this.insert(asset);
      const existing = map(existingRow);
      const updated = { ...asset, id: existing.id };
      update.run({
        id: updated.id,
        activityCmid: updated.activityCmid,
        courseId: updated.courseId,
        filenameOriginal: updated.filenameOriginal,
        filenameLocal: updated.filenameLocal,
        localPath: updated.localPath,
        sizeBytes: updated.sizeBytes,
        hash: updated.hash,
        status: updated.status,
        downloadedAt: updated.downloadedAt,
      });
      return updated;
    },
    getAll(): FileAsset[] {
      return (all.all() as Record<string, unknown>[]).map(map);
    },
    findByHash(hash: string): FileAsset | null {
      const row = byHash.get(hash) as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
  };
}

// --- download_jobs ----------------------------------------------------------

export function makeDownloadJobsRepo(db: AppDatabase) {
  const insert = db.prepare(
    `INSERT INTO download_jobs (activity_cmid, course_id, source_url, local_path, status)
     VALUES (@activityCmid, @courseId, @sourceUrl, @localPath, @status)`,
  );
  const byStatus = db.prepare('SELECT * FROM download_jobs WHERE status = ? ORDER BY id');
  const byId = db.prepare('SELECT * FROM download_jobs WHERE id = ?');
  const update = db.prepare(
    `UPDATE download_jobs SET status = @status, local_path = @localPath, size_bytes = @sizeBytes,
       error_message = @errorMessage, retry_count = @retryCount, updated_at = @now WHERE id = @id`,
  );

  const map = (r: Record<string, unknown>): DownloadJob => ({
    id: r.id as number,
    activityCmid: (r.activity_cmid as number | null) ?? null,
    courseId: r.course_id as number,
    sourceUrl: r.source_url as string,
    localPath: (r.local_path as string | null) ?? null,
    status: r.status as DownloadJobStatus,
    sizeBytes: (r.size_bytes as number | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    retryCount: r.retry_count as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  });

  return {
    insert(input: { activityCmid: number | null; courseId: number; sourceUrl: string; localPath?: string | null; status?: DownloadJobStatus }): number {
      const info = insert.run({
        activityCmid: input.activityCmid,
        courseId: input.courseId,
        sourceUrl: input.sourceUrl,
        localPath: input.localPath ?? null,
        status: input.status ?? 'pending',
      });
      return Number(info.lastInsertRowid);
    },
    getByStatus(status: DownloadJobStatus): DownloadJob[] {
      return (byStatus.all(status) as Record<string, unknown>[]).map(map);
    },
    getById(id: number): DownloadJob | null {
      const row = byId.get(id) as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
    update(job: DownloadJob): void {
      update.run({
        id: job.id,
        status: job.status,
        localPath: job.localPath,
        sizeBytes: job.sizeBytes,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
        now: nowIso(),
      });
    },
  };
}

// --- selection_rules -------------------------------------------------------

export function makeSelectionRulesRepo(db: AppDatabase) {
  const insert = db.prepare(
    `INSERT INTO selection_rules
       (course_id, scope, scope_ref, sync_files, transcribe_recordings, include_new_items, is_active)
     VALUES (@courseId, @scope, @scopeRef, @syncFiles, @transcribeRecordings, @includeNewItems, @isActive)`,
  );
  const byCourse = db.prepare('SELECT * FROM selection_rules WHERE course_id = ? ORDER BY id');
  const setActive = db.prepare(
    `UPDATE selection_rules SET is_active = ?, updated_at = datetime('now') WHERE id = ?`,
  );
  const remove = db.prepare('DELETE FROM selection_rules WHERE id = ?');

  const map = (r: Record<string, unknown>): SelectionRule => ({
    id: r.id as number,
    courseId: r.course_id as number,
    scope: r.scope as SelectionRule['scope'],
    scopeRef: (r.scope_ref as string | null) ?? null,
    syncFiles: toBool(r.sync_files),
    transcribeRecordings: toBool(r.transcribe_recordings),
    includeNewItems: toBool(r.include_new_items),
    isActive: toBool(r.is_active),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  });

  return {
    insert(input: Omit<SelectionRule, 'id' | 'createdAt' | 'updatedAt'>): number {
      return Number(insert.run({
        courseId: input.courseId,
        scope: input.scope,
        scopeRef: input.scopeRef,
        syncFiles: toInt(input.syncFiles),
        transcribeRecordings: toInt(input.transcribeRecordings),
        includeNewItems: toInt(input.includeNewItems),
        isActive: toInt(input.isActive),
      }).lastInsertRowid);
    },
    getByCourse(courseId: number): SelectionRule[] {
      return (byCourse.all(courseId) as Record<string, unknown>[]).map(map);
    },
    setActive(id: number, active: boolean): void {
      setActive.run(toInt(active), id);
    },
    delete(id: number): void {
      remove.run(id);
    },
  };
}

// --- transcript_jobs -------------------------------------------------------

export function makeTranscriptJobsRepo(db: AppDatabase) {
  const insert = db.prepare(
    `INSERT INTO transcript_jobs (course_id, activity_cmid, source_url, status, model)
     VALUES (@courseId, @activityCmid, @sourceUrl, @status, @model)`,
  );
  const byStatus = db.prepare('SELECT * FROM transcript_jobs WHERE status = ? ORDER BY id');
  const update = db.prepare(
    `UPDATE transcript_jobs SET status = @status, media_local_path = @mediaLocalPath,
       transcript_local_path = @transcriptLocalPath, model = @model,
       duration_seconds = @durationSeconds, error_code = @errorCode,
       updated_at = datetime('now') WHERE id = @id`,
  );

  const map = (r: Record<string, unknown>): TranscriptJob => ({
    id: r.id as number,
    courseId: r.course_id as number,
    activityCmid: (r.activity_cmid as number | null) ?? null,
    sourceUrl: r.source_url as string,
    mediaLocalPath: (r.media_local_path as string | null) ?? null,
    transcriptLocalPath: (r.transcript_local_path as string | null) ?? null,
    status: r.status as TranscriptJobStatus,
    model: (r.model as string | null) ?? null,
    durationSeconds: (r.duration_seconds as number | null) ?? null,
    errorCode: (r.error_code as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  });

  return {
    insert(input: {
      courseId: number;
      activityCmid: number | null;
      sourceUrl: string;
      status?: TranscriptJobStatus;
      model?: string | null;
    }): number {
      return Number(insert.run({
        courseId: input.courseId,
        activityCmid: input.activityCmid,
        sourceUrl: input.sourceUrl,
        status: input.status ?? 'pending',
        model: input.model ?? null,
      }).lastInsertRowid);
    },
    getByStatus(status: TranscriptJobStatus): TranscriptJob[] {
      return (byStatus.all(status) as Record<string, unknown>[]).map(map);
    },
    update(job: TranscriptJob): void {
      update.run({
        id: job.id,
        status: job.status,
        mediaLocalPath: job.mediaLocalPath,
        transcriptLocalPath: job.transcriptLocalPath,
        model: job.model,
        durationSeconds: job.durationSeconds,
        errorCode: job.errorCode,
      });
    },
  };
}

// --- sync_runs --------------------------------------------------------------

export function makeSyncRunsRepo(db: AppDatabase) {
  const start = db.prepare("INSERT INTO sync_runs (trigger, status) VALUES (?, 'running')");
  const finish = db.prepare(
    `UPDATE sync_runs SET finished_at = @now, status = @status, courses_checked = @coursesChecked,
       activities_seen = @activitiesSeen, files_downloaded = @filesDownloaded,
       transcripts_created = @transcriptsCreated, warnings_count = @warningsCount,
       errors_count = @errorsCount WHERE id = @id`,
  );
  const last = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1');

  const map = (r: Record<string, unknown>): SyncRun => ({
    id: r.id as number,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
    status: r.status as SyncRun['status'],
    trigger: r.trigger as SyncTrigger,
    coursesChecked: r.courses_checked as number,
    activitiesSeen: r.activities_seen as number,
    filesDownloaded: r.files_downloaded as number,
    transcriptsCreated: r.transcripts_created as number,
    warningsCount: r.warnings_count as number,
    errorsCount: r.errors_count as number,
  });

  return {
    start(trigger: SyncTrigger): number {
      return Number(start.run(trigger).lastInsertRowid);
    },
    finish(run: SyncRun): void {
      finish.run({
        id: run.id,
        status: run.status,
        coursesChecked: run.coursesChecked,
        activitiesSeen: run.activitiesSeen,
        filesDownloaded: run.filesDownloaded,
        transcriptsCreated: run.transcriptsCreated,
        warningsCount: run.warningsCount,
        errorsCount: run.errorsCount,
        now: nowIso(),
      });
    },
    getLast(): SyncRun | null {
      const row = last.get() as Record<string, unknown> | undefined;
      return row ? map(row) : null;
    },
  };
}

// --- settings ---------------------------------------------------------------

export function makeSettingsRepo(db: AppDatabase) {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?');
  const set = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const all = db.prepare('SELECT key, value FROM settings');

  return {
    get(key: string): string | null {
      const row = get.get(key) as { value: string | null } | undefined;
      return row?.value ?? null;
    },
    set(key: string, value: string): void {
      set.run(key, value);
    },
    getAll(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const r of all.all() as Array<{ key: string; value: string | null }>) {
        if (r.value != null) out[r.key] = r.value;
      }
      return out;
    },
  };
}

// --- mcp_status -------------------------------------------------------------

export function makeMcpStatusRepo(db: AppDatabase) {
  const get = db.prepare('SELECT * FROM mcp_status ORDER BY id LIMIT 1');
  const insert = db.prepare('INSERT INTO mcp_status (enabled, configured_at) VALUES (?, ?)');
  const update = db.prepare('UPDATE mcp_status SET enabled = ?, last_checked_at = ? WHERE id = ?');

  const map = (r: Record<string, unknown>): McpStatus => ({
    id: r.id as number,
    enabled: toBool(r.enabled),
    configuredAt: (r.configured_at as string | null) ?? null,
    lastCheckedAt: (r.last_checked_at as string | null) ?? null,
  });

  return {
    get(): McpStatus {
      const row = get.get() as Record<string, unknown> | undefined;
      if (row) return map(row);
      // Defaultzeile anlegen (MCP standardmäßig deaktiviert).
      const info = insert.run(0, null);
      return { id: Number(info.lastInsertRowid), enabled: false, configuredAt: null, lastCheckedAt: null };
    },
    set(enabled: boolean): void {
      const current = this.get();
      update.run(toInt(enabled), nowIso(), current.id);
    },
  };
}

// --- Aggregator -------------------------------------------------------------

export function createRepos(db: AppDatabase) {
  return {
    profiles: makeProfilesRepo(db),
    credentials: makeCredentialRefsRepo(db),
    courses: makeCoursesRepo(db),
    activities: makeActivitiesRepo(db),
    fileAssets: makeFileAssetsRepo(db),
    downloadJobs: makeDownloadJobsRepo(db),
    selectionRules: makeSelectionRulesRepo(db),
    transcriptJobs: makeTranscriptJobsRepo(db),
    syncRuns: makeSyncRunsRepo(db),
    settings: makeSettingsRepo(db),
    mcp: makeMcpStatusRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;
