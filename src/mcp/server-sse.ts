/**
 * MCP-Server ueber SSE/HTTP (fuer Cloud-Clients wie claude.ai).
 *
 * Sicherheit (verbindlich):
 *  - bindet NUR an 127.0.0.1 (Loopback)
 *  - jede Anfrage braucht `Authorization: Bearer <token>` (sonst 401)
 *  - read-only DB
 * Das Exponieren ueber einen Tunnel (ngrok/cloudflared) ist eine bewusste
 * Nutzeraktion ausserhalb dieses Servers.
 *
 * Nutzt den offiziellen SSEServerTransport (echtes MCP-JSON-RPC, kein Eigenbau).
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { openReadonlyDatabase } from './db';
import { makeSessionProvider } from './session';
import { createMcpServer } from './server';

export interface SseServerOptions {
  /** Wunsch-Port; bei Belegung wird der naechste freie Port gewaehlt. */
  port: number;
  /** Bearer-Token, das jede Anfrage tragen muss. */
  token: string;
  /** DB-Pfad (Default in db.ts). */
  dbPath?: string;
}

export interface SseServerHandle {
  /** Aktive SSE-URL, z. B. http://127.0.0.1:3000/sse */
  url: string;
  port: number;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';

/** Startet den lokalen SSE/HTTP-MCP-Server. */
export async function startSseServer(options: SseServerOptions): Promise<SseServerHandle> {
  if (Buffer.byteLength(options.token, 'utf8') < 16) {
    throw new Error('MCP-Bearer-Token muss mindestens 16 Bytes lang sein.');
  }
  const db = openReadonlyDatabase(options.dbPath);
  const getSession = makeSessionProvider(db);
  // Aktive SSE-Transporte je Session-ID (POST /messages routet hierher).
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal error');
      }
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Bearer-Token-Pflicht auf jeder Anfrage.
    if (!hasValidBearerToken(req.headers.authorization, options.token)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
      res.end('Unauthorized');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${HOST}`);

    // SSE-Stream eroeffnen.
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => transports.delete(transport.sessionId));
      const server = createMcpServer({ db, getSession });
      await server.connect(transport);
      return;
    }

    // Eingehende Client-Nachrichten.
    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404);
        res.end('Unbekannte Session');
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  let port: number;
  try {
    port = await listenWithRetry(httpServer, options.port, 10);
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    url: `http://${HOST}:${port}/sse`,
    port,
    close: async () => {
      await Promise.allSettled([...transports.values()].map((transport) => transport.close()));
      transports.clear();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          db.close();
          resolve();
        });
      });
    },
  };
}

function hasValidBearerToken(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Versucht ab `startPort` bis zu `maxTries` Ports, bis einer frei ist. */
function listenWithRetry(server: http.Server, startPort: number, maxTries: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;

    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE' && tries < maxTries) {
        tries += 1;
        port += 1;
        attempt();
      } else {
        reject(err);
      }
    };

    const attempt = (): void => {
      server.removeAllListeners('error');
      server.once('error', onError);
      server.listen(port, HOST, () => {
        server.removeListener('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    };

    attempt();
  });
}
