/* global process */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'utility-proof', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'environment', description: 'the runtime environment', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ electron: process.versions.electron, runAsNode: process.env.ELECTRON_RUN_AS_NODE || null }) }],
}));
await server.connect(new StdioServerTransport());
