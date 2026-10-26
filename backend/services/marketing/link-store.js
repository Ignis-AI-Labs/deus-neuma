// link-store — a house's tracked-link map (campaign plan §4.1): every code
// it minted, the destination it leads to, and where it came from (the post,
// its campaign, angle, account, company). Append-only — a code is never
// reused or rewritten; only its publish state is recorded beside it. One
// house's map is its own: `<realm>/<wallet>/offices/marketing/link-codes.json`.
//
// The SITE sees only code + destination + company (link-codes.js
// publishBody); the rest of the record stays in the house.
//
// impure — disk.

import fs from 'fs/promises';
import { dirname } from 'path';
import { officeFile } from '../house-office.js';
import { withFileLock } from '../file-lock.js';
import { createWriteChain } from '../write-chain.js';

const FILE = 'link-codes.json';
const chain = createWriteChain();

/** The house's map file. */
export const linkStorePath = (wallet) => officeFile(wallet, 'marketing', FILE);

// impure — the map, [] when none.
const read = async (file) => {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('link-store: the map is not a list');
  return parsed;
};

// impure — atomic write, 0600 in a 0700 dir.
const write = async (file, list) => {
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
};

const change = (wallet, fn) => {
  const file = linkStorePath(wallet);
  return chain(() => withFileLock(`${file}.lock`, async () => {
    const list = await read(file);
    const next = fn(list);
    if (next !== list) await write(file, next);
    return next;
  }));
};

/** The house's whole map. impure. */
export const loadLinks = (wallet) => read(linkStorePath(wallet));

/**
 * Add codes to the map. A code already there is refused whole (codes are
 * never reused). impure.
 * @param {string} wallet
 * @param {Array<{code: string, destination: string, entryId?: string, campaignId?: ?string,
 *   angleId?: ?string, accountId?: string, channelId?: string, companyId?: ?string, createdAt: string}>} records
 */
export const appendLinks = (wallet, records) => change(wallet, (list) => {
  const taken = new Set(list.map((r) => r.code));
  const clash = records.find((r) => taken.has(r.code));
  if (clash) throw new Error(`the code ${clash.code} is already this house's`);
  return [...list, ...records.map((r) => ({ ...r, published: r.published ?? null }))];
});

/**
 * Record what the counter answered for each code (published / already /
 * conflict) — the only change a record ever sees. impure.
 * @param {string} wallet
 * @param {Array<{code: string, state: string}>} results
 * @param {string} at
 */
export const markPublished = (wallet, results, at) => change(wallet, (list) => {
  const states = new Map(results.map((r) => [r.code, r.state]));
  return list.map((r) => (states.has(r.code) ? { ...r, published: { state: states.get(r.code), at } } : r));
});

/** Tie minted codes to the post they were minted for, once it is staged. impure. */
export const bindLinks = (wallet, codes, entryId) => change(wallet, (list) => {
  const set = new Set(codes);
  return list.map((r) => (set.has(r.code) && !r.entryId ? { ...r, entryId } : r));
});
