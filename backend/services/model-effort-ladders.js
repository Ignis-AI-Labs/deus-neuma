// model-effort-ladders.js — the vendor effort tables, labels, budgets, and
// ladder builders, extracted VERBATIM from model-effort.js (size-law
// breakdown, 2026-08-26). The measured-evidence doctrine header below moved
// WITH the tables it justifies. model-effort.js composes these into route
// capabilities; this module never imports model-effort.

/**
 * Effort — how hard a model is asked to think before it speaks (pure).
 *
 * TWO CONTROLS, AND ONLY WHERE THEY ARE REAL — the shape both vendors' own
 * surfaces have: a LADDER you pick one rung of, and a THINKING switch beside it.
 *
 * Design note, 2026-07-30, on the gears:
 *   […] — so ULTRA and PRO are RUNGS
 *    in the list, never chips. ChatGPT's own `Advanced ▸ Effort` menu is one
 *    exclusive list (Light · Medium · High · Extra High · Max · Ultra) and that
 *    is what a rung ladder looks like.
 *
 * Founder, same night, on thinking:
 *   […]
 *
 * Not guessed. MEASURED, 2026-07-30, by sending the same question twice on each
 * lane and reading `reasoning_tokens` back off the wire:
 *
 *   openai-chatgpt/gpt-5.6-sol   high → 31 reasoning tokens · none → 0
 *   zai-coding-plan/glm-5.2      high → 261                 · none → 0
 *
 * Zero reasoning tokens IS thinking off, from the vendor's own accounting. So
 * the switch is offered on those lanes because it was proven there, and nowhere
 * else on a guess. Z.AI shows exactly this shape themselves: a rung menu (High ·
 * Max) with a **Deep Think** toggle under it.
 *
 * Why not one list with an off-rung at the bottom: an off state is not a
 * quantity of effort, and stacking it under the rungs made "how hard" and
 * "whether at all" the same question. They are two questions, and the vendors
 * ask them separately.
 *
 * Sampling presets (llm-presets.js) say how WIDE the sampling is; effort says
 * how MUCH REASONING is paid for. Different knobs, different wires, and only
 * effort is model-dependent: every family expresses it differently, and plenty
 * of models have no such knob at all.
 *
 * The house rung ids are the operator's one comparable axis across beings —
 *
 *   low < medium < high < ultra < pro
 *
 * — and each family maps that ladder onto its own wire, under its own labels:
 *
 *   reasoning-effort  → `reasoning_effort: 'none'|'low'|…|'xhigh'|'max'`
 *                       (OpenAI chat/completions reasoning models, Z.AI's GLM;
 *                       xAI's mini reasoning models accept only low|high)
 *   responses-effort  → `reasoning: { effort }` (OpenAI Responses dialect —
 *                       the ChatGPT subscription lane)
 *   thinking-budget   → `thinking: { type: 'enabled', budget_tokens: N }`
 *                       (Anthropic Messages; thinking off sends NO block)
 *   kimi-effort       → one thinking block carries both controls (Kimi's
 *                       coding lane, the official client's own shape):
 *                       `{ type: 'enabled', effort }` the rung,
 *                       `{ type: 'disabled' }` the switch
 *   think-budget      → no wire field at all: the tokens a LOCAL thinking
 *                       substrate is given to reason in before speech, added to
 *                       the request's max tokens (the knob llm-provider's
 *                       THINK_TOKEN_BUDGET has always been).
 *
 * The OpenAI numbers here are not from documentation — they were probed live on
 * this machine's own connection. RE-PROBED 2026-07-29, and the answer had
 * MOVED since 2026-07-26: do not trust this block without re-running the proof.
 *
 * The 400 a bad rung earns names the FIELD SCHEMA, not the model's real set —
 * every model now answers with the same seven values. So the schema was not
 * believed; each rung was SENT, and `usage.output_tokens_details.reasoning_tokens`
 * was read back. A rung is listed here only if it was accepted AND visibly
 * changed the reasoning spent (gpt-5.6-sol, one problem, same prompt):
 *
 *   none 0 · low 55 · medium 55 · high 68 · xhigh 83 · max 84
 *
 * 'minimal' sits in the schema enum but every model rejects it per-model
 * ([…]), so it is not offered.
 *
 * The codex line is NARROWER and rejects three of them — 'none', 'max', and
 * 'minimal' all come back 400, while 'xhigh' is honored (511 reasoning tokens).
 * Codex therefore always reasons, and its ladder stops one rung short.
 *
 * FAIL-CLOSED, ALWAYS: a family this module has not grounded reports channel
 * 'none' — no ladder, nothing on the wire. Inventing a rung for an unknown model
 * would make the desk claim a capability the vendor may not have, and the
 * operator would read the lie as truth. Absence is stated, never faked.
 */

/**
 * Every rung this house can name, weakest first. A route offers a SUBSET of
 * these, in this order; the operator sits on exactly one. Whether the model
 * reasons AT ALL is a separate control (`thinking`), because it is a separate
 * question.
 *   ultra — the gear above HIGH · pro — the gear above THAT
 */
export const EFFORT_LADDER = Object.freeze(['low', 'medium', 'high', 'ultra', 'pro']);

/** The three rungs every grounded ladder shares — the comparable middle. */
export const BASE_RUNGS = Object.freeze(['low', 'medium', 'high']);

/** The rung a being sits on until the operator moves it. */
export const DEFAULT_EFFORT = 'medium';

/** Nothing to ask for, nothing to show — the honest empty capability. */
export const NO_EFFORT = Object.freeze({
  channel: 'none', tiers: Object.freeze([]), labels: Object.freeze({}),
  thinking: false, thinkingLabel: 'THINKING',
});

// THE VENDOR'S OWN WORDS. Design note, 2026-07-29, with Kimi's picker beside ours:
// […]
//
// The house rung IDS stay shared (they are the one axis that compares beings),
// but every LABEL the operator reads is the vendor's where the vendor has one.
// Absent a vendor word the rung keeps the house word, which is honest: no vendor
// is being quoted. Only a label the vendor actually uses may appear here —
// inventing a vendor-sounding word would be the same lie in a better font.
export const HOUSE_LABELS = Object.freeze({
  low: 'LOW', medium: 'MEDIUM', high: 'HIGH', ultra: 'ULTRA', pro: 'PRO',
});

// ChatGPT's own picker, read off the product 2026-07-30 (Advanced ▸ Effort):
//   Light · Medium · High · Extra High · Max · Ultra
// Four of those map by name to wire values this house has PROVEN on the lane
// (medium, high, xhigh, max). "Light" is the picker's weakest rung and 'low' is
// the wire's weakest accepted one — 'minimal' is refused per-model — so Light IS
// low, by elimination rather than by guess.
//
// Their "Ultra" (marked […]) is NOT a value on the
// wire we channel. SENT live 2026-07-30 through the real request path, and the
// lane refused it in its own words:
//   Invalid value: 'ultra'. Supported values are: 'none', 'minimal', 'low',
//   'medium', 'high', 'xhigh', and 'max'.        (param: reasoning.effort)
// So Ultra belongs to some other mechanism of that product, and 'max' — their
// "Max" — is the top rung this channel can actually reach. Not offered, and now
// for a proven reason rather than an absent one.
export const CHATGPT_LABELS = Object.freeze({
  ...HOUSE_LABELS, low: 'LIGHT', ultra: 'EXTRA HIGH', pro: 'MAX',
});

// The OpenAI API lane has no picker — the wire values ARE its vocabulary.
export const OPENAI_API_LABELS = Object.freeze({ ...HOUSE_LABELS, ultra: 'XHIGH', pro: 'MAX' });

// THE SWITCH'S NAME, in the vendor's own words where the vendor has one: Z.AI
// calls it Deep Think, Anthropic calls it extended thinking. Everyone else gets
// the house word, which quotes nobody.
export const THINKING_LABEL = Object.freeze({
  house: 'THINKING', glm: 'DEEP THINK', anthropic: 'EXTENDED THINKING',
});

// Z.AI's own picker shows High, Max, and a "Deep Think" toggle — the exact two
// controls this module models. The top gear is MAX; `xhigh` keeps the API's own
// name, since Z.AI's picker does not surface it. The endpoint honors THREE more
// reasoning rungs than the picker names (measured 2026-07-30: low 150 · medium
// 338 · high 261 · xhigh 355 · max 259 reasoning tokens on one question), so
// they are offered — nothing that works is hidden. Note the counts do NOT order:
// two sittings on two questions both came back non-monotonic, in different
// orders. Each rung is HONORED; this house does not claim they are ranked.
export const GLM_LABELS = Object.freeze({ ...HOUSE_LABELS, ultra: 'XHIGH', pro: 'MAX' });

// Local engines: the operator's own serving. Their "effort" is reasoning ROOM
// (tokens before speech), because llama.cpp/LM Studio/Ollama expose no vendor
// effort parameter — the budget IS the knob, and it is real.
export const LOCAL_ENGINES = Object.freeze(['llama-server', 'lm-studio', 'ollama']);

// Token budgets for reasoning room. The low rung matches the constant this
// path has always used (llm-provider THINK_TOKEN_BUDGET = 1800) so the weakest
// rung is a known-good turn; the rungs above buy room a 65K-context substrate
// can afford.
export const THINK_BUDGETS = Object.freeze({ low: 1800, medium: 6144, high: 16384 });

// Anthropic extended thinking: budget_tokens must be >= 1024 and strictly less
// than max_tokens (the caller adds the budget on top of its speech budget, so
// every rung here clears that). ULTRA is a real rung on this wire — the ceiling
// is high enough that a bigger budget still changes the answer.
export const ANTHROPIC_BUDGETS = Object.freeze({ low: 2048, medium: 8192, high: 24576, ultra: 32768 });

// OpenAI reasoning families. The chat/completions and Responses wires take the
// same rung NAMES; only the field differs. 'xhigh' is the ULTRA rung, proven on
// the gpt-5.1-and-later line; gpt-5.0 and the o-series predate it and stop at
// HIGH.
export const OPENAI_REASONING_RE = /^(?:gpt-5|o1|o3|o4)/i;
const OPENAI_ULTRA_RE = /^gpt-5\.(?:[1-9]\d*)/i;
// The codex line has no 'none' value — it always reasons (re-probed 2026-07-29:
// gpt-5.3-codex-spark still answers 400 to 'none').
export const OPENAI_ALWAYS_THINKS_RE = /codex/i;
// PRO ('max') is NARROWER than ULTRA: proven on the 5.4/5.5/5.6 lines, refused
// by codex. Fail-closed on the rest — 5.1–5.3 are not on this account's route
// and were never probed, so they are not offered a rung nobody has confirmed.
const OPENAI_PRO_RE = /^gpt-5\.(?:[4-9]|\d{2,})/i;

/**
 * What each house rung is called on the OpenAI-shaped wires (OpenAI chat,
 * OpenAI Responses, Z.AI's GLM — all three take the same seven values).
 */
export const OPENAI_WIRE = Object.freeze({
  low: 'low', medium: 'medium', high: 'high', ultra: 'xhigh', pro: 'max',
});

/**
 * Thinking OFF on those same wires. It is a VALUE of the effort field rather
 * than a field of its own — proven 2026-07-30 by reading `reasoning_tokens: 0`
 * back from both the ChatGPT lane and Z.AI's GLM.
 */
export const OPENAI_NO_THINK = 'none';

// Z.ai's GLM line takes the SAME reasoning_effort field as OpenAI's chat wire,
// and names the SAME seven values — probed live 2026-07-29 on
// zai-coding-plan/glm-5.2, which answers a bad rung with
//   […]
// and, unlike OpenAI, ACCEPTS every one of them. Measured by reasoning_tokens
// on one hard problem: none 0 · minimal 0 · low 667 · medium 570 · high 1415 ·
// xhigh 931 · max 1241. So 'none' is a real OFF state here and BOTH gears
// above HIGH are real. The five reasoning rungs did NOT come back monotonic on
// one sample each, so this house claims only that each is honored — not that
// they are ordered.
//
// 'minimal' is not offered: it buys the same zero reasoning as 'none', and one
// thinking-off state is the truth the switch already carries.
//
// GLM also accepts `thinking: {type: enabled|disabled}`, but that field is
// UNVALIDATED — {type:'not-a-mode'} still reasons, silently. reasoning_effort
// answers a bad value with a 400, so the validated field is the one used.
//
// Keyed on the MODEL family, not the provider id: the same GLM weights are sold
// through the coding plan and the general API, and the general endpoint could
// not be probed on this machine (429, no balance) — a billing refusal says
// nothing about capability, so it must not be read as absence.
export const GLM_RE = /^glm-/i;
export const ZAI_PROVIDERS = Object.freeze(['z-ai', 'zai-coding-plan']);

// xAI, PER MODEL — probed value by value on this account 2026-07-30, because
// this lane refuses what it does not support and therefore names its own set:
//
//   grok-4.5   minimal·low·medium·high·xhigh accepted;
//              'none' → 400 […]
//              'max'  → 400 "Invalid reasoning effort."          → NO switch
//   grok-4.3   the same five, AND 'none' → 200 with reasoning_tokens 0
//                                                                → REAL switch
//   grok-4.20-0309-reasoning / -non-reasoning / grok-build-0.1
//              → 400 […] → NOTHING
//   grok-4.20-multi-agent-0309
//              → 400 […]
//   grok-3-mini family  low|high (grounded earlier; not on this account today)
//
// Grok's own picker (SuperGrok: Auto · Fast · Expert · Heavy · Build) is a MODEL
// menu, not an effort ladder — Heavy is the multi-agent model, Build is
// grok-build-0.1 — so it is the MODEL dropdown that mirrors it, and the effort
// control keeps the house rungs the API actually validates.
//
// 'minimal' is not offered: it is a rung below this house's floor and spent the
// same reasoning as 'low' (221 vs 216 tokens on one question).
//
// The reasoning-token spread across the accepted values did NOT order on one
// sample each (low 216 · medium 239 · high 232 · xhigh 229). What is claimed
// here is exactly what was proven: this model ACCEPTS these values and refuses
// every other. Ordering is not claimed.
export const XAI_MINI_RE = /^grok-.*mini/i;
export const XAI_LADDERS = Object.freeze(Object.assign(Object.create(null), {
  'grok-4.5': Object.freeze({ rungs: ['low', 'medium', 'high', 'ultra'], thinking: false }),
  'grok-4.3': Object.freeze({ rungs: ['low', 'medium', 'high', 'ultra'], thinking: true }),
}));

// Kimi's coding lane, from the vendor's own contract (kimi.com/code/docs,
// re-read 2026-09-23): k3, k3-256k and kimi-for-coding (K2.8) take THREE
// effort rungs — low | high | max — plus a thinking off state, both riding
// ONE thinking block in the official client's own shape on this door:
//   thinking: { type: 'enabled', effort: 'low'|'high'|'max' }
//   thinking: { type: 'disabled' }   (served by K2.8 with thinking off —
//                                     the vendor's routing, stated same page)
// Confirmed live on this machine's key (scripts/kimi-effort-probe.mjs,
// 2026-09-23): every rung accepted beside the turn's real temperature, and
// 'disabled' buys ZERO thinking tokens (12/12 across two sittings). What no
// probe showed is SEPARATION — thinking-token bands overlap across rungs on
// every question tried — so, as with GLM and xAI above, the claim is exactly
// the vendor's: these three rungs are the lane's documented control. They
// are not claimed to be ranked. The door validates NO value (a bogus effort
// comes back 200), so this map is the only guard against a rung the vendor
// never named.
//
// The house rungs carrying them: low, medium, pro — labeled in the vendor's
// words. House medium maps to the vendor's 'high' (the vendor's recommended
// middle and k3's default), so a being left on the default rung asks for
// exactly the vendor default.
//
// kimi-for-coding-highspeed (K2.7) has NO rungs ("Thinking:ON", same table)
// and K2.7 is documented to 400 on thinking.disabled — the switch was never
// proven there, so that model reports NO_EFFORT: nothing unmeasured rides
// its wire.
export const KIMI_PROVIDERS = Object.freeze(['kimi-for-coding']);
export const KIMI_NO_LADDER_RE = /highspeed/i;
export const KIMI_RUNGS = Object.freeze(['low', 'medium', 'pro']);
export const KIMI_WIRE = Object.freeze({ low: 'low', medium: 'high', pro: 'max' });
export const KIMI_LABELS = Object.freeze({ ...HOUSE_LABELS, medium: 'HIGH', pro: 'MAX' });

/** The model id without an org/ prefix or a ':tag' — 'openai/gpt-5:latest' → 'gpt-5'. */
export const bareModel = (model) => String(model ?? '').split('/').pop().split(':')[0];

const LOOPBACK_RE = /^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])(:|\/|$)/i;

/** A 'custom' provider pointed at this machine IS a local engine on the wire. Pure. */
export const isLoopbackCustom = (provider, endpoint) =>
  provider === 'custom' && LOOPBACK_RE.test(endpoint ?? '');

/**
 * One route's controls, frozen: the ladder in EFFORT_LADDER order whatever order
 * it was built in, and whether a THINKING switch stands beside it. Pure.
 * @param {string} channel the wire dialect this route speaks
 * @param {Array<string>} rungs the rungs it offers
 * @param {Object} labels the vendor's word per rung
 * @param {{thinking?: boolean, thinkingLabel?: string}} [seg] the switch, where real
 */
export const ladder = (channel, rungs, labels, { thinking = false, thinkingLabel = THINKING_LABEL.house } = {}) =>
  Object.freeze({
    channel,
    tiers: Object.freeze(EFFORT_LADDER.filter((rung) => rungs.includes(rung))),
    labels,
    thinking,
    thinkingLabel,
  });

/**
 * The rungs the OpenAI-shaped wires offer for one model — each gear above HIGH
 * only where that exact model honored it live. Pure.
 * @param {string} model bare model id
 * @returns {Array<string>}
 */
export const openaiRungs = (model) => [
  ...BASE_RUNGS,
  ...(OPENAI_ULTRA_RE.test(model) ? ['ultra'] : []),
  ...(OPENAI_PRO_RE.test(model) && !OPENAI_ALWAYS_THINKS_RE.test(model) ? ['pro'] : []),
];
