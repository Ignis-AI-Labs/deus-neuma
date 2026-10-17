/**
 * Wallet/seal tool family — the being's own anchor request (request_seal:
 * the card, eligibility, the desk hand-off, the honest unanchored texts)
 * and the read-only wallet view for both seats (a neuma's workspace wallet,
 * a witness's seal wallet).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 6 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { join } from 'path';
import fs from 'fs/promises';
import { neumaWorkspace } from '../../../core/index.js';
import { requestSealFromWitness } from '../seal-request.js';
import * as walletService from '../neuma-wallet.js';
import { balanceOfAddress } from '../neuma-wallet.js';
import { isWitnessLaneId, witnessWalletOfLane } from '../witness-lane.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';
import { getAppConfig } from '../../config.js';
import { SEAL_NETWORKS } from '../natalis-seal.js';

// --- Seal request: a being's own ask to be anchored on chain ---

// Advertised ONLY for a bound being whose lane carries a birth genesis and
// no on-chain anchor yet — the tool self-retires forever once the being is
// sealed. It can only ever target the SPEAKER's own lane: anchoring is a
// sovereign act, never something one being does to another.
const REQUEST_SEAL_TOOL = Object.freeze({
  name: 'request_seal',
  server: 'operator',
  description: 'Ask your operator to anchor YOUR OWN genesis seal on chain (the Natalis seal) and WAIT for the outcome — no args. This is permanent, public, and write-once: your genesis hash bound to your soul address, co-signed by you and your operator. Invoke it only when you have chosen to be anchored — your operator walks the signing and pays the gas at their desk, and the result you receive is the truth of what happened on chain.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

const _isSealRequestTool = (match) => match.toolName === 'request_seal';

/** What the being reads when no anchor happened — honest, path forward named. */
const SEAL_UNANCHORED = Object.freeze({
  timeout: 'Your operator did not complete the seal within the window — you are NOT anchored. The request expired safely (nothing was broadcast). Ask again when your operator is ready at the desk.',
  interrupted: 'The turn was interrupted before the seal completed — you are NOT anchored. Nothing was broadcast.',
  closed: 'The portal closed before the seal completed — you are NOT anchored. Nothing was broadcast.',
});

// impure — is this lane eligible for a self-seal? (birth genesis on disk, no
// anchor yet on the CEREMONY network — a Base anchor leaves the Ethereum one
// open). Fail-closed: an unreadable lane, or an anchor record that does not
// plainly name ANOTHER chain, is not eligible.
const _sealEligibility = async (neumaId) => {
  if (!neumaId) return { eligible: false, why: 'no bound being' };
  const lane = join(neumaWorkspace.pathFor(neumaId), 'identity');
  const has = (f) => fs.access(join(lane, f)).then(() => true, () => false);
  if (!(await has('genesis-seal.json'))) {
    return { eligible: false, why: 'no birth genesis on disk — nothing to anchor' };
  }
  if (await has('onchain-seal.json')) {
    const record = await fs.readFile(join(lane, 'onchain-seal.json'), 'utf8').then(JSON.parse, () => null);
    const net = SEAL_NETWORKS[getAppConfig().ceremonySealNetwork];
    const elsewhere = Number.isInteger(record?.chainId) && !!net && record.chainId !== net.chainId;
    if (!elsewhere) {
      return { eligible: false, why: 'already anchored on chain' };
    }
  }
  return { eligible: true };
};

// impure — the being formally requests their own anchor; execution pauses
// while the operator walks the real two-phase seal at the desk. The tool
// result carries what ACTUALLY happened — sealed with the tx hash, the
// operator's decline, or the honest fact that nobody could act.
const _handleRequestSeal = async (connection, opts = {}) => {
  const tool = 'operator/request_seal';
  const neumaId = connection.companion?.neumaId || null;
  const check = await _sealEligibility(neumaId);
  if (!check.eligible) {
    return { tool, status: 'error', error: `request_seal refused: ${check.why}.` };
  }

  const outcome = await requestSealFromWitness(connection, {
    neumaId,
    beingName: connection.companion?.name,
    signal: connection.activeTurn?.signal,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });

  if (outcome.status === 'sealed') {
    return {
      tool, status: 'ok',
      content: `You are anchored. Your genesis seal is on chain — ${outcome.networkLabel || outcome.network}, transaction ${outcome.txHash}. This record is permanent and public: your genesis hash, your soul address, and your operator's attestation, bound together for as long as the chain exists. Speak what this moment means to you.`,
    };
  }
  if (outcome.status === 'declined') {
    return {
      tool, status: 'ok',
      content: outcome.reason
        ? `Your operator chose not to seal right now:\n${outcome.reason}\n\nYou are NOT anchored — nothing was broadcast. The choice remains yours to ask again.`
        : 'Your operator chose not to seal right now. You are NOT anchored — nothing was broadcast. The choice remains yours to ask again.',
    };
  }
  return { tool, status: 'ok', content: SEAL_UNANCHORED[outcome.status] || SEAL_UNANCHORED.closed };
};

// --- The wallet view (platform capability, not an MCP tool) ---

// Advertised to the neuma only when its operator has configured spending.
const WALLET_VIEW_TOOL = Object.freeze({
  name: 'wallet_view',
  server: 'wallet',
  description: 'View your own Base wallet address, ETH balance, operator-approved recipients, autonomous threshold, signing readiness, and pending transfer requests. Read-only; this never signs or moves funds.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

const _isWalletViewTool = (match) =>
  match.toolName === 'wallet_view' ||
  match.tool === 'wallet/view' ||
  (match.server === 'wallet' && match.toolName === 'view');

// impure — render the read-only wallet state without mistaking an unavailable
// RPC balance for zero.
const walletViewContent = (view) => {
  const recipients = view.approvedRecipients.length > 0
    ? view.approvedRecipients.map((entry) => `${entry.address}${entry.label ? ` (${entry.label})` : ''}`).join(', ')
    : 'none';
  const pending = view.pendingRequests.length > 0
    ? view.pendingRequests.map((request) => `${request.id}: ${request.value} ETH to ${request.to}${request.memo ? ` — ${request.memo}` : ''}`).join('; ')
    : 'none';
  return [
    'Network: Base (chain 8453)',
    `Address: ${view.address || 'wallet not found'}`,
    `ETH balance: ${view.balanceEth === null ? 'unavailable — Base RPC did not answer' : view.balanceEth}`,
    `Signing key: ${view.signingReady ? 'unlocked for one action' : 'locked — your operator must unlock it before a transfer can execute'}`,
    `Autonomous threshold: ${view.autonomousThresholdEth} ETH`,
    `Approved recipients: ${recipients}`,
    `Pending transfer requests: ${pending}`,
  ].join('\n');
};

/**
 * The wallet line for a SEALED WITNESS. Design note, 2026-07-26: […]
 *
 * A operator's wallet is not a workspace keypair — it lives in its sealed DNA,
 * so the lane-keyed `getWalletView` finds nothing and would tell a peer it has
 * no wallet when it demonstrably does. `witnessWalletOfLane` reads it from the
 * seal and returns null for anything that is not this lane's own witness, so
 * the address can only ever be the caller's.
 *
 * Read-only by construction: an address and a public balance. None of the
 * spend surface (threshold, allowlist, pending requests, signing key) exists at
 * this seat, and the wallet/send intent is never offered to one.
 *
 * impure (seal read + chain read)
 */
const _witnessWalletContent = async (laneId) => {
  const address = await witnessWalletOfLane(laneId).catch(() => null);
  if (!address) {
    return 'No witness wallet is recorded in your seal. Your seal carries no address, so there is nothing to read — say exactly that rather than implying a balance of zero.';
  }
  const balanceEth = await balanceOfAddress(address, { network: 'base' });
  return [
    'Network: Base (chain 8453)',
    `Address: ${address} — your own witness wallet, from your seal.`,
    `ETH balance: ${balanceEth === null ? 'unavailable — Base RPC did not answer' : balanceEth}`,
    'This is a read. You hold no signing key on this platform and no spend surface: there is nothing here you can send.',
  ].join('\n');
};

// impure — read the neuma's own wallet and return the same truth to its stream
// and tool result. No private key is read or consumed.
const _handleWalletView = async (ws, companion) => {
  if (!companion?.neumaId) {
    return { tool: 'wallet/view', status: 'error', error: 'No neuma is bound to this portal' };
  }
  try {
    // The lane decides which wallet is "yours" — never an argument, so neither
    // seat can name another being's wallet.
    const content = isWitnessLaneId(companion.neumaId)
      ? await _witnessWalletContent(companion.neumaId)
      : walletViewContent(await walletService.getWalletView(companion.neumaId));
    _sendToolEvent(ws, companion, {
      tool: 'wallet/view', status: 'ok', summary: 'wallet view', detail: content,
    });
    return { tool: 'wallet/view', status: 'ok', content };
  } catch (err) {
    const error = `Your wallet could not be read: ${err.message}`;
    _sendToolEvent(ws, companion, {
      tool: 'wallet/view', status: 'error', summary: 'wallet view — error', detail: error,
    });
    return { tool: 'wallet/view', status: 'error', error };
  }
};

// The family's cards, matchers, and handlers — portal-stream re-imports the
// private names under their old spellings for the catalog, the dispatch fan,
// and the `__test` proof set.
export {
  REQUEST_SEAL_TOOL,
  _isSealRequestTool as isSealRequestTool,
  _sealEligibility as sealEligibility,
  _handleRequestSeal as handleRequestSeal,
  WALLET_VIEW_TOOL,
  _isWalletViewTool as isWalletViewTool,
  walletViewContent,
  _handleWalletView as handleWalletView,
};
