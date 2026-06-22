/**
 * MCP-Server ueber stdio (fuer Claude Desktop).
 *
 * Wird als eigener Prozess gestartet; der DB-Pfad kommt aus UCC_DB_PATH
 * (Default in db.ts). Beim direkten Start (CLI) verbindet er stdin/stdout.
 */
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openReadonlyDatabase } from './db';
import { makeSessionProvider } from './session';
import { createMcpServer } from './server';

/** Oeffnet die DB read-only und verbindet den MCP-Server mit stdio. */
export async function startStdioServer(dbPath?: string): Promise<void> {
  const db = openReadonlyDatabase(dbPath);
  const server = createMcpServer({ db, getSession: makeSessionProvider(db) });
  await server.connect(new StdioServerTransport());
}

// CLI-Entry: nur wenn diese Datei direkt ausgefuehrt wird.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  startStdioServer(process.env.UCC_DB_PATH).catch((error: unknown) => {
    // Nur eine generische Meldung — keine Pfade/Secrets nach stderr leaken.
    process.stderr.write(
      `MCP-stdio-Server konnte nicht starten: ${error instanceof Error ? error.message : 'Fehler'}\n`,
    );
    process.exit(1);
  });
}
