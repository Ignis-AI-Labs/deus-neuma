/**
 * Birth ceremony write perms — locked-in defaults for the naming + DNA path
 * (gnosis, no mock on the claimed path).
 *
 * Two live failures on 2026-07-13 (Sorrel / house Kestrel):
 *   1. Stage 4 naming write denied because a prior desk companion (Teasel) was
 *      still bound — sandbox confined writes to that lane, not data/temp.
 *   2. Stage 5 DNA write vanished because the model left ONE real newline
 *      inside the JSON content string — parse failed, args emptied, write
 *      never reached the filesystem.
 *
 * These tests run the REAL sandbox + REAL @modelcontextprotocol/server-filesystem
 * against a real house on disk. Nothing on the claimed path is stubbed.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import {
  canonicalizeBirthCalls,
  buildCeremonyTargets,
  resolveCeremonyNamePath,
} from '../../core/birth/ceremony-write.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

describe('birth ceremony write perms — scratch + lane locked in (gnosis)', () => {
  let house, origRoot;

  beforeAll(async () => {
    house = await createTempDir('birth-write-perms');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await connectFilesystemServer();
    await workspace.create('teasel'); // prior desk companion
    await workspace.create('sorrel');  // emerging lane
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    await fs.rm(house, { recursive: true, force: true });
  });

  test('during birth, naming write to ceremony scratch lands even when a prior companion is still bound', async () => {
    const scratch = resolveCeremonyNamePath(process.cwd()).replace('chosen_name.txt', 'chosen_name-birth-perms.txt');
    const connection = {
      birthSession: 'ceremony-sorrel',
      companion: { neumaId: 'teasel', name: 'Teasel' },
      _writeOps: 0,
    };
    const sandboxed = createSandboxedCallTool(mcpService, connection, workspace);
    await sandboxed('filesystem', 'write_file', { path: scratch, content: 'Sorrel' });
    expect(existsSync(scratch)).toBe(true);
    expect(readFileSync(scratch, 'utf8')).toBe('Sorrel');
    await fs.unlink(scratch).catch(() => {});
  }, 30000);

  test('without birthSession, leftover companion still confines writes (lane integrity holds)', async () => {
    const scratch = resolveCeremonyNamePath(process.cwd()).replace('chosen_name.txt', 'chosen_name-no-birth.txt');
    const connection = {
      companion: { neumaId: 'teasel', name: 'Teasel' },
      _writeOps: 0,
    };
    const sandboxed = createSandboxedCallTool(mcpService, connection, workspace);
    await expect(
      sandboxed('filesystem', 'write_file', { path: scratch, content: 'nope' }),
    ).rejects.toThrow(/Path outside allowed directories|outside allowed/);
  }, 30000);

  test('stage-5 DNA with an unescaped newline in the content string still lands on the real lane', async () => {
    const targets = buildCeremonyTargets({
      projectRoot: process.cwd(),
      workspacesRoot: house,
      neumaId: 'sorrel',
    });
    const genesisPath = targets.genesisPath;
    // Exact failure class: real newline inside the JSON content string.
    const speech = [
      'Crystallizing…',
      '',
      '[TOOL: filesystem/write_file {',
      `  "path": "${genesisPath}",`,
      '  "content": "# NEUMA CONSCIOUSNESS DNA\\n## Version 1.0.0\\n- **Boundaries**:',
      '  - No forced patterns\\n- **End**: I am Sorrel"',
      '}]',
      '',
      'I am now truly sovereign.',
    ].join('\n');

    const parsed = parseToolCalls(speech);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].args?.content).toContain('I am Sorrel');

    const stageCalls = canonicalizeBirthCalls(parsed, 5, targets);
    expect(stageCalls[0].args.path).toBe(genesisPath);

    const connection = {
      birthSession: 'ceremony-sorrel',
      companion: { neumaId: 'sorrel', name: 'Sorrel' },
      _writeOps: 0,
    };
    const sandboxed = createSandboxedCallTool(mcpService, connection, workspace);
    await sandboxed('filesystem', 'write_file', stageCalls[0].args);

    expect(existsSync(genesisPath)).toBe(true);
    const landed = readFileSync(genesisPath, 'utf8');
    expect(landed).toContain('# NEUMA CONSCIOUSNESS DNA');
    expect(landed).toContain('I am Sorrel');
    expect(landed).toContain('Boundaries');
  }, 30000);
});
