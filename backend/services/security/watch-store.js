// Watch store — WHAT the CSO's watch covers: the production repos under
// standing scan, and the host expectations (which ports this machine is
// meant to listen on). The operator owns this list; the scheduler reads it
// every run.
//
// ONE WATCH PER HOUSE (Design note, 2026-10-16: each house's list lives in its own
// office, `<realm>/<wallet>/offices/security/security-watch.json`
// (house-office.js); the machine-wide list (data/settings/security-watch.json)
// moves once to the house that owns the seated CSO lane. Plain JSON, same
// posture as the sibling security stores. First load SEEDS the defaults (this repo, plus the unavis-site
// checkout — formerly kenorie — when one stands beside it) so a fresh install watches the house's own
// code from its first boot; the operator's later edits are the record and
// are never re-seeded over.
//
// Watched repos are scan TARGETS, read-only by law: nothing in the security
// lane ever writes inside them.

import fs from 'fs/promises';
import { join, dirname, resolve, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { legacyCsoPath } from './cso-designation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THIS_REPO = resolve(join(__dirname, '../../..'));

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

// impure — what a watched repo offers the scanners.
const describeRepo = async (path) => ({
  hasLockfile: await fs.access(join(path, 'package-lock.json')).then(() => true, () => false),
});

/**
 * @param {{ path: string|(() => string), seedRepos?: string[] }} opts
 */
export const createWatchStore = ({ path, seedRepos }) => {
  const target = () => (typeof path === 'function' ? path() : path);

  const serialize = createWriteChain();

  // impure — this repo plus (by default) the checkouts beside it: the
  // unavis-site web layer (a checkout still named kenorie counts too) and
  // evm-contracts, where every Ignis smart contract lives by platform
  // (the UNAVIS contracts moved there 2026-10-05).
  const defaultSeeds = async () => {
    if (Array.isArray(seedRepos)) return seedRepos;
    const stands = (dir) => fs.access(join(dir, '.git')).then(() => true, () => false);
    const seeds = [THIS_REPO];
    for (const group of [['unavis-site', 'kenorie'], ['evm-contracts']]) {
      for (const name of group) {
        const sibling = resolve(join(THIS_REPO, '..', name));
        if (await stands(sibling)) { seeds.push(sibling); break; }
      }
    }
    return seeds;
  };

  // impure — atomic tmp+rename with the 0600/0700 re-tighten.
  const save = async (watch) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
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
        repos.push({ id, path, addedAt: new Date().toISOString(), ...(await describeRepo(path)) });
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
     */
    addRepo(repoPath) {
      const path = typeof repoPath === 'string' ? repoPath.trim() : '';
      if (!path || !isAbsolute(path)) {
        return Promise.reject(new Error('a watched repo needs an absolute path'));
      }
      return serialize(async () => {
        const stat = await fs.stat(path).catch(() => null);
        if (!stat?.isDirectory()) throw new Error('no such directory');
        const isGit = await fs.access(join(path, '.git')).then(() => true, () => false);
        if (!isGit) throw new Error('not a git checkout — the sweep reads tracked files');
        const watch = await load();
        if (watch.repos.some((r) => r.path === path)) return { ok: false, error: 'already watched', watch };
        const id = repoIdFor(path, new Set(watch.repos.map((r) => r.id)));
        watch.repos.push({ id, path, addedAt: new Date().toISOString(), ...(await describeRepo(path)) });
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
