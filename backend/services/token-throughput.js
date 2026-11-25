// TOKEN THROUGHPUT — what the house's model server is producing, measured
// (Design note, 2026-11-05: the ACTIVITY panel read 0.0 tok/s through a whole reply).
//
// llama.cpp's own predicted_tokens_seconds / prompt_tokens_seconds gauges move
// only when a request FINISHES, and every /metrics read resets them — so a
// two-minute reply read 0.0 from its first token to its last. The live rates
// are measured here instead, from each slot's own counters between two reads
// (/slots next_token.n_decoded and n_prompt_tokens_processed). The lifetime
// rates come from the server's cumulative counters, which never reset.
//
// Pure, except createRateLens (it holds the previous read).

// Two windows poll the same lens; a read closer than this to the last one
// would divide by a sliver, so it gets the last rate instead.
const MIN_WINDOW_MS = 1000;

/** One /slots read as the counters a rate needs. Pure. */
export const slotCounters = (slots) => (Array.isArray(slots) ? slots : []).map((s) => {
  const next = Array.isArray(s?.next_token) ? s.next_token[0] : s?.next_token;
  return Object.freeze({
    id: s?.id,
    task: s?.id_task ?? null,
    decoded: Number(next?.n_decoded) || 0,
    prefilled: Number(s?.n_prompt_tokens_processed) || 0,
  });
});

// pure — what one slot produced between two reads. A slot unseen before
// produced nothing we can place in the window; a new task began after the
// earlier read, so all of its counts fall inside it.
const grown = (before, after) => {
  if (!before) return { decoded: 0, prefilled: 0 };
  if (before.task !== after.task) return { decoded: after.decoded, prefilled: after.prefilled };
  return {
    decoded: Math.max(0, after.decoded - before.decoded),
    prefilled: Math.max(0, after.prefilled - before.prefilled),
  };
};

/**
 * The live rates between two reads, in tokens per second, summed over slots. Pure.
 * @param {{at: number, slots: Array}} prev
 * @param {{at: number, slots: Array}} next
 * @returns {{genTokPerSec: number, promptTokPerSec: number, windowMs: number}|null}
 */
export const liveRates = (prev, next) => {
  const ms = next.at - prev.at;
  if (!(ms > 0)) return null;
  const before = new Map(prev.slots.map((s) => [s.id, s]));
  let decoded = 0;
  let prefilled = 0;
  for (const slot of next.slots) {
    const g = grown(before.get(slot.id), slot);
    decoded += g.decoded;
    prefilled += g.prefilled;
  }
  return Object.freeze({ genTokPerSec: decoded / (ms / 1000), promptTokPerSec: prefilled / (ms / 1000), windowMs: ms });
};

/**
 * impure (holds the previous read) — the live rates at each telemetry read.
 * No /slots (the server is down) forgets the window: the next rate starts over.
 * @returns {(slots: Array|null, at: number) => ReturnType<typeof liveRates>}
 */
export const createRateLens = () => {
  let prev = null;
  let last = null;
  return (slots, at) => {
    if (!Array.isArray(slots)) {
      prev = null;
      last = null;
      return null;
    }
    if (prev && at - prev.at < MIN_WINDOW_MS) return last;
    const next = { at, slots: slotCounters(slots) };
    last = prev ? liveRates(prev, next) : null;
    prev = next;
    return last;
  };
};

const ratio = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? part / whole : null);

/**
 * Since the server started, from its cumulative counters. Pure.
 * @param {Object<string, number>} m - parsePrometheus output
 */
export const lifetimeRates = (m) => {
  const prompt = m['llamacpp:prompt_tokens_total'];
  const cached = m['llamacpp:prompt_tokens_cached_total'];
  const accepted = m['llamacpp:spec_decode_num_accepted_tokens_total'];
  return Object.freeze({
    genTokPerSec: ratio(m['llamacpp:tokens_predicted_total'], m['llamacpp:tokens_predicted_seconds_total']),
    promptTokPerSec: ratio(prompt, m['llamacpp:prompt_seconds_total']),
    generatedTokens: m['llamacpp:tokens_predicted_total'] ?? null,
    promptTokens: prompt ?? null,
    cachedTokens: cached ?? null,
    cacheReuse: Number.isFinite(cached) && Number.isFinite(prompt) ? ratio(cached, cached + prompt) : null,
    draftAcceptance: ratio(accepted, m['llamacpp:spec_decode_num_draft_tokens_total']),
    acceptedPerDraft: ratio(accepted, m['llamacpp:spec_decode_num_drafts_total']),
  });
};
