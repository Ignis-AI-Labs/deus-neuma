/**
 * THE CHARTER STORE — one charter per house, in the operator's own realm.
 *
 * Keyed the way the house's shared ground is keyed (house-workspace.js): the
 * house IS its operator's wallet, so the charter sits beside that wallet's
 * house-workspace.json (`<realm>/<wallet>/house-charter.json`). A charter is
 * one per house, as the Optio's seat is (staff/cos-designation.js), because
 * two operators on one machine are two houses with two consents.
 *
 * The law of the record:
 *   - EDITING RESETS APPROVAL. Every write is a new version, and an approval
 *     names the version it approved — so a charter changed after the operator
 *     said yes is not approved until they say yes again.
 *   - PAUSE is the master switch. It survives edits (an edit never unpauses
 *     the house) and never touches approval (pausing is not withdrawing).
 *   - Every superseded version is kept, append-only, in
 *     house-charter-history.jsonl: the operator can see what they approved.
 *
 * impure — realm disk, through writeJsonAtomic (tmp + rename).
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from '../user-realm.js';
import { createWriteChain } from '../write-chain.js';
import { GLOBAL_DEFAULTS } from '../tool-policy-defaults.js';
import { intentTypes } from '../intents/registry.js';
import { normalizeCharter } from './charter-shape.js';
import { readCharter, charterFileOf as fileOf } from './charter-read.js';

// The read lives in its own leaf (charter-read.js): a reader that only needs the
// record (the WAITING ON YOU account) must not pull the write path's imports in.
export { readCharter };
const historyOf = (wallet) => path.join(walletDir(wallet), 'house-charter-history.jsonl');

// One chain for the store: a PUT and an approve must never interleave their
// read + write.
const serialize = createWriteChain();

/** A refusal the route turns into a status, with the operator's reason. */
export class CharterError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();

// pure — the act ids a charter may name, in the id space the house matches them in (`server/tool`, as
// protocol-guard.js holdForWake and optio-review.js actRoute read them): every row of the policy
// defaults, and every registered intent as intents/<policyTool>
const knownActIds = () => new Set([
  ...Object.entries(GLOBAL_DEFAULTS).flatMap(([server, row]) => [...row.allowed, ...row.denied, ...row.requireApproval].map((tool) => `${server}/${tool}`)),
  ...intentTypes().map((t) => `intents/${t.policyTool}`),
]);

/**
 * Write the charter: a new version, pending the operator's approval. impure.
 * @param {string} wallet - the house
 * @param {Object} input - the charter's fields (charter-shape.js)
 * @param {{by: string, ownedLanes: string[]}} opts - who wrote it; the house's lanes
 * @returns {Promise<Object>} the stored record
 */
export const writeCharter = (wallet, input, { by, ownedLanes }) => serialize(async () => {
  let fields;
  try {
    fields = normalizeCharter(input, { ownedLanes, knownActs: knownActIds() });
  } catch (err) {
    throw new CharterError(err.message);
  }
  const prior = await readCharter(wallet);
  if (prior) await fs.appendFile(historyOf(wallet), `${JSON.stringify(prior)}\n`, 'utf8');
  const record = {
    v: 1,
    ...fields,
    paused: prior?.paused ?? false,
    pausedAt: prior?.pausedAt ?? null,
    version: (prior?.version ?? 0) + 1,
    updatedAt: now(),
    updatedBy: String(by || '').toLowerCase() || null,
    approvedAt: null,
    approvedBy: null,
    approvedVersion: null,
  };
  await writeJsonAtomic(fileOf(wallet), record);
  return record;
});

/**
 * The operator approves the version they read. impure.
 * @param {string} wallet
 * @param {{version: number, by: string}} opts - the version on the operator's screen
 * @returns {Promise<Object>}
 */
export const approveCharter = (wallet, { version, by }) => serialize(async () => {
  const record = await readCharter(wallet);
  if (!record) throw new CharterError('this house has no charter to approve', 404);
  if (version !== record.version) {
    throw new CharterError(`the charter is at version ${record.version}, not ${version} — read it again before approving`, 409);
  }
  const approved = {
    ...record,
    approvedAt: now(),
    approvedBy: { wallet: String(by || '').toLowerCase(), via: 'desk' },
    approvedVersion: record.version,
  };
  await writeJsonAtomic(fileOf(wallet), approved);
  return approved;
});

/**
 * Throw or release the master switch. impure.
 * @param {string} wallet
 * @param {boolean} paused
 * @returns {Promise<Object>}
 */
export const setCharterPaused = (wallet, paused) => serialize(async () => {
  const record = await readCharter(wallet);
  if (!record) throw new CharterError('this house has no charter to pause', 404);
  const next = { ...record, paused: Boolean(paused), pausedAt: paused ? now() : null };
  await writeJsonAtomic(fileOf(wallet), next);
  return next;
});

/**
 * Every superseded version, oldest first. impure. A torn tail line costs that
 * line, never the history.
 * @param {string} wallet
 * @returns {Promise<Object[]>}
 */
export const readCharterHistory = async (wallet) => {
  let raw;
  try {
    raw = await fs.readFile(historyOf(wallet), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw.split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
};
