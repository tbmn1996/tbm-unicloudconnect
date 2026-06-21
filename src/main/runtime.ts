import type { Database } from 'better-sqlite3';
import { openDatabase } from '../db/db';
import { createRepos, type Repos } from '../db/repos';
import { getPassword, KEYCHAIN_SERVICE, setCredential } from '../keychain/keychain';
import { LearnwebClient } from '../learnweb-core/client';
import { LearnwebSession } from '../learnweb-core/session';
import type { AppState, LoginResult, SyncStatus } from '../shared/domain';
import { SyncEngine } from '../sync-engine/engine';

export class AppRuntime {
  readonly db: Database;
  readonly repos: Repos;
  readonly sync: SyncEngine;
  private session: LearnwebSession | null = null;
  private sessionAccount: string | null = null;

  constructor(dbPath: string, onSyncStatus: (status: SyncStatus) => void) {
    this.db = openDatabase(dbPath);
    this.repos = createRepos(this.db);
    this.sync = new SyncEngine(this.repos, {
      getClient: async () => new LearnwebClient(await this.getSession()),
      getSession: () => this.getSession(),
      getLibraryPath: () => this.getLibraryPath(),
    }, onSyncStatus);
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
    this.sync.notifyCurrentStatus();
    return this.getAppState();
  }

  async saveAndVerifyCredentials(username: string, password: string): Promise<LoginResult> {
    const candidate = new LearnwebSession(username, password);
    await candidate.verifyCredentials();
    await setCredential(username, password);
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

  close(): void {
    this.db.close();
  }
}
