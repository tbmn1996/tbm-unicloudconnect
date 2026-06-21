import { join } from 'node:path';
import { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;
let appIsQuitting = false;

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: 'TBM UniCloudConnect',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!appIsQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return mainWindow;
}

export function showMainWindow(): void {
  const window = createMainWindow();
  window.show();
  window.focus();
}

export function toggleMainWindow(): void {
  const window = createMainWindow();
  if (window.isVisible()) window.hide();
  else showMainWindow();
}

export function markAppQuitting(): void {
  appIsQuitting = true;
}
