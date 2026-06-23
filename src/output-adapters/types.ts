/**
 * Vertrag für die Output-Adapter-Schicht (Issue #23 Part 3).
 *
 * Ein `OutputTarget` platziert heruntergeladene Dateien bzw. fertige
 * Transkripte in einem Zielsystem (lokaler Ordner, Notion, ...). Der
 * `OutputRouter` (siehe router.ts) wählt anhand der Nutzerkonfiguration
 * aus, welche(s) Target(s) für einen Aufruf aktiv sind.
 */

/** Minimale Kurs-Metadaten, die ein Adapter für Properties/Pfade braucht. */
export interface OutputCourseInfo {
  courseId: number;
  fullname: string;
  semester: string | null;
}

export interface PlaceFileInput {
  course: OutputCourseInfo;
  sectionName: string | null;
  filename: string;
  bytes: Uint8Array;
  /** Dedup-Lookup für den Filesystem-Adapter (Hash -> bereits bekannter lokaler Pfad). */
  findExistingByHash?: (hash: string) => { localPath: string } | null;
}

export interface PlaceFileResult {
  adapter: 'filesystem' | 'notion';
  duplicate: boolean;
  /** Relativ zur lokalen Bibliothek (nur Filesystem-Adapter). */
  relativePath?: string;
  /** Notion Page-ID (nur Notion-Adapter). */
  remoteRef?: string;
  hash: string;
  sizeBytes: number;
  filename: string;
}

export interface PlaceTranscriptInput {
  course: OutputCourseInfo;
  title: string | null;
  recordingDate: string | null;
  model: string | null;
  durationSeconds: number | null;
  markdown: string;
  /** Der Worker-Subprozess hat die .md-Datei bereits an diesen Pfad geschrieben. */
  alreadyWrittenLocalPath: string;
}

export interface PlaceTranscriptResult {
  adapter: 'filesystem' | 'notion';
  relativePath?: string;
  remoteRef?: string;
}

export interface OutputTarget {
  readonly kind: 'filesystem' | 'notion';
  placeFile(input: PlaceFileInput): Promise<PlaceFileResult>;
  placeTranscript(input: PlaceTranscriptInput): Promise<PlaceTranscriptResult>;
}

/**
 * Settings-Key (settings-Tabelle) für die Notion-Zieldatenbank-ID.
 * Gemeinsam genutzt von `createNotionAdapter()` und den Aufrufstellen, die
 * nach einem erfolgreichen Notion-Push einen `output_refs`-Eintrag anlegen
 * (siehe FUTURE_OUTPUT_ADAPTERS.md §4.3) — eine Stelle, kein Drift-Risiko.
 */
export const OUTPUT_NOTION_DATABASE_ID_SETTING_KEY = 'output.notion.lw_db_id';
