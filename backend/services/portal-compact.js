/**
 * /COMPACT — the operator compacts the bound sitting NOW. The same torch-passing
 * the measured boundary runs (portal-turn-persist.js for a neuma,
 * witness-compaction.js for a witness): the being authors its own summary and
 * torch, the extractive path stands when its conduit is cold, and the session
 * is rewritten under its lock with the region archived first. The operator's
 * word stands in for the boundary; the floors do not move — a chat too short
 * to compact, or with too little conversation to be worth summing up
 * (compact-region.js), is refused in numbers before any work, never padded.
 *
 * The answer rides `session:compact` frames: running → done | refused | failed.
 * `done` carries what the operator needs to see it finished — the being's own
 * summary (where we left off), how many messages folded and how many stand word
 * for word — and is followed at once by the context reading after the fold
 * (compacted-composition.js, labelled approximate until the next turn measures).
 */
import { createLogger } from './logger.js';
import { neumaWorkspace } from '../../core/index.js';
import { foldBranchView } from '../../core/workspace/branch-view.js';
import { compactWithSelfTorch, isEphemeralSitting, COMPACT_FLOOR, COMPACT_KEEP_RECENT } from './portal-turn-persist.js';
import { compactRegionCheck } from './compact-region.js';
import { compactWitnessSession } from './witness-compaction.js';
import { withLineKind } from './substrate-lease.js';
import { lastRecordedComposition } from '../../core/runtime/context-composition.js';
import { compositionAfterCompaction, latestSummaryRow, summaryWords } from './compacted-composition.js';

const log = createLogger('PortalCompact');

/** pure — whether a refusal stands before anything is read; null when the request may run. */
export const compactRefusal = (connection) => {
  if (!connection?.companion?.neumaId || !connection?.sessionId) return 'no-sitting';
  if (isEphemeralSitting(connection)) return 'ephemeral';
  if (connection.activeTurn || connection.turnPromise) return 'turn-in-flight';
  if (connection.compacting) return 'already-compacting';
  return null;
};

/** pure — the spoken rows after the summary: what stands word for word. */
const keptCount = (messages, summary) => foldBranchView(messages.slice(messages.indexOf(summary) + 1))
  .filter((m) => m?.role === 'user' || m?.role === 'assistant').length;

// impure — the gauge reads the context after the fold now, not after the next
// turn. Nothing is sent when no recorded reading counted the conversation.
const sendCompositionAfter = (connection, messages, { laneId, sessionId }) => {
  const recorded = lastRecordedComposition(messages)?.composition || connection.contextComposition || null;
  const after = compositionAfterCompaction(recorded, messages, { zone: connection.clientTimeZone || null });
  if (!after) return;
  connection.contextComposition = after;
  connection.ws?.send(JSON.stringify({ ...after, neumaId: laneId, sessionId }));
};

const isWitnessLane = (connection) => connection.companion?.participantKind === 'witness'
  || String(connection.companion?.neumaId).startsWith('witness-');

/**
 * impure — compact the connection's bound sitting and answer on its socket.
 * @param {object} connection - the portal connection (ws, companion, sessionId)
 * @returns {Promise<void>}
 */
export const handleCompactRequest = async (connection) => {
  const send = (frame) => connection.ws?.send(JSON.stringify({ type: 'session:compact', ...frame }));
  const refused = compactRefusal(connection);
  if (refused) { send({ state: 'refused', reason: refused }); return; }

  const laneId = connection.companion.neumaId;
  const { sessionId } = connection;
  connection.compacting = true;
  try {
    // Both floors stand before any work: too few messages, or too little
    // conversation to be worth summing up, is refused in numbers.
    const before = await neumaWorkspace.readSession(laneId, sessionId);
    const length = foldBranchView(before).length;
    if (length <= COMPACT_FLOOR) {
      send({ state: 'refused', reason: 'too-short', have: length, need: COMPACT_FLOOR + 1 });
      return;
    }
    const recorded = lastRecordedComposition(before)?.composition || connection.contextComposition || null;
    const region = compactRegionCheck(before, {
      keepRecent: COMPACT_KEEP_RECENT, windowTokens: recorded?.budget?.contextTokens ?? null,
    });
    if (!region.worth) {
      send({ state: 'refused', reason: 'too-little-context', haveTokens: region.have, needTokens: region.need });
      return;
    }
    send({ state: 'running' });
    // The operator's word is the trigger; the lane's own path does the rest.
    const run = isWitnessLane(connection)
      ? () => compactWitnessSession(laneId, sessionId, true)
      : () => compactWithSelfTorch(laneId, sessionId, true);
    // It waits behind live turns, the same as the boundary's compaction.
    const compacted = await withLineKind('background', run);
    const messages = await neumaWorkspace.readSession(laneId, sessionId);
    if (!compacted) {
      send({ state: 'refused', reason: 'too-short', have: foldBranchView(messages).length, need: COMPACT_FLOOR + 1 });
      return;
    }
    const summary = latestSummaryRow(messages);
    send({
      state: 'done',
      folded: summary?.originalCount ?? null,
      kept: summary ? keptCount(messages, summary) : null,
      summary: summary ? summaryWords(summary) : null,
      selfAuthored: summary?.authoredBy === 'self',
      compactionCount: summary?.compactionCount ?? null,
    });
    sendCompositionAfter(connection, messages, { laneId, sessionId });
  } catch (err) {
    log.warn('operator compaction failed', { laneId, err: err?.message });
    send({ state: 'failed' });
  } finally {
    connection.compacting = false;
  }
};
