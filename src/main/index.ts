import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { broadcastSyncStatus, registerIpcHandlers } from './ipc';
import { AppRuntime } from './runtime';
import { StatusTray } from './tray';
import { createMainWindow, markAppQuitting, showMainWindow } from './windows';

let runtime: AppRuntime | null = null;
let tray: StatusTray | null = null;

void app.whenReady().then(() => {
  app.setName('TBM UniCloudConnect');
  app.dock?.hide();
  createMainWindow();

  runtime = new AppRuntime(join(app.getPath('userData'), 'state.sqlite'), (status) => {
    tray?.setStatus(status);
    broadcastSyncStatus(status);
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
