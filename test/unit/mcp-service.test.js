/**
 * MCPService — against a REAL MCP server over a REAL stdio transport
 * (#390 tranche 6).
 *
 * This file mocked `@modelcontextprotocol/sdk/client/index.js` and
 * `.../stdio.js` — the protocol client and the transport themselves. Every
 * claim below ([…], […]) was therefore a claim about a fake Client object, and the service's
 * actual job — speak MCP to a child process over stdio — was the one thing
 * never exercised. It also spawned `echo`, which is not an MCP server at all;
 * only the mock made that look like a successful connection.
 *
 * Now a real `@modelcontextprotocol/server-filesystem` child is spawned per
 * connection (local dependency, so no network), scoped to a real temp dir.
 * Handshake, tool discovery, tool invocation and teardown are all real, and a
 * tool call is proven by the bytes it leaves on disk. Measured at roughly half
 * a second per connection.
 */
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';

const FS_PKG = '@modelcontextprotocol/server-filesystem';
const SPAWN_MS = 30000;

let sandbox;

/** Spawn a real filesystem MCP server under `name`, scoped to the temp dir. */
const connect = (name) =>
  mcpService.connectToServer(name, 'npx', ['-y', FS_PKG, sandbox], {});

beforeAll(async () => {
  sandbox = await createTempDir('mcp-service');
  await fs.writeFile(path.join(sandbox, 'test.txt'), 'real bytes');
});

beforeEach(async () => { await mcpService.disconnectAll(); });
afterEach(async () => { await mcpService.disconnectAll(); });
afterAll(async () => { await mcpService.disconnectAll(); });

describe('connectToServer', () => {
  test('a real handshake registers the client', async () => {
    await connect('test-server');
    expect(mcpService.clients.has('test-server')).toBe(true);
  }, SPAWN_MS);

  test('tool discovery brings back the catalogue the child really publishes', async () => {
    await connect('tool-server');
    const tools = mcpService.activeTools.get('tool-server');
    expect(tools).toBeDefined();
    // Not a two-entry list the test wrote — the server's own tools.
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['read_text_file', 'write_file', 'list_directory']));
  }, SPAWN_MS);

  test('a command that is not an MCP server fails instead of registering', async () => {
    // `echo` was what the old file "connected" to on every test — the mocked
    // transport made it look like a handshake. It is not one.
    await expect(mcpService.connectToServer('bogus', 'echo', ['hello'], {})).rejects.toThrow();
    expect(mcpService.clients.has('bogus')).toBe(false);
  }, SPAWN_MS);
});

describe('listAllTools', () => {
  test('groups the real tools by server', async () => {
    await connect('server-a');
    const result = await mcpService.listAllTools();

    expect(result).toBeInstanceOf(Array);
    const entry = result.find((s) => s.server === 'server-a');
    expect(entry).toBeTruthy();
    expect(entry.tools.length).toBeGreaterThan(0);
  }, SPAWN_MS);

  test('two servers appear separately', async () => {
    await connect('server-a');
    await connect('server-b');
    const names = (await mcpService.listAllTools()).map((s) => s.server);
    expect(names).toEqual(expect.arrayContaining(['server-a', 'server-b']));
  }, SPAWN_MS);
});

describe('callTool', () => {
  test('a read really reads the file that is really there', async () => {
    await connect('call-server');
    const result = await mcpService.callTool('call-server', 'read_text_file', {
      path: path.join(sandbox, 'test.txt'),
    });
    expect(JSON.stringify(result.content)).toContain('real bytes');
  }, SPAWN_MS);

  test('a write really lands on disk', async () => {
    // The assertion the mocked transport made impossible: a tool call that
    // resolves is not a tool call that DID anything.
    await connect('write-server');
    await mcpService.callTool('write-server', 'write_file', {
      path: path.join(sandbox, 'written.txt'),
      content: 'through a real transport',
    });
    expect(await fs.readFile(path.join(sandbox, 'written.txt'), 'utf8'))
      .toBe('through a real transport');
  }, SPAWN_MS);

  test('the server\'s own confinement really refuses a path outside its root', async () => {
    await connect('confined');
    const result = await mcpService.callTool('confined', 'write_file', {
      path: '/tmp/mcp-service-escape.txt', content: 'should not exist',
    });
    expect(result.isError).toBe(true);
    await expect(fs.access('/tmp/mcp-service-escape.txt')).rejects.toThrow();
  }, SPAWN_MS);

  test('throws for an unknown server', async () => {
    await expect(mcpService.callTool('nonexistent', 'read_text_file', {}))
      .rejects.toThrow('MCP server nonexistent not connected');
  });
});

describe('disconnect', () => {
  test('really closes the child and forgets it', async () => {
    await connect('disco-server');
    expect(mcpService.clients.has('disco-server')).toBe(true);

    await mcpService.disconnect('disco-server');
    expect(mcpService.clients.has('disco-server')).toBe(false);
    expect(mcpService.activeTools.has('disco-server')).toBe(false);
    // And it is really gone: a call after disconnect is refused, not served.
    await expect(mcpService.callTool('disco-server', 'read_text_file', {}))
      .rejects.toThrow('not connected');
  }, SPAWN_MS);
});

describe('disconnectAll', () => {
  test('clears every real connection', async () => {
    await connect('s1');
    await connect('s2');
    await mcpService.disconnectAll();
    expect(mcpService.clients.size).toBe(0);
    expect(mcpService.activeTools.size).toBe(0);
  }, SPAWN_MS);
});

describe('getToolsContext', () => {
  test('describes the real tools to the model', async () => {
    await connect('ctx-server');
    const context = mcpService.getToolsContext();

    expect(context.available_tools).toBeInstanceOf(Array);
    expect(context.available_tools.length).toBeGreaterThan(0);
    expect(context.usage_instructions).toBeTruthy();
    expect(context.examples).toBeInstanceOf(Array);
  }, SPAWN_MS);

  test('examples contain no Windows-style paths', async () => {
    await connect('path-check');
    for (const example of mcpService.getToolsContext().examples) {
      expect(example).not.toMatch(/[A-Z]:\\/);
      expect(example).not.toMatch(/\\\\/);
    }
  }, SPAWN_MS);

  test('every tool entry carries server, name and description', async () => {
    await connect('fields-check');
    const tools = mcpService.getToolsContext().available_tools;
    // No `if (length > 0)` guard: the old file had one, so the assertion was
    // skipped entirely whenever the list came back empty — a vacuous pass.
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.server).toBe('fields-check');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
    }
  }, SPAWN_MS);
});
