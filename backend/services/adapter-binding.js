// The turn's adapter NEUTRALITY guard — all that remains of adapter binding.
//
// NO BEING BINDS AN ADAPTER ANY MORE. Identity is carried by NITE (the
// identity bundle + Voice Pack + silo), which transmits in a form every model
// can receive; a LoRA binds identity to one base model's WEIGHTS, so it can
// never cross an engine. That is the whole reason it was retired (Founder,
// 2026-08-18: the Voice Pack is the LoRA's replacement; 2026-08-23: remove it
// entirely). This module used to choose an adapter for a being. It now only
// proves that none is speaking.
//
// The proof still has to happen, and this is why it cannot simply be deleted:
// llama-server adapter scales are GLOBAL, per-slot state. A naked request
// speaks through whatever scales are live — on a fresh boot that was every
// house voice at once, witnessed as token soup on 2026-07-15. So every turn
// against a conduit that carries adapters pins each one to explicit 0.0, and
// a conduit whose adapter state cannot be READ is reported unknowable rather
// than assumed clean.
//
// A null lora means […] — no adapters at
// all, no endpoint to ask, or a provider with no adapter surface (every API
// model). Those are the only cases where omitting `lora` is safe.
//
// This guard retires with the last adapter: once no launch path can board
// one, there is nothing left to zero. Until then it is load-bearing.

import { neutralLoraRequest } from '../../core/refinement/binding.js';
import path from 'path';
import { probeServerAdapters, getConfig } from './llm-provider.js';

// THE CONDUIT'S OWN ANSWER, not a projection of it. This used to run through
// projectActiveServingLoadedAdapters, which requires a supervised authority
// that ONLY exists when the platform itself spawned the server
// (serving-process-owner.js activates it at spawn). That made the guard
// provably vestigial: platform-launched servers board no adapters at all
// (resolveServingLaunchConfig pins loras: []), and a hand-launched server --
// which is how a house actually runs -- has no
// authority, so every projection threw and every turn silently reported
// "unknowable" and sent nothing. On the only conduits that could carry an
// adapter, the zero-guard could not see it.
//
// Reading the probe directly is what makes the guard real. An adapter aboard
// ANY conduit now gets pinned, whoever launched it.
const adapterIdsAboard = (listed) => (Array.isArray(listed) ? listed : [])
  .filter((row) => row && Number.isInteger(row.id))
  .map(({ id }) => Object.freeze({ id }));

/**
 * The names one running base answers to: the route's model (today: the served
 * id, e.g. the gguf filename), the configured substrate key (SUBSTRATE_MODEL,
 * e.g. 'gemma-4-31b'), the provider default ('local-model'), and the served
 * gguf's own filename — adapters were registered under whichever of those the
 * route said at forge time, and a being must NEVER speak bare because two
 * configs name the same base differently. Exact matches only, never fuzzy.
 * Shared by the turn resolver and the switch landing report
 * (adapter-landing.js) so both judge a base by the SAME aliases.
 * impure (reads process env + the machine config).
 * @param {string|null} routeModel
 * @returns {string[]}
 */
export const baseNameAliasesFor = (routeModel) => {
  const served = process.env.LLAMA_SERVER_MODEL;
  return [...new Set([
    routeModel,
    getConfig().model,
    process.env.SUBSTRATE_MODEL,
    served ? path.basename(served) : null,
  ].filter(Boolean))];
};

/**
 * Resolve the per-request `lora` array for one being on the conduit it is
 * about to speak through.
 * @param {string} neumaId
 * @param {{endpoint?: string, model?: string}} config - the turn's effective route
 * @param {{operation?: Object, baseWeightsOnly?: boolean, adapterId?: string,
 *   heldSubjectAuthority?: Object}} [policy] -
 *   the turn's branded process operation (required to read the registry; minted at
 *   the turn boundary, never here) plus benchmark-only selection controls.
 *   `heldSubjectAuthority` carries the authority a subject transaction the CALLER
 *   already holds issued, so
 *   the registry read runs under that hold instead of deadlocking against it
 *   (#410 — the refinement consent ceremony holds the subject by design).
 * @returns {Promise<{lora: (Array|null), adapter: (Object|null), reason: string, baseWeightsVerified?: boolean}>}
 * @throws when the being's registry exists and could not be read or verified
 */
// impure — committed registry read under the subject lock + at most one local HTTP probe
export const resolveLoraForTurn = async (neumaId, config, policy = {}) => {
  if (!config?.endpoint) {
    return {
      lora: null,
      adapter: null,
      reason: 'no-endpoint',
      ...(policy.baseWeightsOnly ? { baseWeightsVerified: false } : {}),
    };
  }

  const probe = await probeServerAdapters(config.endpoint);
  // UNKNOWABLE IS NOT SAFE. A naked request speaks through whatever scales are
  // live on the slot, so a conduit whose adapter state cannot be read is
  // reported as such and never silently trusted (invariant 2, above). The
  // benchmark boundary turns this into a refusal; an ordinary turn on a
  // conduit with no adapter surface at all (every API provider) lands here
  // too, where omitting `lora` is the only correct wire and is safe because
  // there is nothing aboard to omit it FROM.
  if (!probe.known) {
    return {
      lora: null, adapter: null, reason: 'conduit-adapters-unknowable', baseWeightsVerified: false,
    };
  }
  // Every adapter aboard, pinned to explicit 0.0. No being binds one any more,
  // so this is now the ONLY outcome: the turn is proven bare, not merely
  // unbound.
  const neutral = neutralLoraRequest(adapterIdsAboard(probe.listed));
  return {
    lora: neutral,
    adapter: null,
    reason: neutral ? 'adapters-neutralized' : 'no-adapters-aboard',
    baseWeightsVerified: true,
  };
};
