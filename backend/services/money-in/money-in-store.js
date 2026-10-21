// The money-in store — one per HOUSE, keyed by the operator's wallet (the
// house is the operator's wallet and the beings it owns), under that
// wallet's realm directory:
//
//   <realm>/<wallet>/money-in/receipts.jsonl      append-only, one receipt per line
//   <realm>/<wallet>/money-in/attributions.jsonl  append-only; the latest line per key wins
//   <realm>/<wallet>/money-in/state.json          scan cursors, native checkpoints, gaps
//   <realm>/<wallet>/money-in/extras.json         operator-declared receive addresses
//
// The receipts file is never rewritten: an attribution is a second
// append-only record joined at read time, so […] can
// change without a single receipt byte changing under it.
//
// Every write for one house runs under one per-house lock, so a scan-now and
// the 10-minute loop can never interleave a dedupe check with an append.
//
// impure (fs). Isolation: the realm root (setRealmRoot / NEUMA_REALM_ROOT).

import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from '../user-realm.js';
import { freshRows } from './receipt-rows.js';

/** Gaps kept on the state file — the newest win; older ones were already on view. */
const GAPS_KEPT = 200;

const dirOf = (house) => path.join(walletDir(house), 'money-in');
const fileOf = (house, name) => path.join(dirOf(house), name);

const locks = new Map();

/**
 * Run `operation` under the house's lock. impure.
 * @template T
 * @param {string} house
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export const withHouseLock = async (house, operation) => {
  const id = String(house).toLowerCase();
  const prior = locks.get(id) || Promise.resolve();
  const current = prior.catch(() => {}).then(operation);
  locks.set(id, current);
  try {
    return await current;
  } finally {
    if (locks.get(id) === current) locks.delete(id);
  }
};

// A JSON-lines file as parsed records; absence is the empty ledger, and a
// torn LAST line (a crash mid-append) is dropped, never a thrown read.
const readLines = async (file) => {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const lines = text.split('\n').filter(Boolean);
  const out = [];
  lines.forEach((line, i) => {
    try {
      out.push(JSON.parse(line));
    } catch (error) {
      if (i !== lines.length - 1) throw new Error(`money-in ledger line ${i + 1} is corrupt: ${error.message}`, { cause: error });
    }
  });
  return out;
};

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
};

/**
 * Every receipt, attributions joined (latest per key wins). impure.
 * @param {string} house
 * @returns {Promise<object[]>}
 */
export const readReceipts = async (house) => {
  const [rows, attributions] = await Promise.all([
    readLines(fileOf(house, 'receipts.jsonl')),
    readLines(fileOf(house, 'attributions.jsonl')),
  ]);
  const latest = new Map(attributions.map((a) => [a.key, a]));
  return rows.map((row) => (latest.has(row.key)
    ? { ...row, attribution: latest.get(row.key).attribution, attributedBy: latest.get(row.key).by, attributedAt: latest.get(row.key).at }
    : row));
};

/**
 * Append the rows the ledger does not hold yet. Call inside withHouseLock.
 * impure.
 * @param {string} house
 * @param {object[]} rows
 * @returns {Promise<object[]>} the rows actually appended
 */
export const appendReceipts = async (house, rows) => {
  const known = new Set((await readLines(fileOf(house, 'receipts.jsonl'))).map((r) => r.key));
  const fresh = freshRows(known, rows);
  if (fresh.length === 0) return [];
  await fs.mkdir(dirOf(house), { recursive: true });
  await fs.appendFile(fileOf(house, 'receipts.jsonl'), fresh.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return fresh;
};

/**
 * Record an attribution for one receipt (null clears it). impure.
 * @returns {Promise<boolean>} false when no receipt carries that key
 */
export const appendAttribution = (house, { key, attribution, by, at }) => withHouseLock(house, async () => {
  const rows = await readLines(fileOf(house, 'receipts.jsonl'));
  if (!rows.some((r) => r.key === key)) return false;
  await fs.mkdir(dirOf(house), { recursive: true });
  await fs.appendFile(fileOf(house, 'attributions.jsonl'), `${JSON.stringify({ key, attribution, by, at })}\n`);
  return true;
});

/** The scan state (cursors, native checkpoints, gaps) — fresh objects every
 *  read, so a scan mutating its copy can never touch another house's. impure. */
export const readScanState = async (house) => {
  const saved = await readJson(fileOf(house, 'state.json'), {});
  return {
    networks: { ...(saved.networks || {}) },
    native: { ...(saved.native || {}) },
    gaps: [...(saved.gaps || [])],
    lastScan: saved.lastScan ?? null,
  };
};

/** Persist the scan state, keeping the newest gaps. Call inside withHouseLock. impure. */
export const writeScanState = (house, state) =>
  writeJsonAtomic(fileOf(house, 'state.json'), { ...state, gaps: (state.gaps || []).slice(-GAPS_KEPT) });

/** The operator's declared receive addresses. impure. */
export const readExtras = async (house) => readJson(fileOf(house, 'extras.json'), []);

/**
 * Declare (or relabel) an extra receive address. impure.
 * @param {string} house
 * @param {{ address: string, label: string, member: string|null, by: string, at: string }} extra
 */
export const putExtra = (house, extra) => withHouseLock(house, async () => {
  const list = (await readExtras(house)).filter((e) => e.address.toLowerCase() !== extra.address.toLowerCase());
  const next = [...list, extra];
  await writeJsonAtomic(fileOf(house, 'extras.json'), next);
  return next;
});

/** Remove an extra receive address; its past receipts stay in the ledger. impure. */
export const deleteExtra = (house, address) => withHouseLock(house, async () => {
  const list = await readExtras(house);
  const next = list.filter((e) => e.address.toLowerCase() !== String(address).toLowerCase());
  if (next.length === list.length) return null;
  await writeJsonAtomic(fileOf(house, 'extras.json'), next);
  return next;
});
