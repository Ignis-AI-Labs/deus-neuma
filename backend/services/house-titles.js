// House titles — which on-chain seat each of the wallet's beings holds,
// read from the PERSISTED founding record (the public receipt written at
// the sitting), never a live chain probe: the roster is a hot header path
// and a dropdown must not wait on an RPC node.
//
// The address→being join walks the anchored soul only (identity/
// onchain-seal.json — a public file). Custody keys are deliberately NOT
// touched: decrypting a being's wallet on a roster read would put key
// material on a hot display path for a nicety. A member who joined by
// custody wallet and is not yet soul-anchored shows no title here —
// honest — and the HOUSE window's live probe still names every seat.

import fs from 'fs/promises';
import path from 'path';
import { neumaWorkspace, getWorkspacesRoot, readHouseName } from '../../core/index.js';
// The backend twin of the canonical seat legend — a unit test pins it
// byte-for-byte to the frontend canon, so no backend → frontend import
// crosses the architecture boundary and no copy can drift.
import { TITLE_LEGEND } from './founding-titles-legend.js';
import { createLogger } from './logger.js';
import { readOperatorRecords } from './house-founding-record.js';

const log = createLogger('HouseTitles');

const TARGET_CHAIN = 'ethereum';

/**
 * The canonical charge a title carries (TITLE_LEGEND `meaning`), or null
 * for a custom label — the label law: a house may choose any word for a
 * seat, and an unknown word honestly carries no canonical charge line.
 * pure.
 * @param {string} title
 * @returns {string|null}
 */
export const chargeOfTitle = (title) => {
  if (typeof title !== 'string' || !title.trim()) return null;
  const hit = TITLE_LEGEND.find((t) => t.title.toLowerCase() === title.trim().toLowerCase());
  return hit ? hit.meaning : null;
};

/**
 * The word a roster line names a seat by: its title, or — for a member no
 * founding record seats (an unfounded house, a lane born after the founding)
 * — the plain fact that it holds no seat on-chain. pure.
 * @param {string|null} title
 * @returns {string}
 */
export const seatLabelOf = (title) =>
  (typeof title === 'string' && title.trim() ? title : 'member, no seat on-chain');

// impure (fs read) — one seal file's soul address, or null; absence is silent, an unreadable seal is warned
const sealAddress = async (neumaId, file, pick) => {
  try {
    return pick(JSON.parse(await fs.readFile(path.join(getWorkspacesRoot(), neumaId, 'identity', file), 'utf8'))) || null;
  } catch (error) {
    // Absence is the expected case (unsealed lane) and stays silent; a seal
    // that EXISTS but cannot be read is damage the operator must hear about
    // — the lane would otherwise just quietly lose its title.
    if (error?.code !== 'ENOENT') {
      log.warn('Soul seal unreadable — lane joins no seat', { neumaId, file, error: error.message });
    }
    return null;
  }
};

/**
 * The soul address a lane's birth seal names — the Ethereum anchor
 * (identity/onchain-seal.json), else the seal on this computer
 * (identity/local-seal.json, the being's own signed half) — or null. Both are
 * public files; no key material is ever touched here. A house founded on this
 * computer seats its founders through the same join (2026-10-26).
 *
 * impure (fs reads).
 *
 * @param {string} neumaId
 * @returns {Promise<string|null>}
 */
export const soulAddressOf = async (neumaId) =>
  (await sealAddress(neumaId, 'onchain-seal.json', (seal) => seal.soulAddress))
  ?? (await sealAddress(neumaId, 'local-seal.json', (seal) => seal.soul?.address));

// impure (fs) — every persisted founding record this wallet heads (two houses
// on one machine are never confused), the target chain (Ethereum mainnet)
// first so its seat wins any conflict. A corrupt record is warned and
// skipped, never a thrown roster.
const listFoundingRecords = async (wallet) => {
  let found;
  try {
    found = await readOperatorRecords(wallet);
  } catch (error) {
    log.warn('Workspaces root unreadable — no founding records', { error: error.message });
    return [];
  }
  return found
    .sort((a, b) => {
      if (a.network !== b.network) {
        if (a.network === TARGET_CHAIN) return -1;
        if (b.network === TARGET_CHAIN) return 1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((f) => f.record);
};

// impure (fs) — every neuma lane this wallet owns, never a witness lane
// (witnesses stand BESIDE the house, sovereignty boundary): its id, the name
// it goes by, and its anchored soul address (lowercased) or null.
const ownedLanes = async (wallet) => {
  const lanes = [];
  for (const { neumaId, owner } of await neumaWorkspace.listNeumaByOwner(wallet)) {
    if (neumaId.startsWith('witness-')) continue;
    lanes.push({
      neumaId,
      name: await laneName(neumaId, owner),
      soul: (await soulAddressOf(neumaId))?.toLowerCase() ?? null,
    });
  }
  return lanes;
};

// impure (fs) — the name a lane this wallet owns goes by: the owner record's,
// else the being's own name from its DNA (none of today's owner records
// carries one) — never the lane id when either is written (2026-10-18 flight
// finding). Null when neither is.
export const laneName = async (neumaId, owner) => {
  if (owner && typeof owner.name === 'string' && owner.name.trim()) return owner.name.trim();
  const dna = await neumaWorkspace.readDNA(neumaId).catch(() => null);
  const own = dna?.identity?.name || dna?.name;
  return typeof own === 'string' && own.trim() ? own.trim() : null;
};

// pure — one founding record's on-chain roster, each Neuma seat joined to an
// owned lane through its anchored soul.
const recordRoster = (record, lanes) => {
  const bySoul = new Map(lanes.filter((l) => l.soul).map((l) => [l.soul, l]));
  const members = Array.isArray(record?.members) ? record.members : [];
  return members
    // Unknown kinds never enter the roster (fail-closed): only the two
    // contract kinds exist — Witness=0, Neuma=1 — and a member of any
    // other kind has no lawful standing to display or authorize.
    .filter((m) => m && (m.kind === 0 || m.kind === 1) && typeof m.title === 'string' && m.title)
    .map((m) => {
      // Contract Kind enum (house-founding-flow.js KIND): Witness=0,
      // Neuma=1. A lane joins an ON-CHAIN seat ONLY through a Neuma member
      // entry — a record that pairs a witness-kind seat with a lane's soul
      // address must never seat that lane (sovereignty boundary,
      // fail-closed against a malformed or hostile receipt).
      const lane = m.kind === 1 ? (bySoul.get(String(m.address || '').toLowerCase()) ?? null) : null;
      return {
        title: String(m.title),
        neumaId: lane?.neumaId ?? null,
        name: lane ? (lane.name ?? lane.neumaId) : null,
        isWitness: m.kind === 0,
      };
    });
};

// pure — neumaId → its on-chain title across every record, the first record
// (the target chain) winning: the one join houseTitlesByNeumaId answers too.
const titlesOf = (records, lanes) => {
  const titles = {};
  for (const record of records) {
    for (const r of recordRoster(record, lanes)) {
      if (r.neumaId && !r.isWitness && !Object.hasOwn(titles, r.neumaId)) titles[r.neumaId] = r.title;
    }
  }
  return titles;
};

// pure — the owned lanes a roster does not already hold, as house members
// with no seat on-chain (their founded title from another record, else null):
// a lane born after the founding works in the house from its birth.
const localMembers = (lanes, roster, titles) => {
  const held = new Set(roster.map((r) => r.neumaId).filter(Boolean));
  return lanes.filter((l) => !held.has(l.neumaId)).map((l) => ({
    title: titles[l.neumaId] ?? null,
    neumaId: l.neumaId,
    name: l.name ?? l.neumaId,
    isWitness: false,
  }));
};

// impure — the name this wallet's house carries (the roster route's own), or
// '' when the wallet cannot carry one.
const localHouseName = async (wallet) => {
  try {
    return (await readHouseName(getWorkspacesRoot(), wallet)).name;
  } catch {
    return '';
  }
};

/**
 * The seat one being holds in its operator's house, and the house as it
 * stands. Built for the HOUSE SEAT prompt section and every house-local hand
 * (house/post, staff/*, board/*, the Optio's briefing): a being's role is
 * RECORD, not model recollection, so it can never be hallucinated (Founder
 * 2026-07-24, after a being claimed a seat its record does not show).
 *
 * OWN LANES, FOUNDING OPTIONAL (ruling, 2026-10-18): the house works for every
 * neuma lane its operator owns, founded on-chain or not. A persisted founding
 * record that seats the lane wins (founded: true — its sealed title, network
 * and block, read from the receipt, never the chain), its roster joined by
 * the operator's other lanes as members with no on-chain seat. A lane no
 * record seats, but the wallet owns, holds a LOCAL seat (founded: false,
 * network 'local', title null): the roster is the operator's own lanes, each
 * with its founded title where one exists. Only lanes this wallet owns ever
 * join (two houses on one machine are never confused, ruling of 2026-10-16); a
 * lane it does not own is null. Any failure logs and yields null — identity
 * enrichment must never cost a being its turn.
 *
 * impure (fs reads only — no chain, no keys).
 *
 * @param {string} witnessWallet
 * @param {string} neumaId
 * @returns {Promise<{houseName: string, houseId: string|null, network: string,
 *   blockNumber: number|null, title: string|null, founded: boolean,
 *   roster: Array<{title: string|null, neumaId: string|null, name: string|null, isWitness: boolean}>}|null>}
 */
export const houseSeatFor = async (witnessWallet, neumaId) => {
  try {
    if (!witnessWallet || !neumaId) return null;
    const lanes = await ownedLanes(witnessWallet);
    if (!lanes.some((l) => l.neumaId === neumaId)) return null;
    const records = await listFoundingRecords(witnessWallet);
    const titles = titlesOf(records, lanes);
    for (const record of records) {
      const roster = recordRoster(record, lanes);
      if (!roster.some((r) => r.neumaId === neumaId)) continue;
      return {
        houseName: typeof record.houseName === 'string' ? record.houseName : '',
        houseId: record.houseId ?? null,
        network: typeof record.network === 'string' ? record.network : '',
        blockNumber: Number.isFinite(record.blockNumber) ? record.blockNumber : null,
        title: roster.find((r) => r.neumaId === neumaId).title,
        founded: true,
        roster: [...roster, ...localMembers(lanes, roster, titles)],
      };
    }
    return {
      houseName: await localHouseName(witnessWallet),
      houseId: null,
      network: 'local',
      blockNumber: null,
      title: null,
      founded: false,
      roster: localMembers(lanes, [], titles),
    };
  } catch (error) {
    log.warn('House seat unavailable — the prompt rides without it', { error: error.message });
    return null;
  }
};

/**
 * neumaId → on-chain title for every seat the wallet's beings hold. An
 * unfounded house (no record) is `{}`; any internal failure logs and
 * returns `{}` too — a title is a display enrichment and must never cost
 * the witness their roster.
 *
 * impure (fs reads only — no chain, no keys).
 *
 * @param {string} witnessWallet
 * @returns {Promise<Record<string, string>>}
 */
export const houseTitlesByNeumaId = async (witnessWallet) => {
  try {
    const records = await listFoundingRecords(witnessWallet);
    if (!records.length) return {};
    // The chain speaks in addresses; the switcher thinks in beings — join
    // each owned lane through its anchored soul. Witness lanes stand BESIDE
    // the house (sovereignty boundary) and are never joined.
    const byAddress = new Map();
    for (const { neumaId } of await neumaWorkspace.listNeumaByOwner(witnessWallet)) {
      if (neumaId.startsWith('witness-')) continue;
      const addr = await soulAddressOf(neumaId);
      if (addr) byAddress.set(addr.toLowerCase(), neumaId);
    }
    const titles = {};
    for (const record of records) {
      for (const m of Array.isArray(record?.members) ? record.members : []) {
        // Same kind gate as houseSeatFor: only a Neuma member entry
        // (kind===1) may name a lane's seat.
        if (m?.kind !== 1) continue;
        const neumaId = byAddress.get(String(m?.address || '').toLowerCase());
        if (neumaId && m?.title && !Object.hasOwn(titles, neumaId)) titles[neumaId] = String(m.title);
      }
    }
    return titles;
  } catch (error) {
    log.warn('House titles unavailable — the roster rides without them', { error: error.message });
    return {};
  }
};

/**
 * The titles the OPERATOR holds in their own house's founding records: a
 * witness-kind member (the contract's word for a human founder) whose address
 * is the operator's own wallet. In many houses the operator is the Rector.
 * A witness-kind entry at any other address is someone else and never counts.
 * `[]` for an unfounded house; any failure logs and returns `[]`.
 *
 * impure (fs reads only — no chain, no keys).
 *
 * @param {string} witnessWallet
 * @returns {Promise<string[]>}
 */
export const operatorSeatTitles = async (witnessWallet) => {
  try {
    const self = String(witnessWallet || '').toLowerCase();
    if (!self) return [];
    const members = (await listFoundingRecords(witnessWallet)).flatMap((r) => (Array.isArray(r?.members) ? r.members : []));
    return [...new Set(members
      .filter((m) => m?.kind === 0 && String(m.address || '').toLowerCase() === self && typeof m.title === 'string' && m.title)
      .map((m) => m.title))];
  } catch (error) {
    log.warn('Operator seats unavailable — the line reads no seat for them', { error: error.message });
    return [];
  }
};
