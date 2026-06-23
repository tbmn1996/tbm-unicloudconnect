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
 * Architektur-Entscheidung: Der Filesystem-Adapter läuft IMMER, unabhängig
 * vom konfigurierten Modus. Grund: `file_assets.local_path` ist `NOT NULL`
 * im Schema — ein "nur Notion"-Modus ohne lokalen Pfad ist damit nicht
 * abbildbar (das wäre eine Schema-Migration, kein Teil von Part 3). Der
 * Notion-Adapter läuft NUR zusätzlich, wenn konfiguriert — additiv, nie
 * ersetzend.
 *
 * Fehlerstrategie: Schlägt der Notion-Push fehl, scheitert der
 * Gesamtaufruf NICHT (kein Retry/Backfill in Part 3 — späterer Scope).
 * Der Fehler wird als String in `warnings[]` zurückgegeben, die lokale
 * Operation bleibt davon unberührt.
 */

/** Schlanke Settings-Schnittstelle (Duck-Typing, kein voller Repos-Import nötig). */
export interface OutputRouterSettings {
  get(key: string): string | null;
}

export interface RouterPlaceFileResult {
  filesystem: PlaceFileResult;
  notion?: PlaceFileResult;
  warnings: string[];
}

export interface RouterPlaceTranscriptResult {
  filesystem: PlaceTranscriptResult;
  notion?: PlaceTranscriptResult;
  warnings: string[];
}

export class OutputRouter {
  constructor(
    private readonly adapters: { filesystem: OutputTarget; notion?: OutputTarget },
    private readonly settings: OutputRouterSettings,
  ) {}

  private notionActive(): boolean {
    const mode = this.settings.get('output.adapter');
    return (mode === 'notion' || mode === 'both') && this.adapters.notion != null;
  }

  async placeFile(input: PlaceFileInput): Promise<RouterPlaceFileResult> {
    const filesystem = await this.adapters.filesystem.placeFile(input);
    const warnings: string[] = [];
    let notion: PlaceFileResult | undefined;
    if (this.notionActive()) {
      try {
        notion = await this.adapters.notion!.placeFile(input);
      } catch (err) {
        warnings.push(`Notion-Push fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { filesystem, notion, warnings };
  }

  async placeTranscript(input: PlaceTranscriptInput): Promise<RouterPlaceTranscriptResult> {
    const filesystem = await this.adapters.filesystem.placeTranscript(input);
    const warnings: string[] = [];
    let notion: PlaceTranscriptResult | undefined;
    if (this.notionActive()) {
      try {
        notion = await this.adapters.notion!.placeTranscript(input);
      } catch (err) {
        warnings.push(`Notion-Push fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { filesystem, notion, warnings };
  }
}
