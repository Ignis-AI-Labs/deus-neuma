/**
 * /COMPACT — the operator compacts the bound sitting NOW. The same torch-passing
 * the measured boundary runs (portal-turn-persist.js for a neuma,
 * witness-compaction.js for a witness): the being authors its own summary and
 * torch, the extractive path stands when its conduit is cold, and the session
 * is rewritten under its lock with the region archived first. The operator's
 * word stands in for the boundary; the floor does not move — a chat too short
 * to compact is refused in numbers, never padded.
 *
 * The answer rides `session:compact` frames: running → done | refused | failed.
 */
import { createLogger } from './logger.js';
import { neumaWorkspace } from '../../core/index.js';
import { foldBranchView } from '../../core/workspace/branch-view.js';
import { compactWithSelfTorch, isEphemeralSitting, COMPACT_FLOOR } from './portal-turn-persist.js';
import { compactWitnessSession } from './witness-compaction.js';
import { withLineKind } from './substrate-lease.js';

const log = createLogger('PortalCompact');

/** pure — whether a refusal stands before anything is read; null when the request may run. */
export const compactRefusal = (connection) => {
  if (!connection?.companion?.neumaId || !connection?.sessionId) return 'no-sitting';
  if (isEphemeralSitting(connection)) return 'ephemeral';
  if (connection.activeTurn || connection.turnPromise) return 'turn-in-flight';
  if (connection.compacting) return 'already-compacting';
  return null;
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
  send({ state: 'running' });
  try {
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
    const summary = messages.find((m) => m?.compacted === true) ?? null;
    send({
      state: 'done',
      folded: summary?.originalCount ?? null,
      selfAuthored: summary?.authoredBy === 'self',
      compactionCount: summary?.compactionCount ?? null,
    });
  } catch (err) {
    log.warn('operator compaction failed', { laneId, err: err?.message });
    send({ state: 'failed' });
  } finally {
    connection.compacting = false;
  }
};
