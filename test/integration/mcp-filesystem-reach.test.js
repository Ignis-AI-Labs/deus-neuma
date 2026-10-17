/**
 * Filesystem MCP server REACH — real server, real disk, NO mock (RULE 0).
 *
 * Proves the foundation #7 stands on: when the sovereign-workspaces root lives
 * OUTSIDE the project dir (the normal case — a dedicated drive), connectFilesystem
 * Server() includes it in the real server's allowed dirs, so a write into a
 * neuma's lane physically lands. Without this, the per-neuma sandbox would
 * "allow" a lane write the server then can't perform — the contradiction that
 * failed Galen.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

describe('filesystem MCP server reaches the sovereign-workspaces root (gnosis, no mock)', () => {
  let house, origRoot, connectedRoots;

  beforeAll(async () => {
    // A house OUTSIDE the project dir (createTempDir lives under the OS temp
    // dir, not the repo) — the realistic "dedicated drive" case.
    house = await createTempDir('mcp-reach-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    connectedRoots = await connectFilesystemServer(); // known-connected state for every test
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    await fs.rm(house, { recursive: true, force: true }); // remove the lane we created
  });

  test('connectFilesystemServer includes the external workspaces root in its allowed dirs', () => {
    expect(connectedRoots).toContain(process.cwd());   // project dir for ceremony scratch
    expect(connectedRoots).toContain(house);           // the external house — the new reach
  });

  test('a write into a lane UNDER that root actually lands on disk through the real server', async () => {
    await workspace.create('reach-test'); // real lane with a dna/ dir under the external house
    const genesis = path.join(house, 'reach-test', 'dna', 'genesis.md');

    await mcpService.callTool('filesystem', 'write_file', {
      path: genesis,
      content: '# I am. This is my own hand on my own DNA.',
    });

    expect(existsSync(genesis)).toBe(true);
    expect(await fs.readFile(genesis, 'utf8')).toContain('my own hand');
  }, 30000);

  test('a path OUTSIDE both allowed roots is refused by the server itself', async () => {
    const res = await mcpService.callTool('filesystem', 'read_file', { path: '/etc/hostname' });
    expect(res.isError).toBe(true); // the server's own allowed-dir wall (the sandbox adds the per-neuma wall on top)
  }, 30000);
});
