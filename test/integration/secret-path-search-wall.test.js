/**
 * fs/search AND fs/read NEVER OPEN THE OPERATOR'S TOOL CREDENTIALS (security
 * recheck 2026-10-20, §8). A content search over a focused home returned the
 * coding agent's credentials, gh's token file, docker's registry auths, a
 * keypair outside keys/, shell history and the token files other tools keep.
 * The shared classifier (secret-path-classifier.js) now names them, and every
 * reader that consults it withholds them: the organ's search walk, the
 * sandbox's read judgement, and the coding shell's mask sweep.
 *
 * REAL native filesystem organ, REAL sandbox, REAL files on a temp home. The
 * planted content is a marker built here, never a credential. No mock
 * (AGENTS.md RULE 0).
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
import { enumerateSecretMasks } from '../../backend/services/witness-coding-sandbox.js';
import { isSecretFile } from '../../backend/services/secret-path-classifier.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const MARKER = ['PLANTED', 'MARKER', String(process.pid)].join('_');
const BEING = 'secretsearchwall';

// Each where its tool keeps it.
const SECRETS = Object.freeze([
  '.claude/.credentials.json', '.config/gh/hosts.yml', '.docker/config.json', 'proj/keypair.json',
  'proj/deploy-keypair.json', '.bash_history', '.zsh_history', '.local/share/fish/fish_history',
  '.python_history', '.netrc', '.pgpass', '.npmrc', '.ssh/id_rsa', 'proj/id_ed25519', 'proj/id_ecdsa_sk',
  'certs/server.pem', '.kube/config', '.vault-token', '.config/rclone/rclone.conf',
  '.local/share/keyrings/login.keyring', '.mozilla/firefox/abc.default/logins.json',
  '.mozilla/firefox/abc.default/key4.db', 'proj/mnemonic.txt',
]);
// Ordinary neighbours whose names come close.
const ORDINARY = Object.freeze([
  'proj/keypair.js', 'proj/chat_history.json', 'proj/history.md', 'proj/hosts.yml', 'proj/config.json',
  'proj/docker/config.json', 'proj/credential-guide.md', 'proj/kube-config.md', 'proj/logins.json',
]);

describe('the operator\'s tool credentials are withheld from search, read and the coding shell', () => {
  let home;
  const prior = {};

  beforeAll(async () => {
    const tmp = await createTempDir('secret-search-wall');
    home = path.join(tmp, 'home');
    prior.WORKSPACES_ROOT = process.env.WORKSPACES_ROOT;
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = path.join(tmp, 'house');
    await workspace.create(BEING);
    for (const rel of [...SECRETS, ...ORDINARY]) {
      await fs.mkdir(path.dirname(path.join(home, rel)), { recursive: true });
      await fs.writeFile(path.join(home, rel), `${MARKER} ${rel}\n`);
    }
    await setNativeFilesystemRoots([path.join(tmp, 'house'), home]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    if (prior.WORKSPACES_ROOT === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = prior.WORKSPACES_ROOT;
  });

  const being = () => withFsRouting(createSandboxedCallTool(mcpService, {
    companion: { neumaId: BEING }, _writeOps: 0, _grantedReadRoots: [home], _grantedWriteRoots: [],
  }, workspace));

  test('a content search over the home names no secret and reads every ordinary neighbour', async () => {
    const result = await nativeFilesystemClient.callTool({
      name: 'search_content', arguments: { path: home, pattern: MARKER, excludePatterns: [], maxResults: 500 },
    });
    const text = result.content[0].text;
    for (const rel of SECRETS) expect(text, rel).not.toContain(` ${rel}`);
    for (const rel of ORDINARY) expect(text, rel).toContain(`${MARKER} ${rel}`);
    expect(text).toMatch(new RegExp(`\\[${SECRETS.length} path\\(s\\) withheld`));
  });

  test.each(SECRETS)('fs/read of ~/%s is refused', async (rel) => {
    await expect(being()('fs', 'read', { path: path.join(home, rel) })).rejects.toThrow(/denied/i);
  });

  test('fs/read of an ordinary neighbour still reads', async () => {
    const result = await being()('fs', 'read', { path: path.join(home, 'proj', 'config.json') });
    expect(JSON.stringify(result)).toContain(MARKER);
  });

  test('the coding shell masks every one of them, judged by its full path', async () => {
    const masks = await enumerateSecretMasks(home);
    const masked = new Set([...masks.files, ...masks.dirs]);
    const coveredBy = (rel) => [...masked].some((m) => path.join(home, rel) === m || path.join(home, rel).startsWith(`${m}/`));
    for (const rel of SECRETS) expect(coveredBy(rel), rel).toBe(true);
    for (const rel of ORDINARY) expect(coveredBy(rel), rel).toBe(false);
  });

  test('the classifier: a bare basename judges by name, a path also by its tail', () => {
    expect(isSecretFile('.credentials.json')).toBe(true);
    expect(isSecretFile('.zsh_history')).toBe(true);
    expect(isSecretFile('hosts.yml')).toBe(false);
    expect(isSecretFile('/home/op/.config/gh/hosts.yml')).toBe(true);
    expect(isSecretFile('C:\\Users\\op\\.docker\\config.json')).toBe(true);
    expect(isSecretFile('/srv/app/config.json')).toBe(false);
    expect(isSecretFile('backend/services/provider-credentials.js')).toBe(false);
  });
});
