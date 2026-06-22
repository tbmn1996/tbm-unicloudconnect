import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { broadcastSyncStatus, broadcastTranscriptionStatus, registerIpcHandlers } from './ipc';
import { AppRuntime } from './runtime';
import { StatusTray } from './tray';
import { createMainWindow, markAppQuitting, showMainWindow } from './windows';

let runtime: AppRuntime | null = null;
let tray: StatusTray | null = null;

void app.whenReady().then(() => {
  app.setName('TBM UniCloudConnect');
  app.dock?.hide();
  createMainWindow();

  const dbPath = join(app.getPath('userData'), 'state.sqlite');
  const mainDir = dirname(fileURLToPath(import.meta.url));
  runtime = new AppRuntime(dbPath, (status) => {
    tray?.setStatus(status);
    broadcastSyncStatus(status);
    if (status.state === 'idle') void runtime?.runAutoTranscription().catch(() => undefined);
  }, {
    workerDir: join(app.getAppPath(), 'transcription-worker'),
    mcpEntryPath: join(mainDir, 'mcp.js'),
    mcpCommand: process.execPath,
    onTranscriptionStatus: (status) => {
      broadcastTranscriptionStatus(status);
      if (status.phase === 'error') {
        tray?.setStatus({ state: 'error', lastRun: runtime?.sync.getStatus().lastRun ?? null, activeJobs: 0 });
      } else if (status.phase !== 'idle') {
        tray?.setStatus({ state: 'transcribing', lastRun: runtime?.sync.getStatus().lastRun ?? null, activeJobs: 1 });
      } else if (runtime) {
        tray?.setStatus(runtime.sync.getStatus());
      }
    },
  });
  registerIpcHandlers(runtime);
  tray = new StatusTray(showMainWindow, () => runtime?.sync.start());
  const state = runtime.getAppState();
  tray.setStatus(state.isSetupComplete
    ? runtime.sync.getStatus()
    : { state: 'needs_setup', lastRun: null, activeJobs: 0 });

  app.on('activate', showMainWindow);
});

app.on('before-quit', () => {
  markAppQuitting();
  tray?.destroy();
  runtime?.close();
  tray = null;
  runtime = null;
});

app.on('window-all-closed', () => {
  // macOS-Statusbar-App bleibt ohne Fenster aktiv.
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
