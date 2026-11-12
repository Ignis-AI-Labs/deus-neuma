/**
 * Act Gate — the ONE choke point every gated act passes through.
 *
 * Until 2026-08-18 the resolve-policy → apply-mode → approval-card →
 * always-grant → interrupt-recheck sequence was hand-copied into ~15 call
 * sites across portal-stream.js, witness-tools.js, and the domain being-tools
 * (web, security, media, email, ksp, access-request) — each with its own
 * ordering and its own refusal wording, so the same operator decision reached
 * a being in four different voices and some sites forgot a step entirely
 * (the interrupt re-check was […]). This module is the single implementation. Both seats, every domain:
 *
 *   1. resolve policy (defaults → lane → session) and apply the session mode
 *   2. denial / observe-hold refusal (uniform wording, no card)
 *   3. ONE approval card when the tier requires it; ALWAYS persists the grant
 *      at every layer (session + lane policy) for BOTH seats
 *   4. interrupt re-check — an answer that lands after the turn was cut is
 *      consent to a turn that no longer exists (#200)
 *
 * Standing rules that are not policy (channel bindings, CSO seat, the web
 * master switch, the sovereignty boundary) stay in their domain handlers —
 * they are validated there and refuse with the same ACT_REFUSALS vocabulary.
 * The sandbox still enforces at execution; this gate decides what is ASKED.
 *
 * Doctrine: docs/planning/proposals/being-tool-surface-primitives.md (Stage 1).
 */

import { createLogger } from './logger.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import {
  resolvePolicy, checkToolAccess, applyToolMode, addAllowedTool, removeAllowedTool, GLOBAL_DEFAULTS,
} from './tool-policy.js';
import { requestToolApproval } from './tool-approval.js';
import { applyProtocolGuard, holdForWake } from './protocol-guard.js';
import { landsInOpenFolder } from './open-folder-autonomy.js';
import { focusGroundOf } from './focus-ground.js';
import { capturePolicyGrant } from './policy-grant-context.js';

const log = createLogger('ActGate');

/**
 * The one refusal vocabulary. Every denial a being can ever see comes from
 * this table — both seats, every domain. (`timeout` is gone: the broker has
 * no clock — the ask waits for the human, tool-approval.js.)
 */
export const ACT_REFUSALS = Object.freeze({
  policyDenied: Object.freeze({
    summary: 'denied by policy',
    error: 'your operator has denied this tool',
  }),
  held: Object.freeze({
    summary: 'held (observe)',
    error: 'held by observe mode — your operator is watching, not acting',
  }),
  deny: Object.freeze({
    summary: 'denied by operator',
    error: 'your operator denied this action',
  }),
  interrupted: Object.freeze({
    summary: 'turn interrupted',
    error: 'the turn was interrupted before your operator decided',
  }),
});

/**
 * The refusal a being reads when an ask did not come back yes. Pure. A turn
 * no operator is watching (a team member's, team-member-turn.js) carries its
 * own reason on the connection: the being is told the truth — no one saw a
 * card — never […]. The decision stays 'deny' at
 * every gate (fail closed); only the words change.
 *
 * @param {Object} connection - Portal connection
 * @param {string} decision - the broker's decision
 * @returns {{summary: string, error: string}}
 */
export const refusalForDecision = (connection, decision) => {
  if (decision === 'interrupted') return ACT_REFUSALS.interrupted;
  // The route's own words for THIS refusal (an Optio's hold) when it gave them — the broker sets
  // them just before it resolves, and a turn's asks are taken one at a time.
  if (connection?._approvalRefusal) return { summary: 'refused — no operator watches this turn', error: connection._approvalRefusalNow || connection._approvalRefusal };
  return ACT_REFUSALS.deny;
};

/**
 * Build a uniform refusal result for a gated act. Pure.
 * @param {string} toolLabel - Display label, e.g. 'web/web_search'
 * @param {keyof ACT_REFUSALS} kind - Refusal kind
 * @param {Object} [extra] - Extra fields merged into the result
 * @returns {{tool: string, status: string, error: string, summary: string}}
 */
export const refusalResult = (toolLabel, kind, extra = {}) => {
  const refusal = ACT_REFUSALS[kind] || ACT_REFUSALS.deny;
  return { tool: toolLabel, status: 'denied', error: refusal.error, summary: refusal.summary, ...extra };
};

/**
 * impure — an ALWAYS decision widens the lane's policy at BOTH layers: the
 * session layer (this turn and this portal's remaining turns) and the lane's
 * persisted policy (every future session). One implementation for both seats —
 * the witness seat used to persist without touching the session layer, which
 * was drift, not doctrine. Persistence failure downgrades to session-only.
 * @param {Object} connection - Portal connection
 * @param {string} serverName - Server name
 * @param {string} toolName - Tool name
 * @param {Object} [origin] - capturePolicyGrant result captured before approval
 */
export const grantAlwaysAllow = async (connection, serverName, toolName, origin = capturePolicyGrant(connection)) => {
  origin.beforeCommit();
  const { laneId } = origin;
  const grantSession = () => {
    origin.beforeCommit();
    connection._sessionToolPolicy = addAllowedTool(connection._sessionToolPolicy || null, serverName, toolName);
  };
  if (!laneId) { grantSession(); return; }
  try {
    await neumaWorkspace.updateToolPolicy(laneId, (existing) => addAllowedTool(existing, serverName, toolName), {
      ...origin,
      afterCommit: () => {
        grantSession();
        // These tools deliberately have no session duplicate after persistence.
        if ((serverName === 'coding' && ['ground_git', 'ground_sync', 'sandbox_recover'].includes(toolName))
          || (serverName === 'map' && toolName === 'read_history')) {
          connection._sessionToolPolicy = removeAllowedTool(connection._sessionToolPolicy, serverName, toolName);
        }
      },
    });
  } catch (err) {
    origin.beforeCommit();
    grantSession();
    log.warn('ALWAYS ALLOW not persisted — grant holds for this session only', {
      serverName, toolName, err: err.message,
    });
  }
};

/**
 * impure — gate one act through policy, mode, ONE approval card, and the
 * interrupt re-check. Returns `{ ok: true }` when the act may proceed, or
 * `{ ok: false, result }` with a uniform refusal the caller hands straight
 * back to the model. Denial events are emitted through `emit` here, so no
 * call site can forget the chip.
 *
 * @param {Object} connection - Portal connection (companion, session policy, active turn)
 * @param {Object} opts
 * @param {string} opts.server - Server name for policy lookup
 * @param {string} opts.tool - Tool name for policy lookup
 * @param {string} [opts.toolLabel] - Display label (default `${server}/${tool}`)
 * @param {Object} [opts.args] - Call args (card preview when cardArgs absent)
 * @param {Object} [opts.cardArgs] - What the operator's card shows instead of raw args
 * @param {Object|null} [opts.lanePolicy] - The lane's persisted policy (already read by caller)
 * @param {string} opts.mode - Normalized session tool mode (ask/auto/observe)
 * @param {Object} [opts.defaults] - Policy defaults (GLOBAL_DEFAULTS or the witness set)
 * @param {boolean} [opts.observeExempt] - Pure observation a seat keeps open in observe mode
 * @param {Function} [opts.emit] - (event) => void — the seat's tool-event sink
 * @param {AbortSignal} [opts.signal] - Turn signal (default connection.activeTurn?.signal)
 * @param {boolean} [opts.ownWork] - The act only revises or pulls the being's OWN unsent
 *   work: no card is raised for it (Design note, 2026-11-12; a denial or a hold still stands
 * @returns {Promise<{ok: true} | {ok: false, result: Object}>}
 */
export const gateAct = async (connection, opts) => {
  const {
    server, tool, args, cardArgs, lanePolicy, mode,
    defaults = GLOBAL_DEFAULTS, observeExempt = false,
    emit = () => {},
  } = opts;
  const toolLabel = opts.toolLabel || `${server}/${tool}`;
  const signal = opts.signal || connection.activeTurn?.signal;
  const origin = capturePolicyGrant(connection, { signal, isCurrent: opts.isCurrent });
  const interrupted = () => {
    const result = refusalResult(toolLabel, 'interrupted');
    emit({ tool: toolLabel, status: 'denied', summary: `${tool} — ${result.summary}` });
    return { ok: false, result: { tool: toolLabel, status: 'denied', error: result.error } };
  };

  const policy = resolvePolicy(defaults, lanePolicy, connection._sessionToolPolicy || null);
  const baseAccess = checkToolAccess(policy, server, tool);
  // The protocol guard rides AFTER the mode: AUTO's silent unlock stops at
  // the hard-gated classes (deletes, outward speech, spends, shell runs).
  // An explicit grant — or, on AUTO, a delete inside the operator's open folder
  // (open-folder-autonomy.js) — lets a hard-gated act through.
  const explicit = resolvePolicy({}, lanePolicy, connection._sessionToolPolicy || null)[`${server}/${tool}`] === 'allowed'
    || landsInOpenFolder({ server, tool, args, ground: focusGroundOf(connection) });
  const access = observeExempt ? baseAccess
    : holdForWake(connection, applyProtocolGuard(applyToolMode(baseAccess, mode, tool), mode, server, tool, explicit), server, tool);

  if (access === 'denied') {
    // An observe-mode hold reads differently from a policy denial — the
    // operator chose to watch, the being should know which it was.
    const kind = baseAccess !== 'denied' ? 'held' : 'policyDenied';
    const result = refusalResult(toolLabel, kind);
    emit({ tool: toolLabel, status: 'denied', summary: `${tool} — ${result.summary}` });
    return { ok: false, result: { tool: toolLabel, status: 'denied', error: result.error } };
  }

  if (access === 'approval_required' && !opts.ownWork) {
    const decision = await requestToolApproval(connection, {
      tool: toolLabel, args: cardArgs ?? args, signal,
    });
    try { origin.beforeCommit(); } catch { return interrupted(); }
    if (decision === 'always') {
      try { await grantAlwaysAllow(connection, server, tool, origin); }
      catch { return interrupted(); }
    }
    if (decision !== 'allow' && decision !== 'always') {
      const result = refusalForDecision(connection, decision);
      emit({ tool: toolLabel, status: 'denied', summary: `${tool} — ${result.summary}` });
      return { ok: false, result: { tool: toolLabel, status: 'denied', error: result.error } };
    }
  }

  // An approval answered after the interrupt must not become an act (#200).
  if (signal?.aborted) return interrupted();

  return { ok: true };
};
