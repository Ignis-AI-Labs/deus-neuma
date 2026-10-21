// Watch store — WHAT the CSO's watch covers: the production repos under
// standing scan, and the host expectations (which ports this machine is
// meant to listen on). The operator owns this list; the scheduler reads it
// every run.
//
// ONE WATCH PER HOUSE (ruling, 2026-10-16): each house's list lives in its own
// office, `<realm>/<wallet>/offices/security/security-watch.json`
// (house-office.js); the machine-wide list (data/settings/security-watch.json)
// moves once to the house that owns the seated CSO lane. Plain JSON, same
// posture as the sibling security stores. First load SEEDS one entry: the
// running app itself (`app: true` — the dev checkout it runs from, or an
// installed app's own shipped inventory, app-inventory.js), so a fresh install
// watches the code it actually runs from its first boot. Other repos are the
// operator's to add; a product default never names one developer's
// checkouts. The operator's later edits are the record and are never
// re-seeded over, and code never rewrites a list that exists.
//
// Watched repos are scan TARGETS, read-only by law: nothing in the security
// lane ever writes inside them.

import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { join, dirname, basename, isAbsolute } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { legacyCsoPath } from './cso-designation.js';
import { APP_ROOT, currentLayout, lockfileTarget, isPackagedLayout } from './app-inventory.js';
import { readInstallOwner, standingIn } from '../install-owner.js';

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'security-watch.json');

// The pre-2026-10-16 machine list, read per call so tests never touch the
// operator's live one.
const legacyWatchPath = () =>
  process.env.NEUMA_SECURITY_WATCH_PATH || DEFAULT_LEGACY_PATH;

// The ports this house is meant to listen on: backend, Vite dev. Anything
// ELSE answering on this machine is a finding until the operator names it.
const DEFAULT_EXPECTED_PORTS = Object.freeze([3333, 7777]);

// impure — a repo id is its directory name, made unique if it collides.
const repoIdFor = (path, taken) => {
  const base = basename(path) || 'repo';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};

// impure — what a watched repo offers the scanners (for the app itself, the
// lockfile it ships, wherever this layout keeps it).
const describeRepo = async (repo) => ({
  hasLockfile: await fs.access(lockfileTarget(repo, currentLayout()).lockfile).then(() => true, () => false),
});

// impure — may this house's fresh watch hold the running app? An installed
// app is everyone's (its shipped inventory; no git tree is swept). A dev
// checkout is the install owner's working tree, and its leak findings are
// theirs: a guest house's watch starts empty there.
const appSeedFor = async (wallet) => {
  if (!wallet || isPackagedLayout(currentLayout())) return true;
  return standingIn(await readInstallOwner(), wallet) !== 'guest';
};

/**
 * @param {{ path: string|(() => string), seedRepos?: string[], wallet?: string }} opts
 *   wallet — the house this watch belongs to (decides the default seed)
 */
export const createWatchStore = ({ path, seedRepos, wallet }) => {
  const target = () => (typeof path === 'function' ? path() : path);

  const serialize = createWriteChain();

  const defaultSeeds = async () => {
    if (Array.isArray(seedRepos)) return seedRepos;
    return (await appSeedFor(wallet)) ? [APP_ROOT] : [];
  };

  // impure — atomic tmp+rename with the 0600/0700 re-tighten.
  const save = async (watch) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    // A tmp name of its own per write: a house's first open reads the watch
    // twice at once (posture + watch), and both seed it — one shared tmp name
    // lost the second rename and hid the whole ledger.
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(watch, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  // impure — missing file = seed and persist the defaults; a corrupt file
  // THROWS (an unwatched house must never read as an operator's choice).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const repos = [];
      const taken = new Set();
      for (const path of await defaultSeeds()) {
        const id = repoIdFor(path, taken);
        taken.add(id);
        const repo = { id, path, ...(path === APP_ROOT ? { app: true } : {}) };
        repos.push({ ...repo, addedAt: new Date().toISOString(), ...(await describeRepo(repo)) });
      }
      const watch = { repos, host: { expectedPorts: [...DEFAULT_EXPECTED_PORTS] } };
      await save(watch);
      return watch;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.repos)) {
      throw new Error('watch-store: store is not a watch document');
    }
    return parsed;
  };

  return {
    load,

    /**
     * Put a repo under the standing watch. impure.
     * @param {string} repoPath absolute path to a git checkout
     * @param {{mayWatch?: (path: string) => boolean}} [opts] - the caller's
     *   reach; a path it refuses is answered OUTSIDE_HOUSE and never stored
     */
    addRepo(repoPath, { mayWatch = null } = {}) {
      const path = typeof repoPath === 'string' ? repoPath.trim() : '';
      if (!path || !isAbsolute(path)) {
        return Promise.reject(new Error('a watched repo needs an absolute path'));
      }
      return serialize(async () => {
        const stat = await fs.stat(path).catch(() => null);
        if (!stat?.isDirectory()) throw new Error('no such directory');
        // The caller's reach judges the path once it stands, before anything
        // is stored: a watched repo's findings land in the watcher's ledger.
        if (mayWatch && !mayWatch(path)) {
          return { ok: false, code: 'OUTSIDE_HOUSE', error: "That checkout is outside your house. This computer's other folders belong to its owner." };
        }
        const isGit = await fs.access(join(path, '.git')).then(() => true, () => false);
        if (!isGit) throw new Error('not a git checkout — the sweep reads tracked files');
        const watch = await load();
        if (watch.repos.some((r) => r.path === path)) return { ok: false, error: 'already watched', watch };
        const id = repoIdFor(path, new Set(watch.repos.map((r) => r.id)));
        watch.repos.push({ id, path, addedAt: new Date().toISOString(), ...(await describeRepo({ path })) });
        await save(watch);
        return { ok: true, repo: watch.repos[watch.repos.length - 1], watch };
      });
    },

    /** Remove a repo from the watch by id. impure. */
    removeRepo(id) {
      return serialize(async () => {
        const watch = await load();
        const before = watch.repos.length;
        watch.repos = watch.repos.filter((r) => r.id !== id);
        if (watch.repos.length === before) return { ok: false, error: 'no such watched repo', watch };
        await save(watch);
        return { ok: true, watch };
      });
    },

    /**
     * Set the host's expected listening ports (the allowlist the host probe
     * judges drift against). impure.
     * @param {number[]} ports
     */
    setExpectedPorts(ports) {
      if (!Array.isArray(ports) || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
        return Promise.reject(new Error('expectedPorts must be port numbers'));
      }
      return serialize(async () => {
        const watch = await load();
        watch.host = { ...(watch.host || {}), expectedPorts: [...new Set(ports)].sort((a, b) => a - b) };
        await save(watch);
        return watch.host;
      });
    },
  };
};

// A house's own watch list — the routes, the scheduler, the briefing and the
// legal watch all open it for the house in question. impure.
export const watchStoreFor = createHouseStore({
  office: 'security',
  name: 'security-watch.json',
  legacyPath: legacyWatchPath,
  legacySeatPath: legacyCsoPath,
  create: createWatchStore,
});
