/**
 * THE WAKE TURN — a seat takes a WORK turn by itself, for its own work, inside
 * the charter its operator approved (Design note, 2026-10-16.
 *
 * The same turn the operator's chat runs: streamConsciousness on a synthetic
 * portal connection built by the one connection factory (the team member's
 * and the channel bridge's pattern — no parallel pipeline), carrying the
 * seat's identity, memory, tools, sandbox and thought governor. Its law:
 *   - ITS OWN SITTING, minted here and recorded on the seat's lane; the opening
 *     row is marked origin 'wake' (portal-turn-persist.js) — the platform's
 *     note, never the operator's words — and the desk draws it as a WAKE line.
 *     Never a live chat's turn, never mid-turn, never the held-words queue.
 *   - IT WAITS ITS TURN in the substrate line as a 'wake' — beside the
 *     operator, never taking their last slot (substrate-line.js) — and holds
 *     its own place: a wake started from inside someone's turn never rides
 *     that turn's lease.
 *   - APPROVALS never wait (wake-approvals.js, wake-plan.js): the charter's
 *     allow proceeds, a team plan inside the delegation goes to the Optio,
 *     everything else is refused and filed for the operator.
 *   - Every signal it raises is one link deeper in its chain (wake-signal.js).
 *
 * Wired into the queue by the routes layer at boot (setWakeRunner) — the turn
 * pipeline reaches back into the intents, so the queue never imports it.
 *
 * impure — runs a model turn; writes the seat's sitting and lane.
 */
import { randomUUID } from 'crypto';
import { streamConsciousness } from '../portal-stream.js';
import { createPortalConnection } from '../portal-connection.js';
import { createToolStreamSuppressor } from '../../../core/runtime/tool-stream-suppressor.js';
import { releaseIntentOwner } from '../intents/intent-owners.js';
import { withLease, withLineKind } from '../substrate-lease.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { mintSessionId } from '../../../core/workspace/session-id.js';
import { runInWake } from './wake-signal.js';
import { wakeThought } from './wake-thought.js';
import { WAKE_APPROVAL_REFUSAL, wakeApprovalRoute } from './wake-approvals.js';
import { wakePlanRoute, readWakePlan, settlePlanReviews, seatName } from './wake-plan.js';

const COMPLETE_GRACE_MS = 10_000;

// impure — the plans a plan-review wake puts before the Optio
const plansFor = async (wallet, items) => Object.fromEntries(await Promise.all(items
  .filter((i) => i.reason === 'plan-review')
  .map(async (i) => [i.ref, await readWakePlan(wallet, i.ref).catch(() => null)])));

/**
 * Run one wake as a real turn. Never rejects on the turn's own failure — the
 * outcome says how it went, and the queue writes it to the ledger.
 * @param {{wallet: string, seat: string, items: Object[], charter: Object, wakeId: string, depth?: number,
 *   onSitting?: (sessionId: string) => Promise<void>, onAdmit?: () => void}} wake - onAdmit: its place in line is granted
 * @returns {Promise<{outcome: 'done'|'escalated'|'failed', sessionId: ?string, escalations: Object[], note?: string, error?: string}>}
 */
export const runWakeTurn = async ({ wallet, seat, items, charter, wakeId, depth = 0, onSitting = null, onAdmit = null }) => {
  const name = await seatName(seat);
  let text = '';
  let failed = null;
  let completed = false;
  let markComplete;
  const completion = new Promise((resolve) => { markComplete = resolve; });
  // Tool blocks never read as speech (#320) — the Optio's verdict is read from its words.
  const suppressor = createToolStreamSuppressor();
  const ws = {
    OPEN: 1,
    readyState: 1,
    send: (str) => {
      const frame = JSON.parse(str);
      if (frame.type === 'consciousness:stream') {
        if (frame.error) failed = frame.reason || frame.content || 'the turn could not answer';
        else if (typeof frame.content === 'string') text += suppressor.push(frame.content);
      } else if (frame.type === 'consciousness:complete') {
        text += suppressor.flush();
        completed = true;
        markComplete();
      }
    },
  };
  const sessionId = mintSessionId();
  await neumaWorkspace.createSession(seat, sessionId);
  // The queue shows the running wake's sitting, so the operator can open it while it runs.
  await onSitting?.(sessionId);
  const wake = { wallet, seat, name, wakeId, sessionId, charter, escalations: [] };
  const connection = createPortalConnection({ ws, walletAddress: wallet });
  connection.companion = { name, neumaId: seat };
  connection.toolMode = 'ask';
  connection.sessionId = sessionId;
  connection._approvalRefusal = WAKE_APPROVAL_REFUSAL;
  connection._approvalRoute = wakeApprovalRoute(wake);
  connection._wakeHolds = new Set(charter.escalate);
  connection._planRoute = wakePlanRoute(wake);
  // What the wake files is its own to settle, never a chat's (intent-owners.js).
  connection._intentOwner = randomUUID();
  // The opening row is the platform's note (portal-turn-persist.js), consumed once.
  connection._turnOrigin = 'wake';
  const thought = wakeThought({ items, charter, plans: await plansFor(wallet, items) });
  try {
    await withLineKind('wake', () => withLease(
      { kind: 'wake', label: `${name} (wake)`, neumaId: seat, onAdmit },
      () => runInWake({ depth, wakeId }, () => streamConsciousness(connection, { thought })),
    ));
    // The complete frame follows the stream's resolution; a short grace covers it.
    await Promise.race([completion, new Promise((r) => { setTimeout(r, COMPLETE_GRACE_MS).unref?.(); })]);
  } catch (err) {
    failed = failed || err?.message || 'the wake turn failed';
  } finally {
    releaseIntentOwner(connection._intentOwner);
  }
  if (!failed && !completed) failed = 'the wake turn ended without completing';
  // A plan the Optio was shown is always settled — a failed turn ruled nothing, so it goes to the operator.
  const ruled = await runInWake({ depth, wakeId }, () => settlePlanReviews(wake, items, failed ? '' : text));
  return {
    outcome: failed ? 'failed' : wake.escalations.length ? 'escalated' : 'done',
    sessionId,
    escalations: wake.escalations,
    ...(ruled.length ? { note: ruled.map((r) => `${r.planId}: ${r.verdict}`).join('; ') } : {}),
    ...(failed ? { error: failed } : {}),
  };
};
