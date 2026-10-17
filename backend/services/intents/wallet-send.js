/**
 * wallet/send — the intent type that requests a transfer from the being's own
 * wallet (Stage 3 of docs/planning/proposals/being-tool-surface-primitives.md).
 * This was the `wallet_send` tool until the act became a filed intent.
 *
 * CRITICAL PARITY (the [[autonomous-spend-off]] doctrine): this intent's
 * policy row is `allowed` BY DEFAULT — wallet_send never raised an ACTS card,
 * and it does not start now. THE SPEND POLICY IS THE GATE: the operator's
 * allowlist and autonomous threshold are the standing approval routes, so a
 * second gate would be a lie about where consent lives. validate() enforces
 * that policy exactly (default-deny outside the allowlist); an allowlisted
 * transfer above the threshold goes PENDING for the operator's out-of-band
 * signature, exactly as the tool did. Observe mode still holds the settle —
 * the sweep's hold law, unchanged.
 *
 * Spend is local-custody authority: the sovereignty boundary holds at
 * validate time, so a witness seat is refused before anything moves.
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { classifySpend, toAllowlist } from '../../../core/wallet/spend-policy.js';
import { seatOf } from '../flight-check.js';
import { requestSpend } from '../neuma-wallet.js';

// impure — the spend policy stands only once the operator has approved a
// recipient or set a non-zero threshold. The intent's availability probe and
// nothing else.
const spendConfigured = async (laneId) => {
  if (!laneId) return false;
  try {
    const allowlist = toAllowlist(await neumaWorkspace.readSpendAllowlist(laneId));
    if (allowlist.entries.length > 0) return true;
    const threshold = await neumaWorkspace.readSpendThreshold(laneId);
    return Number(threshold?.thresholdEth) > 0;
  } catch {
    return false;
  }
};

// pure — the one narrative per spend outcome (BE-141: the being's record and
// the desk's receipt read the SAME truth; a denied or failed transfer is
// NEVER ok). The old wallet_send tool's spendResult mapping, moved with the act.
export const spendOutcome = (outcome, { to, value }) => {
  const content = ({
    sent: `Sent ${value} ETH to ${to}. Transaction ${outcome.receipt?.hash}.`,
    pending: `That transfer (${value} ETH to ${to}) is above your autonomous threshold. Your operator has been asked to approve it — you'll learn the outcome once they decide.`,
    denied: `Your operator has not approved ${to} as a recipient, so this could not be sent. They would need to add it to your allowlist first.`,
    error: `The transfer could not be sent: ${outcome.reason}.`,
  })[outcome.status] || `The transfer could not be sent: ${outcome.reason || 'unknown error'}.`;
  // 'pending' is ok — the request itself succeeded and awaits the operator.
  return { ok: outcome.status === 'sent' || outcome.status === 'pending', content };
};

export const walletSendIntent = Object.freeze({
  name: 'wallet/send',
  policyTool: 'wallet.send',
  fieldsForPrompt: '{to, value, memo?}',
  descriptionForPrompt: 'Request a transfer from your wallet — to is an operator-approved 0x recipient, value a positive ETH amount. Transfers above your autonomous threshold await your operator\'s signature. Use sparingly, and explain your reasoning in memo.',
  availableFor: async ({ laneId, connection }) =>
    (seatOf(connection) !== 'witness' && await spendConfigured(laneId) ? {} : null),
  validate: async (payload, { connection }) => {
    if (seatOf(connection) === 'witness') {
      return { ok: false, status: 'denied', reason: 'Witness seats cannot invoke local-custody authority.' };
    }
    const laneId = connection.companion?.neumaId;
    const to = typeof payload?.to === 'string' ? payload.to.trim() : '';
    const value = payload?.value;
    if (!to || !Number.isFinite(Number(value)) || Number(value) <= 0) {
      return { ok: false, status: 'invalid', reason: 'a send needs {to, value} — an approved 0x recipient and a positive ETH amount' };
    }
    // THE SPEND POLICY IS THE GATE — read fresh per act, exactly as the tool
    // did: default-deny outside the operator's allowlist.
    const [allowlist, threshold] = await Promise.all([
      neumaWorkspace.readSpendAllowlist(laneId),
      neumaWorkspace.readSpendThreshold(laneId),
    ]);
    if (classifySpend(allowlist, threshold?.thresholdEth, { to, value }) === 'denied') {
      return { ok: false, status: 'denied', reason: `Your operator has not approved ${to} as a recipient — they would need to add it to your allowlist first.` };
    }
    return { ok: true, value: { to, value, memo: typeof payload?.memo === 'string' ? payload.memo : '' } };
  },
  summarize: (payload) => {
    const memo = typeof payload?.memo === 'string' && payload.memo.trim() ? ` — ${payload.memo.trim().slice(0, 80)}` : '';
    return `send ${payload?.value ?? '?'} ETH to ${payload?.to ?? '?'}${memo}`;
  },
  // impure — the real wallet path, unchanged: requestSpend enforces the
  // per-tx cap, the rate limit, and the key unlock at send time.
  execute: async ({ to, value, memo }, { connection }) => {
    let outcome;
    try {
      outcome = await requestSpend(connection.companion?.neumaId, { to, value, memo });
    } catch (err) {
      outcome = { status: 'error', reason: err.message };
    }
    const settled = spendOutcome(outcome, { to, value });
    return settled.ok ? { ok: true, detail: settled.content } : { ok: false, reason: settled.content };
  },
});
