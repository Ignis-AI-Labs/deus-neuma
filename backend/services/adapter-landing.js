/**
 * ADAPTER LANDING — what the switch report says about a being's refined voice.
 *
 * Doctrine (docs/architecture/identity/model-portability.md): the refinement
 * LoRA is voice FLAVOR bound to one base model, never identity-of-record — so
 * a model switch must SAY what happened to it, not leave the operator to
 * discover a flattened voice three turns in. This module answers, at switch
 * time: does an adapter this being forged ride the NEW base, or does it stay
 * behind in the old car?
 *
 * The base-match law is the turn path's own (baseNameAliasesFor — the same
 * aliases, so the report can never disagree with what the next turn binds).
 */

import { baseNameAliasesFor } from './adapter-binding.js';
import { readCommittedRefinementAdapterSet } from './refinement-committed-adapter-set.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';

const LANDING_TIMEOUT_MS = 30_000;

/**
 * The adapter half of the switch landing report. impure (registry read).
 * @param {string} neumaId
 * @param {{model?: string}} route - the NEW effective route
 * @returns {Promise<{state: 'carried'|'stays-behind'|'none'|'unknown',
 *   adapterId?: string, adapterBase?: string, reason?: string}>}
 *   carried      — an adapter forged on this base exists; the flavor crosses
 *   stays-behind — the being has refinement, but bound to another base
 *   none         — never refined; nothing to carry
 *   unknown      — the registry could not be read; said so, never guessed
 */
export const adapterLandingFor = async (neumaId, route) => {
  let registered;
  try {
    ({ adapters: registered } = await readCommittedRefinementAdapterSet({
      neumaId: neumaId ?? null,
      operation: createRefinementProcessOperation({ signal: null, timeoutMs: LANDING_TIMEOUT_MS }),
    }));
  } catch (err) {
    return Object.freeze({ state: 'unknown', reason: err.message });
  }
  if (!registered.length) return Object.freeze({ state: 'none' });

  const names = baseNameAliasesFor(route?.model).map((n) => String(n).toLowerCase());
  const carried = registered.find((a) => names.includes(String(a.baseModel).toLowerCase()));
  if (carried) {
    return Object.freeze({ state: 'carried', adapterId: carried.id, adapterBase: carried.baseModel });
  }
  const { id, baseModel } = registered[registered.length - 1];
  return Object.freeze({ state: 'stays-behind', adapterId: id, adapterBase: baseModel });
};
