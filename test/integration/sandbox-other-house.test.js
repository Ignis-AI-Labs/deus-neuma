/**
 * ANOTHER HOUSE'S DATA IS NEVER A BEING'S TO READ OR WRITE, however wide its
 * focus. REAL native filesystem organ, REAL disk, NO mock (AGENTS.md RULE 0).
 *
 * The install owner may open and focus a folder that holds the whole house or
 * the realm. The operator's own explorer already refuses another wallet's
 * lanes and realm dir there (explorer-walls.js); a being seated under that
 * focus read them through fs/read, because its sandbox knew secret patterns
 * only. Every call travels the being-facing path production composes —
 * withFsRouting(createSandboxedCallTool) over the in-process organ.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
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

describe('a being never reaches another house\'s lanes or realm dir, even under a focus over them', () => {
  let folder, house, realm, priorEnv, priorRealm;

  const own = async (id, wallet) => {
    const lane = workspace.pathFor(id);
    await fs.mkdir(lane, { recursive: true });
    await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
    await fs.writeFile(path.join(lane, 'notes.md'), `${id} words\n`);
    return lane;
  };

  beforeAll(async () => {
    folder = path.join(await createTempDir('sandbox-other-house'), 'home', '.neuma');
    house = path.join(folder, 'workspaces');
    realm = path.join(folder, 'realm');
    priorEnv = process.env.WORKSPACES_ROOT;
    priorRealm = getRealmRoot();
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = house;
    setRealmRoot(realm);
    await own(BEING, OURS);
    await own(HOUSEMATE, OURS);
    await own(STRANGER, THEIRS);
    for (const wallet of [OURS, THEIRS]) {
      await fs.mkdir(path.join(realm, wallet), { recursive: true });
      await fs.writeFile(path.join(realm, wallet, 'chat.json'), `{"house":"${wallet}"}`);
    }
    await setNativeFilesystemRoots([folder]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    setRealmRoot(priorRealm);
    if (priorEnv === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = priorEnv;
  });

  // Focused on the folder holding the whole house and the realm; a fresh connection per call.
  const being = () => withFsRouting(createSandboxedCallTool(mcpService, {
    companion: { neumaId: BEING }, walletAddress: OURS, toolWorkspace: folder, _writeOps: 0,
  }, workspace));
  const text = (result) => (result?.content || []).map((c) => c?.text || '').join('');

  test('fs/read of another house\'s lane and realm dir is refused', async () => {
    await expect(being()('fs', 'read', { path: path.join(house, STRANGER, 'notes.md') })).rejects.toThrow(/another house/);
    await expect(being()('fs', 'read', { path: path.join(realm, THEIRS, 'chat.json') })).rejects.toThrow(/another house/);
    await expect(being()('fs', 'read', { path: path.join(house, STRANGER.toUpperCase(), 'notes.md') })).rejects.toThrow(/another house/);
  });

  test('fs/write into another house\'s lane is refused and nothing lands', async () => {
    const target = path.join(house, STRANGER, 'planted.md');
    await expect(being()('fs', 'write', { path: target, content: 'not yours' })).rejects.toThrow(/another house/);
    expect(existsSync(target)).toBe(false);
  });

  test('a symlink inside its own lane cannot carry a read into another house', async () => {
    const link = path.join(workspace.pathFor(BEING), 'shortcut');
    await fs.symlink(path.join(house, STRANGER), link);
    await expect(being()('fs', 'read', { path: path.join(link, 'notes.md') })).rejects.toThrow(/another house/);
  });

  test('its own lane, a housemate\'s lane and its own house\'s realm dir read as before', async () => {
    expect(text(await being()('fs', 'read', { path: path.join(house, BEING, 'notes.md') }))).toContain(`${BEING} words`);
    expect(text(await being()('fs', 'read', { path: path.join(house, HOUSEMATE, 'notes.md') }))).toContain(`${HOUSEMATE} words`);
    expect(text(await being()('fs', 'read', { path: path.join(realm, OURS, 'chat.json') }))).toContain(OURS);
  });

  // A search rooted at the focus walks the whole house and realm: every entry is judged, not only the root.
  test('a name search over the house lists no file of another house', async () => {
    const found = text(await being()('filesystem', 'search_files', { path: folder, pattern: '*.md', excludePatterns: [] }));
    expect(found).toContain(path.join(house, BEING, 'notes.md'));
    expect(found).toContain(path.join(house, HOUSEMATE, 'notes.md'));
    expect(found).not.toContain(STRANGER);
  });

  test('a content search over the house returns no line from another house', async () => {
    const search = async (pattern) => text(await being()('filesystem', 'search_content', { path: folder, pattern, excludePatterns: [] }));
    const lanes = await search('words');
    expect(lanes).toContain(`${HOUSEMATE} words`);
    expect(lanes).not.toContain(`${STRANGER} words`);
    const realms = await search('"house"');
    expect(realms).toContain(OURS);
    expect(realms).not.toContain(THEIRS);
  });
});
