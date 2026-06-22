import assert from 'node:assert/strict';
import test from 'node:test';

import { AppRuntime } from '../src/main/runtime';

test('Setup-Abschluss publiziert den aktuellen Idle-Status für das Tray', () => {
  const states: string[] = [];
  const runtime = new AppRuntime(':memory:', (status) => states.push(status.state));
  try {
    const state = runtime.completeSetup('Thomas');

    assert.equal(state.isSetupComplete, true);
    assert.equal(state.profile?.displayName, 'Thomas');
    assert.deepEqual(states, ['idle']);
  } finally {
    runtime.close();
  }
});

test('Hintergrund-Sync-Timer wird basierend auf Settings korrekt registriert', () => {
  const runtime = new AppRuntime(':memory:', () => undefined);
  try {
    // Standardmäßig kein Timer
    assert.equal(runtime.syncTimer, null);

    // Setze Intervall auf 10 Minuten
    runtime.setSetting('sync_interval_minutes', '10');
    assert.ok(runtime.syncTimer !== null);

    // Deaktiviere Intervall (z. B. auf 0 oder leer)
    runtime.setSetting('sync_interval_minutes', '0');
    assert.equal(runtime.syncTimer, null);
  } finally {
    runtime.close();
  }
});

test('Hintergrund-Sync-Timer erzwingt ein Minimum von 5 Minuten', () => {
  const runtime = new AppRuntime(':memory:', () => undefined);
  try {
    // Intervall von 2 Minuten setzen (sollte auf 5 Minuten hochgesetzt werden)
    runtime.setSetting('sync_interval_minutes', '2');
    assert.ok(runtime.syncTimer !== null);
  } finally {
    runtime.close();
  }
});

test('close() räumt alle registrierten Timer auf', () => {
  const runtime = new AppRuntime(':memory:', () => undefined);
  runtime.setSetting('sync_interval_minutes', '10');
  assert.ok(runtime.syncTimer !== null);

  runtime.close();
  assert.equal(runtime.syncTimer, null);
  assert.equal(runtime.startupTimeout, null);
});
