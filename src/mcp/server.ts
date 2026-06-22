/**
 * Baut einen MCP-Server (SDK 1.x) mit allen 9 read-only Tools.
 * Transport-unabhaengig — stdio und SSE nutzen denselben Server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type ToolContext } from './tools';

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'tbm-unicloudconnect', version: '0.1.0' });
  registerTools(server, ctx);
  return server;
}
