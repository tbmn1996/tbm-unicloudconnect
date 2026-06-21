import { constants } from 'node:fs';
import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryPathCheck } from '../shared/domain';

export async function checkLibraryPath(path: string): Promise<LibraryPathCheck> {
  if (!path || !isAbsolute(path) || path.includes(String.fromCharCode(0))) {
    return { ok: false, exists: false, writable: false, reason: 'Bitte einen absoluten Ordnerpfad wählen.' };
  }

  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return { ok: false, exists: true, writable: false, reason: 'Der gewählte Pfad ist kein Ordner.' };
    }
    await access(path, constants.W_OK);
    const probe = join(path, `.unicloudconnect-write-test-${randomUUID()}`);
    try {
      await writeFile(probe, '', { flag: 'wx' });
    } finally {
      await unlink(probe).catch(() => undefined);
    }
    return { ok: true, exists: true, writable: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, exists: false, writable: false, reason: 'Der gewählte Ordner existiert nicht.' };
    }
    return {
      ok: false,
      exists: true,
      writable: false,
      reason: 'Keine Schreibberechtigung. Bitte macOS-Dateizugriff prüfen oder einen anderen Ordner wählen.',
    };
  }
}

export async function createAndCheckLibraryPath(path: string): Promise<LibraryPathCheck> {
  if (!path || !isAbsolute(path)) return checkLibraryPath(path);
  try {
    await mkdir(path, { recursive: true });
  } catch {
    return { ok: false, exists: false, writable: false, reason: 'Der Bibliotheksordner konnte nicht erstellt werden.' };
  }
  return checkLibraryPath(path);
}
