/**
 * IPC-Vertrag zwischen Renderer und Main-Prozess.
 *
 * `UniCloudApi` ist die einzige Oberfläche, die der Preload via contextBridge
 * unter `window.api` bereitstellt. Renderer und Main implementieren bzw.
 * konsumieren exakt dieses Interface — kein direkter Node-Zugriff im Renderer.
 *
 * Reine Typen + String-Konstanten, keine Node-/Electron-Imports (auch vom
 * Renderer importierbar).
 */

import type {
  Activity,
  AppSettings,
  AppState,
  Course,
  FileAsset,
  LibraryPathCheck,
  LoginResult,
  McpRuntimeStatus,
  McpStatus,
  RecordingCandidate,
  SyncStatus,
  TranscriptionSettings,
  TranscriptionStatus,
  TranscriptionWorkerStatus,
  TranscriptJob,
} from './domain';

/** Kanonische Kanalnamen (ipcRenderer.invoke ↔ ipcMain.handle). */
export const IPC = {
  // App / Setup
  getAppState: 'app:getState',
  completeSetup: 'app:completeSetup',
  // Credentials / Login (Secrets bleiben im Main-Prozess / Keychain)
  saveCredentials: 'auth:saveCredentials',
  verifyLogin: 'auth:verifyLogin',
  hasCredentials: 'auth:hasCredentials',
  // Bibliotheks-Ordner
  chooseLibraryFolder: 'library:chooseFolder',
  checkLibraryPath: 'library:checkPath',
  setLibraryPath: 'library:setPath',
  getLibraryItems: 'library:getItems',
  openLibraryFolder: 'library:openFolder',
  // Kurse & Auswahl
  refreshCourses: 'courses:refresh',
  getCourses: 'courses:get',
  setCourseSelected: 'courses:setSelected',
  getActivities: 'activities:get',
  setActivitySelected: 'activities:setSelected',
  // Sync
  startSync: 'sync:start',
  getSyncStatus: 'sync:getStatus',
  // Einstellungen
  getSettings: 'settings:get',
  setSetting: 'settings:set',
  // Transkription (Strang A)
  getTranscriptionSettings: 'transcription:getSettings',
  setTranscriptionSettings: 'transcription:setSettings',
  getTranscriptionWorkerStatus: 'transcription:getWorkerStatus',
  setupTranscriptionWorker: 'transcription:setupWorker',
  scanRecordings: 'transcription:scanRecordings',
  enqueueTranscriptions: 'transcription:enqueue',
  getTranscriptJobs: 'transcription:getJobs',
  startTranscriptionQueue: 'transcription:startQueue',
  cancelTranscription: 'transcription:cancel',
  retryTranscription: 'transcription:retry',
  openTranscript: 'transcription:openTranscript',
  // MCP (Strang B) — optional, lokal, opt-in
  getMcpStatus: 'mcp:getStatus',
  getMcpRuntimeStatus: 'mcp:getRuntimeStatus',
  setMcpEnabled: 'mcp:setEnabled',
  regenerateMcpToken: 'mcp:regenerateToken',
  // Events Main → Renderer
  evtSyncStatus: 'evt:syncStatus',
  evtTranscriptionStatus: 'evt:transcriptionStatus',
} as const;

/**
 * Die typsichere API, die der Renderer über `window.api` aufruft.
 * Alle Methoden sind asynchron (ipcRenderer.invoke), Events per Callback.
 */
export interface UniCloudApi {
  // --- App / Setup ---
  getAppState(): Promise<AppState>;
  completeSetup(input: { displayName: string }): Promise<AppState>;

  // --- Credentials / Login ---
  hasCredentials(): Promise<boolean>;
  /** Speichert Username/Passwort in der macOS Keychain (kein Klartext in DB/Logs). */
  saveCredentials(input: { username: string; password: string }): Promise<LoginResult>;
  /** Prüft die gespeicherten Credentials gegen das LearnWeb (echter Login-Versuch). */
  verifyLogin(): Promise<LoginResult>;

  // --- Bibliotheks-Ordner ---
  chooseLibraryFolder(): Promise<string | null>;
  checkLibraryPath(path: string): Promise<LibraryPathCheck>;
  setLibraryPath(path: string): Promise<LibraryPathCheck>;
  getLibraryItems(): Promise<FileAsset[]>;
  openLibraryFolder(): Promise<void>;

  // --- Kurse & Auswahl ---
  refreshCourses(): Promise<Course[]>;
  getCourses(): Promise<Course[]>;
  setCourseSelected(input: { courseId: number; selected: boolean }): Promise<void>;
  getActivities(courseId: number): Promise<Activity[]>;
  setActivitySelected(input: { cmid: number; selected: boolean }): Promise<void>;

  // --- Sync ---
  startSync(): Promise<void>;
  getSyncStatus(): Promise<SyncStatus>;

  // --- Einstellungen ---
  getSettings(): Promise<AppSettings>;
  setSetting(input: { key: string; value: string }): Promise<void>;

  // --- Transkription (Strang A) ---
  getTranscriptionSettings(): Promise<TranscriptionSettings>;
  setTranscriptionSettings(input: TranscriptionSettings): Promise<TranscriptionSettings>;
  getTranscriptionWorkerStatus(): Promise<TranscriptionWorkerStatus>;
  /** Richtet die isolierte Worker-Umgebung ein und lädt das gewählte Modell (Fortschritt via Event). */
  setupTranscriptionWorker(): Promise<TranscriptionWorkerStatus>;
  /** Scannt ausgewählte Kurse nach transkribierbaren Aufzeichnungen. */
  scanRecordings(): Promise<RecordingCandidate[]>;
  /** Reiht die angegebenen Aufzeichnungen idempotent in die Queue ein. */
  enqueueTranscriptions(input: { recordingKeys: string[] }): Promise<TranscriptJob[]>;
  getTranscriptJobs(): Promise<TranscriptJob[]>;
  /** Startet die Abarbeitung der Queue (genau ein aktiver Job). */
  startTranscriptionQueue(): Promise<void>;
  /** Bricht den aktiven Job ab und stellt ihn auf 'pending' zurück. */
  cancelTranscription(): Promise<void>;
  /** Wiederholt einen fehlgeschlagenen Job. */
  retryTranscription(input: { jobId: number }): Promise<void>;
  /** Öffnet das fertige Markdown-Transkript im Finder/Editor. */
  openTranscript(input: { jobId: number }): Promise<void>;

  // --- MCP (Strang B) ---
  getMcpStatus(): Promise<McpStatus>;
  getMcpRuntimeStatus(): Promise<McpRuntimeStatus>;
  /** Aktiviert/deaktiviert den MCP-Zugriff (stdio-Registrierung + lokaler SSE-Server). */
  setMcpEnabled(input: { enabled: boolean }): Promise<McpRuntimeStatus>;
  /** Erzeugt ein neues Bearer-Token für den SSE-Endpunkt. */
  regenerateMcpToken(): Promise<McpRuntimeStatus>;

  // --- Events ---
  /** Abonniert Live-Sync-Status; gibt eine Unsubscribe-Funktion zurück. */
  onSyncStatus(callback: (status: SyncStatus) => void): () => void;
  /** Abonniert Live-Transkriptions-Status; gibt eine Unsubscribe-Funktion zurück. */
  onTranscriptionStatus(callback: (status: TranscriptionStatus) => void): () => void;
}
