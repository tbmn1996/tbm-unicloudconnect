import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { updateClaudeConfig } from '../src/mcp/runtime';

test('Claude-Desktop-Konfiguration erhält fremde Einträge und ändert nur den eigenen MCP-Key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ucc-claude-config-'));
  const path = join(dir, 'claude_desktop_config.json');
  writeFileSync(path, JSON.stringify({ theme: 'dark', mcpServers: { existing: { command: 'other' } } }));
  try {
    await updateClaudeConfig(path, {
      command: '/Applications/TBM UniCloudConnect.app/Contents/MacOS/TBM UniCloudConnect',
      args: ['/app/out/main/mcp.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', UCC_DB_PATH: '/tmp/state.sqlite' },
    });
    let config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    assert.equal(config.theme, 'dark');
    assert.ok((config.mcpServers as Record<string, unknown>).existing);
    assert.ok((config.mcpServers as Record<string, unknown>)['tbm-unicloudconnect']);

    await updateClaudeConfig(path, null);
    config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    assert.ok((config.mcpServers as Record<string, unknown>).existing);
    assert.equal((config.mcpServers as Record<string, unknown>)['tbm-unicloudconnect'], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
