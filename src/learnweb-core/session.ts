/**
 * LearnwebSession — HTTP-Zugriff auf das Münster LearnWeb (Moodle).
 *
 * Portiert aus dem produktiven tbmn-learnweb-connector (src/learnweb/session.ts)
 * und für die Desktop-App angepasst: Credentials kommen NICHT aus .env, sondern
 * werden dem Konstruktor übergeben (die App liest sie zur Laufzeit aus der macOS
 * Keychain). Read-only gegenüber LearnWeb.
 *
 * Verantwortlich für: Formular-Login mit logintoken, Cookie-Persistenz (tough-
 * cookie Jar), transparenten Re-Login bei Session-Expiry, authentifizierten
 * Datei-Download via pluginfile.php, Rate-Limiting. Niemals Credentials loggen.
 *
 * NICHT zuständig für HTML-Parsing (siehe parsers/*).
 */
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { LEARNWEB_BASE_URL } from './constants';

// User-Agent identisch zum Referenz-Scraper, damit Moodle gleich reagiert.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const INTER_CALL_DELAY_MS = 150;
const INTRA_CALL_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 15000;

export class LearnwebAuthError extends Error {
  constructor(message = 'LearnWeb-Login fehlgeschlagen (Zugangsdaten prüfen).') {
    super(message);
    this.name = 'LearnwebAuthError';
  }
}

export class LearnwebTimeoutError extends Error {
  constructor(message = 'LearnWeb-Anfrage hat das Zeitlimit überschritten.') {
    super(message);
    this.name = 'LearnwebTimeoutError';
  }
}

export class LearnwebFileTooLargeError extends Error {
  constructor(message = 'Datei überschreitet das eingestellte Größenlimit.') {
    super(message);
    this.name = 'LearnwebFileTooLargeError';
  }
}

export class LearnwebUpstreamError extends Error {
  public readonly status?: number;
  constructor(message = 'LearnWeb antwortete mit einem Nicht-2xx-Status.', status?: number) {
    super(message);
    this.name = 'LearnwebUpstreamError';
    this.status = status;
  }
}

export interface LearnwebResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  data: string;
}

export interface DownloadFileResult {
  status: number;
  contentType: string;
  filename?: string;
  bytes: Buffer;
}

export class LearnwebSession {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly jar: CookieJar;
  private readonly client: AxiosInstance;

  private loginPromise: Promise<void> | null = null;
  private runningRequests = 0;
  private waitQueue: Array<() => void> = [];
  private lastRequestAt = 0;

  constructor(username: string, password: string, baseUrl: string = LEARNWEB_BASE_URL) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: baseUrl,
        jar: this.jar,
        withCredentials: true,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT },
        maxRedirects: 0,
        validateStatus: () => true,
      }),
    );
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Erzwingt einen frischen Login und meldet Erfolg/Misserfolg. Wird vom
   * Wizard-Schritt "Login prüfen" genutzt. Wirft LearnwebAuthError bei falschen
   * Zugangsdaten (ohne diese zu leaken).
   */
  async verifyCredentials(): Promise<void> {
    await this.performLogin(true);
  }

  /** GET auf Pfad oder absolute LearnWeb-URL (mit transparentem Re-Login). */
  async get(
    path: string,
    options: { allowRedirects?: boolean; timeoutMs?: number } = {},
  ): Promise<LearnwebResponse> {
    await this.throttleInterCall();
    await this.acquireSemaphore();
    try {
      await this.ensureLoggedIn();
      let resp = await this.rawGet(path, options.timeoutMs);

      if (this.isLoginRedirect(resp)) {
        await this.performLogin(true);
        resp = await this.rawGet(path, options.timeoutMs);
        if (this.isLoginRedirect(resp)) {
          throw new LearnwebAuthError('Session konnte nicht wiederhergestellt werden.');
        }
      }

      if (options.allowRedirects && isRedirect(resp.status)) {
        const location = resp.headers['location'];
        if (location) resp = await this.rawGet(location, options.timeoutMs);
      }

      return resp;
    } finally {
      this.releaseSemaphore();
    }
  }

  /** Authentifizierter Datei-Download (Bytes statt HTML). */
  async downloadFile(
    url: string,
    options: { maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<DownloadFileResult> {
    const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 120_000;

    await this.throttleInterCall();
    await this.acquireSemaphore();
    try {
      await this.ensureLoggedIn();
      let resp = await this.rawDownload(url, maxBytes, timeoutMs);

      if (this.isLoginRedirectDownload(resp)) {
        await this.performLogin(true);
        resp = await this.rawDownload(url, maxBytes, timeoutMs);
        if (this.isLoginRedirectDownload(resp)) {
          throw new LearnwebAuthError('Session für Download nicht herstellbar.');
        }
      }

      if (resp.status < 200 || resp.status >= 300) {
        throw new LearnwebUpstreamError('Download mit Nicht-2xx-Status fehlgeschlagen.', resp.status);
      }
      return resp;
    } finally {
      this.releaseSemaphore();
    }
  }

  // --- intern ---

  private async postForm(path: string, form: Record<string, string>): Promise<AxiosResponse> {
    const body = new URLSearchParams(form).toString();
    return this.client.post(path, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  private async rawGet(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<LearnwebResponse> {
    try {
      const resp = await this.client.get(path, { timeout: timeoutMs });
      return {
        status: resp.status,
        url: resp.request?.res?.responseUrl ?? this.resolveUrl(path),
        headers: normalizeHeaders(resp.headers),
        data: typeof resp.data === 'string' ? resp.data : String(resp.data ?? ''),
      };
    } catch (error) {
      if (isAxiosTimeoutError(error)) throw new LearnwebTimeoutError();
      throw error;
    }
  }

  private async rawDownload(url: string, maxBytes: number, timeoutMs: number): Promise<DownloadFileResult> {
    try {
      const resp = await this.client.get(url, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      const headers = normalizeHeaders(resp.headers);
      const contentType = headers['content-type'] ?? 'application/octet-stream';
      const filename = extractFilenameFromContentDisposition(headers['content-disposition']);
      return {
        status: resp.status,
        contentType,
        filename,
        bytes: Buffer.from(resp.data as ArrayBuffer),
      };
    } catch (error) {
      if (isAxiosTimeoutError(error)) throw new LearnwebTimeoutError();
      if (
        axios.isAxiosError(error) &&
        error.code === 'ERR_BAD_RESPONSE' &&
        /maxContentLength size of .* exceeded/i.test(error.message)
      ) {
        throw new LearnwebFileTooLargeError();
      }
      throw error;
    }
  }

  private resolveUrl(pathOrUrl: string): string {
    try {
      return new URL(pathOrUrl, this.baseUrl + '/').toString();
    } catch {
      return this.baseUrl + pathOrUrl;
    }
  }

  private async ensureLoggedIn(): Promise<void> {
    const cookies = await this.jar.getCookies(this.baseUrl);
    const hasMoodleCookie = cookies.some((c) => c.key.toLowerCase().startsWith('moodlesession'));
    if (hasMoodleCookie) return;
    await this.performLogin();
  }

  private async performLogin(force = false): Promise<void> {
    if (this.loginPromise && !force) return this.loginPromise;
    if (force) {
      await this.jar.removeAllCookies();
    }
    this.loginPromise = this.doLogin().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  private async doLogin(): Promise<void> {
    // Schritt 1: Login-Seite holen, logintoken extrahieren.
    const getResp = await this.client.get('/login/index.php');
    if (getResp.status < 200 || getResp.status >= 300) {
      throw new LearnwebAuthError('LearnWeb-Login-Seite nicht erreichbar.');
    }
    const html = typeof getResp.data === 'string' ? getResp.data : String(getResp.data ?? '');
    const $ = cheerio.load(html);
    const logintoken = $('input[name="logintoken"]').attr('value') ?? '';

    // Schritt 2: POST mit Credentials + logintoken.
    const postResp = await this.postForm('/login/index.php', {
      username: this.username,
      password: this.password,
      logintoken,
      anchor: '',
    });
    if (postResp.status < 200 || postResp.status >= 400) {
      throw new LearnwebAuthError();
    }

    // Münster-Moodle nutzt einen testsession-Bounce; das ist KEIN Fehler.
    // Misserfolg: Body enthält "loginerrormessage" oder Location zeigt ohne
    // testsession-Parameter zurück auf die Login-Form.
    const postBody = typeof postResp.data === 'string' ? postResp.data : String(postResp.data ?? '');
    const location = (postResp.headers?.['location'] as string | undefined) ?? '';
    const locationIsLoginForm = location.includes('/login/index.php') && !location.includes('testsession=');
    const stillOnLogin = locationIsLoginForm || postBody.includes('loginerrormessage');

    if (stillOnLogin) {
      throw new LearnwebAuthError(); // generisch — keine Credentials leaken
    }

    await this.verifyAuthenticatedSession();
  }

  private async verifyAuthenticatedSession(): Promise<void> {
    let resp = await this.rawGet('/my/');
    if (isRedirect(resp.status)) {
      const location = resp.headers['location'];
      if (!location || this.isLoginRedirect(resp)) throw new LearnwebAuthError();
      resp = await this.rawGet(location);
    }
    if (resp.status < 200 || resp.status >= 300 || this.isLoginRedirect(resp)) {
      throw new LearnwebAuthError();
    }
  }

  private isLoginRedirect(resp: LearnwebResponse): boolean {
    if (!isRedirect(resp.status)) {
      if (resp.status === 200 && /<form[^>]+action=["'][^"']*\/login\/index\.php/i.test(resp.data)) {
        return true;
      }
      return false;
    }
    const location = resp.headers['location'] ?? '';
    return location.includes('/login/index.php') || location.includes('/login/?');
  }

  private isLoginRedirectDownload(resp: DownloadFileResult): boolean {
    if (!resp.contentType.toLowerCase().startsWith('text/html')) return false;
    const head = resp.bytes.toString('utf8', 0, Math.min(resp.bytes.length, 8192));
    return /<form[^>]+action=["'][^"']*\/login\/index\.php/i.test(head);
  }

  private async throttleInterCall(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + INTER_CALL_DELAY_MS - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async acquireSemaphore(): Promise<void> {
    if (this.runningRequests < INTRA_CALL_CONCURRENCY) {
      this.runningRequests++;
      return;
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    this.runningRequests++;
  }

  private releaseSemaphore(): void {
    this.runningRequests--;
    const next = this.waitQueue.shift();
    if (next) next();
  }
}

// --- Hilfsfunktionen ---

function normalizeHeaders(h: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!h || typeof h !== 'object') return result;
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (Array.isArray(v)) result[k.toLowerCase()] = v.join(', ');
    else if (v != null) result[k.toLowerCase()] = String(v);
  }
  return result;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isAxiosTimeoutError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
}

function extractFilenameFromContentDisposition(header?: string): string | undefined {
  if (!header) return undefined;
  const encodedMatch = /filename\*\s*=\s*(?:UTF-8'[^']*')?([^;\r\n]+)/i.exec(header);
  if (encodedMatch && encodedMatch[1]) {
    const encoded = stripQuotes(encodedMatch[1]);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const plainMatch = /filename\s*=\s*([^;\r\n]+)/i.exec(header);
  if (!plainMatch || !plainMatch[1]) return undefined;
  return stripQuotes(plainMatch[1]);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
