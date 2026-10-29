// mandate-hold-store — each house's HOLDS (mandate-hold.js), beside its
// mandate record: `<realm>/<wallet>/house-mandate-holds.json`. A hold stays
// open until the operator CLEARS it; clearing never covers what was already
// staged as a card — those wait on the operator as any card does.
//
// A sighting is filed fire-and-forget from the turn (G13: a sighting never
// costs a being its turn), so a hold is also NOTED in this process the
// instant the sighting is seen, before any disk await — the CMO's next act in
// the same turn finds it even if the file write has not landed yet.
//
// impure — disk and one in-process list.

import fs from 'fs/promises';
import crypto from 'crypto';
import { housePositionFile } from '../../social/house-positions.js';
import { houseKey } from '../../staff/cos-designation.js';
import { withFileLock } from '../../file-lock.js';
import { writeRecordFile } from './mandate-store.js';

const FILE = 'house-mandate-holds.json';
const KEPT = 100;
const NOTED_MS = 5 * 60 * 1000;

const holdsPath = (wallet) => housePositionFile(wallet, FILE);
const noted = new Map(); // house → [{hold, at}]

/** A fresh hold id. impure (randomness). */
export const newHoldId = () => `mh_${crypto.randomBytes(6).toString('hex')}`;

/**
 * Note a hold in this process at once (synchronous by design). Returns the
 * function that forgets it once the file holds it — or once it is known not
 * to apply. impure.
 */
export const noteHold = (wallet, hold) => {
  const house = houseKey(wallet);
  if (!house) return () => {};
  const row = { hold, at: Date.now() };
  noted.set(house, [...(noted.get(house) || []), row]);
  return () => noted.set(house, (noted.get(house) || []).filter((r) => r !== row));
};

// impure — a missing file is no holds; a torn one surfaces (it must never
// read as "nothing is held").
const readFile = async (file) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { v: 1, holds: [] };
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.holds)) throw new Error('house-mandate-holds: not a holds record');
  return parsed;
};

/**
 * The house's holds on disk, plus (`pending`, for judging an act) any this
 * process noted and has not yet written or ruled out. Surfaces that show a
 * hold to the operator read the disk alone. impure.
 */
export const readHolds = async (wallet, { pending = true } = {}) => {
  const house = houseKey(wallet);
  if (!house) return [];
  const { holds } = await readFile(holdsPath(house));
  if (!pending) return holds;
  const fresh = (noted.get(house) || []).filter((r) => Date.now() - r.at < NOTED_MS).map((r) => r.hold);
  return [...holds, ...fresh.filter((h) => !holds.some((x) => x.id === h.id))];
};

/** Add one hold, keeping the record bounded (cleared ones age out first). impure. */
export const addHold = (wallet, hold) => {
  const house = houseKey(wallet);
  if (!house) return Promise.resolve({ ok: false, error: 'a hold needs the house\'s wallet' });
  const file = holdsPath(house);
  return withFileLock(`${file}.lock`, async () => {
    const record = await readFile(file);
    const open = record.holds.filter((h) => h.status === 'open');
    const cleared = record.holds.filter((h) => h.status !== 'open');
    await writeRecordFile(file, { v: 1, holds: [...open, hold, ...cleared].slice(0, KEPT) });
    return { ok: true, hold };
  });
};

/** The operator CLEARS one open hold. impure. */
export const clearHold = (wallet, id, { by }) => {
  const house = houseKey(wallet);
  if (!house) return Promise.resolve({ ok: false, error: 'a hold needs the house\'s wallet' });
  const file = holdsPath(house);
  return withFileLock(`${file}.lock`, async () => {
    const record = await readFile(file);
    const hold = record.holds.find((h) => h.id === id && h.status === 'open');
    if (!hold) return { ok: false, error: 'no open hold has that id' };
    const done = { ...hold, status: 'cleared', clearedAt: new Date().toISOString(), clearedBy: by };
    await writeRecordFile(file, { v: 1, holds: record.holds.map((h) => (h === hold ? done : h)) });
    return { ok: true, hold: done };
  });
};
