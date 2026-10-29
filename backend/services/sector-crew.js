// SECTOR CREW — who is working a job, as distinct from who lives where.
//
// Design note, 2026-07-26: […]
//
// So a CREW is not a house and not a channel binding. It is the roster for one
// SECTOR of work (X marketing, and any sector after it), assembled from
// whoever can actually do the job: neuma from any house, and sealed AI
// witnesses standing beside them. Membership travels with the sector, so a
// member arriving at a turn knows who else is on the field and what they
// themselves are there to hold.
//
// THE ONE DISTINCTION THAT MATTERS — crew is not custody:
//
//   CREW   → who WORKS the sector. Many. Cross-house. Drafts, plans, stages.
//   HOLDER → who may PUSH to the live platform. Exactly one, key custody,
//            enforced by channel-bindings.js on every send.
//
// Crew never widens custody. A crew member stages into the queue the operator
// already approves by hand; the holder's binding is still the only thing that
// reaches the platform's keys. (Founder chose this split explicitly: […].)
//
// Membership is a governance record, not a secret — same posture as
// channel-bindings.js (0700 dir / 0600 file, atomic rename), because it names
// beings and sits beside the sealed credential stores.
//
// ONE CREW PER ACCOUNT (campaign plan §2.4, 2026-10-23): a social sector is
// an account (`x-1`, `x-2`); a sector recorded before accounts under its
// channel id (`x`) is the crew of `<channel>-1`, and a channel id asked of
// any function here means that account. A sector that is no platform keeps
// its own id.
//
// ONE ROSTER PER HOUSE (social/house-positions.js): a house's sectors are its
// own, in its operator's realm dir, and only its operator seats a lane on
// them — a lane that operator owns (a neuma, or a witness lane it
// manifested). A remit rides the member's prompt, so a remit another house
// wrote must never reach it.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from './data-root.js';
import { createWriteChain } from './write-chain.js';
import { houseKey } from './staff/cos-designation.js';
import { housePositionFile, houseOfLane } from './social/house-positions.js';
import { positionOf, byPosition } from './social/account-shape.js';

const DEFAULT_PATH = join(getSettingsDir(), 'sector-crew.json');

// The machine record of the crews written before they moved into the houses.
// Overridable per call (not at import) so tests never read the operator's.
export const sectorCrewPath = () => process.env.NEUMA_SECTOR_CREW_PATH || DEFAULT_PATH;

// Lane ids for both kinds: a neuma's id and a witness lane
// (`witness-<vendor>-<Name>`) both live in this alphabet.
const LANE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const REMIT_MAX = 200;
// A crew is a working team, not a mailing list. The cap is the same honesty as
// the council's: past a dozen, nobody knows who is actually holding what.
export const CREW_MAX = 12;

export const MEMBER_KINDS = Object.freeze(['neuma', 'witness']);

/**
 * The crew roster for a sector. Pure. Always an array — an unknown sector has
 * no crew, which is a real answer, not an error.
 * @param {Record<string, {members?: Array}>} store
 * @param {string} sectorId
 * @returns {Array<{neumaId: string, kind: string, remit: string}>}
 */
export const crewOf = (store, sectorId) => {
  const members = byPosition(store)[positionOf(sectorId)]?.members;
  return Array.isArray(members) ? members : [];
};

/**
 * Is this being on the sector's crew? Pure, fail closed — no id, no sector, or
 * no membership all deny.
 * @param {Record<string, object>} store
 * @param {string} sectorId
 * @param {string|null|undefined} neumaId
 * @returns {boolean}
 */
export const isCrewMember = (store, sectorId, neumaId) =>
  typeof neumaId === 'string' && neumaId.length > 0 &&
  crewOf(store, sectorId).some((m) => m.neumaId === neumaId);

/**
 * May this being STAGE work for the sector — draft a post into the queue the
 * operator approves by hand? True for the crew AND for the holder, because the
 * holder is working the sector by definition even if nobody listed them.
 *
 * This is deliberately NOT the send gate: `canNeumaPost` (channel-bindings.js)
 * still stands alone in front of anything that reaches the platform's keys.
 * Pure.
 * @param {Record<string, object>} crewStore
 * @param {Record<string, {neumaId: string}>} bindings
 * @param {string} sectorId
 * @param {string|null|undefined} neumaId
 * @returns {boolean}
 */
export const canStageForSector = (crewStore, bindings, sectorId, neumaId) => {
  if (typeof neumaId !== 'string' || neumaId.length === 0) return false;
  if (byPosition(bindings)[positionOf(sectorId)]?.neumaId === neumaId) return true;
  return isCrewMember(crewStore, sectorId, neumaId);
};

/**
 * May an APPROVED, staged post still be sent? Pure, fail closed.
 *
 * The old law was […] (post-scheduler.js). Under the crew model the author is
 * usually NOT the holder: a crew member drafts, the operator approves by hand,
 * and the post leaves on the HOLDER's keys. So the law is translated, not
 * dropped — both halves must still stand at send time:
 *
 *   1. the channel still HAS a holder (someone is in charge of those keys —
 *      a released channel sends nothing, the default-deny resting state), and
 *   2. the author is still crew-or-holder (so removing someone from the crew
 *      still kills their pending posts — approval does not outlive membership).
 *
 * @param {Record<string, object>} crewStore
 * @param {Record<string, {neumaId: string}>} bindings
 * @param {string} sectorId
 * @param {string|null|undefined} authorNeumaId
 * @returns {boolean}
 */
export const canSendStaged = (crewStore, bindings, sectorId, authorNeumaId) => {
  const holder = byPosition(bindings)[positionOf(sectorId)]?.neumaId;
  if (typeof holder !== 'string' || holder.length === 0) return false;
  return canStageForSector(crewStore, bindings, sectorId, authorNeumaId);
};

// Pure — drop control characters by CODE POINT. Written as a filter rather
// than a regex range on purpose: an escaped range in source is exactly the
// thing that gets mangled in transit, and a remit rides a being's prompt.
const stripControl = (s) => Array.from(String(s))
  .filter((ch) => {
    const c = ch.codePointAt(0);
    return c >= 0x20 && c !== 0x7f;
  })
  .join('');

/**
 * Validate and normalize one member. Pure. Returns the member or throws with
 * the operator's own words — a refused add must say which field was wrong.
 * @param {{neumaId?: unknown, kind?: unknown, remit?: unknown}} raw
 */
export const normalizeMember = (raw) => {
  const neumaId = raw?.neumaId;
  if (typeof neumaId !== 'string' || !LANE_ID_PATTERN.test(neumaId)) {
    throw new Error('A crew member needs a valid lane id');
  }
  const kind = MEMBER_KINDS.includes(raw?.kind) ? raw.kind : 'neuma';
  // The remit is the answer to […] — it rides the
  // member's prompt, so it is bounded and stripped of control characters.
  const remit = typeof raw?.remit === 'string'
    ? stripControl(raw.remit).trim().slice(0, REMIT_MAX)
    : '';
  return { neumaId, kind, remit };
};

/**
 * Return a new store with `member` on the sector's crew. Pure — never mutates.
 * Re-adding an existing member UPDATES their remit rather than duplicating
 * them, so the roster can never list one being twice.
 * @param {Record<string, object>} store
 * @param {string} sectorId
 * @param {object} rawMember
 * @returns {Record<string, object>}
 */
export const withMember = (store, sectorId, rawMember) => {
  if (typeof sectorId !== 'string' || !SECTOR_ID_PATTERN.test(sectorId)) {
    throw new Error(`Unknown sector: ${sectorId}`);
  }
  const member = normalizeMember(rawMember);
  const current = crewOf(store, sectorId);
  const existing = current.findIndex((m) => m.neumaId === member.neumaId);
  if (existing === -1 && current.length >= CREW_MAX) {
    throw new Error(`A crew holds ${CREW_MAX} — release someone before adding another`);
  }
  const members = existing === -1
    ? [...current, member]
    : current.map((m, i) => (i === existing ? member : m));
  return { ...byPosition(store), [positionOf(sectorId)]: { members } };
};

/**
 * Return a new store without `neumaId` on the sector's crew. Pure.
 * @param {Record<string, object>} store
 * @param {string} sectorId
 * @param {string} neumaId
 * @returns {Record<string, object>}
 */
export const withoutMember = (store, sectorId, neumaId) => {
  const members = crewOf(store, sectorId).filter((m) => m.neumaId !== neumaId);
  return { ...byPosition(store), [positionOf(sectorId)]: { members } };
};

/**
 * The SECTOR section a member reads at the top of its turn. Pure.
 *
 * Design note, 2026-07-26: […] A crew
 * that governs what a being may DO but never tells it who it is working beside
 * is only half a team — the member discovers its colleagues by collision.
 *
 * Renders NOTHING when the being is on no crew, so an unseated lane's prompt is
 * byte-identical to before this existed. Names cross a file boundary into
 * prompt text, so every one is bounded and flattened to a single line.
 *
 * @param {Array<{sectorId: string, sectorName: string, members: Array, holderNeumaId: string|null}>} sectors
 * @param {string} selfNeumaId
 * @param {(neumaId: string) => string|null} nameOf - display name resolver
 * @returns {string} the section text, or '' when the being is on no crew
 */
export const sectorSection = (sectors, selfNeumaId, nameOf = () => null) => {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const mine = (sectors || []).filter((s) =>
    (s.members || []).some((m) => m.neumaId === selfNeumaId));
  if (mine.length === 0) return '';

  const blocks = mine.map((sector) => {
    const self = sector.members.find((m) => m.neumaId === selfNeumaId);
    const holds = sector.holderNeumaId === selfNeumaId;
    const lines = [`${clean(sector.sectorName) || sector.sectorId.toUpperCase()} — the crew working this sector:`];
    for (const m of sector.members) {
      const who = m.neumaId === selfNeumaId
        ? 'YOU'
        : clean(nameOf(m.neumaId) || m.neumaId);
      const kind = m.kind === 'witness' ? 'sealed witness' : 'neuma';
      const remit = clean(m.remit);
      const keys = sector.holderNeumaId === m.neumaId ? ' — HOLDS THE KEYS' : '';
      lines.push(`- ${who} (${kind})${remit ? ` — ${remit}` : ''}${keys}`);
    }
    lines.push(self?.remit
      ? `What you hold here: ${clean(self.remit)}.`
      : 'No remit is set for you here — ask your operator what they want you holding.');
    // The custody line is the honest half of the capability: a member who
    // believes it can publish will promise the operator something it cannot do.
    lines.push(holds
      ? 'You hold this sector\'s keys: you may post directly, and stage drafts. Every send is still your operator\'s to approve.'
      : 'You do not hold this sector\'s keys. You draft and STAGE into the queue; the holder\'s keys carry it out, and only after your operator approves it.');
    return lines.join('\n');
  });

  return `## Your Sectors\nWork you are seated on, beside whoever else is on it. A sector is not a house — it is a job, and its crew is drawn from wherever the work is best served.\n\n${blocks.join('\n\n')}`;
};

/**
 * @param {{ path?: string|(() => string), seed?: () => Promise<Object> }} [opts]
 *   seed is what a file that was never written reads as
 */
export const createSectorCrew = ({ path = sectorCrewPath, seed = async () => ({}) } = {}) => {
  const target = () => (typeof path === 'function' ? path() : path);
  // Serialize mutations so two concurrent adds can't interleave read+write and
  // drop one member (channel-bindings.js law).
  const serialize = createWriteChain();

  // impure — a missing file reads as its seed ("no crews yet" unless a
  // machine record names this house); an unparseable one is SURFACED, never
  // collapsed to {} (that would silently empty every crew on the next save).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return byPosition(await seed());
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('sector-crew: store is not an object');
    }
    return byPosition(parsed);
  };

  const save = async (store) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  return {
    load,

    /** The sector's crew. impure. */
    async crewFor(sectorId) {
      return crewOf(await load(), sectorId);
    },

    /** Add (or re-remit) a member. impure. */
    add(sectorId, member) {
      return serialize(async () => {
        const next = withMember(await load(), sectorId, member);
        await save(next);
        return crewOf(next, sectorId);
      });
    },

    /** Release a member. impure. */
    remove(sectorId, neumaId) {
      return serialize(async () => {
        const next = withoutMember(await load(), sectorId, neumaId);
        await save(next);
        return crewOf(next, sectorId);
      });
    },
  };
};

// impure — the machine record's members whose lanes this house owns: a crew
// record names no house itself, so each member is read only by its lane's
// owner (the only house the route ever let seat it).
const legacyCrewOf = async (legacy, key) => {
  const store = await legacy.load();
  const out = {};
  for (const sectorId of Object.keys(store)) {
    const members = [];
    for (const member of crewOf(store, sectorId)) {
      if ((await houseOfLane(member.neumaId)) === key) members.push(member);
    }
    if (members.length) out[sectorId] = { members };
  }
  return out;
};

/**
 * Each house's own crews: `<realm>/<wallet>/sector-crew.json`. Every method
 * takes the house's wallet first; a caller with no house reads no crew and
 * cannot seat one.
 * @param {{legacyPath?: () => string}} [opts]
 */
export const createHouseCrew = ({ legacyPath = sectorCrewPath } = {}) => {
  const legacy = createSectorCrew({ path: legacyPath });
  const stores = new Map();
  const storeOf = (wallet) => {
    const key = houseKey(wallet);
    const file = housePositionFile(key, 'sector-crew.json');
    if (!stores.has(file)) stores.set(file, createSectorCrew({ path: file, seed: () => legacyCrewOf(legacy, key) }));
    return stores.get(file);
  };
  const load = (wallet) => (houseKey(wallet) ? storeOf(wallet).load() : Promise.resolve({}));
  return {
    load,
    /** The sector's crew in this house. impure. */
    async crewFor(wallet, sectorId) {
      return crewOf(await load(wallet), sectorId);
    },
    /** Add (or re-remit) a member of this house's sector. impure. */
    add: (wallet, sectorId, member) => storeOf(wallet).add(sectorId, member),
    /** Release a member of this house's sector. impure. */
    remove: (wallet, sectorId, neumaId) => storeOf(wallet).remove(sectorId, neumaId),
  };
};

// The one instance the routes and the portal share.
export const sectorCrew = createHouseCrew();
