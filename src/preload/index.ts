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
import type { SyncStatus } from '../shared/domain';

const api: UniCloudApi = {
  // App / Setup
  getAppState: () => ipcRenderer.invoke(IPC.getAppState),
  completeSetup: (input) => ipcRenderer.invoke(IPC.completeSetup, input),

  // Credentials / Login
  hasCredentials: () => ipcRenderer.invoke(IPC.hasCredentials),
  saveCredentials: (input) => ipcRenderer.invoke(IPC.saveCredentials, input),
  verifyLogin: () => ipcRenderer.invoke(IPC.verifyLogin),

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

  // MCP (Platzhalter)
  getMcpStatus: () => ipcRenderer.invoke(IPC.getMcpStatus),

  // Events Main → Renderer
  onSyncStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: SyncStatus) => callback(status);
    ipcRenderer.on(IPC.evtSyncStatus, listener);
    return () => ipcRenderer.removeListener(IPC.evtSyncStatus, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
