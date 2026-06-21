import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import { LearnwebAuthError, LearnwebSession } from '../src/learnweb-core/session';

test('Credential-Prüfung lehnt eine Fehlerantwort des Login-POSTs ab', async () => {
  const server = createLoginServer(403);
  const baseUrl = await listen(server);
  try {
    const session = new LearnwebSession('user', 'secret', baseUrl);
    await assert.rejects(session.verifyCredentials(), LearnwebAuthError);
  } finally {
    await close(server);
  }
});

test('Credential-Prüfung bestätigt den Login über eine authentifizierte Seite', async () => {
  const server = createLoginServer(303);
  const baseUrl = await listen(server);
  try {
    const session = new LearnwebSession('user', 'secret', baseUrl);
    await session.verifyCredentials();
  } finally {
    await close(server);
  }
});

test('Credential-Prüfung lehnt einen Redirect ohne authentifizierte Sitzung ab', async () => {
  const server = createLoginServer(303, false);
  const baseUrl = await listen(server);
  try {
    const session = new LearnwebSession('user', 'secret', baseUrl);
    await assert.rejects(session.verifyCredentials(), LearnwebAuthError);
  } finally {
    await close(server);
  }
});

function createLoginServer(postStatus: number, issueCookie = true): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/login/index.php') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<form><input name="logintoken" value="token"></form>');
      return;
    }
    if (request.method === 'POST' && request.url === '/login/index.php') {
      if (postStatus === 303) {
        const headers: Record<string, string> = { Location: '/my/' };
        if (issueCookie) headers['Set-Cookie'] = 'MoodleSession=valid; Path=/; HttpOnly';
        response.writeHead(303, headers);
      } else {
        response.writeHead(postStatus, { 'Content-Type': 'text/html' });
      }
      response.end('login result');
      return;
    }
    if (request.method === 'GET' && request.url === '/my/') {
      if (request.headers.cookie?.includes('MoodleSession=valid')) {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<main>Dashboard</main>');
      } else {
        response.writeHead(303, { Location: '/login/index.php' });
        response.end();
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Testserver konnte nicht gestartet werden.');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
