/**
 * Minimaler persistenter App-Logger — bewusst klein gehalten, kein Ersatz für
 * den größeren Logging-Umbau (siehe GitHub-Issue #36: zentraler Logger,
 * Renderer-Error-Boundary, Worker-stderr-Persistierung, Ersatz aller
 * console.*-Aufrufe). Nur für den Notion-Push-Pfad gedacht (manager.ts,
 * notion-adapter.ts), damit dessen Fehler/Warnungen produktiv (ohne offene
 * DevTools) nicht spurlos verschwinden.
 *
 * Electron-frei importierbar: `manager.ts` und `notion-adapter.ts` laufen
 * auch unter `tsx --test` (reines Node, kein Electron-Prozess) — ein
 * statischer `import { app } from 'electron'` würde dort `app` zu
 * `undefined` machen und beim ersten Aufruf crashen. Der Electron-Bezug wird
 * daher lazy per dynamischem Import aufgelöst und nur versucht, wenn
 * `process.versions.electron` (von Electron selbst gesetzt) vorhanden ist.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

let logFilePathPromise: Promise<string | null> | null = null;

function isElectronRuntime(): boolean {
  return Boolean((process.versions as Record<string, string | undefined>).electron);
}

function getLogFilePath(): Promise<string | null> {
  if (!logFilePathPromise) {
    logFilePathPromise = isElectronRuntime()
      ? import('electron').then(({ app }) => join(app.getPath('userData'), 'logs', 'main.log'))
      : Promise.resolve(null);
  }
  return logFilePathPromise;
}

/** Schreibt eine Logzeile auf die Konsole und (nur innerhalb der Electron-Runtime) zusätzlich persistent nach `<userData>/logs/main.log`. */
export function appendLog(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  void getLogFilePath()
    .then((path) => {
      if (!path) return;
      return mkdir(dirname(path), { recursive: true }).then(() => appendFile(path, `${line}\n`, 'utf-8'));
    })
    .catch((err) => console.error('[logger] Konnte Logdatei nicht schreiben:', err));
}
