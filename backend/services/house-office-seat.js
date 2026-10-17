// THE HOUSE OFFICE SEAT — one holder per office per HOUSE (the CSO, the CLO,
// the CMO), the same shape the Optio's seat took (staff/cos-designation.js).
//
// Design note, 2026-10-16: […] The house is its operator's wallet, so
// each office's seat sits beside that wallet's charter:
// `<realm>/<wallet>/house-<office>.json`. A house with no record of its own
// seats no officer — it never reads another house's.
//
// A single-object document: { laneId, designatedAt }. Clearing writes an
// explicit null, so "no officer" is a recorded fact, never an absent file
// mistaken for one. A house seats only its OWN lane: the lane's owner.json
// must name the house's wallet.
//
// THE LEGACY MACHINE SEAT (data/settings/<office>.json) moves on first read
// to the house that owns its lane, and only there (house-office-legacy.js):
// the legacy file becomes a tombstone naming where the seat went; an owner
// that cannot be resolved serves NO house.
//
// Governance record, not a secret: plain JSON, 0600.

import fs from 'fs/promises';
import path from 'path';
import { getRealmRoot, walletDir } from './user-realm.js';
import { createWriteChain } from './write-chain.js';
import { houseKey } from './staff/cos-designation.js';
import { ABSENT, readJson, writePrivate, legacyHouseOf, isTombstone, sameWorld } from './house-office-legacy.js';
import { createLogger } from './logger.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

const log = createLogger('HouseOffice.Seat');

const LANE_ID_MAX = 200;
const WALLET = /^0x[a-f0-9]{40}$/;

/** A seat's file name in the house dir: house-cso.json. Pure. */
export const seatFileName = (office) => `house-${office}.json`;

// impure — the house a live lane belongs to, from its owner.json.
const ownerHouseOf = async (laneId) =>
  houseKey((await neumaWorkspace.readOwner(laneId).catch(() => null))?.wallet);

// impure — a seat document: ABSENT when missing; a corrupt or non-object file
// surfaces, never collapses to null (that would silently unseat an officer).
const readSeat = async (file, office) => {
  const doc = await readJson(file);
  if (doc !== ABSENT && doc !== null && (typeof doc !== 'object' || Array.isArray(doc))) {
    throw new Error(`${office} seat: store is not an object`);
  }
  return doc;
};

// Each unresolvable legacy seat is said loudly once per process, not per read.
const warned = new Set();

/**
 * @param {{office: string, title: string, legacyPath: () => string}} opts
 *   office — the seat's short name (cso | clo | cmo); title — how refusals
 *   name it; legacyPath — the pre-2026-10-16 machine seat
 */
export const createHouseSeat = ({ office, title, legacyPath }) => {
  const houseFile = (key) => path.join(walletDir(key), seatFileName(office));

  // Serialize mutations — a designate, a clear and the migration must never
  // interleave their read+write.
  const serialize = createWriteChain();

  // impure — move the legacy machine seat to its owner's house, once. Never
  // overwrites a record the house already holds; never hands the seat to a
  // wallet that does not own the lane.
  const migrateLegacy = () => serialize(async () => {
    const file = legacyPath();
    let seat;
    try {
      seat = await readSeat(file, office);
    } catch (err) {
      if (!warned.has(file)) {
        warned.add(file);
        log.error(`the legacy ${title} seat is unreadable — it serves no house until an operator designates again`, { file, error: err.message });
      }
      return;
    }
    if (seat === ABSENT || !seat?.laneId || isTombstone(seat)) return;
    if (!sameWorld(file)) {
      if (!warned.has(`world:${file}`)) {
        warned.add(`world:${file}`);
        log.error(`refusing to move the legacy ${title} seat across a temp/live boundary — it serves no house`, { file, realm: getRealmRoot() });
      }
      return;
    }
    const owner = await legacyHouseOf(seat);
    if (!owner) {
      if (!warned.has(`${file}:${seat.laneId}`)) {
        warned.add(`${file}:${seat.laneId}`);
        log.error(`the legacy machine ${title} seat has no resolvable owner — it serves NO house; the operator must designate again`, { laneId: seat.laneId, file });
      }
      return;
    }
    if ((await readSeat(houseFile(owner), office)) === ABSENT) {
      await writePrivate(houseFile(owner), {
        laneId: seat.laneId,
        designatedAt: seat.designatedAt ?? null,
        migratedFrom: 'machine-seat',
      });
    }
    await writePrivate(file, { ...seat, migratedTo: owner, migratedAt: new Date().toISOString() });
    log.info(`the machine ${title} seat moved to its house`, { laneId: seat.laneId, house: owner });
  });

  // impure — the house's own record, migrating the legacy seat first when the
  // house has never written one.
  const load = async (key) => {
    const own = await readSeat(houseFile(key), office);
    if (own !== ABSENT) return own;
    await migrateLegacy();
    const after = await readSeat(houseFile(key), office);
    return after === ABSENT ? null : after;
  };

  return {
    /**
     * The house's officer, or null when that house seats none. impure.
     * @param {string} wallet - the house (its operator's wallet)
     */
    async getOfficer(wallet) {
      const key = houseKey(wallet);
      return key ? load(key) : null;
    },

    /**
     * Is this lane the seated officer of this house? impure. The one question
     * every gate and briefing asks — never a bare lane id against another house.
     * @param {string} wallet
     * @param {string} laneId
     */
    async holds(wallet, laneId) {
      if (!laneId) return false;
      const officer = await this.getOfficer(wallet).catch(() => null);
      return officer?.laneId === laneId;
    },

    /**
     * Every house on this machine that seats this officer, for the sweeps
     * that walk all houses. impure. A house whose record cannot be read is
     * skipped loudly — one corrupt file never stops another house's sweep.
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
        const officer = await readSeat(houseFile(wallet), office).catch((err) => {
          log.error(`a house ${title} record is unreadable`, { house: wallet, error: err.message });
          return null;
        });
        if (officer && officer !== ABSENT && officer.laneId) houses.push({ wallet, officer });
      }
      return houses;
    },

    /**
     * Seat one of the house's own lanes. impure.
     * @param {string} wallet - the house
     * @param {string} laneId
     */
    designate(wallet, laneId) {
      const key = houseKey(wallet);
      const id = typeof laneId === 'string' ? laneId.trim() : '';
      if (!key) return Promise.reject(new Error(`a ${title} designation needs the house's wallet`));
      if (!id || id.length > LANE_ID_MAX) {
        return Promise.reject(new Error(`a ${title} designation needs a lane id`));
      }
      return serialize(async () => {
        if ((await ownerHouseOf(id)) !== key) {
          throw new Error(`lane ${id} is not a lane of this house — a house seats only its own ${title}`);
        }
        const designation = { laneId: id, designatedAt: new Date().toISOString() };
        await writePrivate(houseFile(key), designation);
        return designation;
      });
    },

    /**
     * Unseat the house's officer — the office's acts close to every being of
     * that house. impure.
     * @param {string} wallet - the house
     */
    clear(wallet) {
      const key = houseKey(wallet);
      if (!key) return Promise.reject(new Error(`clearing a ${title} designation needs the house's wallet`));
      return serialize(() => writePrivate(houseFile(key), null));
    },
  };
};
