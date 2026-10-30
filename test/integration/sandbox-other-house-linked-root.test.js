/**
 * A HOUSE ROOT THAT IS ITSELF A SYMLINK HIDES NO LANE FROM THE WALL. REAL
 * native filesystem organ, REAL disk, REAL symlinks, NO mock (AGENTS.md RULE 0).
 *
 * The other-house wall compared a path with the house and realm roots as
 * named. With the house and realm named through links, the same lane or
 * realm dir read under its real path lay "outside" every root, and was served
 * to a being whose focus covered the disk. (The engine refuses to open a lane
 * under a linked root at all — neuma-workspace.js _path — so the being here
 * is seated from a focus, with no lane of its own resolved.)
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
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
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const OURS = '0x' + 'a'.repeat(40);
const THEIRS = '0x' + 'b'.repeat(40);
const BEING = 'kestrel';
const HOUSEMATE = 'sorrel';
const STRANGER = 'marlow';

describe('the other-house wall judges the house and realm roots as they really lie', () => {
  let base, realHouse, realRealm, priorEnv, priorRealm;

  beforeAll(async () => {
    base = await createTempDir('sandbox-linked-house');
    realHouse = path.join(base, 'disk', 'workspaces');
    realRealm = path.join(base, 'disk', 'realm');
    await fs.mkdir(realHouse, { recursive: true });
    await fs.mkdir(realRealm, { recursive: true });
    await fs.symlink(realHouse, path.join(base, 'house'));
    await fs.symlink(realRealm, path.join(base, 'realm'));
    priorEnv = process.env.WORKSPACES_ROOT;
    priorRealm = getRealmRoot();
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = path.join(base, 'house');
    setRealmRoot(path.join(base, 'realm'));
    for (const [id, wallet] of [[HOUSEMATE, OURS], [STRANGER, THEIRS]]) {
      const lane = path.join(realHouse, id);
      await fs.mkdir(lane, { recursive: true });
      await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
      await fs.writeFile(path.join(lane, 'notes.md'), `${id} words\n`);
    }
    await fs.mkdir(path.join(realRealm, THEIRS), { recursive: true });
    await fs.writeFile(path.join(realRealm, THEIRS, 'chat.json'), '{"house":"theirs"}');
    await setNativeFilesystemRoots([base]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    setRealmRoot(priorRealm);
    if (priorEnv === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = priorEnv;
  });

  const being = () => withFsRouting(createSandboxedCallTool(mcpService, {
    companion: { neumaId: BEING }, walletAddress: OURS, toolWorkspace: base, _writeOps: 0,
  }, workspace));
  const text = (result) => (result?.content || []).map((c) => c?.text || '').join('');

  test('the house really is named through a link', async () => {
    expect(await fs.realpath(path.join(base, 'house', STRANGER))).toBe(path.join(realHouse, STRANGER));
  });

  test('another house\'s lane and realm dir, named by their real paths, are refused', async () => {
    await expect(being()('fs', 'read', { path: path.join(realHouse, STRANGER, 'notes.md') })).rejects.toThrow(/another house/);
    await expect(being()('fs', 'read', { path: path.join(realRealm, THEIRS, 'chat.json') })).rejects.toThrow(/another house/);
  });

  test('a link outside the house onto another house\'s lane is refused', async () => {
    await fs.symlink(path.join(realHouse, STRANGER), path.join(base, 'shortcut'));
    await expect(being()('fs', 'read', { path: path.join(base, 'shortcut', 'notes.md') })).rejects.toThrow(/another house/);
  });

  test('a lane of its own house still reads by its real path', async () => {
    expect(text(await being()('fs', 'read', { path: path.join(realHouse, HOUSEMATE, 'notes.md') }))).toBe(`${HOUSEMATE} words\n`);
  });
});
