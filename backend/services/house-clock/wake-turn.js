/**
 * THE WAKE TURN — a seat takes a WORK turn by itself, for its own work, inside
 * the charter its operator approved (ruling, 2026-10-16).
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
 *     allow and reads inside the house's ground proceed, the Optio reviews
 *     the rest of the gated acts (CLEAR runs, HOLD is filed), a team plan
 *     inside the delegation goes to the Optio (hers, to the charter), and the
 *     operator's acts are refused and filed for them — so is every decision
 *     the seat puts to them (ask_operator files it and answers at once).
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
import { loadHouseWorkspace } from '../house-workspace.js';
import { readInboxLines } from '../house-post.js';
import { readDispatch } from '../staff/dispatch-store.js';
import { readRun } from '../team-run-store.js';
import { readActs } from '../act-ledger.js';
import { runInWake } from './wake-signal.js';
import { readAsks } from './wake-ledger.js';
import { wakeThought } from './wake-thought.js';
import { WAKE_APPROVAL_REFUSAL, houseHolds, wakeApprovalRoute, wakeDecisionRoute } from './wake-approvals.js';
import { wakePlanRoute, readWakePlan, settlePlanReviews, seatName } from './wake-plan.js';

const COMPLETE_GRACE_MS = 10_000;

// impure — the answered asks an operator-answer wake relays, by id
const answersFor = async (wallet, items) => {
  const ids = new Set(items.filter((i) => i.reason === 'operator-answer').map((i) => i.ref));
  if (!ids.size) return {};
  return Object.fromEntries((await readAsks(wallet).catch(() => [])).filter((a) => ids.has(a.id)).map((a) => [a.id, a]));
};

// impure — what the platform recorded each ended run's members reading from the web while it ran
// (the act ledger, never a member's own account), by run id
const webReadsFor = async (wallet, items) => Object.fromEntries(await Promise.all(items
  .filter((i) => i.reason === 'run-ended')
  .map(async (i) => {
    const run = await readRun(i.ref, wallet).catch(() => null);
    if (!run?.runAt) return [i.ref, null];
    const members = [...new Set([run.lead?.neumaId, ...(run.steps ?? []).map((s) => s.neumaId)].filter(Boolean))];
    const until = run.finishedAt || new Date().toISOString();
    const acts = await readActs({ since: run.runAt, laneIds: members, limit: 5000 }).catch(() => []);
    return [i.ref, acts.filter((a) => String(a.tool).startsWith('web/') && a.ts <= until && a.status !== 'denied')];
  })));

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

// impure — the words of the work a wake carries, for the Optio's review: a post's body, a charge's brief
// (2026-10-17 live flight: shown only the wake note, the Optio held a write the post had asked for).
// Never throws: a store that cannot be read leaves the review the note alone.
const workWords = async (wallet, seat, items) => {
  const words = [];
  const posts = items.filter((i) => i.reason === 'post');
  if (posts.length) {
    const { root } = await loadHouseWorkspace(wallet).catch(() => ({ root: null }));
    const rows = root ? (await readInboxLines(root, seat).catch(() => [])).map((l) => { try { return JSON.parse(l); } catch { return null; } }) : [];
    for (const i of posts) {
      const p = rows.find((r) => r?.id === i.ref);
      if (p) words.push(`The house post it was woken for, from ${p.from}${p.re ? ` (re: ${p.re})` : ''}: ${p.body}`);
    }
  }
  for (const i of items.filter((x) => x.reason === 'scheduled')) words.push(`The calendar item it was woken for: "${i.detail?.title ?? ''}"`);
  for (const i of items.filter((x) => x.reason === 'dispatch' || x.reason === 'charge-due')) {
    const c = await readDispatch(i.detail?.from, i.detail?.id ?? i.ref).catch(() => null);
    if (c) words.push(`The charge it was woken for, from ${c.from}: "${c.title}" — ${c.body ?? ''}`);
  }
  return words;
};
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
  // What the Optio's review of a gated act reads (optio-review.js): the seat's own words so far, and its work.
  const wake = { wallet, seat, name, wakeId, sessionId, charter, holds: houseHolds(charter), escalations: [], statedIntent: () => text, assignment: '' };
  const connection = createPortalConnection({ ws, walletAddress: wallet });
  connection.companion = { name, neumaId: seat };
  connection.toolMode = 'ask';
  connection.sessionId = sessionId;
  connection._approvalRefusal = WAKE_APPROVAL_REFUSAL;
  connection._approvalRoute = wakeApprovalRoute(wake);
  connection._wakeHolds = wake.holds;
  connection._planRoute = wakePlanRoute(wake);
  // A decision only the operator can make is filed for them; the turn never waits on it.
  connection._askRoute = wakeDecisionRoute(wake);
  // What the wake files is its own to settle, never a chat's (intent-owners.js).
  connection._intentOwner = randomUUID();
  // The opening row is the platform's note (portal-turn-persist.js), consumed once.
  connection._turnOrigin = 'wake';
  const { root: houseRoot } = await loadHouseWorkspace(wallet).catch(() => ({ root: null }));
  const thought = wakeThought({
    items, charter, plans: await plansFor(wallet, items), answers: await answersFor(wallet, items),
    webReads: await webReadsFor(wallet, items),
    ground: { own: neumaWorkspace.pathFor(seat), house: houseRoot }, now: Date.now(),
  });
  // The work's own words come first: the review judges an act against the job, not the note naming it.
  wake.assignment = [...await workWords(wallet, seat, items), thought].join('\n\n');
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
