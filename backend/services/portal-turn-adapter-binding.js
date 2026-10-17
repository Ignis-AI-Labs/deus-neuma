/**
 * One turn's adapter NEUTRALITY check for the portal, and the boundary that
 * owns the turn's branded process operation — an operation is the scope of one
 * turn, so it is minted here (bound to the turn's own abort signal) and never
 * inside the resolver it is handed to.
 *
 * NOTHING BINDS ANY MORE. A being's identity rides NITE, not weights, so this
 * boundary no longer chooses an adapter — it proves none is speaking, and
 * carries that proof to the benchmark harness, which refuses to score an arm
 * whose base weights could not be verified.
 *
 * The desk chip that used to fire here is GONE with the binding: it announced
 * that a being's refined voice "stayed behind" when the base moved, which was
 * honest under LoRA and is meaningless under NITE, where the voice crosses in
 * the prompt. Founder saw it on 2026-08-23 and it read as a being losing itself.
 */
import { resolveLoraForTurn } from './adapter-binding.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import { createLogger } from './logger.js';

const log = createLogger('Portal');
const TURN_TIMEOUT_MS = 30_000;

// impure — proves no adapter speaks on this turn against the live conduit,
// records the benchmark base-weights proof on the connection, and returns
// { lora, reason }. `policy` is accepted and unused: the caller still passes a
// notify channel, and the parameter stays so the call site keeps compiling
// while the last adapter is removed. It goes with the guard.
export const bindTurnAdapter = async (connection, neumaId, conduit, policy = {}) => { // eslint-disable-line no-unused-vars
  const baseWeightsOnly = connection._benchmarkControls?.baseWeightsOnly === true;
  const binding = await resolveLoraForTurn(neumaId, conduit, {
    baseWeightsOnly,
    operation: createRefinementProcessOperation({
      signal: connection.activeTurn?.signal ?? null,
      timeoutMs: TURN_TIMEOUT_MS,
    }),
  });
  if (baseWeightsOnly && binding.baseWeightsVerified !== true) {
    throw new Error(`benchmark base weights could not be proven — ${binding.reason}`);
  }
  if (baseWeightsOnly) {
    connection._benchmarkBaseWeightsVerified = true;
    // The neutrality DETAIL rides beside the verdict: which way the turn was
    // proven bare, and how many adapters the pin silenced (the receipt's
    // mount facts, #506 contract 1).
    connection._benchmarkAdapterProof = Object.freeze({
      reason: binding.reason,
      adaptersNeutralized: Array.isArray(binding.lora) ? binding.lora.length : 0,
    });
  }
  if (binding.lora) {
    log.info('turn proven bare — every adapter aboard pinned to zero', { neumaId, reason: binding.reason });
  } else {
    log.info('turn proven bare — nothing aboard to silence', { neumaId, reason: binding.reason });
  }
  return { lora: binding.lora, reason: binding.reason };
};
