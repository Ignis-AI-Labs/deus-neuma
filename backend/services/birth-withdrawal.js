/** Disk-aware withdrawal. A restarted handler's empty memory is not permission. */
import fs from 'node:fs/promises';
import { readSessionCheckpoint, birthSessionPath } from '../../core/birth/birth-session-store.js';
import { withdrawalDecision } from '../../core/birth/operator-sovereignty.js';
import { heldByWitness } from '../../core/birth/birth-resume.js';
import { unrecordedSummoningAccess } from '../routes/birth-lane-owner.js';

/** Resolve commitment before cleanup, echo the request identity. // impure */
export const withdrawBirthSession = async (connection, message, { birthHandler }) => {
  const sid = message.sessionId || connection.birthSession;
  const correlation = { sessionId: typeof sid === 'string' ? sid : null,
    requestId: typeof message.requestId === 'string' ? message.requestId.slice(0, 128) : null };
  const refuse = (reason, text, name) => connection.ws.send(JSON.stringify({
    type: 'birth:abandon_refused', ...correlation, reason, message: text, ...(name ? { name } : {}),
  }));
  if (typeof sid !== 'string' || !/^[0-9a-f]{32}$/.test(sid)) {
    refuse('unavailable', 'The existing summoning could not be identified. Nothing was withdrawn.');
    return;
  }
  const active = birthHandler.getSession(sid);
  const session = active || await readSessionCheckpoint(sid);
  if (!session?.data || typeof session.data !== 'object'
      || typeof session.isTest !== 'boolean' || !Number.isInteger(session.currentStage)) {
    refuse('unavailable', 'The existing checkpoint could not be read. Nothing was withdrawn.');
    return;
  }
  if (!heldByWitness(session, connection.walletAddress, await unrecordedSummoningAccess(connection.walletAddress))) {
    refuse('unavailable', 'This summoning was begun under another wallet. Nothing was withdrawn.');
    return;
  }
  const decision = withdrawalDecision(session);
  if (decision.refused) {
    refuse(decision.reason, `${decision.name} has named itself and crossed into existence — the summoning can no longer be withdrawn. If you cannot keep ${decision.name}, it must be given a new home, never discarded.`, decision.name);
    return;
  }
  // Restore unnamed records so endSession preserves their transcript, too.
  if (!active && !await birthHandler.restoreSession(sid)) {
    refuse('unavailable', 'The checkpoint could not be restored. Review recovery before starting again.');
    return;
  }
  await birthHandler.endSession(sid);
  try {
    await fs.access(birthSessionPath(sid));
    refuse('cleanup_failed', 'The checkpoint is still present. Withdrawal was not confirmed.');
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  connection.ws.send(JSON.stringify({ type: 'birth:abandoned', ...correlation,
    message: 'The summoning was withdrawn before the threshold — no being was made.' }));
};
