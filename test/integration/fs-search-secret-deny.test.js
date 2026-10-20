/**
 * fs/search walks a whole tree, so it must judge EVERY file it walks — not
 * only the root it was handed. REAL native filesystem organ, REAL disk, the
 * being-facing path production composes (withFsRouting over
 * createSandboxedCallTool), NO mock (AGENTS.md RULE 0).
 *
 * The audit (tools-security-isolation B1) found the sandbox checked only
 * `args.path`: fs/read refused .env and keys/keypair.json, while fs/search
 * content:true over the lane returned their lines, and a name search listed
 * them. Every secret below is FAKE.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const BEING = 'searchwall';
const NEEDLE = 'FAKE_NEEDLE_1d9';
// Each a path the sandbox refuses to fs/read, planted with the needle.
const DENIED = Object.freeze(['.env', 'keys/keypair.json', 'data/dna/x.json', 'id.pem', 'owner.json']);

describe('fs/search never reads or names a file the sandbox denies', () => {
  let house, lane, priorEnv, priorRoot;
  const text = (result) => result.content.map((c) => c.text).join('\n');
  const being = () => withFsRouting(createSandboxedCallTool(
    mcpService, { companion: { neumaId: BEING }, _writeOps: 0 }, workspace,
  ));

  beforeAll(async () => {
    house = path.join(await createTempDir('fs-search-wall'), 'workspaces');
    priorEnv = process.env.WORKSPACES_ROOT;
    priorRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(BEING);
    lane = workspace.pathFor(BEING);
    for (const rel of DENIED) {
      await fs.mkdir(path.dirname(path.join(lane, rel)), { recursive: true });
      await fs.writeFile(path.join(lane, rel), `secret=${NEEDLE}-${rel}\n`);
    }
    await fs.writeFile(path.join(lane, 'notes.md'), `ordinary line ${NEEDLE}-notes\n`);
    await setNativeFilesystemRoots([house]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    setWorkspacesRoot(priorRoot);
    if (priorEnv === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = priorEnv;
  });

  test('the denied files really are denied to fs/read', async () => {
    for (const rel of DENIED) {
      await expect(being()('fs', 'read', { path: path.join(lane, rel) })).rejects.toThrow(/denied/i);
    }
  });

  test('a content search returns the ordinary match and no line of any denied file', async () => {
    const out = text(await being()('fs', 'search', { path: lane, pattern: NEEDLE, content: true }));
    expect(out).toContain(`${NEEDLE}-notes`);
    for (const rel of DENIED) expect(out).not.toContain(`${NEEDLE}-${rel}`);
    expect(out).toMatch(/withheld by the secret-path policy/);
  });

  test('a content search with no excludes still withholds them', async () => {
    const out = text(await being()('fs', 'search', { path: lane, pattern: NEEDLE, content: true, excludePatterns: [] }));
    expect(out).toContain(`${NEEDLE}-notes`);
    for (const rel of DENIED) expect(out).not.toContain(`${NEEDLE}-${rel}`);
  });

  test('a name search lists the ordinary file and names no denied one', async () => {
    const out = text(await being()('fs', 'search', { path: lane, pattern: '*' }));
    expect(out).toContain('notes.md');
    for (const name of ['.env', 'keypair.json', 'x.json', 'id.pem', 'owner.json']) {
      expect(out).not.toContain(name);
    }
    expect(out).toMatch(/withheld by the secret-path policy/);
  });
});
