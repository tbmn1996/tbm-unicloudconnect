/**
 * Tests fuer das MCP-Modul.
 *
 * - DB-Tools (get-courses, get-course-overview) gegen eine read-only Datei-DB.
 * - SSE-Server: Bearer-Token-Pflicht (401), Bindung auf 127.0.0.1, Handshake.
 * - Keine echten LearnWeb-Netzaufrufe (Live-Tools werden hier nicht ausgeloest).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from '../src/db/db';
import { openReadonlyDatabase } from '../src/mcp/db';
import { getCourses, getCourseOverview, safeMoodlePath, TOOL_NAMES, type ToolContext } from '../src/mcp/tools';
import { startSseServer } from '../src/mcp/server-sse';

/** Legt eine Datei-DB (Schema v2) mit Beispieldaten an und gibt den Pfad zurueck. */
function seedDatabase(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ucc-mcp-'));
  const path = join(dir, 'state.sqlite');
  const db = openDatabase(path);
  db.prepare('INSERT INTO courses (course_id, fullname, shortname, course_url) VALUES (?,?,?,?)')
    .run(1, 'Programmierung I', 'PROG1', 'https://lw.example/course/view.php?id=1');
  db.prepare('INSERT INTO courses (course_id, fullname, shortname, course_url) VALUES (?,?,?,?)')
    .run(2, 'Mathematik II', 'MATH2', 'https://lw.example/course/view.php?id=2');
  db.prepare(
    'INSERT INTO activities (cmid, course_id, modtype, name, section_name, section_index, view_url) VALUES (?,?,?,?,?,?,?)',
  ).run(101, 1, 'resource', 'Skript Woche 1', 'Grundlagen', 0, 'https://lw.example/mod/resource/view.php?id=101');
  db.prepare(
    'INSERT INTO activities (cmid, course_id, modtype, name, section_name, section_index, view_url) VALUES (?,?,?,?,?,?,?)',
  ).run(102, 1, 'forum', 'Diskussionsforum', 'Grundlagen', 0, 'https://lw.example/mod/forum/view.php?id=102');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('MCP exportiert genau 9 Tool-Namen', () => {
  assert.equal(TOOL_NAMES.length, 9);
  assert.ok(TOOL_NAMES.includes('learnweb-get-courses'));
  assert.ok(TOOL_NAMES.includes('learnweb-download-resource'));
});

test('get-courses fällt offline auf die read-only DB zurück', async () => {
  const { path, cleanup } = seedDatabase();
  try {
    const db = openReadonlyDatabase(path);
    const ctx = { db, getSession: async () => { throw new Error('offline'); } } as unknown as ToolContext;
    const courses = JSON.parse(await getCourses(ctx)) as Array<{ course_id: number; fullname: string }>;
    assert.equal(courses.length, 2);
    assert.equal(courses[0]!.fullname, 'Mathematik II'); // ORDER BY fullname
    db.close();
  } finally {
    cleanup();
  }
});

test('get-course-overview faellt offline auf den lokalen Cache zurueck', async () => {
  const { path, cleanup } = seedDatabase();
  try {
    const db = openReadonlyDatabase(path);
    // getSession wirft (kein Login) → DB-Fallback fuer synchronisierte Kurse.
    const ctx = {
      db,
      getSession: async () => {
        throw new Error('kein Login');
      },
    } as unknown as ToolContext;
    const overview = JSON.parse(await getCourseOverview(ctx, 1)) as Array<{ section_name: string; activities: unknown[] }>;
    assert.equal(overview.length, 1);
    assert.equal(overview[0]!.section_name, 'Grundlagen');
    assert.equal(overview[0]!.activities.length, 2);
    db.close();
  } finally {
    cleanup();
  }
});

test('get-course-overview liest kontoweit live (auch nicht synchronisierte Kurse)', async () => {
  const { path, cleanup } = seedDatabase();
  // Kurs 9 ist NICHT in der lokalen DB — nur der Live-Pfad liefert Daten.
  const courseHtml = `
    <h1>Datenbanken</h1>
    <li class="course-section" data-sectionname="Woche 1">
      <ul data-for="cmlist">
        <li data-for="cmitem" data-id="201" class="activity modtype_resource">
          <a class="aalink" href="/mod/resource/view.php?id=201"><span data-activityname="Folien">Folien</span></a>
        </li>
        <li data-for="cmitem" data-id="202" class="activity modtype_url">
          <a class="aalink" href="/mod/url/view.php?id=202"><span class="instancename">Vorlesungsvideo</span></a>
        </li>
      </ul>
    </li>`;
  const fakeSession = {
    get: async () => ({ status: 200, url: 'https://lw.example/course/view.php?id=9', headers: {}, data: courseHtml }),
    getBaseUrl: () => 'https://lw.example',
  };
  try {
    const db = openReadonlyDatabase(path);
    const ctx = { db, getSession: async () => fakeSession } as unknown as ToolContext;
    const overview = JSON.parse(await getCourseOverview(ctx, 9)) as Array<{
      section_name: string;
      activities: Array<{ cmid: number }>;
    }>;
    assert.equal(overview.length, 1);
    assert.equal(overview[0]!.section_name, 'Woche 1');
    assert.equal(overview[0]!.activities.length, 2);
    assert.equal(overview[0]!.activities[0]!.cmid, 201);
    db.close();
  } finally {
    cleanup();
  }
});

test('safeMoodlePath erlaubt gueltige Pfade und blockt Traversal', () => {
  assert.equal(safeMoodlePath('/mod/forum/view.php?id=123'), '/mod/forum/view.php?id=123');
  assert.throws(() => safeMoodlePath('/mod/../../login/logout.php'));
  assert.throws(() => safeMoodlePath('/etc/passwd'));
  assert.throws(() => safeMoodlePath('/mod/%2e%2e/%2e%2e/login/token.php'));
});

test('readonly-DB lehnt Schreibzugriffe ab', () => {
  const { path, cleanup } = seedDatabase();
  try {
    const db = openReadonlyDatabase(path);
    assert.throws(() => db.prepare('INSERT INTO courses (course_id, fullname) VALUES (9, "x")').run());
    db.close();
  } finally {
    cleanup();
  }
});

test('SSE-Server: 127.0.0.1, Bearer-Pflicht (401), Handshake mit Token', async () => {
  const { path, cleanup } = seedDatabase();
  const token = 'test-token-abc123';
  const { url, port, close } = await startSseServer({ port: 39517, token, dbPath: path });
  try {
    assert.ok(url.startsWith('http://127.0.0.1:'));
    assert.ok(port >= 39517);

    // ohne Token -> 401
    const noAuth = await get(`${url}`);
    assert.equal(noAuth.status, 401);

    // falsches Token -> 401
    const wrong = await get(url, { Authorization: 'Bearer falsch' });
    assert.equal(wrong.status, 401);

    // korrektes Token -> 200 + event-stream (Stream danach abbrechen)
    const ok = await get(url, { Authorization: `Bearer ${token}` }, true);
    assert.equal(ok.status, 200);
    assert.match(ok.contentType ?? '', /text\/event-stream/);
  } finally {
    await close();
    cleanup();
  }
});

test('SSE-Server lehnt zu kurze Bearer-Tokens ab', async () => {
  const { path, cleanup } = seedDatabase();
  try {
    await assert.rejects(() => startSseServer({ port: 39517, token: 'zu-kurz', dbPath: path }));
  } finally {
    cleanup();
  }
});

/** Minimaler GET-Helfer; bei `abort=true` wird der SSE-Stream sofort beendet. */
function get(
  url: string,
  headers: Record<string, string> = {},
  abort = false,
): Promise<{ status: number; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const result = { status: res.statusCode ?? 0, contentType: res.headers['content-type'] };
      if (abort) {
        res.destroy();
        resolve(result);
        return;
      }
      res.on('data', () => undefined);
      res.on('end', () => resolve(result));
    });
    req.on('error', reject);
  });
}
