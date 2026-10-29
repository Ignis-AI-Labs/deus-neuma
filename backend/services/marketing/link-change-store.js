// link-change-store — each house's LINK CHANGES (link-change-shape.js): what
// its seated CMO proposed for a company's site, pages and repos, and how the
// operator decided. `<realm>/<wallet>/house-company-link-changes.json`, beside
// the house's other positions — one house's file, never another's.
//
// One OPEN proposal per company: a newer filing for the same company stands
// in place of the one still waiting (`superseded`), so the operator decides
// the CMO's latest word once, never a pile of drafts.
//
// impure — disk.

import fs from 'fs/promises';
import crypto from 'crypto';
import { housePositionFile } from '../social/house-positions.js';
import { houseKey } from '../staff/cos-designation.js';
import { withFileLock } from '../file-lock.js';
import { writeJsonAtomic } from '../user-realm.js';

const FILE = 'house-company-link-changes.json';
const KEPT = 60;

const fileOf = (wallet) => housePositionFile(wallet, FILE);

// impure — a missing file is no changes; a torn one surfaces (never "nothing waits").
const readRecord = async (file) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { v: 1, changes: [] };
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.changes)) throw new Error('house-company-link-changes: not a link-changes record');
  return parsed;
};

// pure — open ones first, then the decided, newest first, bounded.
const bounded = (changes) => [
  ...changes.filter((c) => c.status === 'open'),
  ...changes.filter((c) => c.status !== 'open'),
].slice(0, KEPT);

/** The house's link changes on disk (every status). impure. */
export const readLinkChanges = async (wallet) => (houseKey(wallet) ? (await readRecord(fileOf(wallet))).changes : []);

/**
 * File one proposal; an open one for the same company is superseded. impure.
 * @param {string} wallet - the house
 * @param {{laneId: string, companyId: string, change: object}} proposal
 */
export const addLinkChange = (wallet, { laneId, companyId, change }) => {
  if (!houseKey(wallet)) return Promise.resolve({ ok: false, error: 'a link change needs the house\'s wallet' });
  const file = fileOf(wallet);
  return withFileLock(`${file}.lock`, async () => {
    const record = await readRecord(file);
    const at = new Date().toISOString();
    const entry = { id: `lc_${crypto.randomBytes(6).toString('hex')}`, at, laneId, companyId, change, status: 'open' };
    const rest = record.changes.map((c) => (c.status === 'open' && c.companyId === companyId
      ? { ...c, status: 'superseded', decidedAt: at, decidedBy: laneId } : c));
    await writeJsonAtomic(file, { v: 1, changes: bounded([entry, ...rest]) });
    return { ok: true, entry, superseded: rest.filter((c, i) => c !== record.changes[i]).length };
  });
};

/**
 * Settle one OPEN proposal of the house: approved or declined. impure.
 * @param {string} wallet
 * @param {string} id
 * @param {{status: 'approved'|'declined', by: string}} decision
 */
export const settleLinkChange = (wallet, id, { status, by }) => {
  if (!houseKey(wallet)) return Promise.resolve({ ok: false, error: 'a link change needs the house\'s wallet' });
  const file = fileOf(wallet);
  return withFileLock(`${file}.lock`, async () => {
    const record = await readRecord(file);
    const open = record.changes.find((c) => c.id === id && c.status === 'open');
    if (!open) return { ok: false, error: 'no open link change has that id in your house' };
    const done = { ...open, status, decidedAt: new Date().toISOString(), decidedBy: by };
    await writeJsonAtomic(file, { v: 1, changes: bounded(record.changes.map((c) => (c === open ? done : c))) });
    return { ok: true, entry: done };
  });
};
