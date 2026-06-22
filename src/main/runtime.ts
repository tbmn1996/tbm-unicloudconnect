import type { Database } from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/db';
import { createRepos, type Repos } from '../db/repos';
import { deleteCredential, getPassword, KEYCHAIN_SERVICE, setCredential } from '../keychain/keychain';
import { LearnwebClient } from '../learnweb-core/client';
import { LearnwebSession } from '../learnweb-core/session';
import type { AppState, LoginResult, SyncStatus } from '../shared/domain';
import { SyncEngine } from '../sync-engine/engine';
import { McpRuntime } from '../mcp/runtime';
import { TranscriptionManager } from '../transcription/manager';
import type { TranscriptionStatus } from '../shared/domain';

export interface AppRuntimeOptions {
  workerDir?: string;
  mcpEntryPath?: string;
  mcpCommand?: string;
  claudeConfigPath?: string;
  onTranscriptionStatus?: (status: TranscriptionStatus) => void;
}

export class AppRuntime {
  readonly db: Database;
  readonly repos: Repos;
  readonly sync: SyncEngine;
  readonly transcription: TranscriptionManager;
  readonly mcp: McpRuntime;
  private session: LearnwebSession | null = null;
  private sessionAccount: string | null = null;
  private autoTranscriptionRunning = false;
  syncTimer: NodeJS.Timeout | null = null;
  startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    dbPath: string,
    onSyncStatus: (status: SyncStatus) => void,
    options: AppRuntimeOptions = {},
  ) {
    this.db = openDatabase(dbPath);
    this.repos = createRepos(this.db);
    this.sync = new SyncEngine(this.repos, {
      getClient: async () => new LearnwebClient(await this.getSession()),
      getSession: () => this.getSession(),
      getLibraryPath: () => this.getLibraryPath(),
    }, onSyncStatus);
    this.transcription = new TranscriptionManager({
      repos: this.repos,
      getSession: () => this.getSession(),
      getLibraryPath: () => this.getLibraryPath(),
      workerDir: options.workerDir ?? join(process.cwd(), 'transcription-worker'),
      onStatus: options.onTranscriptionStatus ?? (() => undefined),
    });
    this.mcp = new McpRuntime({
      repos: this.repos,
      dbPath,
      configPath: options.claudeConfigPath
        ?? join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      command: options.mcpCommand ?? process.execPath,
      args: [options.mcpEntryPath ?? join(process.cwd(), 'out', 'main', 'mcp.js')],
    });
    void this.mcp.restore().catch((error) => {
      console.error('[mcp] Automatischer MCP-Restore beim App-Start fehlgeschlagen:', error);
      this.repos.mcp.set(false);
    });

    this.setupSyncTimer();
    if (this.repos.settings.get('setup_complete') === '1' && this.repos.credentials.get() !== null) {
      this.startupTimeout = setTimeout(() => {
        void this.sync.run('startup').catch(() => undefined);
      }, 5000);
    }
  }

  getLibraryPath(): string | null {
    return this.repos.profiles.get()?.defaultLibraryPath
      ?? this.repos.settings.get('default_library_path');
  }

  getAppState(): AppState {
    const profile = this.repos.profiles.get();
    return {
      isSetupComplete: this.repos.settings.get('setup_complete') === '1',
      hasCredentials: this.repos.credentials.get() !== null,
      profile,
      libraryPath: this.getLibraryPath(),
      tray: this.sync.getStatus().state,
      mcpEnabled: this.repos.mcp.get().enabled,
    };
  }

  completeSetup(displayName: string): AppState {
    const profile = this.repos.profiles.get();
    if (profile) this.repos.profiles.setDisplayName(profile.id, displayName);
    else this.repos.profiles.create(displayName, this.getLibraryPath());
    this.repos.settings.set('setup_complete', '1');
    this.setupSyncTimer();
    this.sync.notifyCurrentStatus();
    return this.getAppState();
  }

  async saveAndVerifyCredentials(username: string, password: string): Promise<LoginResult> {
    const candidate = new LearnwebSession(username, password);
    await candidate.verifyCredentials();
    const previousCredential = this.repos.credentials.get();
    await setCredential(username, password);
    if (previousCredential && previousCredential.accountName !== username) {
      await deleteCredential(previousCredential.accountName, previousCredential.serviceName);
      this.clearAccountData();
    }
    this.repos.credentials.set({ serviceName: KEYCHAIN_SERVICE, accountName: username });
    const credential = this.repos.credentials.get();
    if (credential) this.repos.credentials.markVerified(credential.id);
    this.session = candidate;
    this.sessionAccount = username;
    return { ok: true };
  }

  async verifyStoredCredentials(): Promise<LoginResult> {
    const session = await this.getSession();
    await session.verifyCredentials();
    const credential = this.repos.credentials.get();
    if (credential) this.repos.credentials.markVerified(credential.id);
    return { ok: true };
  }

  async getSession(): Promise<LearnwebSession> {
    const credential = this.repos.credentials.get();
    if (!credential) throw new Error('Keine LearnWeb-Zugangsdaten gespeichert.');
    if (this.session && this.sessionAccount === credential.accountName) return this.session;
    const password = await getPassword(credential.accountName, credential.serviceName);
    if (!password) throw new Error('Der Keychain-Eintrag konnte nicht gelesen werden.');
    this.session = new LearnwebSession(credential.accountName, password);
    this.sessionAccount = credential.accountName;
    return this.session;
  }

  async clearCredentials(): Promise<void> {
    const credential = this.repos.credentials.get();
    if (credential) {
      await deleteCredential(credential.accountName, credential.serviceName);
    }
    this.repos.credentials.clear();
    this.clearAccountData();
    // Setup-Flag zurücksetzen, damit beim Re-Login der Wizard vollständig
    // von vorne durchlaufen wird (Issue #7).
    this.repos.settings.set('setup_complete', '0');
    this.session = null;
    this.sessionAccount = null;
    if (this.repos.mcp.get().enabled) {
      await this.mcp.setEnabled(false);
    }
  }

  private clearAccountData(): void {
    // Alle account-spezifischen Tabellen in einer einzigen Transaktion leeren,
    // damit kein Teilzustand übrig bleibt (Issue #4).
    this.db.transaction(() => {
      this.repos.courses.clear();
      this.repos.activities.clear();
      this.repos.downloadJobs.clear();
      this.repos.transcriptJobs.clear();
      this.repos.fileAssets.clear();
      this.repos.selectionRules.clear();
      this.repos.syncRuns.clear();
    })();
  }

  async runAutoTranscription(): Promise<void> {
    if (this.autoTranscriptionRunning || this.transcription.getSettings().mode !== 'auto') return;
    this.autoTranscriptionRunning = true;
    try {
      const candidates = await this.transcription.scanRecordings();
      this.transcription.enqueue(candidates.map((candidate) => candidate.recordingKey));
      await this.transcription.start();
    } finally {
      this.autoTranscriptionRunning = false;
    }
  }

  setupSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    const intervalVal = this.repos.settings.get('sync_interval_minutes');
    if (!intervalVal) return;

    const intervalMinutes = parseInt(intervalVal, 10);
    if (isNaN(intervalMinutes) || intervalMinutes <= 0) return;

    // Enforce a minimum interval of 5 minutes to avoid overloading the server.
    const safeIntervalMinutes = Math.max(5, intervalMinutes);
    const ms = safeIntervalMinutes * 60 * 1000;

    this.syncTimer = setInterval(() => {
      if (this.repos.settings.get('setup_complete') === '1' && this.repos.credentials.get() !== null) {
        void this.sync.run('scheduled').catch(() => undefined);
      }
    }, ms);
  }

  setSetting(key: string, value: string): void {
    this.repos.settings.set(key, value);
    if (key === 'sync_interval_minutes') {
      this.setupSyncTimer();
    }
  }

  close(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    void this.mcp.close();
    this.db.close();
  }
}
