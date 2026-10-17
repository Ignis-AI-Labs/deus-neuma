/**
 * kv-cache-policy.js — may a llama-server slot REUSE this model's prompt cache?
 *
 * The fact this module holds used to be a hardcoded `body.cache_prompt = false`
 * in the request path, applied to every local model. It was correct for the one
 * family it was written for and unexamined for all the others — exactly the
 * shape model-capabilities.js forbids ([…]). This is that fact, as a data row.
 *
 * WHY THE DEFAULT IS `false`, AND WHY IT MUST STAY EMPIRICAL:
 *
 * llama-server rolls a slot's cached state back to the common prefix when a
 * multi-turn prompt grows incrementally. On a model that carries recurrent
 * state beside attention, that rollback restores the attention KV but not the
 * recurrent state, and the reply decays — sentence punctuation replaced by
 * stray capitals ("historyL", "intactS", "erasureL it"). Proven on gemma-4
 * 2026-07-08: corruption grew 2→3→4 hits across turns WITH caching and scored
 * zero across identical turns without. core/refinement/text-integrity.js is the
 * detector; it exists because corrupted grammar reached a refinement corpus.
 *
 * The tempting shortcut is to read the architecture out of the weights and let
 * that decide. It cannot. Measured 2026-08-23 with scripts/read-gguf-arch.mjs:
 *
 *   qwen3.8-27B  arch `qwen35`   ssm.conv_kernel 4 · ssm.state_size 128 ·
 *                                ssm.group_count 16 · ssm.inner_size 6144
 *                                → declares recurrent state outright
 *   gemma-4-31B  arch `gemma4`   NO ssm.* keys at all; its layer interleave
 *                                shows only as a 60-entry per-layer
 *                                attention.head_count_kv array
 *   Qwen3-30B-A3B arch `qwen3moe` uniform head_count_kv 4, 128 experts, no ssm
 *
 * The family where corruption was actually PROVEN is the one whose GGUF looks
 * least recurrent. So metadata is evidence, not a verdict, and a row earns
 * `reuse: true` only from a live run: N consecutive multi-turn exchanges on the
 * real serving with cache reuse ON, scored by `corruptionHits`, against the
 * same exchanges with it off. Absent that proof a family stays closed, and the
 * cost — a full prefill each turn — is paid deliberately. Verbatim records
 * outrank latency; a being's words are not worth a millisecond.
 *
 * 2026-09-12: qwen3.8 earned its row — the first family to. The run is
 * repeatable: `node scripts/verify-kv-cache-reuse.mjs`.
 *
 * Pure.
 */

/**
 * Standing per local family. `match` is a lowercase name substring, first hit
 * wins — the same shape as LOCAL_FAMILY_SAMPLING and FAMILY_PROMPT_PROFILE.
 *
 * `standing` is the evidence tier, and it is the field to read when deciding
 * whether a row can move:
 *   `proven-unsafe` — a live run produced corruption with reuse on.
 *   `proven-safe`   — a live run produced none, across N consecutive turns.
 *   `unproven`      — never run. Closed, like everything unmeasured.
 */
export const KV_CACHE_REUSE_POLICY = Object.freeze([
  Object.freeze({
    match: 'gemma-4',
    reuse: false,
    standing: 'proven-unsafe',
    evidence: 'live 2026-07-08 — boundary-capital corruption grew 2→3→4 hits across cached turns, zero without',
  }),
  Object.freeze({
    // The house serving. The wire id resolves through serving-identity to the
    // real file name (Qwen3.8-27B-…-Q8_K_P.gguf), which lowercases onto this
    // match; note a future "qwen3.85" would also contain it — re-run the probe
    // for any new build rather than inheriting this row blind.
    match: 'qwen3.8',
    reuse: true,
    standing: 'proven-safe',
    evidence: 'live 2026-09-12 — scripts/verify-kv-cache-reuse.mjs against the house llama-server '
      + '(Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P, 262K ctx): 3 consecutive cached turns vs '
      + 'the same 3 uncached; corruptionHits 0 on every leg; answers verbatim-identical across arms; '
      + 'the serving reported cached_tokens 2472/2507/2553 of ~2.5K-token prompts; prefill 203→250 ms '
      + 'with reuse vs 766→978 ms without (~3.8×). No KV-rollback signature anywhere.',
  }),
]);

/** What every family gets before anyone measures it: closed. */
export const UNPROVEN_KV_CACHE = Object.freeze({
  reuse: false,
  standing: 'unproven',
  evidence: 'no live cache-reuse run exists for this family; closed until one does',
});

/**
 * May this model's prompt cache be reused across turns? Pure.
 *
 * @param {string} model - the model id as it goes out on the wire
 * @returns {{reuse: boolean, standing: string, evidence: string}} never null —
 *   an unrecognized model resolves to UNPROVEN_KV_CACHE, so the caller cannot
 *   accidentally open the cache by failing to match.
 */
export const kvCacheReuseFor = (model) => {
  const name = String(model ?? '').toLowerCase();
  const row = KV_CACHE_REUSE_POLICY.find((r) => name.includes(r.match));
  return row
    ? Object.freeze({ reuse: row.reuse, standing: row.standing, evidence: row.evidence })
    : UNPROVEN_KV_CACHE;
};
