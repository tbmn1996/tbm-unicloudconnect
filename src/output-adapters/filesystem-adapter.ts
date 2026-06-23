import { relative } from 'node:path';

import { buildRelativeLibraryPath } from '../local-library/paths';
import { storeFile } from '../local-library/store';
import type {
  OutputTarget,
  PlaceFileInput,
  PlaceFileResult,
  PlaceTranscriptInput,
  PlaceTranscriptResult,
} from './types';

/**
 * Filesystem-Output-Adapter (Issue #23 Part 3).
 *
 * Platziert heruntergeladene Dateien in der lokalen Bibliothek (siehe
 * `src/local-library/store.ts`) und meldet bereits vom Worker-Subprozess
 * geschriebene Transkript-Pfade relativ zur Bibliothekswurzel zurück.
 */
export class FilesystemAdapter implements OutputTarget {
  readonly kind = 'filesystem' as const;

  constructor(private readonly libraryPath: string) {}

  async placeFile(input: PlaceFileInput): Promise<PlaceFileResult> {
    const relativePath = buildRelativeLibraryPath({
      semester: input.course.semester,
      courseName: input.course.fullname,
      sectionName: input.sectionName,
      filename: input.filename,
    });
    const stored = await storeFile({
      rootPath: this.libraryPath,
      relativePath,
      bytes: input.bytes,
      findExistingByHash: input.findExistingByHash,
    });
    return {
      adapter: 'filesystem',
      duplicate: stored.duplicate,
      relativePath: stored.relativePath,
      hash: stored.hash,
      sizeBytes: stored.sizeBytes,
      filename: stored.filename,
    };
  }

  async placeTranscript(input: PlaceTranscriptInput): Promise<PlaceTranscriptResult> {
    // Der Worker-Subprozess hat die .md-Datei bereits geschrieben — reiner
    // Passthrough, hier findet KEINE Filesystem-I/O statt.
    return {
      adapter: 'filesystem',
      relativePath: relative(this.libraryPath, input.alreadyWrittenLocalPath),
    };
  }
}
