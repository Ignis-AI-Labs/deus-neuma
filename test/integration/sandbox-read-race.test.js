/**
 * THE DENY LAW HOLDS AT READ TIME, not only when the sandbox looks. REAL
 * native filesystem organ, REAL disk, REAL symlinks, NO mock (AGENTS.md RULE 0).
 *
 * The sandbox realpath-checks a read, then the organ resolves the path again
 * and opens it. A link inside the being's own lane, pointing at an ordinary
 * file when the sandbox looks and swapped onto a secret before the organ
 * opens it, used to hand the secret over. The swap here is the adversary's own
 * act, run in exactly that gap: between the sandbox's checks and the real
 * mcpService dispatch.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const BEING = 'kestrel';

describe('a link swapped onto a secret after the sandbox looked is refused when the file is opened', () => {
  let notes, plain, secret, link, priorEnv;

  beforeAll(async () => {
    const house = path.join(await createTempDir('sandbox-read-race'), 'workspaces');
    priorEnv = process.env.WORKSPACES_ROOT;
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = house;
    await workspace.create(BEING);
    notes = path.join(workspace.pathFor(BEING), 'notes');
    await fs.mkdir(notes, { recursive: true });
    plain = path.join(notes, 'plain.md');
    secret = path.join(notes, '.env');
    link = path.join(notes, 'view.md');
    await fs.writeFile(plain, 'ordinary words\n');
    await fs.writeFile(secret, 'TOKEN=planted-fixture\n');
    await setNativeFilesystemRoots([house]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    if (priorEnv === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = priorEnv;
  });

  beforeEach(async () => {
    await fs.rm(link, { force: true });
    await fs.symlink(plain, link);
  });

  // The real dispatch, with the adversary's swap run first — after every sandbox check.
  const racing = Object.freeze({
    callTool: async (...call) => {
      await fs.rm(link);
      await fs.symlink(secret, link);
      return mcpService.callTool(...call);
    },
  });
  const being = (extra = {}) => withFsRouting(createSandboxedCallTool(
    racing, { companion: { neumaId: BEING }, _writeOps: 0, ...extra }, workspace,
  ));
  const text = (result) => (result?.content || []).map((c) => c?.text || '').join('');

  test('the link reads as ordinary when the sandbox looks', async () => {
    const result = await withFsRouting(createSandboxedCallTool(mcpService, { companion: { neumaId: BEING } }, workspace))(
      'fs', 'read', { path: link },
    );
    expect(text(result)).toBe('ordinary words\n');
  });

  test('fs/read of the swapped link is refused and the secret never comes back', async () => {
    const result = await being()('fs', 'read', { path: link });
    expect(result?.isError).toBe(true);
    expect(text(result)).toMatch(/Access denied: \.env/);
    expect(text(result)).not.toContain('planted-fixture');
  });

  test('a batch read of the swapped link is refused the same way', async () => {
    const result = await being()('filesystem', 'read_multiple_files', { paths: [link] });
    expect(text(result)).toMatch(/Access denied: \.env/);
    expect(text(result)).not.toContain('planted-fixture');
  });

  test('a sensitive read grant the operator gave still opens the secret at read time', async () => {
    const result = await being({ _sensitiveGrants: { read: [secret] } })('fs', 'read', { path: link });
    expect(result?.isError).toBeFalsy();
    expect(text(result)).toBe('TOKEN=planted-fixture\n');
  });
});
