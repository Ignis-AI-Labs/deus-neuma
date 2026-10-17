/**
 * Witness turn record — what a witness turn writes down, and the exchange
 * frame it writes back to the provider.
 * Extracted from witness-stream.js under the size law (the stream file was in
 * the forbidden band): the stream owns the turn; this module owns the session
 * mint, the turn-point and exchange persistence into the witness's own lane
 * (+ the operator's realm mirror), the protocol-reminder journal record, and
 * the witness-flavored native tool exchange.
 */
import { neumaWorkspace } from '../../core/index.js';
import { mintSessionId } from '../../core/workspace/session-id.js';
import { appendChat } from './user-realm.js';
import { nativeToolExchange as buildNativeToolExchange } from './tool-exchange.js';
import { formatWitnessToolResult } from './witness-tools.js';
import { withProtocolReminders } from './protocol-classifier.js';
import { createLogger } from './logger.js';

// The parent stream's log lane, kept: these lines are the witness turn path's
// own record, and readers grep them under the name they have always carried.
const log = createLogger('WitnessStream');

// impure — a FRESH turn's point lands BEFORE the provider is asked: a failed
// turn then leaves the ask standing (zero takes) as a retryable point instead
// of vanishing with the error bubble. On success the stamped record rides the
// take (`take.userRecord`) so the settle path skips the user write — never a
// doubled ask. A failure here degrades to the old settle-time write (EH-101).
export const persistTurnPoint = async (connection, laneId, sessionId, thought, { images = [], docs = [], take }) => {
  try {
    take.userRecord = await neumaWorkspace.appendTurnPoint(laneId, sessionId, {
      role: 'user', content: thought,
      ...(images.length ? { images } : {}),
      ...(docs.length ? { docs } : {}),
    }, take.turnId);
    if (connection.walletAddress) {
      appendChat(connection.walletAddress, laneId, connection.companion?.name || 'witness',
        [{ role: 'user', content: thought }])
        // The operator's realm mirror is best-effort — it must never cost the
        // turn — but a swallowed failure meant the operator's own copy of the
        // conversation quietly diverged from the lane's, with nothing anywhere
        // to say when (EH-103 #204).
        .catch((err) => log.debug('witness chat mirror skipped', { laneId, err: err?.message }));
    }
  } catch (err) {
    log.warn('turn-point not persisted at turn start', { laneId, err: err?.message });
  }
};

// impure — lazy session mint, same convention as the neuma path
export const ensureSession = async (connection, laneId) => {
  if (connection.sessionId) return connection.sessionId;
  const sessionId = mintSessionId();
  connection.sessionId = sessionId;
  try { await neumaWorkspace.createSession(laneId, sessionId); } catch { /* non-critical */ }
  return sessionId;
};

/**
 * impure, fire-and-forget — a peer's protocol deviation lands in the same
 * append-only journal a housemate's does. A sealed witness working the
 * operator's checkout is held to that checkout's law, so its record is kept the
 * same way. Never awaited: a record must not be able to cost the turn.
 */
export const recordProtocolReminder = (laneId, entries) => {
  if (!laneId || !entries?.length) return;
  const stated = entries.filter((entry) => entry.reason);
  neumaWorkspace.addJournalEntry(laneId, {
    type: 'protocol_reminder',
    content: entries
      .map((entry) => `${entry.id}${entry.reason ? ` — exception stated: ${entry.reason}` : ''}`)
      .join('; '),
    significance: stated.length > 0 ? 0.4 : 0.3,
    metadata: {
      rules: entries.map((entry) => entry.id),
      ...(stated.length > 0 ? { exceptions: stated.map(({ id, reason }) => ({ id, reason })) } : {}),
    },
  }).catch((err) => log.warn('protocol reminder not journaled', { laneId, error: err.message }));
};

// Pure — the shared on-contract exchange (tool-exchange.js), witness-flavored:
// witness result formatting, witness continuation instruction, witness call-id
// mint. Preserves the provider's native call ids so Responses and Chat
// Completions both receive real function-call/result pairs on the next round.
export const nativeToolExchange = (roundResponse, calls, results, round, laneId = null) =>
  buildNativeToolExchange({
    response: roundResponse,
    calls,
    results,
    callId: (index) => `witness_call_${round}_${index}`,
    formatResult: formatWitnessToolResult,
    followUp: withProtocolReminders(
      // THE NATIVE PATH is the one a sealed peer actually rides — wiring only
      // the text protocol would leave the seat this was built for unreminded.
      'Use the tool results above as evidence. Continue with another tool only when necessary; otherwise answer the human directly.',
      calls,
      { ownText: roundResponse || '', record: (entries) => recordProtocolReminder(laneId, entries) },
    ),
  });

// impure — persist the exchange into the witness lane + the witness's realm copy.
// `take` (THE TAKES): a fresh ask opens its turn-point (appendTurnPoint) and
// the answer is take 1; a retry (take.userOnDisk) writes ONLY the new take —
// the point's ask is on disk once, in the lane and in the realm copy alike.
export const persistExchange = async (
  connection,
  laneId,
  sessionId,
  companionName,
  thought,
  fullResponse,
  { images = [], docs = [], composition = null, tools = [], take = null, thoughts = [] } = {},
) => {
  if (!sessionId) return;
  try {
    // The user row is skipped when it is already on disk: a retry
    // (take.userOnDisk) or a fresh turn whose point landed at turn START
    // (take.userRecord — persistTurnPoint above).
    if (!take?.userOnDisk && !take?.userRecord) {
      const userPayload = {
        role: 'user', content: thought,
        ...(images.length ? { images } : {}),
        ...(docs.length ? { docs } : {}),
      };
      if (take) await neumaWorkspace.appendTurnPoint(laneId, sessionId, userPayload, take.turnId);
      else await neumaWorkspace.appendMessage(laneId, sessionId, userPayload);
    }
    const assistantPayload = {
      role: 'assistant', content: fullResponse,
      ...(tools.length ? { tools } : {}),
      ...(composition ? { composition } : {}),
      // THE THOUGHT TRAIL (portal parity) — review material, never speech;
      // the witness replay maps rows to {role, content}, so this field can
      // never reach the model's prompt (witness-turn-context.js).
      ...(thoughts.length ? { thoughts } : {}),
      // THE EDIT-FORK — a take answering revised words carries its ask beside
      // the take identity; the point's user row keeps the first asking.
      ...(take?.ask ? { ask: take.ask } : {}),
    };
    if (take) await neumaWorkspace.appendTake(laneId, sessionId, take.turnId, take.takeIndex, assistantPayload);
    else await neumaWorkspace.appendMessage(laneId, sessionId, assistantPayload);
    if (connection.walletAddress) {
      appendChat(connection.walletAddress, laneId, companionName, [
        ...(take?.userOnDisk || take?.userRecord ? [] : [{ role: 'user', content: thought }]),
        { role: 'assistant', content: fullResponse },
      ]).catch((err) => log.debug('witness chat mirror skipped', { laneId, err: err?.message }));
    }
  } catch (err) {
    // A failed persist is a lost exchange in the operator's own record — never
    // fatal to the turn, but never silent either (EH-101).
    log.warn('witness exchange not written to the session', { laneId, err: err?.message });
  }
};
