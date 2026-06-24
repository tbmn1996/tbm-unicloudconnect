import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyAndStoreToken,
  searchDatabases,
  getConfig,
  setDatabase,
  setCoursesDatabase,
  setMeetingDatabase,
  setOutputMode,
  NOTION_TOKEN_ACCOUNT,
  NOTION_PROVIDER,
  OUTPUT_ADAPTER_SETTING_KEY,
  NOTION_WORKSPACE_NAME_SETTING_KEY,
  type NotionSetupRepos,
  type NotionSetupDeps,
  type NotionClientLike,
} from '../src/main/notion-setup';
import { NotionAuthError } from '../src/notion-core/errors';
import {
  OUTPUT_NOTION_DATABASE_ID_SETTING_KEY,
  OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY,
  OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY,
} from '../src/output-adapters/types';

/**
 * Baut ein frisches In-Memory-Repos-Mock (Duck-Typing, siehe NotionSetupRepos).
 * `credentials` und `settings` sind Map-basiert — kein echter SQLite-/Keychain-Zugriff.
 */
function createMockRepos(): {
  repos: NotionSetupRepos;
  credentialSetCalls: Array<{ provider?: string; serviceName: string; accountName: string }>;
  settingsMap: Map<string, string>;
} {
  let storedCredential: { serviceName: string; accountName: string } | null = null;
  const credentialSetCalls: Array<{ provider?: string; serviceName: string; accountName: string }> = [];
  const settingsMap = new Map<string, string>();

  const repos: NotionSetupRepos = {
    credentials: {
      get: (_provider?: string) => storedCredential,
      set: (input) => {
        credentialSetCalls.push(input);
        storedCredential = { serviceName: input.serviceName, accountName: input.accountName };
      },
    },
    settings: {
      get: (key: string) => settingsMap.get(key) ?? null,
      set: (key: string, value: string) => {
        settingsMap.set(key, value);
      },
    },
  };

  return { repos, credentialSetCalls, settingsMap };
}

/** Baut ein Spy-Deps-Objekt; einzelne Felder können pro Test überschrieben werden. */
function createSpyDeps(overrides?: {
  createClient?: (token: string) => NotionClientLike;
  hasCredentialResult?: boolean;
}): {
  deps: NotionSetupDeps;
  setCredentialCalls: Array<{ account: string; secret: string }>;
  createClientCalls: string[];
} {
  const setCredentialCalls: Array<{ account: string; secret: string }> = [];
  const createClientCalls: string[] = [];

  const deps: NotionSetupDeps = {
    createClient: (token: string) => {
      createClientCalls.push(token);
      if (overrides?.createClient) return overrides.createClient(token);
      throw new Error('createClient wurde im Test nicht erwartet/gemockt.');
    },
    setCredential: async (account: string, secret: string) => {
      setCredentialCalls.push({ account, secret });
    },
    getPassword: async (_account: string, _service?: string) => 'gemocktes-token',
    hasCredential: async (_account: string) => overrides?.hasCredentialResult ?? false,
  };

  return { deps, setCredentialCalls, createClientCalls };
}

// ---------------------------------------------------------------------------
// verifyAndStoreToken
// ---------------------------------------------------------------------------

test('verifyAndStoreToken: Erfolg speichert Keychain-Secret und Credential-Verweis', async () => {
  const { repos, credentialSetCalls } = createMockRepos();
  const { deps, setCredentialCalls, createClientCalls } = createSpyDeps({
    createClient: () => ({
      getUser: async () => ({
        object: 'user',
        name: 'Bot',
        bot: { workspace_name: 'Mein Workspace' },
      }),
      search: async () => ({ results: [] }),
    }),
  });

  const result = await verifyAndStoreToken('gueltiges-token', repos, deps);

  assert.deepEqual(result, { ok: true, workspaceName: 'Mein Workspace' });

  // createClient wurde mit dem (getrimmten) Token aufgerufen.
  assert.deepEqual(createClientCalls, ['gueltiges-token']);

  // setCredential (Keychain) wurde mit Account NOTION_TOKEN_ACCOUNT + Token aufgerufen.
  assert.equal(setCredentialCalls.length, 1);
  const credCall = setCredentialCalls[0];
  assert.ok(credCall);
  assert.equal(credCall.account, NOTION_TOKEN_ACCOUNT);
  assert.equal(credCall.secret, 'gueltiges-token');

  // repos.credentials.set wurde mit provider:'notion', accountName:'notion_token' aufgerufen.
  assert.equal(credentialSetCalls.length, 1);
  const credSetCall = credentialSetCalls[0];
  assert.ok(credSetCall);
  assert.equal(credSetCall.provider, NOTION_PROVIDER);
  assert.equal(credSetCall.accountName, NOTION_TOKEN_ACCOUNT);

  // Workspace-Name wurde im Settings-Store hinterlegt.
  assert.equal(repos.settings.get(NOTION_WORKSPACE_NAME_SETTING_KEY), 'Mein Workspace');
});

test('verifyAndStoreToken: 401 (NotionAuthError) speichert nichts und liefert ok:false', async () => {
  const { repos, credentialSetCalls } = createMockRepos();
  const { deps, setCredentialCalls } = createSpyDeps({
    createClient: () => ({
      getUser: async () => {
        throw new NotionAuthError();
      },
      search: async () => ({ results: [] }),
    }),
  });

  const result = await verifyAndStoreToken('ungueltiges-token', repos, deps);

  assert.equal(result.ok, false);
  assert.ok(typeof result.message === 'string' && result.message.length > 0);

  // Weder Keychain noch Repos-Credential dürfen bei einem Auth-Fehler beschrieben werden.
  assert.equal(setCredentialCalls.length, 0);
  assert.equal(credentialSetCalls.length, 0);
});

test('verifyAndStoreToken: generischer Fehler (Netzwerk/Keychain, kein NotionAuthError) speichert nichts und leakt keinen Originalfehler', async () => {
  const { repos, credentialSetCalls } = createMockRepos();
  const { deps, setCredentialCalls } = createSpyDeps({
    createClient: () => ({
      getUser: async () => {
        // Simuliert z.B. einen Netzwerk- oder Keychain-Fehler, der versehentlich
        // sensible Daten (Token-Fragment) in der Fehlermeldung tragen könnte.
        throw new Error('ECONNREFUSED 127.0.0.1:443 secret_geheimes-token');
      },
      search: async () => ({ results: [] }),
    }),
  });

  const result = await verifyAndStoreToken('beliebiges-token', repos, deps);

  assert.equal(result.ok, false);
  assert.ok(typeof result.message === 'string' && result.message.length > 0);

  // Die generische Fehlermeldung darf den Originalfehler nicht durchsickern lassen.
  assert.ok(!result.message?.includes('ECONNREFUSED'));
  assert.ok(!result.message?.includes('secret_geheimes-token'));

  // Wie beim Auth-Fehler: weder Keychain noch Repos-Credential dürfen beschrieben werden.
  assert.equal(setCredentialCalls.length, 0);
  assert.equal(credentialSetCalls.length, 0);
});

test('verifyAndStoreToken: leeres Token liefert ok:false ohne Client-Aufruf', async () => {
  const { repos } = createMockRepos();
  const { deps, createClientCalls, setCredentialCalls } = createSpyDeps();

  const result = await verifyAndStoreToken('', repos, deps);

  assert.equal(result.ok, false);
  assert.ok(result.message);
  assert.equal(createClientCalls.length, 0);
  assert.equal(setCredentialCalls.length, 0);
});

// ---------------------------------------------------------------------------
// searchDatabases
// ---------------------------------------------------------------------------

test('searchDatabases: normalisiert Rich-Text-Titel zu String (Kernfall)', async () => {
  const { repos } = createMockRepos();
  // Token bereits "verbunden" simulieren: credentials.get liefert einen Verweis.
  repos.credentials.set({ provider: NOTION_PROVIDER, serviceName: 'svc', accountName: NOTION_TOKEN_ACCOUNT });

  const { deps } = createSpyDeps({
    createClient: () => ({
      getUser: async () => ({ object: 'user' }),
      search: async () => ({
        results: [
          {
            object: 'database',
            id: 'db1',
            title: [{ plain_text: 'Kurse' }],
            icon: { emoji: '📚' },
            last_edited_time: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    }),
  });

  const result = await searchDatabases('query', repos, deps);

  assert.deepEqual(result, [
    { id: 'db1', title: 'Kurse', icon: '📚', lastEdited: '2026-01-01T00:00:00Z' },
  ]);
  // title ist ein String, nicht das Rich-Text-Array.
  const firstDb = result[0];
  assert.ok(firstDb);
  assert.equal(typeof firstDb.title, 'string');
});

test('searchDatabases: leeres Titel-Array liefert Fallback-Titel statt leerem String', async () => {
  const { repos } = createMockRepos();
  repos.credentials.set({ provider: NOTION_PROVIDER, serviceName: 'svc', accountName: NOTION_TOKEN_ACCOUNT });

  const { deps } = createSpyDeps({
    createClient: () => ({
      getUser: async () => ({ object: 'user' }),
      search: async () => ({
        results: [
          {
            object: 'database',
            id: 'db2',
            title: [],
            icon: null,
            last_edited_time: null,
          },
        ],
      }),
    }),
  });

  const result = await searchDatabases('', repos, deps);

  assert.equal(result.length, 1);
  const fallbackDb = result[0];
  assert.ok(fallbackDb);
  assert.equal(fallbackDb.title, '(ohne Titel)');
  assert.notEqual(fallbackDb.title, '');
  assert.notEqual(fallbackDb.title, '[object Object]');
});

test('searchDatabases: ohne gespeichertes Token wird [] geliefert, kein Client-Aufruf', async () => {
  const { repos } = createMockRepos();
  // credentials.get liefert null (kein Token gespeichert) — Default-Mock-Zustand.

  const { deps, createClientCalls } = createSpyDeps();

  const result = await searchDatabases('query', repos, deps);

  assert.deepEqual(result, []);
  assert.equal(createClientCalls.length, 0);
});

test('searchDatabases: filtert Nicht-Datenbank-Ergebnisse (z. B. object:"page") heraus', async () => {
  const { repos } = createMockRepos();
  repos.credentials.set({ provider: NOTION_PROVIDER, serviceName: 'svc', accountName: NOTION_TOKEN_ACCOUNT });

  const { deps } = createSpyDeps({
    createClient: () => ({
      getUser: async () => ({ object: 'user' }),
      search: async () => ({
        results: [
          { object: 'page', id: 'page1', title: [{ plain_text: 'Sollte raus' }] },
          {
            object: 'database',
            id: 'db3',
            title: [{ plain_text: 'Bleibt' }],
            icon: null,
            last_edited_time: '2026-02-01T00:00:00Z',
          },
        ],
      }),
    }),
  });

  const result = await searchDatabases('query', repos, deps);

  assert.equal(result.length, 1);
  const keptDb = result[0];
  assert.ok(keptDb);
  assert.equal(keptDb.id, 'db3');
});

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

test('getConfig: liefert verbundenen Zustand mit selectedDbId und adapterMode "both"', async () => {
  const { repos } = createMockRepos();
  repos.settings.set(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY, 'db-xyz');
  repos.settings.set(OUTPUT_ADAPTER_SETTING_KEY, 'both');
  repos.settings.set(NOTION_WORKSPACE_NAME_SETTING_KEY, 'Mein Workspace');

  const { deps } = createSpyDeps({ hasCredentialResult: true });

  const config = await getConfig(repos, deps);

  assert.deepEqual(config, {
    connected: true,
    workspaceName: 'Mein Workspace',
    selectedDbId: 'db-xyz',
    selectedCoursesDbId: null,
    selectedMeetingDbId: null,
    adapterMode: 'both',
  });
});

test('getConfig: fehlender output.adapter-Settings-Wert fällt auf adapterMode "filesystem" zurück', async () => {
  const { repos } = createMockRepos();
  // OUTPUT_ADAPTER_SETTING_KEY bewusst nicht gesetzt.

  const { deps } = createSpyDeps({ hasCredentialResult: false });

  const config = await getConfig(repos, deps);

  assert.equal(config.adapterMode, 'filesystem');
  assert.equal(config.connected, false);
});

// ---------------------------------------------------------------------------
// setOutputMode
// ---------------------------------------------------------------------------

test('setOutputMode: ungültiger Wert wirft Error', () => {
  const { repos } = createMockRepos();
  assert.throws(() => setOutputMode('quatsch', repos));
});

test('setOutputMode: gültige Werte schreiben den Settings-Key', () => {
  const { repos } = createMockRepos();

  setOutputMode('notion', repos);
  assert.equal(repos.settings.get(OUTPUT_ADAPTER_SETTING_KEY), 'notion');

  setOutputMode('both', repos);
  assert.equal(repos.settings.get(OUTPUT_ADAPTER_SETTING_KEY), 'both');

  setOutputMode('filesystem', repos);
  assert.equal(repos.settings.get(OUTPUT_ADAPTER_SETTING_KEY), 'filesystem');
});

// ---------------------------------------------------------------------------
// setDatabase
// ---------------------------------------------------------------------------

test('setDatabase: leerer String wirft Error', () => {
  const { repos } = createMockRepos();
  assert.throws(() => setDatabase('', repos));
});

test('setDatabase: gültige ID schreibt den Settings-Key (getrimmt)', () => {
  const { repos } = createMockRepos();
  setDatabase('  db-abc123  ', repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_DATABASE_ID_SETTING_KEY), 'db-abc123');
});

// ---------------------------------------------------------------------------
// setCoursesDatabase
// ---------------------------------------------------------------------------

test('setCoursesDatabase: leerer String oder null setzt leeren String', () => {
  const { repos } = createMockRepos();
  setCoursesDatabase('', repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY), '');
  setCoursesDatabase(null, repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY), '');
});

test('setCoursesDatabase: ungültige ID-Typen werfen Error', () => {
  const { repos } = createMockRepos();
  assert.throws(() => setCoursesDatabase(123, repos));
  assert.throws(() => setCoursesDatabase({}, repos));
});

test('setCoursesDatabase: gültige ID schreibt den Settings-Key (getrimmt)', () => {
  const { repos } = createMockRepos();
  setCoursesDatabase('  db-courses123  ', repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_COURSES_DATABASE_ID_SETTING_KEY), 'db-courses123');
});

// ---------------------------------------------------------------------------
// setMeetingDatabase
// ---------------------------------------------------------------------------

test('setMeetingDatabase: leerer String oder null setzt leeren String', () => {
  const { repos } = createMockRepos();
  setMeetingDatabase('', repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY), '');
  setMeetingDatabase(null, repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY), '');
});

test('setMeetingDatabase: ungültige ID-Typen werfen Error', () => {
  const { repos } = createMockRepos();
  assert.throws(() => setMeetingDatabase(123, repos));
  assert.throws(() => setMeetingDatabase({}, repos));
});

test('setMeetingDatabase: gültige ID schreibt den Settings-Key (getrimmt)', () => {
  const { repos } = createMockRepos();
  setMeetingDatabase('  db-meeting123  ', repos);
  assert.equal(repos.settings.get(OUTPUT_NOTION_MEETING_DATABASE_ID_SETTING_KEY), 'db-meeting123');
});
