import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repos } from '../db/repos';
import { deleteCredential, getPassword, setCredential } from '../keychain/keychain';
import type { McpRuntimeStatus } from '../shared/domain';
import { startSseServer, type SseServerHandle } from './server-sse';

const MCP_TOKEN_SERVICE = 'tbm-unicloudconnect-mcp';
const MCP_TOKEN_ACCOUNT = 'sse-bearer';
const MCP_SERVER_KEY = 'tbm-unicloudconnect';

export interface McpRuntimeOptions {
  repos: Repos;
  dbPath: string;
  configPath: string;
  command: string;
  args: string[];
  port?: number;
}

export class McpRuntime {
  private sse: SseServerHandle | null = null;

  constructor(private readonly options: McpRuntimeOptions) {}

  async getStatus(): Promise<McpRuntimeStatus> {
    const persisted = this.options.repos.mcp.get();
    const token = persisted.enabled ? await getPassword(MCP_TOKEN_ACCOUNT, MCP_TOKEN_SERVICE) : null;
    let stdioRegistered = false;
    try {
      stdioRegistered = await hasOwnClaudeConfig(this.options.configPath);
    } catch {
      // Eine beschädigte fremde Claude-Konfiguration darf den App-Start nicht blockieren.
    }
    return {
      enabled: persisted.enabled,
      stdioRegistered,
      sseRunning: this.sse !== null,
      sseUrl: this.sse?.url ?? null,
      token,
      configuredAt: persisted.configuredAt,
      lastCheckedAt: persisted.lastCheckedAt,
    };
  }

  async setEnabled(enabled: boolean): Promise<McpRuntimeStatus> {
    if (!enabled) {
      await this.stopSse();
      await updateClaudeConfig(this.options.configPath, null);
      await deleteCredential(MCP_TOKEN_ACCOUNT, MCP_TOKEN_SERVICE);
      this.options.repos.mcp.set(false);
      return this.getStatus();
    }
    if (!this.options.repos.credentials.get()) {
      throw new Error('MCP erfordert zuerst einen eingerichteten LearnWeb-Login.');
    }
    const token = await this.getOrCreateToken();
    try {
      await this.startSse(token);
      await updateClaudeConfig(this.options.configPath, {
        command: this.options.command,
        args: this.options.args,
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          UCC_DB_PATH: this.options.dbPath,
        },
      });
      this.options.repos.mcp.set(true);
      return this.getStatus();
    } catch (error) {
      await this.stopSse();
      throw error;
    }
  }

  async regenerateToken(): Promise<McpRuntimeStatus> {
    if (!this.options.repos.mcp.get().enabled) {
      throw new Error('MCP ist nicht aktiviert.');
    }
    const token = randomBytes(32).toString('base64url');
    await setCredential(MCP_TOKEN_ACCOUNT, token, MCP_TOKEN_SERVICE);
    await this.stopSse();
    await this.startSse(token);
    return this.getStatus();
  }

  async restore(): Promise<void> {
    if (!this.options.repos.mcp.get().enabled) return;
    const token = await this.getOrCreateToken();
    await this.startSse(token);
  }

  async close(): Promise<void> {
    await this.stopSse();
  }

  private async getOrCreateToken(): Promise<string> {
    const existing = await getPassword(MCP_TOKEN_ACCOUNT, MCP_TOKEN_SERVICE);
    if (existing && Buffer.byteLength(existing, 'utf8') >= 16) return existing;
    const token = randomBytes(32).toString('base64url');
    await setCredential(MCP_TOKEN_ACCOUNT, token, MCP_TOKEN_SERVICE);
    return token;
  }

  private async startSse(token: string): Promise<void> {
    if (this.sse) return;
    this.sse = await startSseServer({
      port: this.options.port ?? 37645,
      token,
      dbPath: this.options.dbPath,
    });
  }

  private async stopSse(): Promise<void> {
    const current = this.sse;
    this.sse = null;
    if (current) await current.close();
  }
}

export interface ClaudeServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export async function updateClaudeConfig(path: string, server: ClaudeServerConfig | null): Promise<void> {
  const config = await readJsonObject(path);
  const existingServers = config.mcpServers;
  if (existingServers !== undefined && (!existingServers || typeof existingServers !== 'object' || Array.isArray(existingServers))) {
    throw new Error('Claude-Desktop-Konfiguration enthält ein ungültiges mcpServers-Feld.');
  }
  const mcpServers = { ...(existingServers as Record<string, unknown> | undefined) };
  if (server) mcpServers[MCP_SERVER_KEY] = server;
  else delete mcpServers[MCP_SERVER_KEY];
  config.mcpServers = mcpServers;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}

async function hasOwnClaudeConfig(path: string): Promise<boolean> {
  const config = await readJsonObject(path);
  const servers = config.mcpServers;
  return Boolean(servers && typeof servers === 'object' && !Array.isArray(servers)
    && MCP_SERVER_KEY in servers);
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Claude-Desktop-Konfiguration ist kein gültiges JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Claude-Desktop-Konfiguration muss ein JSON-Objekt sein.');
  }
  return parsed as Record<string, unknown>;
}
