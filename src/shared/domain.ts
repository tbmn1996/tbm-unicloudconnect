/**
 * Zentrale Domänentypen + Status-Enums von TBM UniCloudConnect.
 *
 * Kanonische Quellen: docs/ARCHITECTURE.md (SQLite-Schema) und
 * docs/MVP1_SCOPE.md (Statusübergänge). Diese Datei ist der gemeinsame Vertrag
 * zwischen Main-Prozess (Node) und Renderer (DOM/React) — deshalb enthält sie
 * AUSSCHLIESSLICH reine Typen und Konstanten, KEINE Node-/Electron-Imports.
 */

// ---------------------------------------------------------------------------
// Status-Enums (als TS-Union-Typen; per CHECK-Constraint im SQLite-Schema gespiegelt)
// ---------------------------------------------------------------------------

/** Zustände einer Kurs-Aktivität (docs/MVP1_SCOPE.md §1). */
export type ActivityStatus =
  | 'discovered'
  | 'selected'
  | 'ignored'
  | 'download_pending'
  | 'downloaded'
  | 'deferred'
  | 'failed'
  | 'removed';

/** Zustände eines Download-Jobs (docs/MVP1_SCOPE.md §2). */
export type DownloadJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'skipped_duplicate'
  | 'skipped_too_large';

/** Zustände eines Transkriptions-Jobs (docs/MVP1_SCOPE.md §3; erst im späteren Schnitt aktiv). */
export type TranscriptJobStatus =
  | 'pending'
  | 'claimed'
  | 'downloading_media'
  | 'media_downloaded'
  | 'transcribing'
  | 'markdown_created'
  | 'done'
  | 'failed_retryable'
  | 'failed_permanent';

/** Zustand einer lokal abgelegten Datei (file_assets.status). */
export type FileAssetStatus = 'pending' | 'downloaded' | 'skipped_duplicate' | 'failed' | 'removed';

/** Ergebnis eines Sync-Laufs (sync_runs.status). */
export type SyncRunStatus = 'running' | 'success' | 'failed' | 'warnings';

/** Auslöser eines Sync-Laufs (sync_runs.trigger). */
export type SyncTrigger = 'manual' | 'startup' | 'scheduled';

/** Geltungsbereich einer Selektionsregel (selection_rules.scope). */
export type SelectionScope = 'course' | 'section' | 'activity' | 'modtype';

/** Statusbar-/Tray-Zustand der App (für das Menüleisten-Icon). */
export type TrayState = 'idle' | 'syncing' | 'error' | 'needs_setup';

// Laufzeit-Arrays — gespiegelt in den CHECK-Constraints der DDL und nutzbar
// für Validierung/Tests. Reihenfolge identisch zu den Union-Typen oben.
export const ACTIVITY_STATUSES = [
  'discovered', 'selected', 'ignored', 'download_pending',
  'downloaded', 'deferred', 'failed', 'removed',
] as const satisfies readonly ActivityStatus[];

export const DOWNLOAD_JOB_STATUSES = [
  'pending', 'running', 'done', 'failed_retryable',
  'failed_permanent', 'skipped_duplicate', 'skipped_too_large',
] as const satisfies readonly DownloadJobStatus[];

export const TRANSCRIPT_JOB_STATUSES = [
  'pending', 'claimed', 'downloading_media', 'media_downloaded',
  'transcribing', 'markdown_created', 'done', 'failed_retryable', 'failed_permanent',
] as const satisfies readonly TranscriptJobStatus[];

export const FILE_ASSET_STATUSES = [
  'pending', 'downloaded', 'skipped_duplicate', 'failed', 'removed',
] as const satisfies readonly FileAssetStatus[];

export const SYNC_RUN_STATUSES = ['running', 'success', 'failed', 'warnings'] as const satisfies readonly SyncRunStatus[];
export const SYNC_TRIGGERS = ['manual', 'startup', 'scheduled'] as const satisfies readonly SyncTrigger[];
export const SELECTION_SCOPES = ['course', 'section', 'activity', 'modtype'] as const satisfies readonly SelectionScope[];

// ---------------------------------------------------------------------------
// Entitäten (1:1 zum SQLite-Schema, aber camelCase für die TS-/IPC-Schicht)
// ---------------------------------------------------------------------------

export interface Profile {
  id: number;
  displayName: string;
  defaultLibraryPath: string | null;
  createdAt: string;
}

export interface CredentialRef {
  id: number;
  provider: string; // i. d. R. "learnweb"
  secretStore: string; // i. d. R. "macos_keychain"
  serviceName: string; // Keychain-Service
  accountName: string; // Username
  lastVerifiedAt: string | null;
}

export interface Course {
  courseId: number;
  fullname: string;
  shortname: string | null;
  semester: string | null;
  courseUrl: string | null;
  isSelected: boolean;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface Activity {
  cmid: number;
  courseId: number;
  modtype: string;
  name: string;
  sectionName: string | null;
  sectionIndex: number | null;
  viewUrl: string | null;
  isSelected: boolean;
  status: ActivityStatus;
  lastSeenAt: string | null;
}

export interface FileAsset {
  id: number;
  activityCmid: number | null;
  courseId: number;
  sourceUrl: string;
  filenameOriginal: string;
  filenameLocal: string;
  localPath: string;
  sizeBytes: number | null;
  hash: string | null;
  status: FileAssetStatus;
  downloadedAt: string | null;
}

export interface DownloadJob {
  id: number;
  activityCmid: number | null;
  courseId: number;
  sourceUrl: string;
  localPath: string | null;
  status: DownloadJobStatus;
  sizeBytes: number | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SelectionRule {
  id: number;
  courseId: number;
  scope: SelectionScope;
  scopeRef: string | null;
  syncFiles: boolean;
  transcribeRecordings: boolean;
  includeNewItems: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptJob {
  id: number;
  courseId: number;
  activityCmid: number | null;
  sourceUrl: string;
  mediaLocalPath: string | null;
  transcriptLocalPath: string | null;
  status: TranscriptJobStatus;
  model: string | null;
  durationSeconds: number | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: SyncRunStatus;
  trigger: SyncTrigger;
  coursesChecked: number;
  activitiesSeen: number;
  filesDownloaded: number;
  transcriptsCreated: number;
  warningsCount: number;
  errorsCount: number;
}

export interface McpStatus {
  id: number;
  enabled: boolean;
  configuredAt: string | null;
  lastCheckedAt: string | null;
}

// ---------------------------------------------------------------------------
// View-/IPC-Hilfstypen (vom Renderer konsumiert)
// ---------------------------------------------------------------------------

/** Aggregierter App-Zustand, den der Renderer beim Start abfragt. */
export interface AppState {
  isSetupComplete: boolean;
  hasCredentials: boolean;
  profile: Profile | null;
  libraryPath: string | null;
  tray: TrayState;
  mcpEnabled: boolean;
}

/** Ergebnis eines Login-/Credential-Vorgangs (nie das Secret selbst). */
export interface LoginResult {
  ok: boolean;
  message?: string;
}

/** Prüfergebnis eines gewählten Bibliotheks-Pfades (Schreibrechte/TCC). */
export interface LibraryPathCheck {
  ok: boolean;
  exists: boolean;
  writable: boolean;
  reason?: string;
}

/** Live-Status für Tray + Dashboard. */
export interface SyncStatus {
  state: TrayState;
  lastRun: SyncRun | null;
  activeJobs: number;
  message?: string;
  progress?: { done: number; total: number };
}

/** Schlüssel-Wert-Einstellungen (settings-Tabelle) als getipptes Objekt. */
export interface AppSettings {
  syncIntervalMinutes: number | null;
  defaultLibraryPath: string | null;
}
