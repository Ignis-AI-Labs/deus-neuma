// portal-context.js — the turn/lane helpers the portal message handlers share:
// settling an in-flight turn, running a turn and draining the held queue,
// session-runtime hydration, the tool-workspace hint, and the lane ownership
// gate. Extracted from portal-routes.js (P8 decomposition, SIZE-033 plan) —
// bodies byte-identical.
import { createLogger } from '../services/logger.js';
import { verifyLaneOwnership } from '../services/lane-ownership.js';
import { announceTakenThought } from '../services/held-thoughts.js';
import { streamConsciousness } from '../services/portal-stream.js';
import { streamWitnessTurn } from '../services/witness-stream.js';
import { expirePendingApprovals } from '../services/tool-approval.js';
import { cancelIntentSweeps } from '../services/intents/intent-context.js';
import { expirePendingAsks } from '../services/operator-ask.js';
import { expirePendingSealRequests } from '../services/seal-request.js';
import { expirePendingPlans } from '../services/team-plan.js';
import { neumaWorkspace, isValidTimeZone } from '../../core/index.js';
import { turnPointCount } from '../../core/workspace/branch-view.js';
import { resolveFocusPath } from '../services/user-files.js';
import { clearSessionRuntime } from './portal-connections.js';
import { markTurnAsked } from '../services/turn-timing-probe.js';
import { lineTurn } from '../services/turn-line.js';
import { takePlatformFollowUp } from '../services/platform-follow-up.js';

const log = createLogger('Portal');

const expirePendingTurnGates = (connection) => {
  expirePendingApprovals(connection);
  expirePendingAsks(connection);
  expirePendingPlans(connection);
  expirePendingSealRequests(connection);
};

// impure — navigation cannot cross an in-flight turn. Abort it, then wait for
// its own persistence/completion path before the navigation acknowledgement;
// all old-turn frames therefore precede the ack on the wire.
export const settleActiveTurn = async (connection) => {
  cancelIntentSweeps(connection);
  // THE DRAIN EPOCH: settling a turn also ends the drain behind it. A held
  // word was said to the chat and being bound now; whoever settles decides
  // what runs next — navigation clears the held words, an interjection runs
  // first and drains them after it.
  connection.drainEpoch = (connection.drainEpoch || 0) + 1;
  if (!connection.turnPromise) return;
  if (connection.activeTurn) connection.activeTurn.abort();
  else { connection.interruptRequested = true; connection.lineWait?.abort(); }
  // Abort-aware gates settle synchronously from the signal. These explicit
  // expirations are the fail-closed safety net for any gate that lost or never
  // received that signal; navigation must never wait out a 10-minute card.
  expirePendingTurnGates(connection);
  try {
    await connection.turnPromise;
  } catch (err) {
    log.warn('active turn failed while navigation waited', { error: err?.message });
  }
};

/**
 * impure — run one turn, then deliver anything queued while it ran, in order
 * (the held-words queue itself lives in services/held-thoughts.js). A drained
 * thought runs the SAME path as a fresh one — nothing held is second-class.
 * Draining is a loop, never recursion: a queue-during-drain is served on the
 * next pass, and the stack never grows with the conversation.
 */
export const runTurnAndDrain = async (connection, first) => {
  const epoch = connection.drainEpoch || 0;
  let next = first;
  while (next) {
    cancelIntentSweeps(connection);
    markTurnAsked(connection.ws); // the wait starts here (turn-timing-probe.js)
    // A witness rides a provider's line, never this machine's; a neuma's turn waits its turn for
    // the house's model server and holds its place until done (turn-line.js).
    const thought = next;
    const turnPromise = connection.companion?.participantKind === 'witness'
      ? streamWitnessTurn(connection, thought)
      : lineTurn(connection, () => streamConsciousness(connection, thought));
    connection.turnPromise = turnPromise;
    try {
      await turnPromise;
    } finally {
      if (connection.turnPromise === turnPromise) {
        connection.turnPromise = null;
        connection.interruptRequested = false;
      }
    }
    // A turn the platform owes (a held legal answer) is taken now, before the
    // operator's held words — and dropped if a settle ended this drain.
    const owed = takePlatformFollowUp(connection);
    // A settle while this turn ran (navigation, an interjection) ended this drain.
    if ((connection.drainEpoch || 0) !== epoch) return;
    if (owed) {
      connection.ws?.send(JSON.stringify(owed.frame));
      connection._turnOrigin = owed.origin;
      next = { thought: owed.thought };
      continue;
    }
    next = connection.pendingThoughts?.shift() || null;
    announceTakenThought(connection, next);
  }
};

// impure — bind the connection's session-scoped counters to disk truth.
export const hydrateSessionRuntime = async (connection, neumaId, sessionId, entries, composition) => {
  clearSessionRuntime(connection);
  // Turn-point counting (THE TAKES): the counter the compaction triggers read
  // counts answered POINTS — a session rich in retried exchanges is not
  // "longer" for having versions of its answers.
  connection.sessionMsgCount = turnPointCount(entries || []);
  connection.contextComposition = composition || null;
  connection.compositionToolResults = Array.isArray(composition?.toolResults)
    ? [...composition.toolResults]
    : [];
  const records = await neumaWorkspace.readToolResults(neumaId, sessionId).catch(() => []);
  connection.toolResultSeq = records.reduce(
    (next, record) => Math.max(next, Number.isInteger(record?.seq) ? record.seq + 1 : 0),
    0,
  );
  connection.toolResultBytes = records.reduce(
    (total, record) => total + Buffer.byteLength(String(record?.content || ''), 'utf8'),
    0,
  );
};

// impure — a client focus is only a source hint for a disposable coding copy.
// Invalid/closed paths clear the hint; they never degrade to process.cwd here.
export const updateToolWorkspace = (connection, rawPath) => {
  if (rawPath === undefined) return;
  connection.toolWorkspace = resolveFocusPath(rawPath);
};

// The desk's IANA zone (2026-09-25 — every clock a being reads renders on the
// operator's wall). Client-originated and untrusted: a real zone binds, and
// anything else — garbage, a non-string, absence — leaves the connection on
// the machine's own zone (null), never on a fabricated one.
export const updateClientTimeZone = (connection, rawZone) => {
  if (rawZone === undefined) return;
  connection.clientTimeZone = isValidTimeZone(rawZone) ? rawZone : null;
};

// impure — the same ownership check as REST before a lane binds; a bind is a
// read, so it never claims an unclaimed lane (lane-ownership.js).
const laneOwnershipFor = async (connection, neumaId) => {
  const result = await verifyLaneOwnership({
    workspace: neumaWorkspace,
    neumaId,
    wallet: connection.walletAddress,
  });
  if (!result.ok) {
    log.warn('Ownership check refused bind (fail closed)', {
      neumaId, reason: result.reason, error: result.error?.message,
    });
  }
  return result;
};

export const ownsNeumaLane = async (connection, neumaId) =>
  (await laneOwnershipFor(connection, neumaId)).ok;

export { laneOwnershipFor };
