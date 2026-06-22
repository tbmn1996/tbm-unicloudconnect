import { resolve, sep } from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { AppRuntime } from './runtime';
import { LearnwebClient } from '../learnweb-core/client';
import { LearnwebAuthError } from '../learnweb-core/session';
import { checkLibraryPath, createAndCheckLibraryPath } from '../local-library/access';
import { IPC } from '../shared/ipc';
import type { TranscriptionSettings, TranscriptionStatus } from '../shared/domain';

export function registerIpcHandlers(runtime: AppRuntime): void {
  ipcMain.handle(IPC.getAppState, () => runtime.getAppState());
  ipcMain.handle(IPC.completeSetup, (_event, input: { displayName: string }) => {
    const displayName = requireText(input?.displayName, 'Anzeigename');
    return runtime.completeSetup(displayName);
  });

  ipcMain.handle(IPC.hasCredentials, () => runtime.repos.credentials.get() !== null);
  ipcMain.handle(IPC.saveCredentials, async (_event, input: { username: string; password: string }) => {
    try {
      return await runtime.saveAndVerifyCredentials(
        requireText(input?.username, 'Benutzername'),
        requireSecret(input?.password),
      );
    } catch (error) {
      return { ok: false, message: publicError(error, 'Zugangsdaten konnten nicht gespeichert werden.') };
    }
  });
  ipcMain.handle(IPC.verifyLogin, async () => {
    try {
      return await runtime.verifyStoredCredentials();
    } catch (error) {
      return { ok: false, message: publicError(error, 'LearnWeb-Login fehlgeschlagen.') };
    }
  });
  ipcMain.handle(IPC.logout, () => runtime.clearCredentials());

  ipcMain.handle(IPC.chooseLibraryFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Lokale UniCloudConnect-Bibliothek wählen',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.checkLibraryPath, (_event, path: string) =>
    checkLibraryPath(requireText(path, 'Bibliothekspfad')));
  ipcMain.handle(IPC.setLibraryPath, async (_event, path: string) => {
    const safePath = requireText(path, 'Bibliothekspfad');
    const result = await createAndCheckLibraryPath(safePath);
    if (!result.ok) return result;
    const profile = runtime.repos.profiles.get();
    if (profile) runtime.repos.profiles.setLibraryPath(profile.id, safePath);
    runtime.repos.settings.set('default_library_path', safePath);
    return result;
  });
  ipcMain.handle(IPC.getLibraryItems, () => runtime.repos.fileAssets.getAll());
  ipcMain.handle(IPC.openLibraryFolder, async () => {
    const path = runtime.getLibraryPath();
    if (!path) throw new Error('Kein Bibliotheksordner konfiguriert.');
    const error = await shell.openPath(path);
    if (error) throw new Error('Bibliotheksordner konnte nicht geöffnet werden.');
  });

  ipcMain.handle(IPC.refreshCourses, async () => {
    const client = new LearnwebClient(await runtime.getSession());
    const courses = await client.listCourses();
    runtime.repos.courses.upsertMany(courses);
    return runtime.repos.courses.getAll();
  });
  ipcMain.handle(IPC.getCourses, () => runtime.repos.courses.getAll());
  ipcMain.handle(IPC.setCourseSelected, (_event, input: { courseId: number; selected: boolean }) => {
    runtime.repos.courses.setSelected(requirePositiveInt(input?.courseId, 'Kurs-ID'), input?.selected === true);
  });
  ipcMain.handle(IPC.getActivities, (_event, courseId: number) =>
    runtime.repos.activities.getByCourse(requirePositiveInt(courseId, 'Kurs-ID')));
  ipcMain.handle(IPC.setActivitySelected, (_event, input: { cmid: number; selected: boolean }) => {
    const cmid = requirePositiveInt(input?.cmid, 'Aktivitäts-ID');
    const selected = input?.selected === true;
    runtime.repos.activities.setSelected(cmid, selected);
    runtime.repos.activities.setStatus(cmid, selected ? 'selected' : 'ignored');
  });

  ipcMain.handle(IPC.startSync, () => runtime.sync.start());
  ipcMain.handle(IPC.getSyncStatus, () => runtime.sync.getStatus());
  ipcMain.handle(IPC.getSettings, () => ({
    syncIntervalMinutes: parseOptionalNumber(runtime.repos.settings.get('sync_interval_minutes')),
    defaultLibraryPath: runtime.getLibraryPath(),
  }));
  ipcMain.handle(IPC.setSetting, (_event, input: { key: string; value: string }) => {
    if (input?.key !== 'sync_interval_minutes') throw new Error('Unbekannte Einstellung.');
    runtime.repos.settings.set(input.key, requireText(input.value, 'Einstellungswert'));
  });
  ipcMain.handle(IPC.getMcpStatus, () => runtime.repos.mcp.get());

  ipcMain.handle(IPC.getTranscriptionSettings, () => runtime.transcription.getSettings());
  ipcMain.handle(IPC.setTranscriptionSettings, (_event, input: TranscriptionSettings) =>
    runtime.transcription.setSettings(requireTranscriptionSettings(input)));
  ipcMain.handle(IPC.getTranscriptionWorkerStatus, () => runtime.transcription.getWorkerStatus());
  ipcMain.handle(IPC.setupTranscriptionWorker, () => runtime.transcription.setupWorker());
  ipcMain.handle(IPC.scanRecordings, () => runtime.transcription.scanRecordings());
  ipcMain.handle(IPC.enqueueTranscriptions, (_event, input: { recordingKeys: string[] }) =>
    runtime.transcription.enqueue(requireRecordingKeys(input?.recordingKeys)));
  ipcMain.handle(IPC.getTranscriptJobs, () => runtime.transcription.getJobs());
  ipcMain.handle(IPC.startTranscriptionQueue, () => {
    void runtime.transcription.start();
  });
  ipcMain.handle(IPC.cancelTranscription, () => runtime.transcription.cancel());
  ipcMain.handle(IPC.retryTranscription, (_event, input: { jobId: number }) =>
    runtime.transcription.retry(requirePositiveInt(input?.jobId, 'Job-ID')));
  ipcMain.handle(IPC.openTranscript, async (_event, input: { jobId: number }) => {
    const job = runtime.repos.transcriptJobs.getById(requirePositiveInt(input?.jobId, 'Job-ID'));
    const libraryPath = runtime.getLibraryPath();
    if (!job?.transcriptLocalPath || !libraryPath) throw new Error('Transkript ist nicht verfügbar.');
    const root = resolve(libraryPath);
    const target = resolve(job.transcriptLocalPath);
    if (target !== root && !target.startsWith(root + sep)) throw new Error('Transkriptpfad ist ungültig.');
    const error = await shell.openPath(target);
    if (error) throw new Error('Transkript konnte nicht geöffnet werden.');
  });

  ipcMain.handle(IPC.getMcpRuntimeStatus, () => runtime.mcp.getStatus());
  ipcMain.handle(IPC.setMcpEnabled, (_event, input: { enabled: boolean }) =>
    runtime.mcp.setEnabled(input?.enabled === true));
  ipcMain.handle(IPC.regenerateMcpToken, () => runtime.mcp.regenerateToken());
}

export function broadcastSyncStatus(status: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.evtSyncStatus, status);
  }
}

export function broadcastTranscriptionStatus(status: TranscriptionStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.evtTranscriptionStatus, status);
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_048) {
    throw new Error(`${label} ist ungültig.`);
  }
  return value.trim();
}

function requirePositiveInt(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} ist ungültig.`);
  return value as number;
}

function requireSecret(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes(String.fromCharCode(0))
  ) {
    throw new Error('Passwort ist ungültig.');
  }
  return value;
}

function parseOptionalNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicError(error: unknown, fallback: string): string {
  if (error instanceof LearnwebAuthError) return error.message;
  if (error instanceof Error && /Keine LearnWeb|Keychain/.test(error.message)) return error.message;
  return fallback;
}

function requireRecordingKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1_000
    || value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 256)) {
    throw new Error('Aufzeichnungs-Auswahl ist ungültig.');
  }
  return value;
}

function requireTranscriptionSettings(value: unknown): TranscriptionSettings {
  if (!value || typeof value !== 'object') throw new Error('Transkriptions-Einstellungen sind ungültig.');
  const input = value as Partial<TranscriptionSettings>;
  if (!['none', 'manual', 'auto'].includes(input.mode ?? '')
    || !['de', 'en', 'auto'].includes(input.language ?? '')
    || !['base', 'small', 'large-v3-turbo'].includes(input.model ?? '')) {
    throw new Error('Transkriptions-Einstellungen sind ungültig.');
  }
  return input as TranscriptionSettings;
}
