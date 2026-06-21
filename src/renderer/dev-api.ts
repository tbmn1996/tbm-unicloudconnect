import type { UniCloudApi } from '../shared/ipc';
import type { AppState, Course, SyncStatus } from '../shared/domain';

const state: AppState = {
  isSetupComplete: false,
  hasCredentials: false,
  profile: null,
  libraryPath: null,
  tray: 'needs_setup',
  mcpEnabled: false,
};

let courses: Course[] = [
  course(101, 'Algorithmen und Datenstrukturen', 'SoSe 2026'),
  course(102, 'Software Engineering', 'SoSe 2026'),
  course(103, 'Datenbanken', 'WiSe 2025/26'),
];
let syncStatus: SyncStatus = { state: 'idle', lastRun: null, activeJobs: 0 };
const listeners = new Set<(status: SyncStatus) => void>();

export function createDevApi(): UniCloudApi {
  return {
    getAppState: async () => ({ ...state }),
    completeSetup: async ({ displayName }) => {
      state.isSetupComplete = true;
      state.profile = { id: 1, displayName, defaultLibraryPath: state.libraryPath, createdAt: new Date().toISOString() };
      return { ...state };
    },
    hasCredentials: async () => state.hasCredentials,
    saveCredentials: async () => {
      state.hasCredentials = true;
      return { ok: true };
    },
    verifyLogin: async () => ({ ok: state.hasCredentials, message: state.hasCredentials ? undefined : 'Noch keine Zugangsdaten.' }),
    chooseLibraryFolder: async () => '/Users/demo/UniCloudConnect',
    checkLibraryPath: async (path) => ({ ok: Boolean(path), exists: Boolean(path), writable: Boolean(path) }),
    setLibraryPath: async (path) => {
      state.libraryPath = path;
      return { ok: true, exists: true, writable: true };
    },
    getLibraryItems: async () => [],
    openLibraryFolder: async () => undefined,
    refreshCourses: async () => courses.map((item) => ({ ...item })),
    getCourses: async () => courses.map((item) => ({ ...item })),
    setCourseSelected: async ({ courseId, selected }) => {
      courses = courses.map((item) => item.courseId === courseId ? { ...item, isSelected: selected } : item);
    },
    getActivities: async () => [],
    setActivitySelected: async () => undefined,
    startSync: async () => {
      syncStatus = { ...syncStatus, state: 'syncing', message: 'Vorschau-Sync läuft' };
      for (const listener of listeners) listener(syncStatus);
    },
    getSyncStatus: async () => syncStatus,
    getSettings: async () => ({ syncIntervalMinutes: null, defaultLibraryPath: state.libraryPath }),
    setSetting: async () => undefined,
    getMcpStatus: async () => ({ id: 1, enabled: false, configuredAt: null, lastCheckedAt: null }),
    onSyncStatus: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

function course(courseId: number, fullname: string, semester: string): Course {
  return {
    courseId,
    fullname,
    shortname: null,
    semester,
    courseUrl: null,
    isSelected: false,
    firstSeenAt: null,
    lastSeenAt: null,
  };
}
