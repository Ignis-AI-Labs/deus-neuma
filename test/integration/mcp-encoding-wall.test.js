/**
 * THE ENCODING WALL on the being lane (#290 / INFRA-013) — real server, real
 * disk, NO mock (RULE 0).
 *
 * Wendell's #239 validation drove the real pinned
 * @modelcontextprotocol/server-filesystem over stdio on a latin1 file:
 * read_text_file handed back U+FFFD'd text, write_file said OK, and the bytes
 * on disk were destroyed — the desk editor's fixed defect, still live on the
 * lane a being uses. The wall now stands in createSandboxedCallTool, BEFORE
 * the forward to the server, so this proves the same drive REFUSES and the
 * bytes survive — and that ordinary writes still land through the real server.
 *
 * Harness mirrors sandbox-write-grant.test.js (granted project folder).
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const SERVER = 'encoding-wall-fs';

// #239's fixture manifest, byte for byte: `Café naïve résumé señor\n` in Latin-1.
const LATIN1 = Buffer.from('Caf\xE9 na\xEFve r\xE9sum\xE9 se\xF1or\n', 'latin1');

describe('the MCP encoding wall — a being cannot destroy a non-UTF-8 file (gnosis, no mock)', () => {
  let base, house, project, origRoot;

  beforeAll(async () => {
    base = await createTempDir('encoding-wall');
    house = path.join(base, 'workspaces');
    project = path.join(base, 'project');
    await fs.mkdir(house, { recursive: true });
    await fs.mkdir(project, { recursive: true });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create('neuma-wall');
    await fs.writeFile(path.join(project, 'latin1.txt'), LATIN1);
    await fs.writeFile(path.join(project, 'valid.txt'), 'plain utf-8\n');
    await mcpService.connectToServer(SERVER, 'npx', ['-y', '@modelcontextprotocol/server-filesystem', base], {});
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect(SERVER);
  });

  // A sandboxed caller with a write grant on the project folder — the same
  // seat shape a being holds when working the operator's files.
  const call = () => {
    const connection = { companion: { neumaId: 'neuma-wall' }, _writeOps: 0, _grantedWriteRoots: [project] };
    return createSandboxedCallTool(mcpService, connection, workspace);
  };

  test('write_file onto the latin1 file REFUSES, and every byte survives', async () => {
    const target = path.join(project, 'latin1.txt');
    await expect(call()(SERVER, 'write_file', { path: target, content: 'clobber' }))
      .rejects.toThrow(/not UTF-8/i);
    expect((await fs.readFile(target)).equals(LATIN1)).toBe(true);
  });

  test('the refusal names the honest cost — the character count a save would destroy', async () => {
    const target = path.join(project, 'latin1.txt');
    await expect(call()(SERVER, 'write_file', { path: target, content: 'x' }))
      .rejects.toThrow(/destroy 5 character/i);
  });

  test('edit_file onto the latin1 file refuses the same way — the server would read-modify-rewrite it', async () => {
    const target = path.join(project, 'latin1.txt');
    await expect(call()(SERVER, 'edit_file', { path: target, edits: [{ oldText: 'Caf', newText: 'Kaf' }] }))
      .rejects.toThrow(/not UTF-8/i);
    expect((await fs.readFile(target)).equals(LATIN1)).toBe(true);
  });

  test('a deliberate UTF-8 whole-file replacement still lands with the current stamp', async () => {
    const target = path.join(project, 'valid.txt');
    const expectedMtimeMs = (await fs.stat(target)).mtimeMs;
    await call()(SERVER, 'write_file', {
      path: target, content: 'replaced — 日本語 ok\n', overwrite: true, expectedMtimeMs,
    });
    expect(await fs.readFile(target, 'utf8')).toBe('replaced — 日本語 ok\n');
  });

  test('a write CREATING a fresh file still lands — a fresh write is not a rewrite', async () => {
    const target = path.join(project, 'brand-new.txt');
    expect(existsSync(target)).toBe(false);
    await call()(SERVER, 'write_file', { path: target, content: 'fresh\n' });
    expect(await fs.readFile(target, 'utf8')).toBe('fresh\n');
  });
});
