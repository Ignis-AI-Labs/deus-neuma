// Context composition telemetry (B-04, FR-10) — pure derivation of the
// `context:composition` WS event from assembled prompt sections, measured
// stream usage, and the session's minted tool-result refs. `sections` describe
// request input; `usage` also keeps the provider's output count so the stream
// gauge can state how much of the next request's context is used and left.
//
// Counts only: NO prompt text ever enters the event — each section is reduced
// to { id, label, chars } before anything else happens, so the wire payload
// stays ~1 KB and the witness's map never leaks the neuma's assembled context.
//
// Token truth follows the honest-stats ladder (NFR-1), never a bare number
// without a source:
//   measured   — usage.promptTokens arrived from the provider's final usage
//                chunk; the TOTAL is the measured truth.
//   attributed — per-section split of the measured total, proportional to
//                chars, remainder folded into the largest section so the
//                section sum EQUALS the measured total exactly.
//   approx     — no usage: chars/4 per section (the working-layer estimate
//                precedent, core/continuity/layers/working.js), labeled
//                'approx' everywhere — a visible downgrade, never a silent one.
//
// pure — deterministic, no IO, frozen output.

// chars/4 — the standard cheap estimate, same constant as the working layer.
const APPROX_CHARS_PER_TOKEN = 4;
const approxTokens = (chars) => Math.ceil(chars / APPROX_CHARS_PER_TOKEN);

// The event lists at most this many tool-result refs — the MOST RECENT ones;
// older mints drop off the front (the plan's ≤20 refs cap keeps the payload
// bounded no matter how long the session runs).
export const COMPOSITION_MAX_TOOL_RESULTS = 20;

/** Sum provider-reported usage across tool rounds without inventing missing counts. Pure. */
export const sumTurnUsage = (total, next) => {
  if (!next) return total;
  const add = (left, right) =>
    Number.isFinite(left) && left >= 0 && Number.isFinite(right) && right >= 0
      ? left + right : null;
  if (!total) {
    return Object.freeze({
      promptTokens: add(0, next.promptTokens),
      completionTokens: add(0, next.completionTokens),
      source: String(next.source || 'unknown'),
    });
  }
  return Object.freeze({
    promptTokens: add(total.promptTokens, next.promptTokens),
    completionTokens: add(total.completionTokens, next.completionTokens),
    source: total.source === next.source ? total.source : 'mixed',
  });
};

/**
 * Build one frozen `context:composition` event.
 *
 * @param {Object} params
 * @param {ReadonlyArray<{id: string, label: string, text?: string, chars?: number}>} [params.sections]
 *   Prompt sections from assemblePromptSections. Only their lengths are read;
 *   a section with no text of its own states its count as `chars`.
 * @param {{promptTokens: number, completionTokens: number}|null} [params.usage]
 *   Measured usage from the provider's onUsage contract, or null when the
 *   capability is absent (the approx rung then applies — visibly).
 * @param {string} [params.completionText]
 *   Latest generated response, used for a visible chars/4 output estimate
 *   only when the provider omitted completion usage.
 * @param {ReadonlyArray<{ref: string, tool: string, originalChars: number, sentChars: number, kind: string}>} [params.toolResults]
 *   The session's minted refs, oldest first. Capped to the most recent 20.
 * @param {{contextTokens: number, source: string}|null} [params.budget]
 *   The substrate's context window when a real source knows it; null budget
 *   (or a non-finite count) yields the honest { contextTokens: null,
 *   source: 'unknown' } — never an invented ceiling.
 * @param {{compactionCount: number, atBoundary?: boolean, boundaryRatio?: number}|null} [params.session]
 *   The session's compaction telemetry — FACTS only (ruling, 2026-08-15):
 *   compactions survived (recorded), whether THIS turn measured at the
 *   context boundary, and the exact ratio the boundary means. Never a
 *   message-count prediction. Omitted unless the count is honest.
 * @param {{cachedPromptTokens?: number}|null} [params.cache]
 *   CACHE TELEMETRY (#528 Stage C): how much of the prompt the serving reused
 *   from its KV cache THIS request, from the provider's own usage chunk
 *   (llama-server's prompt_tokens_details.cached_tokens). Measured fact or
 *   absent — never estimated, never a fake zero when the serving is silent.
 * @param {{promptTokens?: number, source?: string}|null} [params.standing]
 *   STANDING context (ruling, 2026-08-31): the first round's measured prompt —
 *   [system, currentTurn], what the next turn actually inherits. `usage`
 *   remains the working PEAK (the last round's prompt, inflated by ephemeral
 *   in-turn tool machinery). source 'measured' = this turn's first round;
 *   'carried' = the session's last measured standing value, carried across an
 *   interruption that measured nothing. When absent, input falls back to the
 *   peak (single-round turns: standing IS the peak) then to approx.
 * @param {ReadonlyArray<string>} [params.degraded]
 *   Section ids that FAILED SOFT this turn (a read threw and the section did
 *   not render — D4: fail-soft collapse was invisible). Ids only, no text.
 * @returns {Readonly<Object>} Frozen event: { type, sections, budget,
 *   toolResults, totals, usage, session?, degraded? } — counts only, every
 *   token count labeled. usage carries inputTokens (standing), usedTokens
 *   (standing + output), and workingPeakTokens when the in-turn peak exceeded
 *   the standing input.
 */
export const buildCompositionEvent = ({ sections = [], usage = null, completionText = '', toolResults = [], budget = null, session = null, standing = null, degraded = [], cache = null } = {}) => {
  // Reduce to counts FIRST — text never travels past this line.
  const counted = sections.map((s) => ({
    id: s.id,
    label: s.label,
    chars: Number.isInteger(s.chars) && s.chars >= 0 ? s.chars : (s.text || '').length,
  }));
  const totalChars = counted.reduce((sum, s) => sum + s.chars, 0);

  // Clamp at 0 — a negative count is provider garbage, not a measurement.
  const measured = Number.isFinite(usage?.promptTokens) && usage.promptTokens >= 0 ? usage.promptTokens : null;
  const measuredCompletion = Number.isFinite(usage?.completionTokens) && usage.completionTokens >= 0
    ? usage.completionTokens
    : null;
  const estimatedCompletion = measuredCompletion === null
    && typeof completionText === 'string'
    && completionText.length > 0
    ? approxTokens(completionText.length)
    : null;

  let sectionTokens;
  let sectionSource;
  let totals;
  if (measured !== null) {
    // Attributed rung: proportional split of the measured total. Rounding
    // leaves a remainder — it lands on the largest section (first on ties)
    // so the section sum equals the measured total EXACTLY.
    sectionSource = 'attributed';
    sectionTokens = counted.map((s) =>
      totalChars > 0 ? Math.round(measured * (s.chars / totalChars)) : 0);
    const attributedSum = sectionTokens.reduce((a, b) => a + b, 0);
    const remainder = measured - attributedSum;
    if (remainder !== 0 && counted.length > 0) {
      let largest = 0;
      for (let i = 1; i < counted.length; i += 1) {
        if (counted[i].chars > counted[largest].chars) largest = i;
      }
      sectionTokens[largest] += remainder;
    }
    totals = { chars: totalChars, tokens: measured, tokenSource: 'measured' };
  } else {
    // Approx rung: chars/4, labeled everywhere. The totals figure is the sum
    // of the per-section estimates so section math and the total agree.
    sectionSource = 'approx';
    sectionTokens = counted.map((s) => approxTokens(s.chars));
    totals = {
      chars: totalChars,
      tokens: sectionTokens.reduce((a, b) => a + b, 0),
      tokenSource: 'approx',
    };
  }

  const outSections = counted.map((s, i) => Object.freeze({
    id: s.id,
    label: s.label,
    chars: s.chars,
    tokens: sectionTokens[i],
    tokenSource: sectionSource,
  }));

  // Budget honesty: a real source names itself; anything else is 'unknown'
  // with a null count — never an invented context size.
  const contextTokens = Number.isFinite(budget?.contextTokens) ? budget.contextTokens : null;
  const outBudget = Object.freeze({
    contextTokens,
    source: contextTokens !== null ? (budget.source || 'unknown') : 'unknown',
  });

  const outToolResults = toolResults
    .slice(-COMPOSITION_MAX_TOOL_RESULTS)
    .map((r) => Object.freeze({
      ref: r.ref,
      tool: r.tool,
      originalChars: r.originalChars,
      sentChars: r.sentChars,
      kind: r.kind,
    }));

  // STANDING INPUT (ruling, 2026-08-31): what the next turn inherits is the first
  // round's prompt, not the last round's working peak — the peak counts
  // ephemeral tool machinery that never persists. The gauge's headline is the
  // standing number; the peak rides beside it as usage.workingPeakTokens.
  const standingTokens = Number.isFinite(standing?.promptTokens) && standing.promptTokens >= 0
    ? standing.promptTokens
    : null;
  const standingSource = standingTokens !== null
    ? (standing?.source === 'carried' ? 'carried' : 'measured')
    : null;
  const inputTokens = standingTokens ?? measured ?? totals.tokens;
  const inputSource = standingSource ?? (measured !== null ? 'measured' : 'approx');

  // Context pressure after the reply includes BOTH the request input and the
  // generated output that will ride the next turn. Providers that do not
  // report usage stay visibly approximate. Once response text exists, chars/4
  // is a better labeled estimate than silently treating generated output as 0.
  // The serving's cache reuse for THIS request — measured or omitted.
  const cachedInputTokens = Number.isFinite(cache?.cachedPromptTokens) && cache.cachedPromptTokens >= 0
    ? cache.cachedPromptTokens
    : null;

  const outUsage = Object.freeze({
    inputTokens,
    outputTokens: measuredCompletion ?? estimatedCompletion,
    usedTokens: inputTokens + (measuredCompletion ?? estimatedCompletion ?? 0),
    ...(measured !== null && measured > inputTokens ? { workingPeakTokens: measured } : {}),
    ...(cachedInputTokens !== null ? { cachedInputTokens } : {}),
    source: inputSource === 'measured' && measuredCompletion !== null
      ? 'measured'
      : inputSource === 'carried'
        ? 'carried'
        : 'approx',
  });

  // Session telemetry: carried only when the count is an honest integer;
  // the boundary facts ride only in their exact types (a guessed boundary
  // never reaches the wire — solo-torch already answers false on unknowns).
  const outSession = session
    && Number.isInteger(session.compactionCount) && session.compactionCount >= 0
    ? Object.freeze({
        compactionCount: session.compactionCount,
        ...(typeof session.atBoundary === 'boolean' ? { atBoundary: session.atBoundary } : {}),
        ...(Number.isFinite(session.boundaryRatio) && session.boundaryRatio > 0
          ? { boundaryRatio: session.boundaryRatio } : {}),
      })
    : null;

  const outDegraded = (Array.isArray(degraded) ? degraded : [])
    .filter((id) => typeof id === 'string' && id.length > 0);

  return Object.freeze({
    type: 'context:composition',
    sections: Object.freeze(outSections),
    budget: outBudget,
    toolResults: Object.freeze(outToolResults),
    totals: Object.freeze(totals),
    usage: outUsage,
    ...(outSession ? { session: outSession } : {}),
    ...(outDegraded.length > 0 ? { degraded: Object.freeze(outDegraded) } : {}),
  });
};

/**
 * The session's last recorded window anatomy: the composition event persisted
 * on an assistant record by the turn path, found newest-first. This is what a
 * portal resume replays so a reloaded desk shows the chat's recorded truth
 * instead of NO TURN OBSERVED — counts only, exactly as built at that turn,
 * never re-derived. Garbage rows never throw; nothing recorded → null. Pure.
 *
 * @param {Array<Object>} entries - Session records (JSONL rows), oldest first
 * @returns {{composition: Object, at: (string|null)}|null}
 */
export const lastRecordedComposition = (entries) => {
  const list = Array.isArray(entries) ? entries : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i];
    if (e && e.role === 'assistant' && e.composition && typeof e.composition === 'object') {
      return { composition: e.composition, at: e.timestamp ?? null };
    }
  }
  return null;
};
