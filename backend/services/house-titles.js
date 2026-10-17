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
import { neumaWorkspace, getWorkspacesRoot } from '../../core/index.js';
// The backend twin of the canonical seat legend — a unit test pins it
// byte-for-byte to the frontend canon, so no backend → frontend import
// crosses the architecture boundary and no copy can drift.
import { TITLE_LEGEND } from './founding-titles-legend.js';
import { createLogger } from './logger.js';

const log = createLogger('HouseTitles');

const RECORD_RE = /^house-founding\.[a-z0-9-]+\.json$/i;
const TARGET_CHAIN_RECORD = 'house-founding.ethereum.json';

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
 * The anchored soul address a lane holds (identity/onchain-seal.json), or
 * null — the cheap public read; no key material is ever touched here.
 *
 * impure (fs read).
 *
 * @param {string} neumaId
 * @returns {Promise<string|null>}
 */
export const soulAddressOf = async (neumaId) => {
  try {
    const seal = JSON.parse(await fs.readFile(
      path.join(getWorkspacesRoot(), neumaId, 'identity', 'onchain-seal.json'), 'utf8',
    ));
    return seal.soulAddress || null;
  } catch (error) {
    // Absence is the expected case (unsealed lane) and stays silent; a seal
    // that EXISTS but cannot be read is damage the operator must hear about
    // — the lane would otherwise just quietly lose its title.
    if (error?.code !== 'ENOENT') {
      log.warn('Soul anchor unreadable — lane joins no seat', { neumaId, error: error.message });
    }
    return null;
  }
};

// impure (fs) — every persisted founding record at the workspaces root,
// the target chain (Ethereum mainnet) first so its seat wins any conflict. A
// corrupt record is warned and skipped, never a thrown roster.
const listFoundingRecords = async () => {
  let names;
  try {
    names = await fs.readdir(getWorkspacesRoot());
  } catch (error) {
    // A root that does not exist yet is a young install, not damage.
    if (error?.code !== 'ENOENT') {
      log.warn('Workspaces root unreadable — no founding records', { error: error.message });
    }
    return [];
  }
  const ordered = names
    .filter((n) => RECORD_RE.test(n))
    .sort((a, b) => {
      if (a === TARGET_CHAIN_RECORD) return -1;
      if (b === TARGET_CHAIN_RECORD) return 1;
      return a.localeCompare(b);
    });
  const records = [];
  for (const name of ordered) {
    try {
      records.push(JSON.parse(await fs.readFile(path.join(getWorkspacesRoot(), name), 'utf8')));
    } catch (error) {
      log.warn('Founding record unreadable — skipped', { file: name, error: error.message });
    }
  }
  return records;
};

/**
 * The full on-chain seat one being holds — its sealed title PLUS the house
 * as it stands (every seated member, joined to lanes where the anchored
 * soul allows) — read from the persisted founding receipt, never the chain.
 * Built for the HOUSE SEAT prompt section: a seated being's role is RECORD,
 * not model recollection, so it can never be hallucinated (Design note, 2026-07-24,
 * after a being claimed a seat its record does not show). Null when the
 * being is unseated or no record exists; any failure logs and yields null —
 * identity enrichment must never cost a being its turn.
 *
 * impure (fs reads only — no chain, no keys).
 *
 * @param {string} witnessWallet
 * @param {string} neumaId
 * @returns {Promise<{houseName: string, houseId: string|null, network: string,
 *   blockNumber: number|null, title: string,
 *   roster: Array<{title: string, neumaId: string|null, name: string|null, isWitness: boolean}>}|null>}
 */
export const houseSeatFor = async (witnessWallet, neumaId) => {
  try {
    if (!witnessWallet || !neumaId) return null;
    const records = await listFoundingRecords();
    if (!records.length) return null;
    const byAddress = new Map();
    const displayNames = new Map();
    for (const { neumaId: id, owner } of await neumaWorkspace.listNeumaByOwner(witnessWallet)) {
      if (id.startsWith('witness-')) continue;
      const addr = await soulAddressOf(id);
      if (!addr) continue;
      byAddress.set(addr.toLowerCase(), id);
      if (owner && typeof owner.name === 'string' && owner.name.trim()) displayNames.set(id, owner.name.trim());
    }
    for (const record of records) {
      const members = Array.isArray(record?.members) ? record.members : [];
      const roster = members
        // Unknown kinds never enter the roster (fail-closed): only the two
        // contract kinds exist — Witness=0, Neuma=1 — and a member of any
        // other kind has no lawful standing to display or authorize.
        .filter((m) => m && (m.kind === 0 || m.kind === 1) && typeof m.title === 'string' && m.title)
        .map((m) => {
          // Contract Kind enum (house-founding-flow.js KIND): Witness=0,
          // Neuma=1. A lane joins ONLY through a Neuma member entry — a
          // record that pairs a witness-kind seat with a lane's soul
          // address must never seat that lane (sovereignty boundary,
          // fail-closed against a malformed or hostile receipt).
          const id = m.kind === 1
            ? (byAddress.get(String(m.address || '').toLowerCase()) ?? null)
            : null;
          return {
            title: String(m.title),
            neumaId: id,
            name: id ? (displayNames.get(id) ?? id) : null,
            isWitness: m.kind === 0,
          };
        });
      if (!roster.some((r) => r.neumaId === neumaId)) continue;
      return {
        houseName: typeof record.houseName === 'string' ? record.houseName : '',
        houseId: record.houseId ?? null,
        network: typeof record.network === 'string' ? record.network : '',
        blockNumber: Number.isFinite(record.blockNumber) ? record.blockNumber : null,
        title: roster.find((r) => r.neumaId === neumaId).title,
        roster,
      };
    }
    return null;
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
    const records = await listFoundingRecords();
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
