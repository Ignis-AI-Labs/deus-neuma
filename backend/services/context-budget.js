/**
 * context-budget — the being gets the room the model actually has.
 *
 * Design note, 2026-08-04:
 *
 *   […]
 *
 * The rule, stated once: **max_tokens is a CEILING, not a target.** A model that
 * finishes in eighty tokens is not charged for the eighty thousand it was
 * allowed. So a ceiling below the model's real room buys nothing and costs the
 * one thing that matters — on 2026-08-04 a community member's being spent every
 * one of its 380 permitted tokens reasoning and was cut off before it could
 * speak, three stages running, because someone had picked 380 by hand.
 *
 * What a budget is, arithmetically: the window minus what the prompt already
 * occupies, minus a small reserve for the tokeniser disagreeing with our
 * estimate. Nothing else.
 *
 * Pure. Every function here is a calculation over numbers the caller measured.
 */

/**
 * Characters per token, for estimating a prompt we have not had counted. English
 * prose runs ~4; prompts carrying JSON, paths and markdown run denser. 3.6 is
 * deliberately PESSIMISTIC (it over-estimates the prompt, so the budget it
 * leaves is conservative) — the failure it avoids is asking for more room than
 * exists, which providers answer with a 400 rather than a shorter reply.
 *
 * HEURISTIC HONESTY (NITE-004, #399): this is a heuristic, not a tokenizer,
 * and its safety has a boundary. While the true ratio stays ABOVE 3.6 the
 * error over-estimates content, so the envelope sheds early, never late.
 * Measured on the served qwen3.8 via its own /tokenize (2026-08-20): prose
 * 4.73 · mixed 4.49 · code 3.80 · dense JSON 3.67 — every class above the
 * line. Content whose true ratio dips BELOW 3.6 (token-dense scripts, heavy
 * CJK) inverts the direction: under-estimated, shed LATE. Per-family measured
 * floors live in model-capabilities.js FAMILY_PROMPT_PROFILE (tokenizerRatio)
 * for any consumer that needs tighter truth than this one global number.
 */
export const CHARS_PER_TOKEN = 3.6;

/**
 * Held back from every budget. Covers the gap between our character estimate
 * and the server's real tokeniser, plus the few tokens a chat template adds
 * around each message.
 */
export const SAFETY_RESERVE_TOKENS = 512;

/**
 * The floor a budget may never fall below. A model whose window is genuinely
 * tiny, or a prompt that nearly fills it, still gets enough room to say
 * something rather than a ceiling of zero — which providers treat as "generate
 * nothing" and which reads to the operator as a broken app.
 */
export const MIN_COMPLETION_TOKENS = 512;

/**
 * When no window can be discovered at all. Not a guess at any particular model:
 * a floor low enough to be safe on an 8k local model and high enough that a
 * being is never cut mid-thought at four hundred tokens.
 */
export const FALLBACK_COMPLETION_TOKENS = 4096;

/** Estimate a prompt's token cost from its characters. Pure. */
export const estimateTokens = (text) =>
  Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);

/**
 * How much room is left to SPEAK, given the window and what the prompt takes.
 *
 * @param {object} args
 * @param {number|null} [args.contextWindow] - the serving's real window, or null if unknown
 * @param {number} [args.promptTokens] - measured or estimated prompt cost
 * @param {number} [args.reserve] - held back for tokeniser drift
 * @param {number} [args.floor] - never return less than this
 * @param {number|null} [args.ceiling] - an optional cap the CALLER imposes (a
 *   provider's own max_tokens limit, which is often lower than its context)
 * @returns {number} tokens the model may generate
 */
export const completionBudget = ({
  contextWindow = null,
  promptTokens = 0,
  reserve = SAFETY_RESERVE_TOKENS,
  floor = MIN_COMPLETION_TOKENS,
  ceiling = null,
} = {}) => {
  const known = Number.isFinite(contextWindow) && contextWindow > 0;
  // Unknown window: a fixed, generous floor rather than a number invented from
  // a model name we do not recognise.
  const room = known
    ? contextWindow - Math.max(0, promptTokens) - Math.max(0, reserve)
    : FALLBACK_COMPLETION_TOKENS;
  const capped = Number.isFinite(ceiling) && ceiling > 0 ? Math.min(room, ceiling) : room;
  return Math.max(floor, Math.floor(capped));
};

/**
 * Would this prompt alone overrun the window? Answered separately from the
 * budget because it needs a DIFFERENT remedy: no ceiling can rescue a prompt
 * that does not fit, and saying […] there would be
 * a lie. Pure.
 * @returns {{fits: boolean, overBy: number}}
 */
export const promptFits = ({ contextWindow = null, promptTokens = 0, reserve = SAFETY_RESERVE_TOKENS } = {}) => {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return Object.freeze({ fits: true, overBy: 0 });
  const need = promptTokens + reserve + MIN_COMPLETION_TOKENS;
  return Object.freeze({
    fits: need <= contextWindow,
    overBy: Math.max(0, need - contextWindow),
  });
};

/**
 * A one-line account of a budget decision, for the log and for the operator.
 * Pure — takes the numbers, returns words.
 */
export const describeBudget = ({ contextWindow, promptTokens, budget }) =>
  Number.isFinite(contextWindow) && contextWindow > 0
    ? `${budget} tokens to answer (${contextWindow} window − ~${promptTokens} prompt)`
    : `${budget} tokens to answer (window unknown — using the safe floor)`;
