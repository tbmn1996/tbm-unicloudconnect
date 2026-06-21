import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface StoredFile {
  absolutePath: string;
  relativePath: string;
  filename: string;
  hash: string;
  sizeBytes: number;
  duplicate: boolean;
}

export interface StoreFileInput {
  rootPath: string;
  relativePath: string;
  bytes: Uint8Array;
  findExistingByHash?: (hash: string) => { localPath: string } | null;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function storeFile(input: StoreFileInput): Promise<StoredFile> {
  const hash = sha256(input.bytes);
  const root = resolve(input.rootPath);
  const known = input.findExistingByHash?.(hash);
  if (known) {
    const knownPath = resolve(root, known.localPath);
    if (isInsideRoot(root, knownPath) && await hasHash(knownPath, hash)) {
      return resultFor(root, knownPath, hash, input.bytes.byteLength, true);
    }
  }

  let destination = resolve(root, input.relativePath);
  assertInsideRoot(root, destination);
  await mkdir(dirname(destination), { recursive: true });

  if (await exists(destination)) {
    const existingHash = sha256(await readFile(destination));
    if (existingHash === hash) {
      return resultFor(root, destination, hash, input.bytes.byteLength, true);
    }
    const extension = extname(destination);
    const stem = extension ? destination.slice(0, -extension.length) : destination;
    destination = `${stem}-${hash.slice(0, 8)}${extension}`;
  }

  const tempPath = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, input.bytes, { flag: 'wx' });
    await rename(tempPath, destination);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
  return resultFor(root, destination, hash, input.bytes.byteLength, false);
}

function assertInsideRoot(root: string, destination: string): void {
  if (isInsideRoot(root, destination)) return;
  throw new Error('Zielpfad liegt außerhalb der lokalen Bibliothek.');
}

function isInsideRoot(root: string, destination: string): boolean {
  const rel = relative(root, destination);
  return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function hasHash(path: string, expectedHash: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expectedHash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function resultFor(
  root: string,
  absolutePath: string,
  hash: string,
  sizeBytes: number,
  duplicate: boolean,
): StoredFile {
  const relativePath = relative(root, absolutePath);
  return {
    absolutePath,
    relativePath,
    filename: basename(absolutePath),
    hash,
    sizeBytes,
    duplicate,
  };
}
