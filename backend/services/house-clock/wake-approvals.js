/**
 * APPROVALS INSIDE A WAKE — nobody is at the desk to tap a card, and a wake
 * must never hang on one (Design note, 2026-10-16: […]; […]).
 *
 * Every approval-gated act a wake reaches for comes to the broker
 * (tool-approval.js), which asks this route first:
 *   - an act the charter's `allow` names proceeds — the charter is the
 *     operator's standing yes, and the act ledger records it as the charter's;
 *   - everything else — and ALWAYS money out, and every act the charter's
 *     `escalate` names even where a grant would let it through
 *     (protocol-guard.js holdForWake) — is refused in the turn with an honest
 *     reason, FILED as an operator ask, and raised on the tray. It never waits
 *     and never holds the wake's place in the line.
 *
 * Team plans have their own road (wake-plan.js): inside the charter's
 * delegation they go to the Optio.
 *
 * impure — the asks store, the notification bus.
 */
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { scopeOf } from '../act-ledger.js';
import { createLogger } from '../logger.js';
import { MONEY_OUT } from './charter-shape.js';
import { fileAsk } from './wake-ledger.js';

const log = createLogger('HouseClock.Approvals');

/** What a woken seat reads when an act it reached for needs the operator. */
export const WAKE_APPROVAL_REFUSAL = 'This is a house wake — the house woke you for your own work, and nobody is at the desk to approve this act. It was NOT taken: it is filed for your operator, who sees it in the house clock. Carry on with what you can do, and say plainly what waits on them.';

/**
 * Whether the charter lets a wake take this act without the operator. Pure.
 * @param {Object} charter
 * @param {string} tool - the act's policy id (server/tool)
 * @returns {{allow: boolean, why: string}}
 */
export const wakeActVerdict = (charter, tool) => {
  if (MONEY_OUT.includes(tool)) return { allow: false, why: 'money out is always the operator\'s to approve' };
  if (charter.escalate.includes(tool)) return { allow: false, why: 'the charter sends this act to the operator' };
  if (charter.allow.includes(tool)) return { allow: true, why: 'the charter allows it' };
  return { allow: false, why: 'it needs the operator\'s approval, and the charter does not pre-allow it' };
};

/**
 * File one thing a wake could not do, and tell the operator. impure, never
 * throws — the turn goes on whatever the record does.
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, escalations }
 * @param {Object} ask - { kind, tool?, planId?, scope?, why }
 */
export const escalate = (wake, ask) => {
  const row = { ...ask, at: new Date().toISOString() };
  wake.escalations.push(row);
  fileAsk(wake.wallet, { wakeId: wake.wakeId, seat: wake.seat, sessionId: wake.sessionId, ...ask })
    .catch((err) => log.error('a wake\'s ask could not be filed', { seat: wake.seat, error: err.message }));
  Promise.resolve(notifyOperator({
    wallet: wake.wallet,
    kind: KIND.houseWake,
    standing: STANDING.neuma,
    title: ask.kind === 'plan'
      ? `${wake.name}'s wake sent a team plan to you`
      : `${wake.name}'s wake was refused ${ask.tool} — filed for you`,
    detail: ask.why,
    actor: { id: wake.seat, name: wake.name },
    ref: { sessionId: wake.sessionId, wakeId: wake.wakeId },
  })).catch(() => {});
};

/**
 * The broker's route for one wake: 'allow' for what the charter allows, else
 * the act is escalated and refused. impure (escalate).
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, charter, escalations }
 * @returns {(req: {tool: string, args?: Object, scope?: string}) => 'allow'|'deny'}
 */
export const wakeApprovalRoute = (wake) => ({ tool, args, scope }) => {
  const verdict = wakeActVerdict(wake.charter, String(tool || ''));
  if (verdict.allow) return 'allow';
  escalate(wake, {
    kind: 'act',
    tool: String(tool || ''),
    scope: scope ? String(scope).slice(0, 300) : scopeOf(args),
    why: verdict.why,
  });
  return 'deny';
};
