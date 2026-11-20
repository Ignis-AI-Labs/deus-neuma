/**
 * Protocol Guard — the floor AUTO mode cannot walk through.
 *
 * AUTO is the dangerous bearing: approval-required acts flow without the
 * per-act card. Founder's law for it (2026-08-26): […] This module IS that protocol — a deterministic hard-gate list of
 * act classes that raise the operator's ACTS card even in AUTO, because an
 * irreversible or outward act should never land with no checkpoint, no
 * matter how much trust the mode carries:
 *
 *   extension/*             — dynamic third-party tools, including outward systems
 *   filesystem/delete_file  — IRREVERSIBLE (the fs/edit {delete:true} sub-op
 *                             carries this identity, fs-primitives.js) — except
 *                             inside the operator's OPEN FOLDER, where AUTO is
 *                             the grant (open-folder-autonomy.js, ruling 2026-10-28)
 *   intents/team.workspace-run — the being's own script run on a team workspace
 *   intents/social.post     — outward speech under the house's name
 *   intents/social.queue    — staged outward speech
 *   intents/email.send      — named speech to a real person
 *   intents/raise.reach     — the same, to an investor, under the company's name
 *   intents/wallet.send     — value leaving the house (allowed by default via
 *                             the spend policy; AUTO still pauses on the card)
 *   intents/web.download    — a request to an address the being chose: the
 *   intents/media.save        address itself can carry what was in its context
 *   intents/forge.install     (a model brought into the image engine, the same)
 *   intents/forge.workflow  — a workflow made a pipeline for every being on this computer:
 *                             the operator reads what it runs, every time
 *                             out of the house (PR600 audit P6-04)
 *   intents/tasks.operator-drop — taking something off the OPERATOR'S own list
 *                             and calendar: their yes, every time (ruling, 2026-10-17)
 *   intents/security.assess — a verdict can quiet a real threat; a turned CSO
 *                             must never hide one unseen (ruling 2026-10-19)
 *   intents/security.escalate — outward speech on the operator's own gh login
 *   intents/security.circuit-breaker — blocks traffic for every house on
 *                             the machine
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
// `coding/execute` left this set (Design note, 2026-10-28: […]): it made AUTO STRICTER than ASK — allowed by
// default, a card on every command in AUTO. On AUTO the shell now runs live in
// the operator's open folder (its .git and secrets masked) and in the overlay
// everywhere else; ASK keeps the overlay. The off switch is the mode.
// `intents/social.queue` left this set (posting-pipeline-v2): staging a draft
// is not egress — the queue board's approve is that post's single gate, on
// the surface that shows the real card. social.post stays: post-now is the
// irreversible act, and its card now carries the image.
const AUTO_HARD_GATES = Object.freeze(new Set([
  'filesystem/delete_file',
  'intents/team.workspace-run',
  'intents/social.post',
  'intents/email.send',
  'intents/raise.reach',
  'intents/wallet.send',
  'intents/lp.open', 'intents/lp.add', 'intents/lp.claim', 'intents/lp.withdraw',
  'intents/lp.close', 'intents/lp.swap', 'intents/lp.send', 'intents/lp.create-pool',
  'intents/web.download', 'intents/media.save', 'intents/forge.install', 'intents/forge.workflow',
  // a click or a keystroke in a neuma's own browser can send, buy or delete (docs/work/being-browser.md)
  'browser/browser_click', 'browser/browser_type',
  'intents/tasks.operator-drop',
  'intents/security.assess',
  'intents/security.escalate',
  'intents/security.circuit-breaker',
]));

/**
 * Does this act pause on the operator's card even in AUTO? Pure.
 * @param {string} server - Policy server name (post-fsPolicyTarget for fs calls)
 * @param {string} tool - Policy tool name
 * @returns {boolean}
 */
export const isAutoHardGated = (server, tool) => server === 'extension' || AUTO_HARD_GATES.has(`${server}/${tool}`);

/**
 * Apply the protocol guard on top of a mode-resolved access level. Pure.
 * Only acts AUTO would have silently unlocked (or let stand) are re-gated;
 * a policy denial always survives untouched, and no other mode is tightened —
 * SANDBOX OFF included (Design note, 2026-11-18.
 * @param {'allowed'|'denied'|'approval_required'} access - post-applyToolMode access
 * @param {'ask'|'auto'|'observe'} mode - session tool mode
 * @param {string} server - policy server name
 * @param {string} tool - policy tool name
 * @param {boolean} [explicitlyAllowed] - an operator's explicit standing grant
 * @param {boolean} [direct] - the command will run without OS confinement
 * @returns {'allowed'|'denied'|'approval_required'}
 */
export const applyProtocolGuard = (access, mode, server, tool, explicitlyAllowed = false, direct = false) => {
  // SANDBOX OFF asks no more than ON does (Design note, 2026-11-18: […]):
  // the approval stance (DEFAULT / PLAN / AUTO) decides, not where the command runs.
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
 * wake's carries no `_wakeHolds` and passes through untouched. The same call
 * applies the wake ask (askInWake) where no cover stands between the two.
 * @param {Object} connection - the turn's connection (`_wakeHolds`: Set of policy ids)
 * @param {'allowed'|'denied'|'approval_required'} access - the act's resolved access
 * @param {string} server - policy server name
 * @param {string} tool - policy tool name
 * @returns {'allowed'|'denied'|'approval_required'}
 */
export const holdForWake = (connection, access, server, tool) => (
  escalateInWake(connection, askInWake(connection, access, server, tool), server, tool)
);

// pure — an act that would run with no ask, turned back into one when the set names it
const heldBy = (set, access, server, tool) => (access === 'allowed' && set?.has(`${server}/${tool}`) ? 'approval_required' : access);

/**
 * THE WAKE ASK — the acts house work never runs on a chat's ALWAYS grant, or
 * on a default row that asks nobody (audit P6-105): posting and email, every
 * publishing act, a reward request, an invoice (`_wakeAsks`,
 * house-clock/wake-approvals.js HOUSE_ASKS). The grant was given to a chat
 * with the operator in it; in house work the act becomes an ask again, and
 * the wake's table decides it — the charter's `allow`, or the operator. It is
 * applied BEFORE a cover the operator signed for exactly such acts (the sales
 * cover over an approved list), which may still answer the ask. Pure.
 * @param {Object} connection - the turn's connection (`_wakeAsks`: Set of policy ids)
 * @param {'allowed'|'denied'|'approval_required'} access
 * @param {string} server - policy server name
 * @param {string} tool - policy tool name
 * @returns {'allowed'|'denied'|'approval_required'}
 */
export const askInWake = (connection, access, server, tool) => heldBy(connection?._wakeAsks, access, server, tool);

/**
 * The charter's own holds (`_wakeHolds`: money out, a benchmark launch, what
 * the charter escalates), which stand over every grant and every cover. Pure.
 * @param {Object} connection - the turn's connection (`_wakeHolds`: Set of policy ids)
 * @param {'allowed'|'denied'|'approval_required'} access
 * @param {string} server - policy server name
 * @param {string} tool - policy tool name
 * @returns {'allowed'|'denied'|'approval_required'}
 */
export const escalateInWake = (connection, access, server, tool) => heldBy(connection?._wakeHolds, access, server, tool);
