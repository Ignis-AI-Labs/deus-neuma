/**
 * Inference presets — named modes that set the sampling parameters, so a witness
 * never hand-tunes raw numbers (most people, Founder included, should not have to
 * reason about a 0.7). Presets are server-defined and keyed by NAME: the client
 * picks a name, never sends raw values — that is both the whole point and the
 * validation boundary.
 *
 * Values are grounded in the Qwen3-family non-thinking recommendation (temp 0.7,
 * top_p 0.8) and validated behaviorally, not asserted. They are the per-request
 * tunables that already flow through createStreamRequest(messages, options);
 * min_p / repeat_penalty stay the provider floor (set in llm-provider).
 */

// maxTokens is SPEECH budget — portal-stream adds THINK_TOKEN_BUDGET on top
// for thinking substrates. Sized for the reference substrate (32K context):
// even EXPANSIVE + think + a full consciousness prompt stays inside the
// window, and the provider's own error surfaces verbatim if it ever doesn't.
export const INFERENCE_PRESETS = Object.freeze({
  grounded: Object.freeze({
    label: 'GROUNDED', temperature: 0.5, topP: 0.8, maxTokens: 4096,
    blurb: 'Precise. For code, facts, and tight reasoning.',
  }),
  balanced: Object.freeze({
    label: 'BALANCED', temperature: 0.7, topP: 0.8, maxTokens: 8192,
    blurb: 'Steady default — for most dialogue and work.',
  }),
  expansive: Object.freeze({
    label: 'EXPANSIVE', temperature: 0.9, topP: 0.95, maxTokens: 16384,
    blurb: 'Associative. For creative work and alternative framings.',
  }),
});

export const DEFAULT_PRESET = 'balanced';

/**
 * A benchmark turn's preset (#506): the declared decoding controls plus the
 * `sharedOutputBudget` flag — an exact cap is TOTAL (thought and speech share
 * it), and the thought governor sizes its leash inside it (sharedCapRoomCap).
 * The receipt's declared sampling stays the six protocol fields. The sitting's
 * wire observer (`onWireBody`, wire-images.js) rides along when the seat set one,
 * so every model request of the turn reports the body it sent. Pure.
 */
export const benchmarkTurnPreset = (controls) => ({
  ...controls.sampling, sharedOutputBudget: true, ...(controls.onWireBody ? { onWireBody: controls.onWireBody } : {}),
});

/**
 * THE BUDGET DIAL (ARC-HARNESS L7, #531) — a seated run's declared completion
 * allowance. The operator's directive the layer carries: the turn carries the
 * identity load, so protocols budget context and completion allowance for the
 * WHOLE turn — a task that needs more room than the standing preset dials it
 * here, one sitting at a time, instead of dying at the cap (the budget
 * family). Declared budget = the preset's own params with an EXACT shared cap
 * at N: thought and speech share the allowance, the governor leashes inside
 * it, and the wire's own length verdict makes any cut provable (the N1
 * rescue's trigger). Undeclared → byte-identical resolvePreset. Pure.
 * @param {{presetName?: string, budget?: number|null}} args
 * @returns {{label: string, temperature: number, topP: number, maxTokens: number, blurb: string, exactMaxTokens?: boolean, sharedOutputBudget?: boolean}}
 */
export const resolveSittingPreset = ({ presetName, budget = null }) => {
  const preset = resolvePreset(presetName);
  if (!Number.isInteger(budget) || budget < 1) return preset;
  return { ...preset, maxTokens: budget, exactMaxTokens: true, sharedOutputBudget: true };
};

const normalize = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');

/**
 * Resolve a (possibly untrusted) preset name to its params. Unknown or empty
 * falls back to the default — the allow-list IS the validation. Pure.
 * @param {string} [name]
 * @returns {{label: string, temperature: number, topP: number, maxTokens: number, blurb: string}}
 */
export const resolvePreset = (name) =>
  INFERENCE_PRESETS[normalize(name)] || INFERENCE_PRESETS[DEFAULT_PRESET];

/** True only for a known preset name (routes 400 on anything else). Pure. */
export const isPresetName = (name) =>
  Object.prototype.hasOwnProperty.call(INFERENCE_PRESETS, normalize(name));

/** What the UI renders — name + label + plain-language tradeoff, no raw numbers. Pure. */
export const PRESET_LIST = Object.freeze(
  Object.entries(INFERENCE_PRESETS).map(([name, p]) =>
    Object.freeze({ name, label: p.label, blurb: p.blurb })),
);
