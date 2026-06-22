/**
 * MCP-Tools — die 9 read-only LearnWeb-Werkzeuge laut docs/MCP_SPEC.md.
 *
 * Zwei Gruppen:
 *  - DB-Tools (get-courses, get-course-overview): lesen aus der lokalen
 *    read-only SQLite (synchronisierte Daten).
 *  - Live-Tools (Rest): nutzen eine LearnwebSession (Keychain-Login im
 *    MCP-Prozess) und greifen read-only auf das LearnWeb zu.
 *
 * Sicherheit: strikt lesend. `modtype`/`path` sind allowlisted, Downloads sind
 * auf den LearnWeb-Host beschraenkt (kein SSRF/Cookie-Leak zu Fremdhosts).
 */
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { absoluteUrl } from '../learnweb-core/parsers/common';
import { LearnwebClient } from '../learnweb-core/client';
import type { SessionProvider } from './session';

/** Laufzeitkontext, den jedes Tool erhaelt. */
export interface ToolContext {
  /** Read-only geoeffnete lokale SQLite. */
  db: Database.Database;
  /** Lazy LearnwebSession-Provider (nur Live-Tools nutzen ihn). */
  getSession: SessionProvider;
}

// --- Hilfsfunktionen --------------------------------------------------------

/** Bereinigt LearnWeb-HTML zu lesbarem Text (Navigation/Skripte entfernt). */
function cleanText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .navbar, #nav-drawer, .breadcrumb').remove();
  const main = $('#region-main').first();
  const root = main.length > 0 ? main : $('[role=main]').first().length > 0 ? $('[role=main]').first() : $('body');
  return root
    .text()
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20_000);
}

/** Extrahiert pluginfile-/Ressourcen-Download-Links als absolute URLs. */
function extractDownloadUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('a[href*="pluginfile.php"], a[href*="/mod_resource/"]').each((_i, el) => {
    const href = $(el).attr('href');
    if (href) urls.add(absoluteUrl(baseUrl, href));
  });
  return [...urls];
}

/** Prueft, ob eine absolute URL denselben Host wie die LearnWeb-Basis hat. */
function isSameHost(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).host === new URL(baseUrl).host;
  } catch {
    return false;
  }
}

const HARD_DOWNLOAD_LIMIT = 25 * 1024 * 1024;

/** Erlaubte Pfad-Praefixe fuer learnweb-get-page (nach Normalisierung geprueft). */
const ALLOWED_PAGE_PREFIXES = ['/mod/', '/course/', '/calendar/', '/my/', '/blocks/'] as const;

/**
 * Validiert und normalisiert einen Moodle-Pfad fuer `getPage`.
 *
 * Schutz vor Path-Traversal: Die Allowlist allein genuegt nicht, weil
 * `/mod/../../login/logout.php` mit `/mod/` beginnt. Daher wird der Pfad zuerst
 * **normalisiert** (URL kollabiert `..`/`.`), erst der finale `pathname` gegen
 * die Allowlist geprueft. `..`-Segmente (auch prozent-kodiert) werden zusaetzlich
 * hart abgelehnt. Rueckgabe ist der bereinigte Pfad (inkl. Query), der dann an
 * die Session geht — nie der ungepruefte Rohwert.
 */
export function safeMoodlePath(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error('Ungueltiger Pfad.');
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) {
    throw new Error('Pfad-Traversal nicht erlaubt.');
  }
  // Relative Aufloesung gegen einen Dummy-Host kollabiert ./ und ../
  const normalized = new URL(decoded, 'http://learnweb.local');
  const pathname = normalized.pathname;
  if (pathname.includes('..')) {
    throw new Error('Pfad-Traversal nicht erlaubt.');
  }
  if (!ALLOWED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    throw new Error('Pfad nicht erlaubt (nur /mod, /course, /calendar, /my, /blocks).');
  }
  return `${pathname}${normalized.search}`;
}

// --- Tool-Handler (einzeln testbar) -----------------------------------------

/** Lokaler Kurs-Cache als Offline-Fallback. */
function getCoursesFromDb(ctx: ToolContext): string {
  const rows = ctx.db
    .prepare('SELECT course_id, fullname, shortname, course_url FROM courses ORDER BY fullname')
    .all() as Array<{ course_id: number; fullname: string; shortname: string | null; course_url: string | null }>;
  return JSON.stringify(rows, null, 2);
}

/** 1. Alle sichtbaren Kontokurse live; bei Offline-Betrieb aus dem Cache. */
export async function getCourses(ctx: ToolContext): Promise<string> {
  try {
    const session = await ctx.getSession();
    const courses = await new LearnwebClient(session).listCourses();
    return JSON.stringify(courses.map((course) => ({
      course_id: course.courseId,
      fullname: course.fullname,
      shortname: course.shortname,
      course_url: course.courseUrl,
    })), null, 2);
  } catch {
    return getCoursesFromDb(ctx);
  }
}

/** Eine Aktivitaets-Zeile fuer die Gruppierung nach Abschnitt. */
interface OverviewRow {
  cmid: number;
  modtype: string;
  name: string;
  section_name: string | null;
  section_index: number | null;
  view_url: string | null;
}

/** Gruppiert Aktivitaeten nach Abschnitt (Reihenfolge des Eingangs bleibt erhalten). */
function groupBySection(rows: OverviewRow[]): Array<{
  section_name: string;
  activities: Array<{ cmid: number; modtype: string; name: string; view_url: string | null }>;
}> {
  const sections = new Map<string, Array<{ cmid: number; modtype: string; name: string; view_url: string | null }>>();
  for (const r of rows) {
    const key = r.section_name ?? `Abschnitt ${r.section_index ?? 0}`;
    const list = sections.get(key) ?? [];
    list.push({ cmid: r.cmid, modtype: r.modtype, name: r.name, view_url: r.view_url });
    sections.set(key, list);
  }
  return [...sections.entries()].map(([section_name, activities]) => ({ section_name, activities }));
}

/** Kurs-Uebersicht aus dem lokalen Cache (Fallback; nur synchronisierte Kurse). */
export function getCourseOverviewFromDb(ctx: ToolContext, courseId: number): string {
  const rows = ctx.db
    .prepare(
      'SELECT cmid, modtype, name, section_name, section_index, view_url FROM activities WHERE course_id = ? ORDER BY section_index, name',
    )
    .all(courseId) as OverviewRow[];
  return JSON.stringify(groupBySection(rows), null, 2);
}

/**
 * 2. Kurs-Uebersicht (Abschnitte + Aktivitaeten).
 *
 * Kontoweiter Scope (MCP_SPEC, "Keine Scope-Einschraenkung"): primaer **live**
 * ueber die Session, damit auch nicht lokal ausgewaehlte Kurse vollstaendig
 * erscheinen. Faellt bei Fehlern (offline/kein Login) auf den lokalen Cache
 * zurueck (nur synchronisierte Kurse).
 */
export async function getCourseOverview(ctx: ToolContext, courseId: number): Promise<string> {
  try {
    const session = await ctx.getSession();
    const client = new LearnwebClient(session);
    const activities = await client.listActivities(courseId);
    const rows: OverviewRow[] = activities.map((a) => ({
      cmid: a.cmid,
      modtype: a.modtype,
      name: a.name,
      section_name: a.sectionName,
      section_index: a.sectionIndex,
      view_url: a.viewUrl,
    }));
    return JSON.stringify(groupBySection(rows), null, 2);
  } catch {
    return getCourseOverviewFromDb(ctx, courseId);
  }
}

/** 3. Aktivitaet live auslesen (bereinigter Text + ggf. Download-URLs). */
export async function readActivity(
  ctx: ToolContext,
  input: { cmid: number; modtype: string; limit?: number; offset?: number },
): Promise<string> {
  const session = await ctx.getSession();
  const resp = await session.get(`/mod/${input.modtype}/view.php?id=${input.cmid}`, { allowRedirects: true });
  const $ = cheerio.load(resp.data);
  const discussions = $('.discussion, [data-region="discussion-list"] [data-region="discussion"], .forumpost')
    .map((_i, element) => cleanText($.html(element)))
    .get()
    .filter(Boolean);
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  return JSON.stringify({
      cmid: input.cmid,
      modtype: input.modtype,
      text: cleanText(resp.data),
      download_urls: extractDownloadUrls(resp.data, session.getBaseUrl()),
      discussions: discussions.slice(offset, offset + limit),
      pagination: { offset, limit, total: discussions.length },
    }, null, 2);
}

/** 4. Quiz-Review eines abgeschlossenen Versuchs (bereinigter Text). */
export async function readQuizReview(
  ctx: ToolContext,
  input: { cmid: number; attempt: number },
): Promise<string> {
  const session = await ctx.getSession();
  const resp = await session.get(`/mod/quiz/review.php?attempt=${input.attempt}&cmid=${input.cmid}`, {
    allowRedirects: true,
  });
  const $ = cheerio.load(resp.data);
  const header: Record<string, string> = {};
  $('table.quizreviewsummary tr').each((_i, row) => {
    const label = $(row).find('th').first().text().trim().toLowerCase().replace(/\s+/g, '_');
    const value = $(row).find('td').first().text().trim().replace(/\s+/g, ' ');
    if (label && value) header[label] = value;
  });
  const state = Object.entries(header).find(([key]) => /state|status|zustand/.test(key))?.[1] ?? '';
  const finished = /finished|beendet|abgeschlossen|completed/i.test(state);
  const questions: Array<Record<string, unknown>> = [];
  if (finished) {
    $('div.que').each((_i, element) => {
      const question = $(element);
      const chosen = question.find('input[checked]').map((_j, inputElement) =>
        $(inputElement).closest('div').text().trim().replace(/\s+/g, ' ')).get().filter(Boolean);
      questions.push({
        number: Number(question.find('.qno, .no').first().text().match(/\d+/)?.[0] ?? 0) || null,
        state: question.find('.state').first().text().trim() || null,
        marks: question.find('.grade').first().text().trim() || null,
        question_text: question.find('.qtext').first().text().trim().replace(/\s+/g, ' ') || null,
        your_answer: chosen,
        correct_answer: question.find('.rightanswer').first().text().trim().replace(/^.*?:\s*/, '') || null,
        explanation: question.find('.generalfeedback').first().text().trim().replace(/\s+/g, ' ') || null,
      });
    });
  }
  return JSON.stringify({ cmid: input.cmid, attempt: input.attempt, header, questions, parser_degraded: !finished }, null, 2);
}

/** 5. Timeline (anstehende Termine, kursuebergreifend). */
export async function getTimeline(
  ctx: ToolContext,
  input: { window_days?: number; modtypes?: string[]; course_id?: number; event_type?: string } = {},
): Promise<string> {
  const session = await ctx.getSession();
  const resp = await session.get('/calendar/view.php?view=upcoming', { allowRedirects: true });
  const windowDays = input.window_days ?? 30;
  const events = parseCalendarEvents(resp.data, session.getBaseUrl()).filter((event) => {
    if (input.course_id && event.course_id !== input.course_id) return false;
    if (input.event_type && event.event_type !== input.event_type) return false;
    if (input.modtypes?.length && event.modtype && !input.modtypes.includes(event.modtype)) return false;
    if (event.due_at_unix) {
      const now = Math.floor(Date.now() / 1000);
      return event.due_at_unix >= now && event.due_at_unix <= now + windowDays * 86_400;
    }
    return true;
  }).sort((a, b) => (a.due_at_unix ?? Number.MAX_SAFE_INTEGER) - (b.due_at_unix ?? Number.MAX_SAFE_INTEGER));
  return JSON.stringify({ events, window_days: windowDays, fetched_at: new Date().toISOString() }, null, 2);
}

/** 6. Kurssuche im globalen Katalog (Live). */
export async function searchCourses(
  ctx: ToolContext,
  input: { query: string; page: number; limit?: number },
): Promise<string> {
  const session = await ctx.getSession();
  const resp = await session.get(
    `/course/search.php?search=${encodeURIComponent(input.query)}&page=${input.page}`,
    { allowRedirects: true },
  );
  const $ = cheerio.load(resp.data);
  const results: Array<{ course_id: number | null; fullname: string; course_url: string }> = [];
  $('.coursebox, .course-listitem').each((_i, el) => {
    const link = $(el).find('a[href*="/course/view.php"]').first();
    const href = link.attr('href') ?? '';
    const idMatch = href.match(/[?&]id=(\d+)/);
    const fullname = link.text().trim() || $(el).find('.coursename').text().trim();
    if (fullname) {
      results.push({
        course_id: idMatch ? Number(idMatch[1]) : null,
        fullname,
        course_url: absoluteUrl(session.getBaseUrl(), href),
      });
    }
  });
  const limit = input.limit ?? 20;
  return JSON.stringify({
    results: results.slice(0, limit),
    page: input.page,
    has_more: results.length > limit || $('a[rel="next"], .paging a.next').length > 0,
    effective_perpage: results.length,
  }, null, 2);
}

/** 7. Geschuetzte Moodle-Seite als bereinigten Text (Pfad normalisiert + allowlisted). */
export async function getPage(ctx: ToolContext, path: string): Promise<string> {
  const safePath = safeMoodlePath(path);
  const session = await ctx.getSession();
  const resp = await session.get(safePath, { allowRedirects: true });
  return JSON.stringify({ path: safePath, text: cleanText(resp.data) }, null, 2);
}

/** 8. Monatskalender (Live). */
export async function getCalendarMonth(
  ctx: ToolContext,
  input: { year?: number; month?: number; course_id?: number },
): Promise<string> {
  const session = await ctx.getSession();
  const params = ['view=month'];
  if (input.year) params.push(`cal_y=${input.year}`);
  if (input.month) params.push(`cal_m=${input.month}`);
  if (input.course_id) params.push(`course=${input.course_id}`);
  const resp = await session.get(`/calendar/view.php?${params.join('&')}`, { allowRedirects: true });
  const now = new Date();
  return JSON.stringify({
    events: parseCalendarEvents(resp.data, session.getBaseUrl())
      .filter((event) => !input.course_id || event.course_id === input.course_id),
    year: input.year ?? now.getFullYear(),
    month: input.month ?? now.getMonth() + 1,
    fetched_at: new Date().toISOString(),
  }, null, 2);
}

interface CalendarEvent {
  title: string;
  course_id: number | null;
  modtype: string | null;
  event_type: string | null;
  cmid: number | null;
  due_at_unix: number | null;
  url: string | null;
}

function parseCalendarEvents(html: string, baseUrl: string): CalendarEvent[] {
  const $ = cheerio.load(html);
  const events: CalendarEvent[] = [];
  $('li[data-region="event-list-item"], li[data-region="event-item"], [data-region="day"] li').each((_i, element) => {
    const item = $(element);
    const link = item.find("a[href*='/mod/'], a[data-action='view-event']").first();
    const href = link.attr('href') ?? '';
    const title = item.find('.event-name, .eventname, h3').first().text().trim() || link.text().trim();
    if (!title) return;
    const cmid = Number(new URL(href || '/', baseUrl).searchParams.get('id')) || null;
    const courseId = Number(item.attr('data-course-id') ?? new URL(href || '/', baseUrl).searchParams.get('course')) || null;
    const component = item.attr('data-event-component') ?? '';
    const modtype = component.startsWith('mod_') ? component.slice(4) : href.match(/\/mod\/([a-z_]+)\//)?.[1] ?? null;
    const timestamp = Number(item.attr('data-timestamp') ?? item.find('[data-timestamp]').first().attr('data-timestamp')) || null;
    events.push({
      title: title.replace(/\s+/g, ' ').slice(0, 300),
      course_id: courseId,
      modtype,
      event_type: item.attr('data-event-eventtype') ?? null,
      cmid,
      due_at_unix: timestamp,
      url: href ? absoluteUrl(baseUrl, href) : null,
    });
  });
  return events;
}

/** 9. Authentifizierter Download (Base64), nur vom LearnWeb-Host. */
export async function downloadResource(
  ctx: ToolContext,
  input: { url: string; max_bytes: number },
): Promise<string> {
  const session = await ctx.getSession();
  if (!isSameHost(input.url, session.getBaseUrl())) {
    throw new Error('Download nur von der LearnWeb-Domain erlaubt.');
  }
  if (!new URL(input.url).pathname.includes('/pluginfile.php/')) {
    throw new Error('Download nur für Moodle-pluginfile-URLs erlaubt.');
  }
  const maxBytes = Math.min(input.max_bytes, HARD_DOWNLOAD_LIMIT);
  const result = await session.downloadFile(input.url, { maxBytes });
  return JSON.stringify({
    filename: result.filename ?? 'download',
    mime_type: result.contentType,
    base64: result.bytes.toString('base64'),
  });
}

// --- Registrierung am MCP-Server (SDK 1.x) ----------------------------------

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

/** Registriert alle 9 read-only Tools am uebergebenen McpServer. */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'learnweb-get-courses',
    { description: 'Listet alle sichtbaren LearnWeb-Kurse (course_id, fullname, shortname, course_url).', inputSchema: {} },
    async () => textResult(await getCourses(ctx)),
  );

  server.registerTool(
    'learnweb-get-course-overview',
    {
      description: 'Wochen-/Themenstruktur und Aktivitaeten eines Kurses.',
      inputSchema: { course_id: z.number().int().positive() },
    },
    async ({ course_id }) => textResult(await getCourseOverview(ctx, course_id)),
  );

  server.registerTool(
    'learnweb-read-activity',
    {
      description: 'Liest Details einer Aktivitaet strukturiert aus (Text + Download-URLs).',
      inputSchema: {
        cmid: z.number().int().positive(),
        modtype: z.string().regex(/^[a-z_]+$/, 'modtype muss aus Kleinbuchstaben/Unterstrichen bestehen'),
        limit: z.number().int().nonnegative().optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async ({ cmid, modtype, limit, offset }) => textResult(await readActivity(ctx, { cmid, modtype, limit, offset })),
  );

  server.registerTool(
    'learnweb-read-quiz-review',
    {
      description: 'Detail-Auswertung eines abgeschlossenen Quiz-Versuchs.',
      inputSchema: { cmid: z.number().int().positive(), attempt: z.number().int().positive() },
    },
    async ({ cmid, attempt }) => textResult(await readQuizReview(ctx, { cmid, attempt })),
  );

  server.registerTool(
    'learnweb-get-timeline',
    {
      description: 'Anstehende Abgaben, Quizzes und Kalender-Events kursuebergreifend.',
      inputSchema: {
        window_days: z.number().int().min(1).max(90).optional(),
        modtypes: z.array(z.string()).optional(),
        course_id: z.number().int().positive().optional(),
        event_type: z.string().optional(),
      },
    },
    async (args) => textResult(await getTimeline(ctx, args)),
  );

  server.registerTool(
    'learnweb-search-courses',
    {
      description: 'Durchsucht den globalen LearnWeb-Kurskatalog der Universitaet Muenster.',
      inputSchema: {
        query: z.string().min(2).max(200),
        page: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async ({ query, page, limit }) => textResult(await searchCourses(ctx, { query, page: page ?? 0, limit })),
  );

  server.registerTool(
    'learnweb-get-page',
    {
      description: 'Bereinigter Textinhalt einer geschuetzten Moodle-Seite (Pfad auf /mod,/course,/calendar,/my,/blocks beschraenkt).',
      inputSchema: {
        path: z
          .string()
          .regex(/^\/(?:mod|course|calendar|my|blocks)\//, 'Pfad muss unter /mod, /course, /calendar, /my oder /blocks liegen'),
      },
    },
    async ({ path }) => textResult(await getPage(ctx, path)),
  );

  server.registerTool(
    'learnweb-get-calendar-month',
    {
      description: 'Kalender-Eintraege eines Monats.',
      inputSchema: {
        year: z.number().int().min(2000).optional(),
        month: z.number().int().min(1).max(12).optional(),
        course_id: z.number().int().optional(),
      },
    },
    async ({ year, month, course_id }) => textResult(await getCalendarMonth(ctx, { year, month, course_id })),
  );

  server.registerTool(
    'learnweb-download-resource',
    {
      description: 'Authentifizierter Datei-Download (Base64) ueber eine LearnWeb-Pluginfile-URL.',
      inputSchema: {
        url: z.string().url(),
        max_bytes: z.number().int().positive().max(HARD_DOWNLOAD_LIMIT).optional(),
      },
    },
    async ({ url, max_bytes }) => textResult(await downloadResource(ctx, { url, max_bytes: max_bytes ?? 3 * 1024 * 1024 })),
  );
}

/** Namen aller registrierten Tools (fuer Tests/Diagnose). */
export const TOOL_NAMES = [
  'learnweb-get-courses',
  'learnweb-get-course-overview',
  'learnweb-read-activity',
  'learnweb-read-quiz-review',
  'learnweb-get-timeline',
  'learnweb-search-courses',
  'learnweb-get-page',
  'learnweb-get-calendar-month',
  'learnweb-download-resource',
] as const;
