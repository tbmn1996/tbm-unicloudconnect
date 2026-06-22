/**
 * Preload — exponiert die einzige Brücke `window.api` (typsicher, contextBridge).
 *
 * Der Renderer hat keinen direkten Node-/Electron-Zugriff. Jede Methode leitet
 * via ipcRenderer.invoke an den passenden ipcMain.handle-Handler im Main-Prozess
 * (Schritt E) weiter. Diese Datei ist bereits vollständig — sie spiegelt nur den
 * IPC-Vertrag aus src/shared/ipc.ts.
 */
import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type UniCloudApi } from '../shared/ipc';
import type { SyncStatus, TranscriptionStatus } from '../shared/domain';

const api: UniCloudApi = {
  // App / Setup
  getAppState: () => ipcRenderer.invoke(IPC.getAppState),
  completeSetup: (input) => ipcRenderer.invoke(IPC.completeSetup, input),

  // Credentials / Login
  hasCredentials: () => ipcRenderer.invoke(IPC.hasCredentials),
  saveCredentials: (input) => ipcRenderer.invoke(IPC.saveCredentials, input),
  verifyLogin: () => ipcRenderer.invoke(IPC.verifyLogin),
  logout: () => ipcRenderer.invoke(IPC.logout),

  // Bibliotheks-Ordner
  chooseLibraryFolder: () => ipcRenderer.invoke(IPC.chooseLibraryFolder),
  checkLibraryPath: (path) => ipcRenderer.invoke(IPC.checkLibraryPath, path),
  setLibraryPath: (path) => ipcRenderer.invoke(IPC.setLibraryPath, path),
  getLibraryItems: () => ipcRenderer.invoke(IPC.getLibraryItems),
  openLibraryFolder: () => ipcRenderer.invoke(IPC.openLibraryFolder),

  // Kurse & Auswahl
  refreshCourses: () => ipcRenderer.invoke(IPC.refreshCourses),
  getCourses: () => ipcRenderer.invoke(IPC.getCourses),
  setCourseSelected: (input) => ipcRenderer.invoke(IPC.setCourseSelected, input),
  getActivities: (courseId) => ipcRenderer.invoke(IPC.getActivities, courseId),
  setActivitySelected: (input) => ipcRenderer.invoke(IPC.setActivitySelected, input),

  // Sync
  startSync: () => ipcRenderer.invoke(IPC.startSync),
  getSyncStatus: () => ipcRenderer.invoke(IPC.getSyncStatus),

  // Einstellungen
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSetting: (input) => ipcRenderer.invoke(IPC.setSetting, input),

  // Transkription (Strang A)
  getTranscriptionSettings: () => ipcRenderer.invoke(IPC.getTranscriptionSettings),
  setTranscriptionSettings: (input) => ipcRenderer.invoke(IPC.setTranscriptionSettings, input),
  getTranscriptionWorkerStatus: () => ipcRenderer.invoke(IPC.getTranscriptionWorkerStatus),
  setupTranscriptionWorker: () => ipcRenderer.invoke(IPC.setupTranscriptionWorker),
  scanRecordings: () => ipcRenderer.invoke(IPC.scanRecordings),
  enqueueTranscriptions: (input) => ipcRenderer.invoke(IPC.enqueueTranscriptions, input),
  getTranscriptJobs: () => ipcRenderer.invoke(IPC.getTranscriptJobs),
  startTranscriptionQueue: () => ipcRenderer.invoke(IPC.startTranscriptionQueue),
  cancelTranscription: () => ipcRenderer.invoke(IPC.cancelTranscription),
  retryTranscription: (input) => ipcRenderer.invoke(IPC.retryTranscription, input),
  removeTranscription: (input) => ipcRenderer.invoke(IPC.removeTranscription, input),
  openTranscript: (input) => ipcRenderer.invoke(IPC.openTranscript, input),

  // MCP (Strang B)
  getMcpStatus: () => ipcRenderer.invoke(IPC.getMcpStatus),
  getMcpRuntimeStatus: () => ipcRenderer.invoke(IPC.getMcpRuntimeStatus),
  setMcpEnabled: (input) => ipcRenderer.invoke(IPC.setMcpEnabled, input),
  regenerateMcpToken: () => ipcRenderer.invoke(IPC.regenerateMcpToken),

  // Events Main → Renderer
  onSyncStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: SyncStatus) => callback(status);
    ipcRenderer.on(IPC.evtSyncStatus, listener);
    return () => ipcRenderer.removeListener(IPC.evtSyncStatus, listener);
  },
  onTranscriptionStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: TranscriptionStatus) => callback(status);
    ipcRenderer.on(IPC.evtTranscriptionStatus, listener);
    return () => ipcRenderer.removeListener(IPC.evtTranscriptionStatus, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
