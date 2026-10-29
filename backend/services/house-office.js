// THE HOUSE OFFICES — where each house's office data lives, and the one
// door every office store is opened through.
//
// Design note, 2026-10-16: […] The security, legal and marketing
// offices kept ONE machine-wide record each under data/settings; two houses
// share this machine now. Every office record moves into its house:
// `<realm>/<wallet>/offices/<office>/<file>`, beside the house's charter and
// seats. A store is opened for a WALLET, never for the machine — a caller
// with no house has no office to read.
//
// The machine-wide record moves on first open, once, to the house it belongs
// to (house-office-legacy.js). Until it can be placed it serves no house.

import fs from 'fs/promises';
import path from 'path';
import { getRealmRoot, walletDir } from './user-realm.js';
import { houseKey } from './staff/cos-designation.js';
import { moveLegacyRecord } from './house-office-legacy.js';
import { seatFileName } from './house-office-seat.js';

const OFFICES = Object.freeze(['security', 'legal', 'marketing', 'treasury', 'revenue']);
const WALLET = /^0x[a-f0-9]{40}$/;

// Every legacy move an office's modules declared, so a watch can place the
// machine-wide records before it asks which houses stand the office.
const moves = new Map(OFFICES.map((office) => [office, []]));

// pure — refuse an office this module does not know (a typo would quietly
// open a second, empty office).
const assertOffice = (office) => {
  if (!OFFICES.includes(office)) throw new Error(`no such house office: ${office}`);
};

/**
 * The house's office directory. Throws on a wallet that is not one — no
 * house, no office.
 * @param {string} wallet
 * @param {string} office - security | legal | marketing | treasury | revenue
 */
const officeDir = (wallet, office) => {
  assertOffice(office);
  const key = houseKey(wallet);
  if (!key) throw new Error(`the ${office} office needs the house's wallet`);
  return path.join(walletDir(key), 'offices', office);
};

/** One office file in a house. */
export const officeFile = (wallet, office, name) => path.join(officeDir(wallet, office), name);

/**
 * The one-time move of a machine-wide office file into its house, as a
 * function every reader awaits first. A settled outcome (moved, never there,
 * or a house that already holds its own) is remembered per legacy path; an
 * unresolved one is retried on the next open (and said loudly once).
 * @param {{office: string, name: string, legacyPath: () => string, legacySeatPath?: () => string,
 *   tombstone?: Function}} opts
 * @returns {() => Promise<void>}
 */
export const createLegacyMove = ({ office, name, legacyPath, legacySeatPath = null, tombstone }) => {
  assertOffice(office);
  const settled = new Set();
  const move = async () => {
    const legacyFile = legacyPath();
    const marker = `${getRealmRoot()}|${legacyFile}`;
    if (settled.has(marker)) return;
    const outcome = await moveLegacyRecord({
      legacyFile,
      seatFile: legacySeatPath ? legacySeatPath() : null,
      destOf: (house) => officeFile(house, office, name),
      label: `${office}/${name}`,
      tombstone,
    });
    if (outcome !== 'unresolved') settled.add(marker);
  };
  moves.get(office).push(move);
  return move;
};

/**
 * Run every legacy move the office declared — before a watch walks the
 * office's houses, so a house whose records are still machine-wide is not
 * skipped. impure.
 * @param {string} office
 */
export const settleLegacy = async (office) => {
  assertOffice(office);
  for (const move of moves.get(office)) await move();
};

/**
 * A per-house store registry: `await storeFor(wallet)` is that house's own
 * store, created by the module's factory on the house's office path.
 * impure (the legacy move).
 * @param {{office: string, name: string, legacyPath: () => string, legacySeatPath?: () => string,
 *   create: (opts: {path: () => string}) => Object}} opts
 * @returns {(wallet: string) => Promise<Object>}
 */
export const createHouseStore = ({ office, name, legacyPath, legacySeatPath, create }) => {
  const moveLegacy = createLegacyMove({ office, name, legacyPath, legacySeatPath });
  const stores = new Map();
  return async (wallet) => {
    const file = officeFile(wallet, office, name);
    await moveLegacy();
    if (!stores.has(file)) stores.set(file, create({ path: () => file, wallet }));
    return stores.get(file);
  };
};

/**
 * Every house on this machine whose office stands: it seats the office's
 * officer, or it already holds the office's records. The houses a watch walks.
 * impure.
 * @param {string} office - security | legal | marketing
 * @param {string} seat - the officer's seat short name (cso | clo | cmo)
 * @returns {Promise<string[]>} house wallets
 */
export const officeHouses = async (office, seat) => {
  assertOffice(office);
  let names;
  try {
    names = await fs.readdir(getRealmRoot());
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const houses = [];
  for (const wallet of names.filter((n) => WALLET.test(n))) {
    const dir = walletDir(wallet);
    const records = await fs.stat(path.join(dir, 'offices', office)).then((s) => s.isDirectory(), () => false);
    if (records) { houses.push(wallet); continue; }
    const officer = await fs.readFile(path.join(dir, seatFileName(seat)), 'utf8')
      .then((raw) => JSON.parse(raw), () => null);
    if (officer?.laneId) houses.push(wallet);
  }
  return houses;
};
