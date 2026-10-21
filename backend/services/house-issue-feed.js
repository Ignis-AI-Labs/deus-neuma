// THE FAILURES FEED, PER HOUSE — what one operator may read of the process's
// recent warnings and errors.
//
// The logger keeps one ring for the whole process (logger.js), and its rows
// carry whatever the caller logged: wallets, lane ids, paths. Two houses run
// on this machine, and houses are never confused (ruling, 2026-10-16), so a row
// that names another house — its wallet, or a lane that is not the reader's —
// is withheld and only counted. A row that names no house is the machine's
// own (the model server, the GPU) and every reader sees it. The install owner
// reads the whole feed, every house's rows (ruling, 2026-10-19). Every row that is
// shown passes through the journal's secret scrub (audit-redact.js).

import { redactArgs } from './audit-redact.js';
import { houseWallet } from './house-served.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

const WALLET_TEXT = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
const LANE_KEYS = new Set(['neumaId', 'laneId', 'companionId', 'memberId', 'lane']);
const LANE_ID = /^[a-zA-Z0-9_-]+$/;
const MAX_DEPTH = 4;

// pure — every wallet and lane id a value names, walked to a bounded depth
const collectMarks = (value, key, depth, marks) => {
  if (typeof value === 'string') {
    for (const w of value.match(WALLET_TEXT) || []) marks.wallets.add(w.toLowerCase());
    if (LANE_KEYS.has(key) && LANE_ID.test(value)) marks.lanes.add(value);
    return marks;
  }
  if (!value || typeof value !== 'object' || depth >= MAX_DEPTH) return marks;
  for (const [k, v] of Object.entries(value)) collectMarks(v, Array.isArray(value) ? key : k, depth + 1, marks);
  return marks;
};

/**
 * The wallets and lanes one ring entry names, in its message or its data. pure.
 * @param {{msg?: string, data?: object|null}} entry
 * @returns {{wallets: string[], lanes: string[]}}
 */
const houseMarksOf = (entry) => {
  const marks = collectMarks({ msg: entry?.msg, data: entry?.data }, '', 0, { wallets: new Set(), lanes: new Set() });
  return { wallets: [...marks.wallets], lanes: [...marks.lanes] };
};

// pure — the shown form of a row: the scrubbed message and data, never the raw ones
const shownRow = (entry) => {
  let safe;
  try { safe = JSON.parse(redactArgs({ msg: entry.msg, data: entry.data }) || '{}'); } catch { safe = { msg: '[unavailable]', data: null }; }
  return Object.freeze({ ts: entry.ts, level: entry.level, context: entry.context, msg: safe.msg ?? '', data: safe.data ?? null });
};

/**
 * The whole feed, as the install owner reads it: no row withheld, each still
 * scrubbed of secrets. Pure.
 * @param {ReadonlyArray<object>} entries
 * @returns {{rows: ReadonlyArray<object>, withheld: number}}
 */
export const issuesForOwner = (entries) => ({ rows: Object.freeze((entries || []).map(shownRow)), withheld: 0 });

/**
 * The rows of the failures feed this wallet may read, and how many were
 * withheld as another house's. A lane whose owner cannot be read is not
 * provably the reader's, so it is withheld. impure (reads owner.json).
 * @param {ReadonlyArray<{ts: string, level: string, context: string, msg: string, data: object|null}>} entries
 * @param {string} wallet - the reader
 * @returns {Promise<{rows: ReadonlyArray<object>, withheld: number}>}
 */
export const issuesForHouse = async (entries, wallet) => {
  const reader = houseWallet(wallet);
  const owners = new Map();
  const ownerOf = async (laneId) => {
    if (!owners.has(laneId)) {
      owners.set(laneId, houseWallet((await neumaWorkspace.readOwner(laneId).catch(() => null))?.wallet));
    }
    return owners.get(laneId);
  };
  const rows = [];
  let withheld = 0;
  for (const entry of entries || []) {
    const { wallets, lanes } = houseMarksOf(entry);
    const laneOwners = await Promise.all(lanes.map(ownerOf));
    const theirs = wallets.some((w) => w !== reader) || laneOwners.some((o) => !o || o !== reader);
    if (theirs) withheld += 1;
    else rows.push(shownRow(entry));
  }
  return { rows: Object.freeze(rows), withheld };
};
