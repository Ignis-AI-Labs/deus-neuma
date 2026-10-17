/**
 * Protocol Guard — the floor AUTO mode cannot walk through.
 *
 * AUTO is the dangerous bearing: approval-required acts flow without the
 * per-act card. Founder's law for it (2026-08-26): […] This module IS that protocol — a deterministic hard-gate list of
 * act classes that raise the operator's ACTS card even in AUTO, because an
 * irreversible or outward act should never land with no checkpoint, no
 * matter how much trust the mode carries:
 *
 *   filesystem/delete_file  — IRREVERSIBLE (the fs/edit {delete:true} sub-op
 *                             carries this identity, fs-primitives.js)
 *   coding/execute          — an arbitrary shell run, sandboxed but unsupervised
 *   intents/social.post     — outward speech under the house's name
 *   intents/social.queue    — staged outward speech
 *   intents/email.send      — named speech to a real person
 *   intents/wallet.send     — value leaving the house (allowed by default via
 *                             the spend policy; AUTO still pauses on the card)
 *
 * AUTO alone grants none of these acts. An explicit operator grant does:
 * Founder's 2026-09-06 clarification is Allow / Always / Revoke, not a second
 * approval after permission was already given. Other standing custody and
 * spend constraints remain in their own executors.
 *
 * Consulted at the three choke points that apply the session mode: gateAct
 * (act-gate.js), the intent sweep (intents/intent-sweep.js), and the MCP
 * dispatch's hand-composed policy step (portal-stream.js).
 */

// The hard-gated classes, keyed by their POLICY identity (server/tool).
// `intents/social.queue` left this set (posting-pipeline-v2): staging a draft
// is not egress — the queue board's approve is that post's single gate, on
// the surface that shows the real card. social.post stays: post-now is the
// irreversible act, and its card now carries the image.
const AUTO_HARD_GATES = Object.freeze(new Set([
  'filesystem/delete_file',
  'coding/execute',
  'intents/social.post',
  'intents/email.send',
  'intents/wallet.send',
]));

/**
 * Does this act pause on the operator's card even in AUTO? Pure.
 * @param {string} server - Policy server name (post-fsPolicyTarget for fs calls)
 * @param {string} tool - Policy tool name
 * @returns {boolean}
 */
export const isAutoHardGated = (server, tool) => AUTO_HARD_GATES.has(`${server}/${tool}`);

/**
 * Apply the protocol guard on top of a mode-resolved access level. Pure.
 * Only acts AUTO would have silently unlocked (or let stand) are re-gated;
 * a policy denial always survives untouched, and no other mode is tightened.
 * @param {'allowed'|'denied'|'approval_required'} access - post-applyToolMode access
 * @param {'ask'|'auto'|'observe'} mode - session tool mode
 * @param {string} server - policy server name
 * @param {string} tool - policy tool name
 * @returns {'allowed'|'denied'|'approval_required'}
 */
export const applyProtocolGuard = (access, mode, server, tool, explicitlyAllowed = false) => {
  if (mode !== 'auto') return access;
  if (access !== 'allowed') return access;
  return isAutoHardGated(server, tool) && !explicitlyAllowed ? 'approval_required' : access;
};

/**
 * THE WAKE HOLD — what a house charter sends back to the operator even where
 * a standing grant would let it through. In the operator's own chat an act
 * the lane's policy allows simply runs: wallet.send is `allowed` because the
 * spend policy is its gate, and an ALWAYS grant on social.post stands until
 * revoked. In a house WAKE (house-clock/wake-turn.js) no one is at the desk,
 * so the charter's `escalate` list — which always holds money out (Founder: […])
 * — turns such an act back into an ask, which the wake's broker refuses and
 * files for the operator (tool-approval.js). Pure; a connection that is not a
 * wake's carries no `_wakeHolds` and passes through untouched.
 * @param {Object} connection - the turn's connection (`_wakeHolds`: Set of policy ids)
 * @param {'allowed'|'denied'|'approval_required'} access - the act's resolved access
 * @param {string} server - policy server name
 * @param {string} tool - policy tool name
 * @returns {'allowed'|'denied'|'approval_required'}
 */
export const holdForWake = (connection, access, server, tool) => (
  access === 'allowed' && connection?._wakeHolds?.has(`${server}/${tool}`) ? 'approval_required' : access
);
