// house-founding-record.js — the founding record's NAME and its OWNER, the one
// law every writer and reader of house-founding records shares.
//
// Two houses on one install (Design note, 2026-10-16: houses are never confused, at any
// level): a record named only by network was overwritten the moment a second
// wallet founded a house here. A record is now named by network AND the
// operator wallet that heads it — `house-founding.<network>.<wallet>.json` —
// and a reader opens only the records named for the reading wallet. The
// legacy `house-founding.<network>.json` stays readable only when its own
// Witness seat is the reading wallet: it is never a fallback for another house.
//
// Plaintext by design: every field is already public on chain.

import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';

const log = createLogger('HouseFoundingRecord');

// The contract's Witness kind (house-founding-confirm.js KIND.Witness) — the
// operator's seat. Mirrored, not imported: that module raises grounds and
// speaks RPC, and every lightweight reader of a record would inherit both.
const KIND_WITNESS = 0;

// Network, then the optional operator wallet (absent on a legacy record).
const FOUNDING_RECORD_RE = /^house-founding\.([a-z0-9-]+?)(?:\.(0x[0-9a-f]{40}))?\.json$/i;

const lower = (value) => String(value || '').toLowerCase();

/**
 * The operator wallet a record belongs to: its Witness seat, lowercased, or
 * null when it seats no operator. pure.
 * @param {object} record
 * @returns {string|null}
 */
export const recordOperator = (record) => {
  const members = Array.isArray(record?.members) ? record.members : [];
  const seat = members.find((m) => m?.kind === KIND_WITNESS && typeof m.address === 'string');
  return seat ? lower(seat.address) : null;
};

/**
 * Whether a record read from disk is this wallet's. A record named for the
 * wallet is, unless its own Witness seat names another; a legacy record named
 * by network alone is only when its Witness seat IS the wallet — never by
 * default. pure.
 * @param {object} record
 * @param {string} wallet - lowercased operator wallet
 * @param {boolean} keyed - the file name carries this wallet
 * @returns {boolean}
 */
export const recordBelongsTo = (record, wallet, keyed) => {
  const seat = recordOperator(record);
  return keyed ? seat === null || seat === wallet : seat === wallet;
};

/**
 * The file name a record is kept under: per wallet when the record seats an
 * operator, else the legacy network-only name — which no wallet's read will
 * ever trust, because no Witness seat proves it belongs to one. pure.
 * @param {string} network
 * @param {string|null} wallet
 * @returns {string}
 */
export const foundingRecordName = (network, wallet) =>
  (wallet ? `house-founding.${network}.${lower(wallet)}.json` : `house-founding.${network}.json`);

/**
 * Every founding record that belongs to this wallet, from the workspaces
 * root (recordBelongsTo): its own per-wallet records, and a legacy record
 * only when that record's Witness seat is this wallet. A corrupt record is
 * warned and skipped; a root that does not exist yet is an empty list.
 *
 * impure (fs reads).
 *
 * @param {string} wallet - the operator wallet
 * @returns {Promise<Array<{name: string, network: string, record: object}>>}
 * @throws when the root exists but cannot be listed
 */
export const readOperatorRecords = async (wallet) => {
  const owner = lower(wallet);
  if (!owner) return [];
  let names;
  try {
    names = await fs.readdir(getWorkspacesRoot());
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const name of names) {
    const match = FOUNDING_RECORD_RE.exec(name);
    // A record named for another wallet is that house's — never opened.
    if (!match || (match[2] && lower(match[2]) !== owner)) continue;
    try {
      const record = JSON.parse(await fs.readFile(path.join(getWorkspacesRoot(), name), 'utf8'));
      if (recordBelongsTo(record, owner, Boolean(match[2]))) out.push({ name, network: match[1], record });
    } catch (error) {
      log.warn('Founding record unreadable — skipped', { file: name, error: error.message });
    }
  }
  return out;
};
