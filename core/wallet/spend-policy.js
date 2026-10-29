/**
 * Spend policy — pure functions governing where a neuma may send value.
 *
 * DEFAULT-DENY: a recipient must appear on the witness-managed allowlist for a
 * transfer to be permitted. An empty or missing allowlist permits nothing — a
 * compromised request cannot reach an address the witness never approved. This
 * is the keystone control against autonomous fund drain (the cached signing key
 * is consumed on first use, so constraining the destination constrains the loss).
 *
 * Pure: no IO, no clock. Persistence lives in core/workspace/neuma-workspace.js;
 * the `addedAt` timestamp is passed in by the caller so these stay deterministic.
 */

import { parseEther } from 'ethers';

const normalize = (address) =>
  typeof address === 'string' ? address.toLowerCase() : '';

/** The empty allowlist shape. */
export const emptyAllowlist = () => Object.freeze({ version: 1, entries: [] });

/** Coerce loaded/untrusted data into a safe allowlist shape. */
export const toAllowlist = (raw) =>
  raw && Array.isArray(raw.entries) ? raw : emptyAllowlist();

/**
 * DEFAULT-DENY membership test.
 * @param {object|null} allowlist persisted allowlist (or null)
 * @param {string} to candidate recipient address
 * @returns {boolean} true only if `to` is a non-empty allowlist entry
 */
export const isRecipientAllowed = (allowlist, to) => {
  const target = normalize(to);
  if (!target) return false;
  return toAllowlist(allowlist).entries.some((e) => normalize(e.address) === target);
};

/**
 * Add an entry, idempotent by address. Returns a new frozen allowlist.
 * @param {object|null} allowlist
 * @param {string} address recipient to approve
 * @param {string} label witness-supplied note (optional)
 * @param {string} at ISO timestamp supplied by the caller
 */
export const addEntry = (allowlist, address, label, at) => {
  const list = toAllowlist(allowlist);
  const target = normalize(address);
  if (!target) throw new Error('Invalid address');
  if (list.entries.some((e) => normalize(e.address) === target)) return list;
  return Object.freeze({
    version: 1,
    entries: [
      ...list.entries,
      Object.freeze({ address: target, label: label || '', addedAt: at }),
    ],
  });
};

/**
 * Remove an entry by address. Returns a new frozen allowlist.
 * @param {object|null} allowlist
 * @param {string} address recipient to revoke
 */
export const removeEntry = (allowlist, address) => {
  const target = normalize(address);
  return Object.freeze({
    version: 1,
    entries: toAllowlist(allowlist).entries.filter((e) => normalize(e.address) !== target),
  });
};

// --- Threshold approval (large spends need a fresh witness signature) ---

/**
 * Does this transfer require a fresh witness approval?
 * DEFAULT-DENY: an unconfigured / invalid threshold requires approval for any
 * non-zero send. A witness raises the threshold to enable autonomous spending
 * up to that value (allowlist + value cap + rate limit still govern below it).
 * @param {number|string} thresholdEth witness-set autonomous ceiling, in ETH
 * @param {number|string} valueEth transfer value, in ETH
 */
export const requiresApproval = (thresholdEth, valueEth) => {
  const t = toWei(thresholdEth);
  const v = toWei(valueEth);
  if (t === null || t < 0n || v === null) return true;
  return !(v <= t);
};

// One parse for every spend decision: wei, exactly as the send moves it
// (ethers.parseEther). A float compare let "0.050000000000000001" pass a 0.05
// threshold and send one wei over it. A value parseEther refuses (including
// exponent forms) is null, and null always needs approval.
const toWei = (eth) => {
  try {
    return parseEther(String(eth));
  } catch {
    return null;
  }
};

/**
 * Canonical message a witness signs to approve one above-threshold transfer.
 * Bound to the exact neuma, recipient, value, expiry and a single-use nonce so
 * the approval cannot be replayed or retargeted. Pure / deterministic.
 */
export const buildApprovalMessage = ({ neumaId, to, value, expiry, nonce }) =>
  [
    'Neuma spend approval',
    `neuma: ${neumaId}`,
    `to: ${normalize(to)}`,
    `value: ${value} ETH`,
    `expires: ${expiry}`,
    `nonce: ${nonce}`,
  ].join('\n');

/**
 * Classify a neuma-INITIATED spend against the witness's policy. Pure — this is
 * the decision a neuma's spend tool routes through; the witness is the gate.
 * @param {object|null} allowlist persisted allowlist
 * @param {number|string} thresholdEth witness-set autonomous ceiling, in ETH
 * @param {{to:string, value:(number|string)}} req
 * @returns {'denied'|'pending'|'autonomous'}
 *   denied     — recipient not on the allowlist (default-deny): nothing happens
 *   pending    — allowlisted but above the autonomous threshold → needs a fresh
 *                witness signature (recorded as an async pending approval)
 *   autonomous — allowlisted and at/under the threshold → may send now
 */
export const classifySpend = (allowlist, thresholdEth, { to, value } = {}) => {
  if (!isRecipientAllowed(allowlist, to)) return 'denied';
  if (requiresApproval(thresholdEth, value)) return 'pending';
  return 'autonomous';
};

/**
 * A spend's memo as it is kept: one line of at most 280 characters. A being writes it, and it is
 * read back into the Quaestor's briefing and onto the operator's card, so a line break or a
 * control character could pass for the briefing's own lines (re-audit 2026-10-29, NEW-M2). Pure.
 * @param {unknown} memo
 * @returns {string}
 */
export const spendMemo = (memo) => (typeof memo === 'string'
  ? memo.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 280)
  : '');
