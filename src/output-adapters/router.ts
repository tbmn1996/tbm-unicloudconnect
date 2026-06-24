import type {
  OutputTarget,
  PlaceFileInput,
  PlaceFileResult,
  PlaceTranscriptInput,
  PlaceTranscriptResult,
} from './types';

/**
 * Output-Router (Issue #23 Part 3).
 *
 * Wählt anhand der Nutzereinstellung `output.adapter` aus, welche Targets
 * für einen `placeFile`/`placeTranscript`-Aufruf aktiv sind.
 *
 * `filesystem` schreibt nur lokal, `both` schreibt lokal und zusätzlich nach
 * Notion, `notion` ist exklusiv und ruft den Filesystem-Adapter nicht auf.
 * Im exklusiven Notion-Modus ist ein initialisierter Notion-Adapter Pflicht.
 *
 * Fehlerstrategie: Schlägt der Notion-Push fehl, scheitert der
 * Gesamtaufruf NICHT. Der Fehler wird als String in `warnings[]`
 * zurückgegeben; aufrufende Schichten entscheiden, wie sie den fehlenden
 * Remote-Persistenzanker bewerten.
 *
 * `skipNotion` (siehe `RouterCallOptions`) überspringt den Notion-Leg
 * unabhängig vom Modus — auch die Adapter-Existenzprüfung entfällt dann.
 * Aufrufer nutzen das, um bei bereits vorhandenem `output_ref` keinen
 * doppelten Remote-Push (Notion `createPage`) auszulösen.
 */

/** Schlanke Settings-Schnittstelle (Duck-Typing, kein voller Repos-Import nötig). */
export interface OutputRouterSettings {
  get(key: string): string | null;
}

/**
 * Differenzierter Notion-Push-Status pro Aufruf (statt nur "Exception oder
 * nicht"): 'ok' = Seite + alle Properties; 'warnings' = Seite erstellt, aber
 * Properties gegen das DB-Schema gefiltert; 'failed' = keine Seite
 * (Exception); 'skipped' = Notion-Leg nicht aktiv/konfiguriert.
 */
export type NotionPushStatus = 'ok' | 'warnings' | 'failed' | 'skipped';

export interface RouterPlaceFileResult {
  filesystem?: PlaceFileResult;
  notion?: PlaceFileResult;
  warnings: string[];
  notionStatus: NotionPushStatus;
  notionError?: string;
}

export interface RouterPlaceTranscriptResult {
  filesystem?: PlaceTranscriptResult;
  notion?: PlaceTranscriptResult;
  warnings: string[];
  notionStatus: NotionPushStatus;
  notionError?: string;
}

type OutputRouterMode = 'filesystem' | 'notion' | 'both';

/** Optionen für einzelne `placeFile`/`placeTranscript`-Aufrufe. */
export interface RouterCallOptions {
  /** Notion-Leg überspringen, z. B. weil bereits ein `output_ref` existiert. */
  skipNotion?: boolean;
}

export class OutputRouter {
  constructor(
    private readonly adapters: { filesystem: OutputTarget; notion?: OutputTarget },
    private readonly settings: OutputRouterSettings,
  ) {}

  async placeFile(input: PlaceFileInput, options?: RouterCallOptions): Promise<RouterPlaceFileResult> {
    const mode = normalizeMode(this.settings.get('output.adapter'));
    const warnings: string[] = [];
    let filesystem: PlaceFileResult | undefined;
    let notion: PlaceFileResult | undefined;
    let notionStatus: NotionPushStatus = 'skipped';
    let notionError: string | undefined;

    if (mode === 'filesystem' || mode === 'both') {
      filesystem = await this.adapters.filesystem.placeFile(input);
    }

    if (!options?.skipNotion && (mode === 'notion' || (mode === 'both' && this.adapters.notion))) {
      if (!this.adapters.notion) {
        throw new Error('Notion-Adapter ist nicht initialisiert/verfügbar.');
      }
      try {
        notion = await this.adapters.notion.placeFile(input);
        if (notion.warnings && notion.warnings.length > 0) {
          warnings.push(...notion.warnings);
          notionStatus = 'warnings';
        } else {
          notionStatus = 'ok';
        }
      } catch (err) {
        notionError = err instanceof Error ? err.message : String(err);
        warnings.push(`Notion-Push fehlgeschlagen: ${notionError}`);
        notionStatus = 'failed';
      }
    }

    return { filesystem, notion, warnings, notionStatus, ...(notionError !== undefined ? { notionError } : {}) };
  }

  async placeTranscript(input: PlaceTranscriptInput, options?: RouterCallOptions): Promise<RouterPlaceTranscriptResult> {
    const mode = normalizeMode(this.settings.get('output.adapter'));
    const warnings: string[] = [];
    let filesystem: PlaceTranscriptResult | undefined;
    let notion: PlaceTranscriptResult | undefined;
    let notionStatus: NotionPushStatus = 'skipped';
    let notionError: string | undefined;

    if (mode === 'filesystem' || mode === 'both') {
      filesystem = await this.adapters.filesystem.placeTranscript(input);
    }

    if (!options?.skipNotion && (mode === 'notion' || (mode === 'both' && this.adapters.notion))) {
      if (!this.adapters.notion) {
        throw new Error('Notion-Adapter ist nicht initialisiert/verfügbar.');
      }
      try {
        notion = await this.adapters.notion.placeTranscript(input);
        if (notion.warnings && notion.warnings.length > 0) {
          warnings.push(...notion.warnings);
          notionStatus = 'warnings';
        } else {
          notionStatus = 'ok';
        }
      } catch (err) {
        notionError = err instanceof Error ? err.message : String(err);
        warnings.push(`Notion-Push fehlgeschlagen: ${notionError}`);
        notionStatus = 'failed';
      }
    }

    return { filesystem, notion, warnings, notionStatus, ...(notionError !== undefined ? { notionError } : {}) };
  }
}

function normalizeMode(value: string | null): OutputRouterMode {
  return value === 'notion' || value === 'both' ? value : 'filesystem';
}
