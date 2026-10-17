/**
 * Witness tool epochs — the pure dedup/repeat law of a witness tool turn.
 * Extracted from witness-stream.js under the size law (the stream file was in
 * the forbidden band): the stream owns the turn; this module owns the keys —
 * which call is a repeat, which world-version each call sees, and what a
 * repeated call is answered with.
 */
import { isObservationTool } from './tool-policy.js';
import { serializeToolIdentity } from '../../core/runtime/tool-call-identity.js';

/** Pure - execution can be retried after mutation, but is NEVER read-only. */
export const isRepeatableExecution = (call) =>
  (!call?.server || call.server === 'coding')
  && ['execute', 'coding/execute'].includes(call?.toolName || call?.tool);

// Pure — one turn must never execute the same model-issued act twice just
// because the provider repeats its call after receiving the result.
//
// `epoch` is how many times the world has moved this turn (BE-142 #214). It
// enters the key for observations and coding execution, so a retry after a write is a
// different question and actually runs, while a repeated write is deduped as
// absolutely as it always was. Without this, a being that created a task and
// immediately listed its ledger was handed the pre-write answer and told, in
// the platform's own voice, that its act had not happened. Exported so its
// tests build keys with the REAL function rather than a hand-written copy.
export const toolCallKey = (call, epoch = 0) => serializeToolIdentity([
  call?.server || null,
  call?.toolName || call?.tool || null,
  call?.args || {},
  (isObservationTool(call) || isRepeatableExecution(call)) ? epoch : null,
  ...((!call?.server || call.server === 'coding')
    && ['sandbox_recover', 'coding/sandbox_recover'].includes(call?.toolName || call?.tool)
    ? [call.recoveryState || null] : []),
]);

/**
 * The world-version each call in a batch sees. Pure.
 *
 * A batch can carry [list, add, list] in one round, so the epoch cannot be a
 * per-round constant — a read placed AFTER a write in the same batch must see
 * the moved world too. Each mutating call advances the version for everything
 * that follows it.
 *
 * @param {Array<object>} calls the round's calls, in issue order
 * @param {number} base the turn's epoch entering this round
 * @returns {{epochs: Array<number>, next: number}} per-call epoch + the epoch to carry forward
 */
export const epochsForBatch = (calls, base = 0) => {
  let epoch = base;
  const epochs = (calls || []).map((call) => {
    const at = epoch;
    if (!isObservationTool(call)) epoch += 1;
    return at;
  });
  return { epochs, next: epoch };
};

/** How much of a prior result to quote back. The full text is already in the
 *  transcript; repeating it would double the context to say "you have this". */
const REPEAT_EXCERPT = 400;

/**
 * The answer to a call the model already made this turn.
 *
 * Pure. Says plainly that the call was not re-run and what it returned, so the
 * model can move on instead of waiting on a result that is never coming. The
 * `prior` may be absent when a batch was cut short by an interrupt — then this
 * says exactly that rather than inventing an outcome.
 *
 * @param {object} call the repeated call
 * @param {{tool?: string, status?: string, content?: string, error?: string}|undefined} prior
 */
/** The statuses of a call that actually executed — the only ones a repeat may say "ran". */
// 'returned': a sender's tool ran on the sender's side; its result is known, not its verdict.
const RAN_STATUSES = new Set(['ok', 'error', 'returned']);

export const heldRepeatResult = (call, prior) => {
  const tool = prior?.tool
    || (call?.server ? `${call.server}/${call.toolName || call.tool}` : call?.toolName || call?.tool || 'unknown');
  if (!prior) {
    return {
      tool,
      status: 'held',
      error: 'this call was not executed — the turn was interrupted before it ran',
    };
  }
  const body = prior.content ?? prior.error ?? '';
  const excerpt = body.length > REPEAT_EXCERPT ? `${body.slice(0, REPEAT_EXCERPT)}…` : body;
  return {
    tool,
    status: 'held',
    ...(prior.operationId ? { operationId: prior.operationId, operationState: prior.operationState,
      ...(prior.operationTiming ? { operationTiming: prior.operationTiming } : {}) } : {}),
    // Past tense, deliberately (BE-142 #214): says when the answer was true,
    // and leaves the being free to judge whether it still is — present-tense
    // wording once told a being its just-filled ledger was empty. The close
    // line is a redirect, not a verdict (#531, 2026-09-20): a held call must
    // send the being somewhere, because a seat that repeats a held read was
    // ending its session on the guard instead of varying the call. Only a
    // call that RAN (ok, error) says "when it ran": a denied or refused call
    // never executed, and its repeat must not claim that it did (#566).
    content: `You already made this exact call earlier this turn — it was not run again. `
      + `Its earlier result was (${prior.status}) — `
      + `${RAN_STATUSES.has(prior.status) ? 'when it ran, it returned the following' : 'it never ran'}:\n\n${excerpt}\n\n`
      + `That was its answer at that moment, not necessarily the state now. `
      + `The full result is earlier in this turn. Identical call already executed — `
      + `change the arguments, vary them, or choose another route entirely; `
      + `the same call will not run again this turn.`,
  };
};

/**
 * Results aligned ONE-TO-ONE with `calls`.
 *
 * `nativeToolExchange` pairs calls to results BY POSITION, and the Responses
 * API rejects an assistant turn carrying a `tool_call_id` with no matching
 * result — a shorter or reordered array fails the turn. Every call gets
 * exactly one result: the fresh one if it ran, else the outcome that call
 * already produced this turn, else an honest "not executed".
 *
 * Pure. Exported because this invariant is the whole risk of answering repeats
 * instead of ending the turn on them.
 *
 * @param {Array<object>} calls every call the model made this round, in order
 * @param {Array<object>} freshCalls the subset that had not been made before
 * @param {Array<object>} freshResults results for freshCalls, index-aligned
 * @param {Map<string, object>} priorByKey key -> the result that call produced
 * @param {{epochs?: Array<number>, freshEpochs?: Array<number>}} [worldVersion]
 *   per-call world-versions from epochsForBatch (BE-142 #214); absent means the
 *   pre-#214 unmoved world
 * @returns {Array<object>} one result per entry of `calls`, in the same order
 */
export const alignToolResults = (calls, freshCalls, freshResults, priorByKey, worldVersion = {}) => {
  const { epochs = [], freshEpochs = [] } = worldVersion;
  const freshByKey = new Map();
  freshCalls.forEach((call, index) => {
    if (freshResults[index]) freshByKey.set(toolCallKey(call, freshEpochs[index] || 0), freshResults[index]);
  });
  return calls.map((call, index) => {
    const key = toolCallKey(call, epochs[index] || 0);
    return freshByKey.get(key) || heldRepeatResult(call, priorByKey.get(key));
  });
};
