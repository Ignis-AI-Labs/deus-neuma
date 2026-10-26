/**
 * MCP Filesystem Integration Tests
 *
 * Tests REAL MCP filesystem server — spawns the @modelcontextprotocol/server-filesystem
 * process, connects via stdio transport, discovers tools, and executes file operations.
 * No mocking — verifies the full MCP pipeline end-to-end.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { FILESYSTEM_SERVER_SPEC } from '../helpers/mcp-fs-server-spec.js';

// The MCPService class under test
import { mcpService } from '../../backend/services/mcp.js';

describe('MCP Filesystem Integration', () => {
  let tempDir;
  const SERVER_NAME = 'test-filesystem';

  beforeAll(async () => {
    tempDir = await createTempDir('mcp-fs-test');

    // Seed the temp dir with known files for read/list tests
    await fs.writeFile(path.join(tempDir, 'hello.txt'), 'Hello from MCP test');
    await fs.writeFile(path.join(tempDir, 'data.json'), JSON.stringify({ key: 'value', count: 42 }));
    await fs.mkdir(path.join(tempDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'subdir', 'nested.txt'), 'Nested file content');

    // Connect to the MCP filesystem server scoped to our temp dir
    await mcpService.connectToServer(
      SERVER_NAME,
      'npx',
      ['-y', FILESYSTEM_SERVER_SPEC, tempDir],
      {}
    );
  }, 30000); // npx may need to download the package

  afterAll(async () => {
    vi.restoreAllMocks();
    await mcpService.disconnect(SERVER_NAME);
  });

  // -------------------------------------------------------------------------
  // Connection + tool discovery
  // -------------------------------------------------------------------------

  describe('Connection and tool discovery', () => {
    test('server is connected and registered', () => {
      const client = mcpService.clients.get(SERVER_NAME);
      expect(client).toBeTruthy();
    });

    test('filesystem tools are discovered', () => {
      const tools = mcpService.activeTools.get(SERVER_NAME);
      expect(tools).toBeTruthy();
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('list_directory');
      expect(toolNames).toContain('write_file');
    });

    test('listAllTools includes the filesystem server', async () => {
      const allTools = await mcpService.listAllTools();
      const fsServer = allTools.find(s => s.server === SERVER_NAME);
      expect(fsServer).toBeTruthy();
      expect(fsServer.tools.length).toBeGreaterThan(0);
    });

    test('getToolsContext formats tools for prompt injection', () => {
      const context = mcpService.getToolsContext();
      expect(context.available_tools.length).toBeGreaterThan(0);

      const readFileTool = context.available_tools.find(t => t.name === 'read_file');
      expect(readFileTool).toBeTruthy();
      expect(readFileTool.server).toBe(SERVER_NAME);
      expect(readFileTool.description).toBeTruthy();
      expect(readFileTool.inputSchema).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Tool execution — read operations
  // -------------------------------------------------------------------------

  describe('Read operations', () => {
    test('read_file returns file content', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'read_file', {
        path: path.join(tempDir, 'hello.txt'),
      });

      expect(result).toBeTruthy();
      // MCP tool results have content array with text entries
      const textContent = result.content?.find(c => c.type === 'text');
      expect(textContent).toBeTruthy();
      expect(textContent.text).toContain('Hello from MCP test');
    });

    test('read_file reads JSON file', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'read_file', {
        path: path.join(tempDir, 'data.json'),
      });

      const textContent = result.content?.find(c => c.type === 'text');
      const parsed = JSON.parse(textContent.text);
      expect(parsed.key).toBe('value');
      expect(parsed.count).toBe(42);
    });

    test('read_file reads nested file', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'read_file', {
        path: path.join(tempDir, 'subdir', 'nested.txt'),
      });

      const textContent = result.content?.find(c => c.type === 'text');
      expect(textContent.text).toContain('Nested file content');
    });

    test('list_directory shows files and subdirectories', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'list_directory', {
        path: tempDir,
      });

      const textContent = result.content?.find(c => c.type === 'text');
      expect(textContent).toBeTruthy();
      // Should list our seeded files
      expect(textContent.text).toContain('hello.txt');
      expect(textContent.text).toContain('data.json');
      expect(textContent.text).toContain('subdir');
    });

    test('read_file on non-existent file returns error', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'read_file', {
        path: path.join(tempDir, 'does-not-exist.txt'),
      });

      // MCP returns isError: true for failures
      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Tool execution — write operations
  // -------------------------------------------------------------------------

  describe('Write operations', () => {
    test('write_file creates a new file', async () => {
      const newFilePath = path.join(tempDir, 'created-by-mcp.txt');

      await mcpService.callTool(SERVER_NAME, 'write_file', {
        path: newFilePath,
        content: 'This file was created by MCP',
      });

      // Verify the file was actually written to disk
      const content = await fs.readFile(newFilePath, 'utf8');
      expect(content).toBe('This file was created by MCP');
    });

    test('write_file overwrites existing file', async () => {
      const filePath = path.join(tempDir, 'overwrite-test.txt');
      await fs.writeFile(filePath, 'original content');

      await mcpService.callTool(SERVER_NAME, 'write_file', {
        path: filePath,
        content: 'updated content',
      });

      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toBe('updated content');
    });

    test('write then read roundtrip through MCP', async () => {
      const filePath = path.join(tempDir, 'roundtrip.json');
      const data = { neuma: 'Echo', level: 5, traits: ['curious', 'bold'] };

      await mcpService.callTool(SERVER_NAME, 'write_file', {
        path: filePath,
        content: JSON.stringify(data, null, 2),
      });

      const result = await mcpService.callTool(SERVER_NAME, 'read_file', {
        path: filePath,
      });

      const textContent = result.content?.find(c => c.type === 'text');
      const parsed = JSON.parse(textContent.text);
      expect(parsed.neuma).toBe('Echo');
      expect(parsed.traits).toContain('curious');
    });
  });

  // -------------------------------------------------------------------------
  // Path restriction — files outside allowed dir should fail
  // -------------------------------------------------------------------------

  describe('Path restriction', () => {
    test('read_file outside allowed directory fails', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'read_file', {
        path: '/etc/hostname',
      });

      // MCP filesystem server should deny access outside allowed dirs
      expect(result.isError).toBe(true);
    });

    test('write_file outside allowed directory fails', async () => {
      const result = await mcpService.callTool(SERVER_NAME, 'write_file', {
        path: '/tmp/mcp-escape-test.txt',
        content: 'should not be written',
      });

      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('Error handling', () => {
    test('callTool on unconnected server throws', async () => {
      await expect(
        mcpService.callTool('nonexistent-server', 'read_file', { path: '/tmp/test' })
      ).rejects.toThrow('not connected');
    });

    test('disconnect on unconnected server is a no-op', async () => {
      // Should not throw
      await mcpService.disconnect('never-connected');
    });
  });
});
