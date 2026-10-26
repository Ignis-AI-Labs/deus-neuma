// treasury-flight — the treasury's flight check (SHINKEI: every mark is a
// fact read just now, never a belief): the seat seated, the wallets
// readable, the limits in force, the allowlists standing, no orphaned spend,
// every signing key in custody, and the trade lock closed.
//
// A mark is { id, label, state, line }: state ok | warn | fail | unread —
// `unread` when the fact could not be read (never shown as ok).
//
// The marks are pure over what treasury-board read; the two probes that read
// the disk and the wallet code live here too, marked impure.
import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { signTransaction } from '../neuma-wallet.js';

// A send that began and has not settled in this long never will on its own.
const ORPHAN_AFTER_MS = 10 * 60 * 1000;

const nameOf = (lane) => lane.name || lane.neumaId;
const mark = (id, label, state, line) => Object.freeze({ id, label, state, line });

/**
 * impure — where a being's signing key stands, read from its lane without
 * ever handing back a key: `sealed` (an encrypted envelope, no bare key),
 * `bare` (a plaintext private key on disk — the wallet audit's one failing
 * shape), or `none` (no key at all).
 * @param {string} neumaId
 * @returns {Promise<'sealed'|'bare'|'none'>}
 */
export const keyCustodyOf = async (neumaId) => {
  const keys = path.join(neumaWorkspace.pathFor(neumaId), 'keys');
  let bare = false;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(keys, 'keypair.json'), 'utf8'));
    bare = typeof parsed?.privateKey === 'string' && parsed.privateKey.length > 0;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (bare) return 'bare';
  const sealed = await fs.stat(path.join(keys, 'keypair-encrypted.json')).then(() => true, () => false);
  return sealed ? 'sealed' : 'none';
};

/** impure — is raw transaction signing still refused by the wallet code? (W3-005) */
export const rawSigningRefused = () => signTransaction().then(() => false, () => true);

/**
 * The marks, from the board's reads. Pure.
 * @param {{officer: ?{laneId: string}, officerName: ?string,
 *   lanes: Array<{neumaId: string, name: ?string, address: ?string, baseEth: ?string,
 *     thresholdEth: number, allowlistCount: number, custody: string, records: Array<object>}>,
 *   capEth: string, rawSigningRefused: boolean, nowMs: number}} facts
 * @returns {ReadonlyArray<object>}
 */
export const treasuryMarks = ({ officer, officerName, lanes, capEth, rawSigningRefused: refused, nowMs }) => {
  const noWallet = lanes.filter((l) => !l.address);
  const unread = lanes.filter((l) => l.address && l.baseEth === null);
  const loose = lanes.filter((l) => l.thresholdEth > 0);
  const recipients = lanes.reduce((n, l) => n + l.allowlistCount, 0);
  const orphans = lanes.flatMap((l) => l.records
    .filter((r) => r.status === 'executing' && nowMs - Date.parse(r.approvalStartedAt || r.requestedAt) > ORPHAN_AFTER_MS)
    .map((r) => ({ lane: l, record: r })));
  const pending = lanes.reduce((n, l) => n + l.records.filter((r) => r.status === 'pending').length, 0);
  const bare = lanes.filter((l) => l.custody === 'bare');
  const keyless = lanes.filter((l) => l.custody === 'none');
  return Object.freeze([
    officer
      ? mark('seat', 'SEAT', 'ok', `The Quaestor's seat is held by ${officerName || officer.laneId}.`)
      : mark('seat', 'SEAT', 'warn', 'No Quaestor is seated — nobody reviews the house\'s spends before you decide them.'),
    lanes.length === 0
      ? mark('wallets', 'WALLETS', 'ok', 'This house has no beings yet — only your own wallet.')
      : noWallet.length
        ? mark('wallets', 'WALLETS', 'warn', `${noWallet.map(nameOf).join(', ')} ${noWallet.length === 1 ? 'has' : 'have'} no wallet yet.`)
        : unread.length
          ? mark('wallets', 'WALLETS', 'unread', `${unread.length} of ${lanes.length} balances did not answer on Base — the chain was not reached.`)
          : mark('wallets', 'WALLETS', 'ok', `All ${lanes.length} being wallets read on Base just now.`),
    loose.length
      ? mark('limits', 'LIMITS', 'warn', `${loose.map((l) => `${nameOf(l)} may send up to ${l.thresholdEth} ETH`).join('; ')} to approved recipients without your signature (never more than ${capEth} ETH a send). Set the threshold to 0 for a signature on every send.`)
      : mark('limits', 'LIMITS', 'ok', 'Every send from every being needs your own signature.'),
    mark('allowlists', 'RECIPIENTS', 'ok', `${recipients} approved recipient${recipients === 1 ? '' : 's'} across the house. Any other address is refused.`),
    orphans.length
      ? mark('pending', 'PENDING', 'fail', `${orphans.length} approved send${orphans.length === 1 ? '' : 's'} began and never settled (${orphans.map((o) => `${nameOf(o.lane)}: ${o.record.value} ETH`).join('; ')}). It is never retried — check the chain for it.`)
      : mark('pending', 'PENDING', 'ok', `${pending} waiting on you; nothing stuck.`),
    bare.length
      ? mark('custody', 'KEYS', 'fail', `${bare.map(nameOf).join(', ')} ${bare.length === 1 ? 'holds' : 'hold'} a signing key unsealed on disk. Finish the key custody step for ${bare.length === 1 ? 'it' : 'them'}.`)
      : keyless.length
        ? mark('custody', 'KEYS', 'warn', `${keyless.map(nameOf).join(', ')} ${keyless.length === 1 ? 'has' : 'have'} no signing key.`)
        : mark('custody', 'KEYS', 'ok', 'Every being\'s signing key is sealed under its password and recovery codes.'),
    refused
      ? mark('trade', 'TRADE LOCK', 'ok', 'Raw signing was refused just now, and the send path refuses contract calls: money moves only as a plain transfer.')
      : mark('trade', 'TRADE LOCK', 'fail', 'Raw transaction signing answered — the trade lock is open. Stop and report this.'),
  ]);
};
