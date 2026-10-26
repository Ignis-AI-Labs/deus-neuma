// mandate-store — each house's MANDATE record and its journal, beside the
// house's charter and office seats: `<realm>/<wallet>/house-mandate.json`
// (the standing mandate + the last few that ended) and
// `<realm>/<wallet>/house-mandate-journal.jsonl` (every grant, act, trip,
// pause, resume and withdrawal, append-only — the DONE FOR YOU feed reads it).
//
// The realm root is a platform write wall (platform-write-walls.js): no
// being's file tool can write here, so a mandate is only ever changed by the
// operator's own routes (or the operator's CLI at the machine).
//
// impure — disk.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { housePositionFile } from '../../social/house-positions.js';
import { houseKey } from '../../staff/cos-designation.js';
import { withFileLock } from '../../file-lock.js';
import { createLogger } from '../../logger.js';

const log = createLogger('Marketing.Mandate');

const FILE = 'house-mandate.json';
const JOURNAL = 'house-mandate-journal.jsonl';
const PAST_KEPT = 20;
const FEED_MAX = 200;

/** The house's mandate file. Throws on a wallet that is not one. */
export const mandatePath = (wallet) => housePositionFile(wallet, FILE);
const journalPath = (wallet) => housePositionFile(wallet, JOURNAL);

const empty = () => ({ v: 1, current: null, past: [] });

// impure — a missing file is no mandate; a corrupt one surfaces, never reads
// as "none" (that would silently end a mandate the operator holds, or hide one).
const readFile = async (file) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return empty();
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.past)) throw new Error('house-mandate: not a mandate record');
  return parsed;
};

/** Write a whole house record atomically, owner-only (tmp + rename). impure. */
export const writeRecordFile = async (file, record) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
};

/** The house's mandate record ({current, past}). impure. */
export const readMandateRecord = async (wallet) => {
  if (!houseKey(wallet)) return empty();
  return readFile(mandatePath(wallet));
};

/** The house's standing mandate, or null. impure. */
export const readMandate = async (wallet) => (await readMandateRecord(wallet)).current;

/**
 * Change the house's record in one atom — across processes too (the desk,
 * the dev stack and the operator's CLI may all hold this house). `fn` gets the
 * record and returns `{record, result}` or `{error}`. impure.
 */
export const mutateMandate = (wallet, fn) => {
  if (!houseKey(wallet)) return Promise.resolve({ ok: false, error: 'a mandate needs the house\'s wallet' });
  const file = mandatePath(wallet);
  return withFileLock(`${file}.lock`, async () => {
    const record = await readFile(file);
    const out = await fn(record);
    if (out?.error) return { ok: false, error: out.error };
    await writeRecordFile(file, out.record);
    return { ok: true, ...out.result };
  });
};

/** Move the standing mandate into the past, keeping the record bounded. Pure. */
export const retire = (record, ended) => ({
  ...record,
  current: null,
  past: [ended, ...record.past].slice(0, PAST_KEPT),
});

/** A fresh mandate id. impure (randomness). */
export const newMandateId = () => `md_${crypto.randomBytes(6).toString('hex')}`;

/**
 * Append one line to the house's mandate journal. Never throws — a journal
 * that cannot be written is logged loudly, and the act it records stands.
 * impure.
 * @param {string} wallet
 * @param {{mandateId: string, kind: string, [k: string]: any}} event
 */
export const journalMandate = async (wallet, event) => {
  try {
    const file = journalPath(wallet);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  } catch (err) {
    log.error('mandate journal line not written', { kind: event?.kind, error: err.message });
  }
};

/** The house's journal, newest first, bounded. impure. */
export const readMandateJournal = async (wallet, { limit = FEED_MAX } = {}) => {
  if (!houseKey(wallet)) return [];
  let raw;
  try {
    raw = await fs.readFile(journalPath(wallet), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (const line of lines.slice(-limit).reverse()) {
    try { out.push(JSON.parse(line)); } catch { log.warn('a mandate journal line is not JSON — skipped'); }
  }
  return out;
};
