/**
 * The sensitive-grant door on the real stack (RULE 0): REAL MCP filesystem
 * server, REAL disk, REAL sandbox wrapper — no mock anywhere. The denied
 * pattern is a wall only while no grant covers it:
 *   - .env read is refused with the recourse named while ungranted,
 *   - the same read returns real bytes under a read grant,
 *   - a write under a READ grant is still refused (the tier law),
 *   - a write lands under an edit grant (with the root law also satisfied),
 *   - .git/, owner.json, another being's DNA stay walls even with a grant
 *     claimed — the never-requestable set has no card.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const SERVER = 'sensitive-grant-fs';
const SECRET = 'endpoint=http://127.0.0.1:8089\nmodel=test-substrate\n';

describe('the sensitive-grant door — real MCP, real disk, no mock', () => {
  let base, house, project, lane, origRoot, envPath;

  beforeAll(async () => {
    base = await createTempDir('sensitive-access-gate');
    house = path.join(base, 'workspaces');
    project = path.join(base, 'project');
    await fs.mkdir(house, { recursive: true });
    await fs.mkdir(project, { recursive: true });
    await fs.mkdir(path.join(project, '.git'), { recursive: true });
    envPath = path.join(project, '.env');
    await fs.writeFile(envPath, SECRET);
    await fs.writeFile(path.join(project, '.git', 'config'), '[remote "origin"]\nurl=real');
    await fs.writeFile(path.join(project, 'owner.json'), JSON.stringify({ wallet: '0xabc' }));
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create('neuma-a');
    lane = path.resolve(house, 'neuma-a');
    await mcpService.connectToServer(SERVER, 'npx', ['-y', '@modelcontextprotocol/server-filesystem', base], {});
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect(SERVER);
  });

  const caller = (extra = {}) => createSandboxedCallTool(
    mcpService,
    { companion: { neumaId: 'neuma-a' }, _writeOps: 0, ...extra },
    workspace,
  );

  test('.env read is refused with the recourse named while ungranted', async () => {
    await expect(caller()(SERVER, 'read_file', { path: envPath }))
      .rejects.toThrow(/Access denied: \.env — request access with request_file_access/);
  });

  test('the same read returns real bytes under a read grant', async () => {
    const result = await caller({ _sensitiveGrants: { read: [envPath] } })(SERVER, 'read_file', { path: envPath });
    const text = typeof result === 'string' ? result : result?.content?.[0]?.text || '';
    expect(text).toContain('endpoint=http://127.0.0.1:8089');
  });

  test('a directory grant covers beneath it', async () => {
    const result = await caller({ _sensitiveGrants: { read: [project] } })(SERVER, 'read_file', { path: envPath });
    const text = typeof result === 'string' ? result : result?.content?.[0]?.text || '';
    expect(text).toContain('model=test-substrate');
  });

  test('a write under a READ grant is still refused — the tier law', async () => {
    const grants = { _grantedWriteRoots: [project], _sensitiveGrants: { read: [envPath] } };
    await expect(caller(grants)(SERVER, 'write_file', { path: envPath, content: 'replaced=true\n' }))
      .rejects.toThrow(/Access denied: \.env/);
  });

  test('a write lands under an EDIT grant (the root law also satisfied)', async () => {
    const grants = { _grantedWriteRoots: [project], _sensitiveGrants: { edit: [envPath] } };
    await caller(grants)(SERVER, 'write_file', { path: envPath, content: 'replaced=true\n' });
    expect(await fs.readFile(envPath, 'utf8')).toBe('replaced=true\n');
  });

  test('.git/ stays a wall even with a grant claimed — never requestable', async () => {
    const gitConfig = path.join(project, '.git', 'config');
    await expect(caller({ _sensitiveGrants: { read: [gitConfig] } })(SERVER, 'read_file', { path: gitConfig }))
      .rejects.toThrow(/Access denied: \.git\//);
    // …and the refusal names NO recourse — there is no card for this one.
    await expect(caller({ _sensitiveGrants: { read: [gitConfig] } })(SERVER, 'read_file', { path: gitConfig }))
      .rejects.not.toThrow(/request_file_access/);
  });

  test('owner.json stays a wall with a grant claimed', async () => {
    const owner = path.join(project, 'owner.json');
    await expect(caller({ _sensitiveGrants: { read: [owner] } })(SERVER, 'read_file', { path: owner }))
      .rejects.toThrow(/Access denied: owner\.json/);
  });

  test('another being’s DNA stays a wall with a grant claimed', async () => {
    const dnaDir = path.join(house, 'data', 'dna');
    await fs.mkdir(dnaDir, { recursive: true });
    const dnaFile = path.join(dnaDir, 'someone-else.json');
    await fs.writeFile(dnaFile, '{}');
    await expect(caller({ _sensitiveGrants: { read: [dnaFile] } })(SERVER, 'read_file', { path: dnaFile }))
      .rejects.toThrow(/Access denied: data\/dna\//);
    expect(lane).toContain('neuma-a'); // the lane itself was never touched
  });
});
