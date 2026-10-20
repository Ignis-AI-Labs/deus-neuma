/**
 * ONE-SHOT GRANTS — the operator's ALLOW ONCE on an act house work was
 * refused (Design note, 2026-10-16: the operator […]).
 *
 * A wake never waits on a card, so a refused act has no turn left to settle.
 * When the operator answers its ask ALLOW, a grant is written here: ONE use,
 * for exactly that seat, that tool and those arguments (a hash of their
 * canonical JSON), and the seat is woken to take it again. The house's act
 * route (wake-approvals.js) consumes the grant on the first matching act —
 * any other seat, tool or argument is no match — and the act is recorded as
 * the operator's yes ({kind: 'operator', askId}). A consumed grant never
 * matches again.
 *
 * Only the operator's own answer writes a grant (the answer route, under
 * their token): nothing here lets the Optio, a charter or a seat grant one,
 * and money out is allowed only this way — by the operator, once.
 *
 * `<realm>/<wallet>/house-clock/grants.json`, every read-modify-write under
 * the in-process chain and the cross-process lock (the queue's idiom).
 *
 * Pure: canonical JSON, the hash, the match. impure: the file.
 */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { writeJsonAtomic } from '../user-realm.js';
import { createWriteChain } from '../write-chain.js';
import { withFileLock } from '../file-lock.js';
import { clockDir } from './wake-ledger.js';

/** The longest arguments an ask keeps whole, so the seat can repeat them exactly. */
export const ASK_ARGS_MAX = 8000;

// pure — JSON with every object's keys sorted, so the same arguments hash the same however written
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

/**
 * The fingerprint of one act's arguments. Pure.
 * @param {unknown} args
 * @returns {string} sha256 hex
 */
export const argsHash = (args) => createHash('sha256').update(canonical(args ?? {})).digest('hex');

/**
 * What an act ask keeps of its arguments: the hash always, the arguments
 * themselves while they are short enough to repeat. Pure.
 * @param {unknown} args
 * @returns {{argsHash: string, args?: Object}}
 */
export const askArgs = (args) => {
  const text = canonical(args ?? {});
  return { argsHash: argsHash(args), ...(text.length <= ASK_ARGS_MAX ? { args: args ?? {} } : {}) };
};

/**
 * The first unused grant for exactly this act, or null. Pure.
 * @param {Object[]} grants
 * @param {{seat: string, tool: string, hash: string}} act
 */
export const matchGrant = (grants, { seat, tool, hash }) =>
  grants.find((g) => !g.consumedAt && g.seat === seat && g.tool === tool && g.argsHash === hash) ?? null;

const grantsFile = (wallet) => path.join(clockDir(wallet), 'grants.json');
const chain = createWriteChain();
const serialize = (wallet, fn) => chain(() => withFileLock(`${grantsFile(wallet)}.lock`, fn));

// impure — the house's grants; missing is none, corrupt throws (read as none it would drop a grant)
const load = async (wallet) => {
  try {
    return JSON.parse(await fs.readFile(grantsFile(wallet), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { v: 1, grants: [] };
    throw err;
  }
};

/**
 * The operator allows one act once. impure.
 * @param {string} wallet
 * @param {{askId: string, seat: string, tool: string, argsHash: string, by: string}} grant
 */
export const grantOnce = (wallet, grant) => serialize(wallet, async () => {
  const state = await load(wallet);
  state.grants.push({ ...grant, grantedAt: new Date().toISOString() });
  await writeJsonAtomic(grantsFile(wallet), state);
});

/**
 * Use the grant for exactly this act, if one stands. impure.
 * @param {string} wallet
 * @param {{seat: string, tool: string, args?: unknown}} act
 * @returns {Promise<?Object>} the grant used, or null
 */
export const consumeGrant = (wallet, { seat, tool, args }) => serialize(wallet, async () => {
  const state = await load(wallet);
  const grant = matchGrant(state.grants, { seat, tool, hash: argsHash(args) });
  if (!grant) return null;
  grant.consumedAt = new Date().toISOString();
  await writeJsonAtomic(grantsFile(wallet), state);
  return grant;
});
