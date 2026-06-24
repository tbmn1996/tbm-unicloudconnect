/**
 * Integrationstest (Backfill): pusht bereits lokal fertige ('done') Jobs, die
 * noch keinen output_refs-Eintrag haben, nachträglich in die konfigurierte
 * Notion-Meeting-DB. Behebt den ursprünglichen Bug (VL 7 & 8 fehlten in der
 * Meeting-DB), ohne erneut den ~10-min-Whisper-Lauf durchlaufen zu müssen —
 * die .md-Transkripte liegen lokal bereits vor.
 *
 * Läuft NICHT bei normalem `npm test` (echte Netzwerk-/Notion-Seiteneffekte).
 * Nur explizit mit `NOTION_PUSH_IT=1` aktiv:
 *
 *   npm run rebuild:node && NOTION_PUSH_IT=1 npm test -- notion-push.it
 *
 * Vorher `npm run rebuild:node` (better-sqlite3 sonst auf Electron-ABI
 * gebaut, siehe CLAUDE.md "Live-Tests & Builds"). Die App vor dem Lauf
 * schließen, damit kein konkurrierender Schreibzugriff auf state.sqlite
 * entsteht. Idempotent: bereits per output_refs erfasste Jobs werden
 * übersprungen, ein wiederholter Lauf ist gefahrlos.
 *
 * Env-Variablen:
 * - UCC_DB_PATH: expliziter Pfad zur state.sqlite (sonst Kandidaten-Suche).
 * - NOTION_TOKEN: Notion-Integration-Token (sonst Keychain-Credential).
 * - NOTION_PUSH_TEST_DB: pusht gegen eine Scratch-DB statt der konfigurierten
 *   Meeting-DB — für schnelle, wiederholbare Tests ohne Risiko für echte Daten.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openDatabase } from '../src/db/db';
import { createRepos, type Repos } from '../src/db/repos';
import { getPassword } from '../src/keychain/keychain';
import { NotionClient } from '../src/notion-core/client';
import { NotionAdapter } from '../src/output-adapters/notion-adapter';
import {
  OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY,
  OUTPUT_NOTION_DATABASE_ID_SETTING_KEY,
  OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY,
} from '../src/output-adapters/types';

const RUN_IT = process.env.NOTION_PUSH_IT === '1';

/** DB-Pfad-Auflösung: UCC_DB_PATH zuerst, sonst Dev-/Packaged-Kandidaten (siehe CLAUDE.md). */
function resolveDbPath(): string {
  if (process.env.UCC_DB_PATH) return process.env.UCC_DB_PATH;
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'TBM UniCloudConnect', 'state.sqlite'),
    join(homedir(), 'Library', 'Application Support', 'tbm-unicloudconnect', 'state.sqlite'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`Keine state.sqlite gefunden (geprüft: ${candidates.join(', ')}). UCC_DB_PATH setzen.`);
  }
  return found;
}

/** Baut den NotionAdapter + die Ziel-DB-ID für den Backfill (Token: NOTION_TOKEN bevorzugt, sonst Keychain). */
async function resolveNotionAdapter(repos: Repos): Promise<{ adapter: NotionAdapter; meetingDatabaseId: string }> {
  const meetingDatabaseId = process.env.NOTION_PUSH_TEST_DB
    || repos.settings.get(OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY)
    || repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY);
  if (!meetingDatabaseId) {
    throw new Error('Keine Meeting-/Ziel-Datenbank-ID konfiguriert (output.notion.meeting_db_id) und NOTION_PUSH_TEST_DB nicht gesetzt.');
  }
  const contentDatabaseId = repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY) ?? meetingDatabaseId;
  // Wie createNotionAdapter() in notion-adapter.ts: coursesDatabaseId mitnehmen, sonst
  // verknüpft placeTranscript() den 'Kurs'-Wert als rich_text statt als relation —
  // schlägt mit "Kurs is expected to be relation" fehl, wenn die Ziel-DB eine
  // Kurs-Relation erwartet (wie die echte Meeting-DB).
  const coursesDatabaseId = repos.settings.get(OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY) || undefined;

  let token = process.env.NOTION_TOKEN ?? null;
  if (!token) {
    const credential = repos.credentials.get('notion');
    if (credential) token = await getPassword(credential.accountName, credential.serviceName);
  }
  if (!token) {
    throw new Error('Kein Notion-Token verfügbar (NOTION_TOKEN setzen oder Keychain-Credential "notion" prüfen).');
  }

  return {
    adapter: new NotionAdapter(new NotionClient(token), contentDatabaseId, coursesDatabaseId, meetingDatabaseId),
    meetingDatabaseId,
  };
}

test(
  'Backfill: pusht done-Jobs ohne output_refs-Eintrag in die Notion-Meeting-DB nach',
  { skip: RUN_IT ? false : 'Nur mit NOTION_PUSH_IT=1 aktiv (echter Notion-Push, siehe Modulkommentar)' },
  async () => {
    const dbPath = resolveDbPath();
    const db = openDatabase(dbPath);
    try {
      const repos = createRepos(db);
      const { adapter, meetingDatabaseId } = await resolveNotionAdapter(repos);

      const doneJobs = repos.transcriptJobs.getByStatus('done');
      assert.ok(doneJobs.length > 0, 'Keine done-Jobs in der DB gefunden — nichts zum Backfillen.');

      let pushed = 0;
      let skipped = 0;
      for (const job of doneJobs) {
        const existingRef = repos.outputRefs.getBySource('transcript_job', job.id, meetingDatabaseId);
        if (existingRef) {
          skipped++;
          continue;
        }
        if (!job.transcriptLocalPath) continue;

        const course = repos.courses.getAll().find((c) => c.courseId === job.courseId);
        if (!course) continue;

        const markdown = await readFile(job.transcriptLocalPath, 'utf-8');
        const result = await adapter.placeTranscript({
          course: { courseId: course.courseId, fullname: course.fullname, semester: course.semester },
          title: job.title,
          recordingDate: job.recordingDate,
          model: job.model,
          durationSeconds: job.durationSeconds,
          markdown,
          alreadyWrittenLocalPath: job.transcriptLocalPath,
        });

        const warningSuffix = result.warnings?.length ? ` (Warnings: ${result.warnings.join('; ')})` : '';
        console.log(`[notion-push.it] Job ${job.id} ("${job.title}") -> Page ${result.remoteRef}${warningSuffix}`);

        repos.outputRefs.insert({
          sourceEntityType: 'transcript_job',
          sourceEntityId: job.id,
          notionDatabaseId: meetingDatabaseId,
          notionPageId: result.remoteRef ?? null,
        });
        repos.transcriptJobs.setNotionPushResult(
          job.id,
          result.warnings?.length ? 'warnings' : 'ok',
          result.warnings?.length ? result.warnings.join('; ') : null,
        );
        pushed++;
      }

      console.log(`[notion-push.it] ${pushed} Job(s) gepusht, ${skipped} bereits vorhanden übersprungen.`);
      assert.ok(pushed > 0 || skipped > 0, 'Weder gepusht noch übersprungen — done-Jobs ohne transcriptLocalPath/zugehörigen Kurs?');
    } finally {
      db.close();
    }
  },
);
