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
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { LEARNWEB_BASE_URL } from './constants';

// User-Agent identisch zum Referenz-Scraper, damit Moodle gleich reagiert.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const INTER_CALL_DELAY_MS = 150;
const INTRA_CALL_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 30000;

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

export interface DownloadToPathResult {
  status: number;
  contentType: string;
  filename?: string;
  sizeBytes: number;
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
    await this.acquireSemaphore();
    await this.throttleInterCall();
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

    await this.acquireSemaphore();
    await this.throttleInterCall();
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

  /** Authentifizierter, größenbegrenzter Streaming-Download ohne Vollbuffer im RAM. */
  async downloadFileToPath(
    url: string,
    destination: string,
    options: {
      maxBytes?: number;
      timeoutMs?: number;
      onProgress?: (downloadedBytes: number, totalBytes?: number) => void;
    } = {},
  ): Promise<DownloadToPathResult> {
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 30 * 60_000;
    await this.acquireSemaphore();
    await this.throttleInterCall();
    try {
      await this.ensureLoggedIn();
      let response = await this.rawStreamDownload(url, timeoutMs);
      if (response.contentType.toLowerCase().startsWith('text/html')) {
        response.stream.destroy();
        await this.performLogin(true);
        response = await this.rawStreamDownload(url, timeoutMs);
      }
      if (response.status < 200 || response.status >= 300
        || response.contentType.toLowerCase().startsWith('text/html')) {
        response.stream.destroy();
        throw new LearnwebUpstreamError('Medien-Download fehlgeschlagen.', response.status);
      }

      let sizeBytes = 0;
      const totalBytes = response.contentLength;
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          if (sizeBytes > maxBytes) {
            callback(new LearnwebFileTooLargeError());
          } else {
            if (options.onProgress) {
              options.onProgress(sizeBytes, totalBytes);
            }
            callback(null, chunk);
          }
        },
      });
      try {
        await pipeline(response.stream, limiter, createWriteStream(destination, { flags: 'wx' }));
      } catch (error) {
        await unlink(destination).catch(() => undefined);
        throw error;
      }
      return {
        status: response.status,
        contentType: response.contentType,
        filename: response.filename,
        sizeBytes,
      };
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
      // responseType 'arraybuffer' verhindert, dass axios den Body anhand
      // eines falsch erkannten Default-Charsets (Latin-1) vordekodiert. Wir
      // dekodieren stattdessen selbst anhand des Content-Type-Headers.
      const resp = await this.client.get(path, { timeout: timeoutMs, responseType: 'arraybuffer' });
      const headers = normalizeHeaders(resp.headers);
      const buffer = Buffer.from(resp.data as ArrayBuffer);
      return {
        status: resp.status,
        url: resp.request?.res?.responseUrl ?? this.resolveUrl(path),
        headers,
        data: decodeBodyBuffer(buffer, headers['content-type']),
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

  private async rawStreamDownload(url: string, timeoutMs: number): Promise<{
    status: number;
    contentType: string;
    filename?: string;
    contentLength?: number;
    stream: Readable;
  }> {
    try {
      const response = await this.client.get<Readable>(url, {
        responseType: 'stream',
        timeout: timeoutMs,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      const headers = normalizeHeaders(response.headers);
      const contentLengthStr = headers['content-length'];
      const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;
      return {
        status: response.status,
        contentType: headers['content-type'] ?? 'application/octet-stream',
        filename: extractFilenameFromContentDisposition(headers['content-disposition']),
        contentLength: contentLength !== undefined && !isNaN(contentLength) ? contentLength : undefined,
        stream: response.data,
      };
    } catch (error) {
      if (isAxiosTimeoutError(error)) throw new LearnwebTimeoutError();
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
    try {
      const getResp = await this.client.get('/login/index.php');
      if (getResp.status < 200 || getResp.status >= 300) {
        throw new LearnwebAuthError('LearnWeb-Login-Seite nicht erreichbar.');
      }
      const html = typeof getResp.data === 'string' ? getResp.data : String(getResp.data ?? '');
      const $ = cheerio.load(html);
      const logintoken = $('input[name="logintoken"]').attr('value') ?? '';

      const postResp = await this.postForm('/login/index.php', {
        username: this.username,
        password: this.password,
        logintoken,
        anchor: '',
      });
      if (postResp.status < 200 || postResp.status >= 400) {
        throw new LearnwebAuthError();
      }

      const postBody = typeof postResp.data === 'string' ? postResp.data : String(postResp.data ?? '');
      const location = (postResp.headers?.['location'] as string | undefined) ?? '';
      const locationIsLoginForm = location.includes('/login/index.php') && !location.includes('testsession=');
      const stillOnLogin = locationIsLoginForm || postBody.includes('loginerrormessage');

      if (stillOnLogin) {
        throw new LearnwebAuthError();
      }

      await this.verifyAuthenticatedSession();
    } catch (error) {
      if (isAxiosTimeoutError(error)) throw new LearnwebTimeoutError();
      if (error instanceof LearnwebAuthError || error instanceof LearnwebTimeoutError) throw error;
      throw new LearnwebAuthError(
        error instanceof Error ? error.message : 'LearnWeb-Login fehlgeschlagen.',
      );
    }
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

/**
 * Dekodiert einen rohen HTTP-Response-Body anhand des charset-Parameters im
 * Content-Type-Header. Moodle/LearnWeb liefert standardmaessig UTF-8; ohne
 * erkanntes oder unbekanntes Charset wird ebenfalls UTF-8 angenommen (Fix fuer
 * Mojibake bei Umlauten, GitHub-Issue #8).
 */
function decodeBodyBuffer(buffer: Buffer, contentType?: string): string {
  const match = contentType ? /charset=([^;]+)/i.exec(contentType) : null;
  const charset = match?.[1]?.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252') {
    return buffer.toString('latin1');
  }
  return buffer.toString('utf8');
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
  return fixLatin1Mojibake(stripQuotes(plainMatch[1]));
}

/**
 * Node dekodiert HTTP-Header grundsaetzlich als Latin-1 (RFC 7230 erlaubt nur
 * ASCII in Headern). Sendet ein Server unkodierte UTF-8-Bytes im plain
 * filename-Parameter (statt RFC-5987 filename*=UTF-8''...), erscheinen
 * Mehrbyte-Zeichen als mehrere Latin-1-Zeichen (z.B. "Ã¼" statt "ü"). Die
 * Latin-1-Zeichen als die urspruenglichen UTF-8-Bytes zu re-interpretieren
 * behebt das, ist aber nur sicher anzuwenden, wenn das Ergebnis valides UTF-8
 * ergibt (sonst bleibt der Originalwert erhalten).
 */
function fixLatin1Mojibake(value: string): string {
  const reinterpreted = Buffer.from(value, 'latin1').toString('utf8');
  return reinterpreted.includes('�') ? value : reinterpreted;
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
