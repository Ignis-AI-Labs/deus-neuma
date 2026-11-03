import { foldWorkingContext } from './working-context.js';
import { nearContextBoundary } from './solo-torch.js';
import { createLogger } from './logger.js';

const log = createLogger('ContextOverflow');

const OVERFLOW = /exceed_context_size_error|context_length_exceeded|exceeds?\s+(?:the\s+)?(?:available\s+)?context\s+(?:size|window)|context\s+(?:size|window)\s+exceeded/i;

/** Pure — classify only provider responses that explicitly name context exhaustion. */
export const isContextOverflow = (status, detail) =>
  (Number(status) === 400 || Number(status) === 413) && OVERFLOW.test(String(detail || ''));

/**
 * Pure — emergency fold after the provider measured an overflow. The ordinary
 * fold keeps two recent rounds; an actual overflow releases every in-turn
 * round instead. The system prompt, transcript, current operator turn, and
 * assistant speech stay untouched. Null means there is nothing lawful to fold.
 */
export const recoverContextOverflow = (messages, contextHead) => {
  if (!Number.isInteger(contextHead) || contextHead < 1 || !Array.isArray(messages)) return null;
  const fold = foldWorkingContext(messages, { head: contextHead, keepRecentRounds: 0 });
  return fold.freedChars > 0 ? fold : null;
};

/** Pure — request options shared by every round and close in one turn. */
export const contextRecoveryOptions = (contextHead, onContextRecovery) => ({ contextHead, onContextRecovery });

/** Pure — the last measured standing count carried by a connection, if one exists. */
export const measuredStandingFor = (connection) => {
  if (Number.isFinite(connection?.lastMeasuredStanding?.promptTokens)) {
    return { promptTokens: connection.lastMeasuredStanding.promptTokens };
  }
  const usage = connection?.contextComposition?.usage;
  if (!Number.isFinite(usage?.inputTokens) || !['measured', 'carried'].includes(usage?.source)) return null;
  return { promptTokens: usage.inputTokens };
};

/**
 * Impure — after a failed/interrupted turn, compact before the next assembly
 * when the inherited session is measured near-full. Successful turns keep their
 * established post-turn compaction. Failure is logged and the turn continues;
 * the provider-confirmed overflow path remains the last line of defense.
 */
export const compactBeforeTurn = async ({ connection, contextWindow, compact, onState = null }) => {
  if (connection?.contextRecoveryPending !== true) return false;
  connection.contextRecoveryPending = false;
  const usage = measuredStandingFor(connection);
  if (!nearContextBoundary(usage, { contextTokens: contextWindow })) return false;
  try {
    onState?.('running');
    const compacted = await compact();
    if (compacted) {
      connection.lastMeasuredStanding = null;
      connection.contextComposition = null;
    }
    onState?.(compacted ? 'done' : 'refused');
    return compacted;
  } catch (err) {
    log.warn('turn-start compaction failed', { err: err?.message });
    onState?.('failed');
    return false;
  }
};
