/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NotionClient } from '../src/notion-core/client';
import { NotionAuthError, NotionRateLimitExceededError, NotionApiError } from '../src/notion-core/errors';
import { NotionRateLimiter } from '../src/notion-core/rate-limiter';
import { NOTION_VERSION, NOTION_MIN_REQUEST_INTERVAL_MS } from '../src/notion-core/constants';
import http from 'node:http';
import https from 'node:https';

test('NotionClient setzt Header und Keep-Alive korrekt auf Axios-Instanz', async () => {
  let passedConfig: any = null;

  const mockAdapter = async (config: any) => {
    passedConfig = config;
    return {
      data: { object: 'user', id: 'bot-id' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };

  const client = new NotionClient('test-token-123', {
    axiosAdapter: mockAdapter,
    sleepFn: async () => {},
  });

  const user = await client.getUser();

  assert.equal(user.id, 'bot-id');
  assert.ok(passedConfig);
  assert.equal(passedConfig.headers['Authorization'], 'Bearer test-token-123');
  assert.equal(passedConfig.headers['Notion-Version'], NOTION_VERSION);
  assert.equal(passedConfig.headers['Content-Type'], 'application/json');

  // Prüfe Keep-Alive Agents
  assert.ok(passedConfig.httpAgent instanceof http.Agent);
  assert.ok(passedConfig.httpsAgent instanceof https.Agent);
  assert.equal((passedConfig.httpAgent as any).keepAlive, true);
  assert.equal((passedConfig.httpsAgent as any).keepAlive, true);
});

test('NotionRateLimiter führt Aufrufe nacheinander mit Mindestabstand aus', async () => {
  const sleepCalls: number[] = [];
  const sleepFn = async (ms: number) => {
    sleepCalls.push(ms);
  };

  const limiter = new NotionRateLimiter(NOTION_MIN_REQUEST_INTERVAL_MS, sleepFn);
  const results: number[] = [];

  // Führe 3 Aufgaben über den Rate-Limiter aus
  await Promise.all([
    limiter.schedule(async () => { results.push(1); }),
    limiter.schedule(async () => { results.push(2); }),
    limiter.schedule(async () => { results.push(3); }),
  ]);

  // Da wir das sleepFn gemockt haben, blockiert der Code nicht wirklich,
  // aber wir prüfen, ob die Wartezeiten (sleepFn) korrekt gerufen wurden.
  assert.deepEqual(results, [1, 2, 3]);
  assert.ok(sleepCalls.length >= 2, 'Sollte mindestens zweimal geschlafen haben');
  for (const delay of sleepCalls) {
    assert.ok(delay > 0 && delay <= NOTION_MIN_REQUEST_INTERVAL_MS);
  }
});

test('NotionClient fängt 401-Fehler ab und wirft NotionAuthError', async () => {
  const mockAdapter = async (config: any) => {
    const error = new Error('Request failed with status code 401');
    (error as any).response = {
      status: 401,
      data: { message: 'Token is invalid', code: 'unauthorized' },
      headers: {},
    };
    (error as any).config = config;
    throw error;
  };

  const client = new NotionClient('bad-token', {
    axiosAdapter: mockAdapter,
    sleepFn: async () => {},
  });

  await assert.rejects(async () => {
    await client.getUser();
  }, NotionAuthError);
});

test('NotionClient fängt sonstige API-Fehler ab und wirft NotionApiError mit Code und Status', async () => {
  const mockAdapter = async (config: any) => {
    const error = new Error('Request failed with status code 400');
    (error as any).response = {
      status: 400,
      data: { message: 'Some database constraint error', code: 'validation_error' },
      headers: {},
    };
    (error as any).config = config;
    throw error;
  };

  const client = new NotionClient('token', {
    axiosAdapter: mockAdapter,
    sleepFn: async () => {},
  });

  await assert.rejects(
    async () => {
      await client.queryDatabase('db-id');
    },
    (err: any) => {
      assert.ok(err instanceof NotionApiError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'validation_error');
      assert.equal(err.message, 'Some database constraint error');
      return true;
    }
  );
});

test('NotionClient wiederholt Anfragen bei 429-Fehlern unter Einhaltung von Retry-After', async () => {
  let callCount = 0;
  const sleepMsCalls: number[] = [];

  const mockAdapter = async (config: any) => {
    callCount++;
    if (callCount < 3) {
      const error = new Error('Too many requests');
      (error as any).response = {
        status: 429,
        data: { message: 'Rate limit exceeded', code: 'rate_limited' },
        headers: { 'retry-after': '3' }, // 3 Sekunden warten
      };
      (error as any).config = config;
      throw error;
    }
    return {
      data: { object: 'list', results: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };

  const client = new NotionClient('token', {
    axiosAdapter: mockAdapter,
    sleepFn: async (ms) => {
      sleepMsCalls.push(ms);
    },
  });

  const res = await client.search({ query: 'test' });
  assert.deepEqual(res, { object: 'list', results: [] });
  assert.equal(callCount, 3);
  assert.deepEqual(sleepMsCalls, [3000, 3000]); // 3s beim ersten, 3s beim zweiten Mal
});

test('NotionClient wiederholt Anfragen bei 429-Fehlern mit exponentiellem Backoff als Fallback', async () => {
  let callCount = 0;
  const sleepMsCalls: number[] = [];

  const mockAdapter = async (config: any) => {
    callCount++;
    if (callCount < 3) {
      const error = new Error('Too many requests');
      (error as any).response = {
        status: 429,
        data: { message: 'Rate limit exceeded', code: 'rate_limited' },
        headers: {}, // Kein retry-after vorhanden
      };
      (error as any).config = config;
      throw error;
    }
    return {
      data: { object: 'page', id: 'page-id' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };

  const client = new NotionClient('token', {
    axiosAdapter: mockAdapter,
    sleepFn: async (ms) => {
      sleepMsCalls.push(ms);
    },
  });

  const page = await client.createPage({
    parent: { database_id: 'db-id' },
    properties: {},
  });

  assert.equal(page.id, 'page-id');
  assert.equal(callCount, 3);
  // Fallback: Math.pow(2, attempt + 1) * 1000.
  // attempt 0 -> Math.pow(2, 1) * 1000 = 2000 ms.
  // attempt 1 -> Math.pow(2, 2) * 1000 = 4000 ms.
  assert.deepEqual(sleepMsCalls, [2000, 4000]);
});

test('NotionClient wirft NotionRateLimitExceededError nach Überschreiten der maximalen Retry-Versuche', async () => {
  let callCount = 0;

  const mockAdapter = async (config: any) => {
    callCount++;
    const error = new Error('Too many requests');
    (error as any).response = {
      status: 429,
      data: { message: 'Rate limit exceeded', code: 'rate_limited' },
      headers: { 'retry-after': '1' },
    };
    (error as any).config = config;
    throw error;
  };

  const client = new NotionClient('token', {
    axiosAdapter: mockAdapter,
    sleepFn: async () => {},
  });

  await assert.rejects(async () => {
    // Sollte nach 3 Versuchen abbrechen
    await client.appendBlockChildren('block-id', []);
  }, NotionRateLimitExceededError);

  assert.equal(callCount, 3);
});
