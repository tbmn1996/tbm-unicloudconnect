import type { UniCloudApi } from '../shared/ipc';
import type { AppState, Course, SyncStatus, TranscriptionStatus } from '../shared/domain';

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
let mockSyncInterval: number | null = null;
const listeners = new Set<(status: SyncStatus) => void>();
const transcriptionListeners = new Set<(status: TranscriptionStatus) => void>();

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
    logout: async () => {
      state.hasCredentials = false;
    },
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
    getSettings: async () => ({ syncIntervalMinutes: mockSyncInterval, defaultLibraryPath: state.libraryPath }),
    setSetting: async ({ key, value }) => {
      if (key === 'sync_interval_minutes') mockSyncInterval = parseInt(value, 10);
    },
    getMcpStatus: async () => ({ id: 1, enabled: false, configuredAt: null, lastCheckedAt: null }),

    // Transkription (Vorschau-Mocks)
    getTranscriptionSettings: async () => ({ mode: 'none', language: 'de', model: 'small' }),
    setTranscriptionSettings: async (input) => ({ ...input }),
    getTranscriptionWorkerStatus: async () => ({ installed: false, backend: 'mlx-whisper', downloadedModels: [] }),
    setupTranscriptionWorker: async () => ({ installed: true, backend: 'mlx-whisper', downloadedModels: ['small'] }),
    scanRecordings: async () => [],
    enqueueTranscriptions: async () => [],
    getTranscriptJobs: async () => [],
    startTranscriptionQueue: async () => undefined,
    cancelTranscription: async () => undefined,
    retryTranscription: async () => undefined,
    removeTranscription: async () => undefined,
    openTranscript: async () => undefined,

    // MCP (Vorschau-Mocks)
    getMcpRuntimeStatus: async () => ({
      enabled: false, stdioRegistered: false, sseRunning: false,
      sseUrl: null, token: null, configuredAt: null, lastCheckedAt: null,
    }),
    setMcpEnabled: async ({ enabled }) => ({
      enabled, stdioRegistered: enabled, sseRunning: enabled,
      sseUrl: enabled ? 'http://127.0.0.1:3000/sse' : null,
      token: enabled ? 'dev-token-0000' : null,
      configuredAt: enabled ? new Date().toISOString() : null,
      lastCheckedAt: new Date().toISOString(),
    }),
    regenerateMcpToken: async () => ({
      enabled: true, stdioRegistered: true, sseRunning: true,
      sseUrl: 'http://127.0.0.1:3000/sse', token: 'dev-token-' + Math.random().toString(36).slice(2, 8),
      configuredAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString(),
    }),

    // Notion-Anbindung (Vorschau-Mocks — im Browser-Dev-Modus keine echte Notion-Verbindung)
    verifyNotionToken: async () => ({ ok: false, message: 'Notion ist im Vorschaumodus nicht verfügbar.' }),
    searchNotionDatabases: async () => [],
    getNotionConfig: async () => ({ connected: false, workspaceName: null, selectedDbId: null, selectedCoursesDbId: null, selectedMeetingDbId: null, adapterMode: 'filesystem' }),
    setNotionDatabase: async () => undefined,
    setNotionCoursesDatabase: async () => undefined,
    setNotionMeetingDatabase: async () => undefined,
    setNotionOutputMode: async () => undefined,

    onSyncStatus: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    onTranscriptionStatus: (callback) => {
      transcriptionListeners.add(callback);
      return () => transcriptionListeners.delete(callback);
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
