/**
 * Secret inodes — a secret judged by WHAT it is, not by what it is called.
 *
 * Every wall a being meets judges a secret by its name or its path:
 * `.env`, `keys/`, `~/.claude/.credentials.json`. A hard link made outside the
 * being gives the same bytes a second, innocent name (`notes.txt`, same
 * inode as `.env`), and every name law reads it as an ordinary file (the
 * residual recorded by the 2026-10-20 re-check). This module is the identity
 * law: the (dev, ino) of every KNOWN secret file on this machine, and the one
 * question every reader asks — is this file one of them?
 *
 * The question costs one stat per read and fires only when the file has more
 * than one link: a file with a single link is itself, and the name and path
 * laws already judged it. The set is built lazily (only when a multi-link
 * file is met) and kept for a few seconds — but a miss is re-checked against
 * a set built then and there (see isSecretInode), so a secret made a moment
 * ago is never read through a twin because the set was older.
 *
 * A ROTATED secret (written to a new file and renamed over the old name) has a
 * new inode; the old twin then holds the OLD bytes under a name no law knows,
 * with one link left, and is ordinary again: a stale copy of a value the
 * rotation revoked, readable by a being (the commit secret gate still scans
 * it if it is ever staged). That is the residual, stated plainly. A secret
 * rewritten in place keeps its inode, and its twin stays refused.
 *
 * Known secrets: env-style and classifier-named files at the install root,
 * its top-level directories, HOME, and every folder a secret may stand in
 * that a being or the Explorer can reach — the organ's roots, the Explorer's
 * opened folders, every live connection's focus ground, every granted read
 * or write root (one readdir each, plus every file of a keys/ folder there);
 * every secret-shaped file git ignores anywhere under the install root and
 * each of those roots that is a checkout (checkout-secret-files.js: listed
 * once, then re-listed in the background, so a read never waits on git);
 * the machine's secret stores (~/.neuma/secrets.json, NEUMA_SECRETS_FILE);
 * every lane's owner.json and every file under its keys/, vault/ and dna/
 * in the three lane grounds, and under the data root's dna/, dna-cache/ and
 * memory-store/; and the credential files tools keep at fixed places under
 * HOME. The first build lists each checkout synchronously (~1.2s on this
 * one), once per process and root.
 *
 * Readers: the sandbox's path check (sandbox-path-policy.js); the organ's
 * search walks and directory copy (native-filesystem.js: a copy drops a twin
 * rather than mint it a fresh inode); the coding shell's mask sweep
 * (witness-coding-sandbox.js, which also masks every other name of a linked
 * secret, node_modules included — secret-twin-finder.js); the operator
 * Explorer's walls (explorer-walls.js), so a twin is served to no wallet;
 * and the CSO house probe, which raises a linked secret as a finding.
 *
 * impure — stat and readdir; never throws. A source that cannot be read is
 * skipped (absent sources silently; any other failure is logged once), so a
 * missing store can never take the read path down — it only guards less.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllowedDirectories } from '@modelcontextprotocol/server-filesystem/dist/lib.js';
import { createLogger } from './logger.js';
import { getDataRoot } from './data-root.js';
import { getRoots as explorerRoots } from './user-files.js';
import { filesystemFocusRoots } from './filesystem-focus-owners.js';
import { filesystemGrantedRoots } from './filesystem-granted-roots.js';
import { checkoutSecretFiles, secretListingVersion } from './checkout-secret-files.js';
import { isEnvFileName } from './security/secret-gate.js';
import { isSecretFile } from './secret-path-classifier.js';
import { getWorkspacesRoot, getWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../core/workspace/lane-grounds.js';

const log = createLogger('SecretInodes');

export const SECRET_INODE_TTL_MS = 3000;
// A miss on an inode untouched since the set was built re-checks against a
// fresh set at most this often: a walk over a hard-linked dependency tree
// (uv, pnpm) meets thousands of multi-link files, none of them secrets.
const MISS_REBUILD_FLOOR_MS = 25;
// The kernel stamps ctime from a coarse clock; a link made just after a build
// began can carry a ctime a few ms before it.
const CTIME_SLACK_MS = 50;

// Resolved from this file, never cwd — the same anchor sandbox-path-policy.js uses.
const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Credentials the classifier names by path tail, where their tools keep them.
const HOME_FILES = Object.freeze([
  '.claude/.credentials.json', '.config/gh/hosts.yml', '.docker/config.json', '.kube/config',
  '.config/hub', '.aws/credentials', '.config/rclone/rclone.conf', '.local/share/fish/fish_history',
  '.config/gcloud/application_default_credentials.json',
]);
// Folders whose every file is key material, whatever it is named (a deploy
// key in ~/.ssh need not be called id_*).
const HOME_KEY_DIRS = Object.freeze(['.ssh', '.gnupg/private-keys-v1.d', '.local/share/keyrings']);
// Mail and browser profiles: the classifier knows which files in a profile are secrets.
const HOME_PROFILE_DIRS = Object.freeze(['.mozilla/firefox', '.thunderbird']);

// A lane's sovereign state: its key material, its sealed vault, its DNA and
// its owner record — and the install data root's own copies of them. Walked
// whole: these trees are small.
const LANE_TREES = Object.freeze(['keys', 'vault', 'dna']);
const DATA_TREES = Object.freeze(['dna', 'dna-cache', 'memory-store']);

const GONE = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);
const warned = new Set();

// impure (log) — a source that exists but cannot be read guards nothing; say so once.
const skipped = (where, error) => {
  if (GONE.has(error.code) || warned.has(where)) return;
  warned.add(where);
  log.warn('secret source skipped — cannot stat or list it', { where, code: error.code || error.message });
};

// impure — a followed stat (a symlinked secret is its target), or null.
const statOf = (filePath) => {
  try {
    return fs.statSync(filePath, { bigint: true, throwIfNoEntry: false }) || null;
  } catch (error) {
    skipped(filePath, error);
    return null;
  }
};

// impure — one level of a directory: its non-directory entries, or its subdirectories.
const entriesOf = (dir, wantDirs) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() === wantDirs)
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    skipped(dir, error);
    return [];
  }
};
const filesIn = (dir) => entriesOf(dir, false);
const dirsIn = (dir) => entriesOf(dir, true);
// impure — every file below a directory. A symlinked directory is not a
// Dirent directory, so the walk never loops.
const filesUnder = (dir) => [...filesIn(dir), ...dirsIn(dir).flatMap(filesUnder)];

// pure
const isNamedSecret = (filePath) => isEnvFileName(path.basename(filePath)) || isSecretFile(filePath);
const inodeKey = (stat) => `${stat.dev}:${stat.ino}`;

// impure (env, module state) — where secrets stand right now; also the cache key.
const currentRoots = () => {
  const house = getWorkspacesRoot();
  const home = os.homedir();
  return {
    home,
    // Every folder a secret may stand in that a being or the Explorer can
    // reach: the organ's roots, the Explorer's opened folders, every live
    // connection's focus ground, and every granted read or write root.
    allowed: [...new Set([
      ...getAllowedDirectories(), ...explorerRoots(), ...filesystemFocusRoots(), ...filesystemGrantedRoots,
    ])].sort(),
    data: path.resolve(getDataRoot()),
    grounds: [house, getWitnessesRoot(), getHarnessRoot(house)].map((g) => path.resolve(g)),
    stores: [path.join(home, '.neuma', 'secrets.json'), process.env.NEUMA_SECRETS_FILE].filter(Boolean),
  };
};

// impure (readdir, git) — every path that names a known secret, given the roots.
const secretPathsFor = ({ home, allowed, data, grounds, stores }) => [
  ...stores,
  ...HOME_FILES.map((rel) => path.join(home, rel)),
  ...HOME_KEY_DIRS.flatMap((rel) => filesIn(path.join(home, rel))),
  ...HOME_PROFILE_DIRS.flatMap((rel) => dirsIn(path.join(home, rel))).flatMap(filesIn).filter(isSecretFile),
  ...[home, INSTALL_ROOT, ...dirsIn(INSTALL_ROOT), ...allowed].flatMap(filesIn).filter(isNamedSecret),
  ...allowed.flatMap((root) => filesUnder(path.join(root, 'keys'))),
  ...checkoutSecretFiles([INSTALL_ROOT, ...allowed]).paths,
  ...grounds.flatMap(dirsIn).flatMap((lane) => [
    path.join(lane, 'owner.json'), ...LANE_TREES.flatMap((tree) => filesUnder(path.join(lane, tree))),
  ]),
  ...DATA_TREES.flatMap((tree) => filesUnder(path.join(data, tree))),
];

let cached = { signature: null, version: -1, startedAt: 0, keys: new Set(), linked: [] };

// impure — the known secrets' inodes, rebuilt when the roots move, a
// checkout's secret listing changed, or the build is older than maxAgeMs.
// `linked` names every known secret with more than one link — each is a
// twin somewhere.
const loadSecretInodes = (maxAgeMs = SECRET_INODE_TTL_MS) => {
  const roots = currentRoots();
  const signature = JSON.stringify(roots);
  if (cached.signature === signature && cached.version === secretListingVersion()
    && Date.now() - cached.startedAt < maxAgeMs) return cached;
  const startedAt = Date.now();
  const keys = new Set();
  const linked = [];
  for (const filePath of new Set(secretPathsFor(roots))) {
    const stat = statOf(filePath);
    if (!stat?.isFile()) continue;
    keys.add(inodeKey(stat));
    if (stat.nlink > 1n) linked.push({ path: filePath, dev: String(stat.dev), ino: String(stat.ino), nlink: Number(stat.nlink) });
  }
  cached = { signature, version: secretListingVersion(), startedAt, keys, linked };
  return cached;
};

/**
 * Is this stat a second name for a known secret? Only a multi-link regular
 * file is ever looked up. A MISS is never trusted to an old set: it is
 * re-checked against one built now (git listings excepted — they refresh
 * in the background) whenever the inode changed after the set was begun (a
 * new link or a write moves ctime), and otherwise at most every
 * MISS_REBUILD_FLOOR_MS. impure (may build the set).
 * @param {fs.Stats|fs.BigIntStats|null|undefined} stat - a FOLLOWED stat
 * @returns {boolean}
 */
export const isSecretInode = (stat) => {
  if (!stat?.isFile() || Number(stat.nlink) <= 1) return false;
  const key = inodeKey(stat);
  const set = loadSecretInodes();
  if (set.keys.has(key)) return true;
  const changedSince = Number(stat.ctimeMs) >= set.startedAt - CTIME_SLACK_MS;
  if (!changedSince && Date.now() - set.startedAt < MISS_REBUILD_FLOOR_MS) return false;
  return loadSecretInodes(0).keys.has(key);
};

/**
 * The refusal for a path whose file is a hard link to a known secret, else
 * null. One stat (symlinks followed, so a link to a twin is judged as the
 * twin); a path that does not exist is never a twin. impure.
 * @param {string} filePath
 * @returns {string|null}
 */
export const secretLinkReason = (filePath) => (isSecretInode(statOf(path.resolve(String(filePath))))
  ? 'Access denied: this file is another name (a hard link) for a secret file'
  : null);

/**
 * Every known secret that has more than one link right now, asked fresh.
 * Nothing the platform makes links a secret twice, so each is a sign of
 * staging: the coding shell masks every other name (secret-twin-finder.js)
 * and the house probe raises it. impure.
 * @returns {Array<{path: string, dev: string, ino: string, nlink: number}>}
 */
export const linkedSecrets = () => loadSecretInodes(0).linked;
