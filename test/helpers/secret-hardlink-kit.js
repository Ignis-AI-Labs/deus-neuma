/**
 * A real house on temp disk for the hard-link law (secret-inodes.js): a fake
 * HOME, a lane ground, an operator project, a secret store — each holding a
 * planted secret whose content is a marker built at runtime (AGENTS.md Rule
 * 8: no secret value in any file). The REAL filesystem organ is registered
 * over these roots and a being reaches it through the REAL sandbox. Every
 * hard link is made inside one temp tree, so source and twin share a device.
 */
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { createTempDir } from './temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';

export const marker = (tag) => ['HARDLINK', tag, String(process.pid), randomBytes(6).toString('hex')].join('_');

const ENV_KEYS = ['HOME', 'WORKSPACES_ROOT', 'NEUMA_SECRETS_FILE', 'NEUMA_DATA_ROOT'];

// impure — write a file, making its parent first.
export const plant = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  return file;
};

// impure — a hard link at `to` for `from`, parent made first.
export const hardlink = async (from, to) => {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.link(from, to);
  return to;
};

/**
 * Stand the house up. Returns the roots, the planted secrets ({ file, mark }
 * by kind), a being call through the sandbox, and `restore`.
 * impure — env, module roots, temp disk, the organ registration.
 * @param {string} label
 * @param {string} being - lane id
 */
export const standHouse = async (label, being) => {
  const tmp = await createTempDir(label);
  const roots = {
    tmp,
    home: path.join(tmp, 'home'),
    house: path.join(tmp, 'house'),
    proj: path.join(tmp, 'proj'),
    stores: path.join(tmp, 'stores'),
    witnesses: path.join(tmp, 'witnesses'),
    data: path.join(tmp, 'data'),
  };
  const prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = roots.home;
  process.env.WORKSPACES_ROOT = roots.house;
  process.env.NEUMA_SECRETS_FILE = path.join(roots.stores, 'secrets.json');
  process.env.NEUMA_DATA_ROOT = roots.data;
  setWorkspacesRoot(null);
  setWitnessesRoot(roots.witnesses);
  setHarnessRoot(null);
  const lane = await workspace.create(being);

  // The project is a real checkout whose env files git ignores, as an
  // operator's repository's are — so a nested one is found only by git.
  await fs.mkdir(roots.proj, { recursive: true });
  execFileSync('git', ['init', '-q', roots.proj]);
  await fs.writeFile(path.join(roots.proj, '.gitignore'), '.env*\n');
  const other = path.join(roots.house, 'otherlane');
  const secrets = {};
  for (const [kind, file, shape] of [
    ['env', path.join(roots.proj, '.env'), (m) => `API_TOKEN=${m}\n`],
    ['keypair', path.join(other, 'keys', 'keypair.json'), (m) => `{"secretKey":"${m}"}\n`],
    ['dek', path.join(other, 'keys', 'dek.json'), (m) => `{"dek":"${m}"}\n`],
    ['credentials', path.join(roots.home, '.claude', '.credentials.json'), (m) => `{"accessToken":"${m}"}\n`],
    ['ghHosts', path.join(roots.home, '.config', 'gh', 'hosts.yml'), (m) => `github.com:\n  oauth_token: ${m}\n`],
    ['store', process.env.NEUMA_SECRETS_FILE, (m) => `{"authSecret":"${m}"}\n`],
    ['nestedEnv', path.join(roots.proj, 'sub', 'dir', '.env'), (m) => `NESTED_TOKEN=${m}\n`],
    ['vault', path.join(other, 'vault', 'notes', 'a', 'b', 'c', 'd', 'sealed.json'), (m) => `{"sealed":"${m}"}\n`],
    ['owner', path.join(other, 'owner.json'), (m) => `{"wallet":"${m}"}\n`],
    ['laneDna', path.join(other, 'dna', 'history', 'x', 'y', 'z', 'genesis.json'), (m) => `{"dna":"${m}"}\n`],
    ['dataDna', path.join(roots.data, 'dna', 'active.json'), (m) => `{"dna":"${m}"}\n`],
  ]) {
    const mark = marker(kind);
    secrets[kind] = { file: await plant(file, shape(mark)), mark };
  }

  await fs.mkdir(roots.witnesses, { recursive: true });
  await setNativeFilesystemRoots([roots.house, roots.home, roots.proj, roots.witnesses]);
  mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);

  const call = withFsRouting(createSandboxedCallTool(mcpService, {
    companion: { neumaId: being }, _writeOps: 0, _grantedReadRoots: [roots.home, roots.proj], _grantedWriteRoots: [],
  }, workspace));

  const restore = async () => {
    await mcpService.disconnect('filesystem');
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    setWitnessesRoot(null);
  };
  return { roots, lane, secrets, call, restore };
};

// pure — the text of a tool result, whatever its shape.
export const textOf = (result) => JSON.stringify(result);
