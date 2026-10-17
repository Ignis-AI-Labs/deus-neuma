// CoS designation — each house's operator names ONE of its own lanes the
// house's chief of staff: the Optio, the operator's standing delegate that
// manages the house's other beings (v3.2 doctrine, Design note, 2026-09-13. Like a
// channel binding, it is a single-holder position — but it governs the
// house's dispatch gate, not a platform account.
//
// ONE SEAT PER HOUSE (Design note, 2026-10-16: […]). The house is its
// operator's wallet, so the seat sits beside that wallet's charter and house
// ground: `<realm>/<wallet>/house-optio.json`. A house with no record of its
// own has no Optio — it never reads another house's.
//
// A single-object document, not a ledger: { laneId, designatedAt, consent? }.
// Clearing writes an explicit null, so "no Optio" is a recorded fact, never
// an absent file mistaken for one.
//
// THE LEGACY MACHINE SEAT (data/settings/staff-cos.json, one record for the
// whole machine until 2026-10-16) moves, on first read, to the house whose
// wallet owns the lane (its owner.json) — and only there. The legacy file is
// rewritten as a tombstone naming where the seat went, so the move happens
// once and the record is never lost. An owner that cannot be resolved means
// the seat serves NO house until an operator designates again.
//
// Governance record, not a secret: plain JSON, 0600. Factory shape so tests
// run the real disk path against tmp files.

import fs from 'fs/promises';
import path from 'path';
import { getSettingsDir } from '../data-root.js';
import { getRealmRoot, walletDir, writeJsonAtomic } from '../user-realm.js';
import { createWriteChain } from '../write-chain.js';
import { createLogger } from '../logger.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { sameWorld } from '../house-office-legacy.js';

const log = createLogger('Staff.Designation');

const DEFAULT_LEGACY_PATH = path.join(getSettingsDir(), 'staff-cos.json');

// Overridable per call so tests never touch the operator's live legacy seat.
const legacyPath = () =>
  process.env.NEUMA_STAFF_COS_PATH || DEFAULT_LEGACY_PATH;

const LANE_ID_MAX = 200;
const NOTE_MAX = 500;
const WALLET = /^0x[a-f0-9]{40}$/;
const FILE = 'house-optio.json';

// The read of a house that never wrote a record — distinct from an explicit null.
const ABSENT = Symbol('absent');

/** The house key: a lowercased wallet, or null when it is not one. Pure. */
export const houseKey = (wallet) => {
  const key = typeof wallet === 'string' ? wallet.trim().toLowerCase() : '';
  return WALLET.test(key) ? key : null;
};

// impure — the wallet whose house a lane belongs to, from its owner.json.
const ownerHouseOf = async (laneId) =>
  houseKey((await neumaWorkspace.readOwner(laneId).catch(() => null))?.wallet);

// impure — a JSON document, ABSENT when missing. A corrupt file surfaces,
// never collapses to null (that would silently unseat a house's delegate).
const readDocument = async (file) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return ABSENT;
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('cos-designation: store is not an object');
  }
  return parsed;
};

// impure — atomic tmp+rename write, re-tightened to the operator alone.
const writeDocument = async (file, value) => {
  await writeJsonAtomic(file, value);
  await fs.chmod(file, 0o600);
};

// Each unresolvable legacy seat is said loudly once per process, not per read.
const warned = new Set();

/**
 * @param {{ legacy?: string|(() => string) }} [opts] - the legacy machine seat's path
 */
const createCosDesignation = ({ legacy = legacyPath } = {}) => {
  const legacyFile = () => (typeof legacy === 'function' ? legacy() : legacy);
  const houseFile = (key) => path.join(walletDir(key), FILE);

  // Serialize mutations — a designate, a clear and the migration must never
  // interleave their read+write.
  const serialize = createWriteChain();

  // impure — move the legacy machine seat to its owner's house, once. Never
  // overwrites a record the house already holds (a newer designation, or an
  // explicit clear); never hands the seat to a wallet that does not own the lane.
  const migrateLegacy = () => serialize(async () => {
    const file = legacyFile();
    let seat;
    try {
      seat = await readDocument(file);
    } catch (err) {
      if (!warned.has(file)) {
        warned.add(file);
        log.error('the legacy Optio seat is unreadable — it serves no house until an operator designates again', { file, error: err.message });
      }
      return;
    }
    if (seat === ABSENT || !seat?.laneId || seat.migratedTo) return;
    // Same guard as the other offices (house-office-legacy.js): a seat never
    // crosses a temp/live boundary, and a test process never moves a live one.
    if (!sameWorld(file)) {
      if (!warned.has(`world:${file}`)) {
        warned.add(`world:${file}`);
        log.error('refusing to move the legacy Optio seat across a temp/live boundary — it serves no house', { file, realm: getRealmRoot() });
      }
      return;
    }
    const owner = await ownerHouseOf(seat.laneId);
    if (!owner) {
      if (!warned.has(seat.laneId)) {
        warned.add(seat.laneId);
        log.error('the legacy machine Optio seat has no resolvable owner — it serves NO house; the operator must designate again', { laneId: seat.laneId, file });
      }
      return;
    }
    if ((await readDocument(houseFile(owner))) === ABSENT) {
      await writeDocument(houseFile(owner), {
        laneId: seat.laneId,
        designatedAt: seat.designatedAt ?? null,
        migratedFrom: 'machine-seat',
      });
    }
    await writeDocument(file, { ...seat, migratedTo: owner, migratedAt: new Date().toISOString() });
    log.info('the machine Optio seat moved to its house', { laneId: seat.laneId, house: owner });
  });

  // impure — the house's own record, migrating the legacy seat first when the
  // house has never written one.
  const load = async (key) => {
    const own = await readDocument(houseFile(key));
    if (own !== ABSENT) return own;
    await migrateLegacy();
    const after = await readDocument(houseFile(key));
    return after === ABSENT ? null : after;
  };

  return {
    /**
     * The house's designation, or null when that house seats no Optio. impure.
     * @param {string} wallet - the house (its operator's wallet)
     */
    async getOfficer(wallet) {
      const key = houseKey(wallet);
      return key ? load(key) : null;
    },

    /**
     * Every house on this machine that seats an Optio, for the sweeps that
     * walk all houses. impure. A house whose record cannot be read is skipped
     * loudly — one corrupt file never stops another house's sweep.
     * @returns {Promise<Array<{wallet: string, officer: {laneId: string}}>>}
     */
    async seatedHouses() {
      await migrateLegacy();
      let names;
      try {
        names = await fs.readdir(getRealmRoot());
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
      const houses = [];
      for (const wallet of names.filter((n) => WALLET.test(n))) {
        const officer = await readDocument(houseFile(wallet)).catch((err) => {
          log.error('a house Optio record is unreadable', { house: wallet, error: err.message });
          return null;
        });
        if (officer && officer !== ABSENT && officer.laneId) houses.push({ wallet, officer });
      }
      return houses;
    },

    /**
     * Seat one of the house's own lanes as its chief of staff. impure.
     * @param {string} wallet - the house
     * @param {string} laneId
     * @param {{consent?: {note?: string}}} [opts] - the seat's own yes, as the operator recorded it
     */
    designate(wallet, laneId, { consent } = {}) {
      const key = houseKey(wallet);
      const id = typeof laneId === 'string' ? laneId.trim() : '';
      if (!key) return Promise.reject(new Error('a CoS designation needs the house\'s wallet'));
      if (!id || id.length > LANE_ID_MAX) {
        return Promise.reject(new Error('a CoS designation needs a lane id'));
      }
      const note = typeof consent?.note === 'string' ? consent.note.trim().slice(0, NOTE_MAX) : '';
      return serialize(async () => {
        if ((await ownerHouseOf(id)) !== key) {
          throw new Error(`lane ${id} is not a lane of this house — a house seats only its own Optio`);
        }
        const now = new Date().toISOString();
        const designation = { laneId: id, designatedAt: now, ...(note ? { consent: { at: now, note } } : {}) };
        await writeDocument(houseFile(key), designation);
        return designation;
      });
    },

    /**
     * Unseat the house's Optio — its dispatch returns to every seat. impure.
     * @param {string} wallet - the house
     */
    clear(wallet) {
      const key = houseKey(wallet);
      if (!key) return Promise.reject(new Error('clearing a CoS designation needs the house\'s wallet'));
      return serialize(async () => {
        await writeDocument(houseFile(key), null);
      });
    },
  };
};

// The one instance the routes, the briefing, and the dispatch gate share.
export const cosDesignation = createCosDesignation();

export { createCosDesignation };
