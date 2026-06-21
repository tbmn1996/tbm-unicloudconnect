import { extname, join } from 'node:path';

const MAX_SEGMENT_LENGTH = 120;

export function sanitizePathSegment(value: string, fallback = 'Unbenannt'): string {
  const printable = Array.from(value.normalize('NFC'))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  const normalized = printable
    .replace(/[/:]/g, '-')
    .replace(/\.\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-.\s]+/, '')
    .trim();
  const safe = normalized || fallback;
  if (safe.length <= MAX_SEGMENT_LENGTH) return safe;
  const extension = extname(safe);
  const stemLength = Math.max(1, MAX_SEGMENT_LENGTH - extension.length);
  return `${safe.slice(0, stemLength)}${extension}`;
}

export interface LibraryPathInput {
  semester: string | null;
  courseName: string;
  sectionName: string | null;
  filename: string;
}

export function buildRelativeLibraryPath(input: LibraryPathInput): string {
  const parts = input.semester
    ? [sanitizePathSegment(input.semester), sanitizePathSegment(input.courseName, 'Kurs')]
    : [sanitizePathSegment(input.courseName, 'Kurs')];
  if (input.sectionName) parts.push(sanitizePathSegment(input.sectionName, 'Allgemein'));
  parts.push(sanitizePathSegment(input.filename, 'download.bin'));
  return join(...parts);
}
