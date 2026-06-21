/**
 * Smoke-Tests für die geteilten Domänen-Konstanten.
 *
 * Stellt sicher, dass die Status-Enum-Arrays (die in den SQLite-CHECK-Constraints
 * gespiegelt werden) eindeutig und vollständig sind. Reine Logik — kein Electron,
 * läuft unter `tsx --test` (Node-ABI).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVITY_STATUSES,
  DOWNLOAD_JOB_STATUSES,
  FILE_ASSET_STATUSES,
  SELECTION_SCOPES,
  SYNC_RUN_STATUSES,
  SYNC_TRIGGERS,
  TRANSCRIPT_JOB_STATUSES,
} from '../src/shared/domain';

function assertUnique(values: readonly string[], label: string): void {
  assert.equal(new Set(values).size, values.length, `${label} enthält Duplikate`);
  assert.ok(values.length > 0, `${label} ist leer`);
}

test('Status-Enum-Arrays sind eindeutig und nicht leer', () => {
  assertUnique(ACTIVITY_STATUSES, 'ACTIVITY_STATUSES');
  assertUnique(DOWNLOAD_JOB_STATUSES, 'DOWNLOAD_JOB_STATUSES');
  assertUnique(TRANSCRIPT_JOB_STATUSES, 'TRANSCRIPT_JOB_STATUSES');
  assertUnique(FILE_ASSET_STATUSES, 'FILE_ASSET_STATUSES');
  assertUnique(SYNC_RUN_STATUSES, 'SYNC_RUN_STATUSES');
  assertUnique(SYNC_TRIGGERS, 'SYNC_TRIGGERS');
  assertUnique(SELECTION_SCOPES, 'SELECTION_SCOPES');
});

test('Kernzustände sind vorhanden (Vertrag mit docs/MVP1_SCOPE.md)', () => {
  assert.ok(ACTIVITY_STATUSES.includes('downloaded'));
  assert.ok(DOWNLOAD_JOB_STATUSES.includes('skipped_duplicate'));
  assert.ok(TRANSCRIPT_JOB_STATUSES.includes('markdown_created'));
});
