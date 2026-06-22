/**
 * MCP-Modul (Architekturmodul, siehe docs/MCP_SPEC.md).
 *
 * Optionaler, lokaler, read-only LearnWeb-Zugriff fuer KI-Clients
 * (Claude Desktop via stdio, claude.ai via SSE/HTTP). Muss explizit im
 * Dashboard aktiviert werden; kein automatisches Starten. Kontoweiter
 * Lesezugriff, unabhaengig von der lokalen Sync-Auswahl.
 *
 * Implementierung: Dual-Transport (stdio + SSE/HTTP), 9 read-only Tools laut
 * MCP_SPEC, lokale SQLite read-only + LearnwebSession (Keychain). SSE nur auf
 * 127.0.0.1 mit Bearer-Token.
 */
export { openReadonlyDatabase, getDbPath } from './db';
export { makeSessionProvider, type SessionProvider } from './session';
export { createMcpServer } from './server';
export { registerTools, TOOL_NAMES, type ToolContext } from './tools';
export { startStdioServer } from './server-stdio';
export { startSseServer, type SseServerHandle, type SseServerOptions } from './server-sse';
export { McpRuntime, type McpRuntimeOptions } from './runtime';
