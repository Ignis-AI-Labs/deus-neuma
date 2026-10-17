// THE LEGACY OFFICE MOVE — a machine-wide office record goes home to its
// house, once.
//
// Until 2026-10-16 the CSO, CLO and CMO seats and every office's data (the
// threat ledger, the matters, the campaigns, the leads…) were ONE record per
// machine under data/settings. Two houses run on this machine now, and Founder's
// ruling the same day: […] Each record therefore belongs to exactly
// one house, decided at the move:
//
//   - the house whose wallet owns the office's seated lane (its owner.json);
//   - with no seat at all, the machine's original single operator: the one
//     wallet that owns every lane under the persisted workspace root (the
//     settings-pinned desk's root, where these records were written);
//   - a seat whose owner cannot be resolved, or a root naming more than one
//     owner, serves NO house — never a guess, never a cross-house fallback.
//     It is said loudly and the legacy file is left untouched.
//
// The move copies the record into the house and rewrites the legacy file as
// a tombstone naming where it went, so it happens once and is never in two
// houses. A house that already holds its own record is never overwritten.
//
// impure — data/settings and realm disk, behind the legacy file's lock.

import fs from 'fs/promises';
import path from 'path';
import { getRealmRoot, writeJsonAtomic } from './user-realm.js';
import { isTempPath, loadWorkspaceSettings } from './workspace-settings.js';
import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { withFileLock } from './file-lock.js';
import { houseKey } from './staff/cos-designation.js';
import { createLogger } from './logger.js';

const log = createLogger('HouseOffice.Legacy');

const LANE_ID = /^[a-zA-Z0-9_-]+$/;

// The read of a file that does not exist — distinct from a stored null.
export const ABSENT = Symbol('absent');

/** Is this document a tombstone the move left behind? Pure. */
export const isTombstone = (doc) =>
  Boolean(doc && typeof doc === 'object' && !Array.isArray(doc) && houseKey(doc.migratedTo));

/** The one wallet a set of owner records names, or null for none or many. Pure. */
export const soleOwner = (wallets) => {
  const houses = new Set(wallets.map(houseKey).filter(Boolean));
  return houses.size === 1 ? [...houses][0] : null;
};

// impure — a JSON document, ABSENT when missing; a corrupt file throws.
export const readJson = async (file) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return ABSENT;
    throw err;
  }
  return JSON.parse(raw);
};

// impure — atomic write, re-tightened to the operator alone (0600 file, 0700 dir).
export const writePrivate = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(file, value);
  await fs.chmod(path.dirname(file), 0o700);
  await fs.chmod(file, 0o600);
};

// Each unresolved record is said loudly once per process, not per read.
const warned = new Set();
const loud = (key, message, data) => {
  if (warned.has(key)) return;
  warned.add(key);
  log.error(message, data);
};

// impure — the root the machine-wide records were written under: the
// persisted (settings-pinned) workspace root, else this process's own.
const originalRoot = async () => (await loadWorkspaceSettings()).root || getWorkspacesRoot();

// impure — the house a lane under `root` belongs to, or null.
const laneOwnerIn = async (root, laneId) => {
  if (typeof laneId !== 'string' || !LANE_ID.test(laneId)) return null;
  const owner = await readJson(path.join(root, laneId, 'owner.json')).catch(() => null);
  return owner && owner !== ABSENT ? houseKey(owner.wallet) : null;
};

// impure — the machine's original single operator: the sole owner of the lanes
// under `root`, or null when the lanes name none or more than one.
const originalOperator = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const wallets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const owner = await readJson(path.join(root, entry.name, 'owner.json')).catch(() => null);
    if (owner && owner !== ABSENT && owner.wallet) wallets.push(owner.wallet);
  }
  return soleOwner(wallets);
};

/**
 * The house a machine-wide office record belongs to, from the office's
 * legacy seat (ABSENT, null, a seat, or a seat tombstone). impure.
 * @param {*} seat
 * @returns {Promise<string|null>} the house wallet, or null: serves no house
 */
export const legacyHouseOf = async (seat) => {
  if (isTombstone(seat)) return houseKey(seat.migratedTo);
  const root = await originalRoot();
  if (seat && seat !== ABSENT && typeof seat === 'object' && seat.laneId) {
    return laneOwnerIn(root, seat.laneId);
  }
  return originalOperator(root);
};

// A temp legacy file never moves into a live realm, and a live one never
// into a temp realm: a test that pinned one and not the other would carry
// throwaway data into a house, or a house's real record into the trash. And
// a TEST process never moves a live record at all — a test that pinned
// neither would perform the operator's real migration from inside a test
// run, under a desk still running the old code.
export const sameWorld = (file) => isTempPath(file) === isTempPath(getRealmRoot())
  && !(process.env.NODE_ENV === 'test' && !isTempPath(file));

/**
 * Move one legacy office record to its house, once. impure.
 * @param {{legacyFile: string, seatFile?: string|null, destOf: (wallet: string) => string, label: string,
 *   tombstone?: (doc: *, house: string, at: string) => Object}} opts
 *   seatFile — the office's legacy seat, which decides the house; destOf —
 *   the record's path in a house; tombstone — what the legacy file becomes.
 * @returns {Promise<'absent'|'moved'|'conflict'|'unresolved'>}
 */
export const moveLegacyRecord = async ({ legacyFile, seatFile = null, destOf, label, tombstone }) => {
  const peek = await readJson(legacyFile).catch(() => null);
  if (peek === ABSENT) return 'absent';
  if (isTombstone(peek)) return 'moved';
  if (!sameWorld(legacyFile)) {
    loud(`world:${legacyFile}`, 'refusing to move a legacy office record across a temp/live boundary — it serves no house', { label, legacyFile, realm: getRealmRoot() });
    return 'unresolved';
  }
  return withFileLock(`${legacyFile}.lock`, async () => {
    let doc;
    try {
      doc = await readJson(legacyFile);
    } catch (err) {
      loud(`corrupt:${legacyFile}`, 'a legacy office record is unreadable — it serves no house until the operator repairs it', { label, legacyFile, error: err.message });
      return 'unresolved';
    }
    if (doc === ABSENT) return 'absent';
    if (isTombstone(doc)) return 'moved';
    const seat = seatFile ? await readJson(seatFile).catch(() => null) : ABSENT;
    const house = await legacyHouseOf(seat);
    if (!house) {
      loud(`owner:${legacyFile}`, 'a machine-wide office record has no resolvable house — it serves NO house; the operator must place it', { label, legacyFile, seatLane: seat?.laneId ?? null });
      return 'unresolved';
    }
    const dest = destOf(house);
    if ((await readJson(dest).catch(() => null)) !== ABSENT) {
      loud(`conflict:${legacyFile}`, 'the house already holds its own office record — the legacy one is left in place, unmerged', { label, house, legacyFile, dest });
      return 'conflict';
    }
    const at = new Date().toISOString();
    await writePrivate(dest, doc);
    await writePrivate(legacyFile, tombstone
      ? tombstone(doc, house, at)
      : { migratedTo: house, migratedAt: at, office: label });
    log.info('a machine-wide office record moved to its house', { label, house, dest });
    return 'moved';
  });
};
