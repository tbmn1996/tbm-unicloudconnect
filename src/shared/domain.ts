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

/** Zustände eines lokalen Transkriptions-Jobs (docs/MVP1_SCOPE.md §3). */
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
export type TrayState = 'idle' | 'syncing' | 'transcribing' | 'error' | 'needs_setup';

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
// Transkription (Strang A) — Enums + Konstanten
// ---------------------------------------------------------------------------

/** Quelle einer transkribierbaren Aufzeichnung. */
export type RecordingSourceKind = 'opencast' | 'youtube' | 'media';

/** Transkriptionsmodus (Setup-Schritt 5 / Wizard-Index 4). */
export type TranscriptionMode = 'none' | 'manual' | 'auto';

/** Sprache der Transkription ('auto' = Whisper-Spracherkennung). */
export type TranscriptionLanguage = 'de' | 'en' | 'auto';

/** Whisper-Modellgröße (Intel mappt 'large-v3-turbo' → 'large-v3', siehe Worker). */
export type TranscriptionModel = 'base' | 'small' | 'large-v3-turbo';

/** Phase der Transkriptions-Queue (Tray + Dashboard). */
export type TranscriptionPhase =
  | 'idle'
  | 'scanning'
  | 'downloading'
  | 'transcribing'
  | 'writing'
  | 'error';

export const RECORDING_SOURCE_KINDS = ['opencast', 'youtube', 'media'] as const satisfies readonly RecordingSourceKind[];
export const TRANSCRIPTION_MODES = ['none', 'manual', 'auto'] as const satisfies readonly TranscriptionMode[];
export const TRANSCRIPTION_LANGUAGES = ['de', 'en', 'auto'] as const satisfies readonly TranscriptionLanguage[];
export const TRANSCRIPTION_MODELS = ['base', 'small', 'large-v3-turbo'] as const satisfies readonly TranscriptionModel[];

// ---------------------------------------------------------------------------
// MCP (Strang B) — Transport
// ---------------------------------------------------------------------------

/** Transportart des optionalen lokalen MCP-Servers. */
export type McpTransport = 'stdio' | 'sse';

export const MCP_TRANSPORTS = ['stdio', 'sse'] as const satisfies readonly McpTransport[];

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
  localPath: string | null;
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
  // --- Schema-v2-Erweiterungen (Migration MIGRATIONS[2]) ---
  /** Stabiler Dedup-Schlüssel der Aufzeichnung (eindeutig). */
  recordingKey: string | null;
  /** Anzeigetitel der Aufzeichnung. */
  title: string | null;
  /** Quelltyp der Aufzeichnung. */
  sourceType: RecordingSourceKind | null;
  /** Roh-URL der Medienquelle (Opencast/YouTube/Media). */
  mediaUrl: string | null;
  /** Benötigt der Download eine authentifizierte LearnWeb-Session? */
  needsAuth: boolean;
  sectionName: string | null;
  sectionIndex: number | null;
  /** Aufzeichnungsdatum (ISO) oder null, falls unbekannt. */
  recordingDate: string | null;
  /** Anzahl der automatischen Wiederholversuche. */
  retryCount: number;
  // --- Schema-v4-Erweiterung (Migration MIGRATIONS[4]) ---
  /** Ergebnis des letzten Notion-Push-Versuchs; null = noch nie versucht. */
  notionPushStatus: 'ok' | 'warnings' | 'failed' | 'skipped' | null;
  /** Klartext-Meldung bei notionPushStatus 'warnings'/'failed', sonst null. */
  notionPushError: string | null;
  /** Lokale Retry-Kopie, wenn ein Notion-only-Transkript-Push fehlgeschlagen ist. */
  pendingLocalPath: string | null;
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

export type OutputRefSourceType = 'file_asset' | 'transcript_job';

export interface OutputRef {
  id: number;
  sourceEntityType: OutputRefSourceType;
  sourceEntityId: number;
  notionDatabaseId: string;
  notionPageId: string | null;
  createdAt: string;
  updatedAt: string;
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

// ---------------------------------------------------------------------------
// Notion-Anbindung — View-/IPC-Typen (Issue #27, Part 4)
// ---------------------------------------------------------------------------

/**
 * Ausgabe-Modus (settings-Key `output.adapter`). Steuert, welche Adapter beim
 * Sync laufen. `filesystem` (Default) = nur lokale Ablage; `notion` = nur
 * Notion ohne dauerhaften lokalen Pfad; `both` = lokale Ablage plus Notion.
 */
export type OutputAdapterMode = 'filesystem' | 'notion' | 'both';

/**
 * Eine über die Notion-Such-API gefundene Datenbank, normalisiert für die UI.
 * `title` ist bereits aus dem Rich-Text-Array zu einem String aufgelöst.
 */
export interface NotionDatabaseSummary {
  id: string;
  title: string;
  icon?: string | null;
  lastEdited?: string | null;
}

/** Aktueller Konfigurationsstand der Notion-Anbindung (für den Settings-Tab). */
export interface NotionConfigState {
  /** true, sobald ein Token in der Keychain hinterlegt ist. */
  connected: boolean;
  /** Name des Notion-Workspaces (aus der letzten erfolgreichen Verifikation), falls bekannt. */
  workspaceName?: string | null;
  /** Hinterlegte Ziel-Datenbank-ID (settings-Key `output.notion.lw_db_id`). */
  selectedDbId?: string | null;
  /** Hinterlegte Ziel-Datenbank-ID für Kurse (settings-Key `output.notion.courses_db_id`). */
  selectedCoursesDbId?: string | null;
  /** Hinterlegte Ziel-Datenbank-ID für Meetings/Transkripte (settings-Key `output.notion.meeting_db_id`). */
  selectedMeetingDbId?: string | null;
  /** Aktueller Ausgabe-Modus; fehlt der Settings-Key, gilt `filesystem`. */
  adapterMode: OutputAdapterMode;
}

// ---------------------------------------------------------------------------
// Transkription — View-/IPC-Typen
// ---------------------------------------------------------------------------

/** Eine erkannte, transkribierbare Aufzeichnung (Ergebnis des Scans). */
export interface RecordingCandidate {
  /** Stabiler Dedup-Schlüssel (z. B. Opencast-Event-ID / YouTube-ID / URL-Hash). */
  recordingKey: string;
  courseId: number;
  activityCmid: number | null;
  title: string;
  sourceKind: RecordingSourceKind;
  /** Quelle des Mediums; wird NICHT an den Worker geloggt. */
  mediaUrl: string;
  /** Benötigt eine authentifizierte LearnWeb-Session (Cookies bleiben im Main-Prozess). */
  needsAuth: boolean;
  /** Sind (manuelle/automatische) Untertitel verfügbar? (YouTube/Opencast) */
  hasSubtitles: boolean;
  sectionName: string | null;
  sectionIndex: number | null;
  recordingDate: string | null;
}

/** Persistierte Transkriptions-Einstellungen (settings-Tabelle). */
export interface TranscriptionSettings {
  mode: TranscriptionMode;
  language: TranscriptionLanguage;
  model: TranscriptionModel;
}

/** Zustand des verwalteten Python-Worker (Setup-Schritt 5). */
export interface TranscriptionWorkerStatus {
  /** Ist die isolierte uv-/Python-Umgebung eingerichtet? */
  installed: boolean;
  /** Aktives Backend je nach CPU-Architektur (arm64 → mlx, x86_64 → faster-whisper). */
  backend: 'mlx-whisper' | 'faster-whisper' | null;
  /** Bereits heruntergeladene Modelle. */
  downloadedModels: string[];
  message?: string;
}

/** Live-Status der Transkriptions-Queue (Event evt:transcriptionStatus). */
export interface TranscriptionStatus {
  phase: TranscriptionPhase;
  /** Aktuell verarbeiteter Job oder null. */
  activeJob: TranscriptJob | null;
  queued: number;
  done: number;
  failed: number;
  message?: string;
  /** Fortschritt innerhalb des aktiven Jobs (z. B. transkribierte Sekunden). */
  progress?: { done: number; total: number };
}

// ---------------------------------------------------------------------------
// MCP — View-/IPC-Typen
// ---------------------------------------------------------------------------

/** Laufzeit-/Verbindungsinfo des optionalen MCP-Servers (Dashboard/Settings). */
export interface McpRuntimeStatus {
  enabled: boolean;
  /** In ~/Library/Application Support/Claude/claude_desktop_config.json eingetragen? */
  stdioRegistered: boolean;
  /** Läuft der lokale SSE/HTTP-Server? */
  sseRunning: boolean;
  /** Aktive lokale SSE-URL (nur 127.0.0.1), z. B. http://127.0.0.1:3000/sse. */
  sseUrl: string | null;
  /** Bearer-Token zum Kopieren in der UI (Zugriffsschutz des SSE-Endpunkts). */
  token: string | null;
  configuredAt: string | null;
  lastCheckedAt: string | null;
}
