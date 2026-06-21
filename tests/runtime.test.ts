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
