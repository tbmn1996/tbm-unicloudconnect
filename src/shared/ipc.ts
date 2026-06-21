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
  McpStatus,
  SyncStatus,
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
  // MCP (Platzhalter, in diesem Schnitt inaktiv)
  getMcpStatus: 'mcp:getStatus',
  // Events Main → Renderer
  evtSyncStatus: 'evt:syncStatus',
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

  // --- MCP (Platzhalter) ---
  getMcpStatus(): Promise<McpStatus>;

  // --- Events ---
  /** Abonniert Live-Status-Updates; gibt eine Unsubscribe-Funktion zurück. */
  onSyncStatus(callback: (status: SyncStatus) => void): () => void;
}
