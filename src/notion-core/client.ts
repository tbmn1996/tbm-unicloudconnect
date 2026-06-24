import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosInstance, type AxiosError, type AxiosAdapter } from 'axios';
import {
  NOTION_API_BASE,
  NOTION_VERSION,
  NOTION_MIN_REQUEST_INTERVAL_MS,
  NOTION_MAX_RETRY_ATTEMPTS,
} from './constants';
import { NotionAuthError, NotionRateLimitExceededError, NotionApiError } from './errors';
import { NotionRateLimiter } from './rate-limiter';

// Erzeuge persistente Agents mit Keep-Alive für Node.js zur Latenz-Minimierung
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

export class NotionClient {
  private axiosInstance: AxiosInstance;
  private rateLimiter: NotionRateLimiter;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(
    token: string,
    options?: {
      rateLimiter?: NotionRateLimiter;
      sleepFn?: (ms: number) => Promise<void>;
      axiosAdapter?: AxiosAdapter;
    }
  ) {
    this.sleepFn =
      options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

    this.rateLimiter = options?.rateLimiter ?? new NotionRateLimiter(NOTION_MIN_REQUEST_INTERVAL_MS, this.sleepFn);

    this.axiosInstance = axios.create({
      baseURL: NOTION_API_BASE,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      httpAgent,
      httpsAgent,
      adapter: options?.axiosAdapter,
    });
  }

  /**
   * Führt einen API-Aufruf über den Rate-Limiter aus, inklusive automatischer
   * Retries bei HTTP 429 (Rate-Limit) mit exponentiellem Backoff.
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown
  ): Promise<T> {
    const executeCall = async (attempt: number): Promise<T> => {
      try {
        const response = await this.axiosInstance.request<T>({
          method,
          url: path,
          data: body,
        });
        return response.data;
      } catch (err) {
        const error = err as AxiosError<{ message?: string; code?: string }>;

        if (error.response?.status === 429) {
          if (attempt >= NOTION_MAX_RETRY_ATTEMPTS - 1) {
            throw new NotionRateLimitExceededError();
          }

          // Versuche Retry-After Header zu lesen (ist in Sekunden angegeben)
          const retryAfterHeader = error.response.headers['retry-after'];
          let waitMs = 0;
          if (typeof retryAfterHeader === 'string') {
            const parsedSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
              waitMs = parsedSeconds * 1000;
            }
          }

          // Fallback falls Header fehlt oder ungültig ist: Math.pow(2, attempt + 1) * 1000
          if (waitMs <= 0) {
            waitMs = Math.pow(2, attempt + 1) * 1000;
          }

          await this.sleepFn(waitMs);
          return executeCall(attempt + 1);
        }

        if (error.response?.status === 401) {
          throw new NotionAuthError();
        }

        if (error.response) {
          const data = error.response.data;
          const message = data?.message || error.message || 'Notion API-Fehler';
          const code = data?.code;
          const status = error.response.status;
          throw new NotionApiError(message, status, code);
        }

        throw new NotionApiError(error.message || 'Verbindungsfehler zur Notion API');
      }
    };

    return this.rateLimiter.schedule(() => executeCall(0));
  }

  /** Holt Details über den aktuellen Integration-User (Bot). */
  public async getUser(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/users/me');
  }

  /** Durchsucht Notion-Objekte (Seiten/Datenbanken) nach Titel. */
  public async search(params: {
    query?: string;
    sort?: { direction: 'ascending' | 'descending'; timestamp: 'last_edited_time' };
    filter?: { value: 'page' | 'database'; property: 'object' };
    start_cursor?: string;
    page_size?: number;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', '/search', params);
  }

  /** Fragt Einträge aus einer Notion-Datenbank ab (inkl. Filter/Sortierungen). */
  public async queryDatabase(
    databaseId: string,
    params?: {
      filter?: unknown;
      sorts?: unknown[];
      start_cursor?: string;
      page_size?: number;
    }
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', `/databases/${databaseId}/query`, params);
  }

  /** Erstellt eine neue Seite in einer Datenbank oder als Unterseite einer anderen Seite. */
  public async createPage(body: {
    parent: { database_id?: string; page_id?: string };
    properties: unknown;
    children?: unknown[];
    icon?: unknown;
    cover?: unknown;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', '/pages', body);
  }

  /** Hängt neue Block-Kinder an einen bestehenden Block/Seite an. */
  public async appendBlockChildren(blockId: string, children: unknown[]): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('PATCH', `/blocks/${blockId}/children`, { children });
  }

  /** Ruft Metadaten und Schema einer Notion-Datenbank ab. */
  public async retrieveDatabase(databaseId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/databases/${databaseId}`);
  }
}
