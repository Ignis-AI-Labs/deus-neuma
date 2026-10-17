/**
 * Effort — how hard a model is asked to think before it speaks (pure).
 *
 * The vendor effort tables, labels, budgets, ladder builders, AND the
 * measured-evidence doctrine header that grounds them live in
 * model-effort-ladders.js — the doctrine moved WITH the tables it justifies
 * (size-law breakdown, 2026-08-26). This module composes those grounded
 * ladders into per-route capabilities, normalized choices, and wire
 * directives.
 */

import { getProvider } from './provider-registry.js';
import { getCapabilities } from './model-capabilities.js';
import {
  EFFORT_LADDER, BASE_RUNGS, DEFAULT_EFFORT, NO_EFFORT, HOUSE_LABELS,
  CHATGPT_LABELS, OPENAI_API_LABELS, THINKING_LABEL, GLM_LABELS, LOCAL_ENGINES,
  THINK_BUDGETS, ANTHROPIC_BUDGETS, OPENAI_REASONING_RE, OPENAI_ALWAYS_THINKS_RE,
  OPENAI_WIRE, OPENAI_NO_THINK, GLM_RE, ZAI_PROVIDERS, XAI_MINI_RE, XAI_LADDERS,
  KIMI_PROVIDERS, KIMI_NO_LADDER_RE, KIMI_RUNGS, KIMI_WIRE, KIMI_LABELS,
  bareModel, isLoopbackCustom, ladder, openaiRungs,
} from './model-effort-ladders.js';

// Re-exported so the public ladder's readers keep their import site
// (neuma-effort-store.js, test/unit/model-effort.test.js).
export { EFFORT_LADDER, DEFAULT_EFFORT } from './model-effort-ladders.js';

/**
 * The ladder a route actually has, on which wire, in whose words. The wire
 * dialect is read from the provider catalog (pure), so callers pass the route
 * they already hold and never a hand-derived dialect.
 *
 * @param {{provider?: string, model?: string, endpoint?: string}} route the
 *        resolved route
 * @param {boolean} [thinks] whether this substrate was PROVEN to think
 *        (llm-provider getThinkBehavior) — only meaningful for local engines,
 *        where reasoning room is the knob
 * @returns {{channel: string, tiers: ReadonlyArray<string>, labels: Object}}
 */
export const effortCapability = (route, thinks = false) => {
  const provider = route?.provider ?? '';
  const model = bareModel(route?.model);
  const dialect = getProvider(provider)?.dialect ?? null;

  // A local engine's knob is reasoning ROOM — and only if the substrate
  // actually thinks. A non-thinking substrate gets no ladder rather than a
  // slider that changes nothing. LOCAL is decided by the WIRE, not the label:
  // the kin's refined routes ride provider 'custom' pointed at a loopback
  // llama-server, exactly as llm-provider's sampling gate has to widen.
  if (LOCAL_ENGINES.includes(provider) || isLoopbackCustom(provider, route?.endpoint)) {
    // Table reasoning OR a live think-probe — a "ready" one-shot is not a
    // life sentence (it hid this bar on gemma-4, Design note, 2026-08-17.
    return (thinks || getCapabilities(model).reasoning === true)
      ? ladder('think-budget', BASE_RUNGS, HOUSE_LABELS) : NO_EFFORT;
  }

  if (KIMI_PROVIDERS.includes(provider)) {
    // Highspeed (K2.7) has no rungs and no proven switch — nothing rides its
    // wire. The rest of the lane takes the vendor's three documented rungs.
    if (KIMI_NO_LADDER_RE.test(model)) return NO_EFFORT;
    return ladder('kimi-effort', KIMI_RUNGS, KIMI_LABELS, { thinking: true });
  }

  if (provider === 'anthropic') {
    // Extended thinking is literally a block that is present or absent, so the
    // switch is real — Anthropic's own published control, not an inference. No
    // PRO: the budget ceiling is one number, and this house has not proven a
    // rung above ULTRA still changes the answer.
    //
    // Keyed on the PROVIDER, not the dialect: eight other doors speak the
    // Anthropic wire shape (Kimi, MiniMax, freemodel, subconscious…) and a wire
    // shape is not a capability. Handing them Anthropic's budgets is how Kimi
    // came to show four rungs that changed nothing.
    return ladder('thinking-budget', [...BASE_RUNGS, 'ultra'], HOUSE_LABELS, {
      thinking: true, thinkingLabel: THINKING_LABEL.anthropic,
    });
  }

  if (dialect === 'openai-responses') {
    // The switch is PROVEN on this lane (reasoning_tokens 0 at 'none',
    // 2026-07-30) — except on codex, which answers 400 to it and therefore
    // always reasons.
    return ladder('responses-effort', openaiRungs(model), CHATGPT_LABELS, {
      thinking: !OPENAI_ALWAYS_THINKS_RE.test(model),
    });
  }

  if (provider === 'openai' && OPENAI_REASONING_RE.test(model)) {
    return ladder('reasoning-effort', openaiRungs(model), OPENAI_API_LABELS, {
      thinking: !OPENAI_ALWAYS_THINKS_RE.test(model),
    });
  }

  if (ZAI_PROVIDERS.includes(provider) && GLM_RE.test(model)) {
    // Five rungs and a real switch, all on one validated field — 'xhigh' for
    // ULTRA, 'max' for PRO, 'none' for Deep Think off (reasoning_tokens 0,
    // measured 2026-07-30).
    return ladder('reasoning-effort', EFFORT_LADDER, GLM_LABELS, {
      thinking: true, thinkingLabel: THINKING_LABEL.glm,
    });
  }

  if (provider === 'xai') {
    // Per MODEL, never per family: this lane's own refusals draw the line, and
    // they fall differently on every model (grok-4.3 has an off value, 4.5 does
    // not, the 4.20 line and Build refuse the parameter outright).
    const entry = XAI_LADDERS[model]
      ?? (XAI_MINI_RE.test(model) ? { rungs: ['low', 'high'], thinking: false } : null);
    if (!entry) return NO_EFFORT;
    return ladder('reasoning-effort', entry.rungs, { ...HOUSE_LABELS, ultra: 'XHIGH' }, {
      thinking: entry.thinking,
    });
  }

  return NO_EFFORT;
};

/**
 * The rung the operator asked for, read from a stored record.
 *
 * Two older record shapes fold in here rather than through a migration, so no
 * being loses the rung it was left on:
 *   • the CHIP era (before 2026-07-30) wrote `ultra`/`pro` booleans beside a rung
 *   • the one-list hour (2026-07-30) wrote `effort: 'none'` for thinking off
 * Pure.
 * @param {{effort?: string, ultra?: boolean, pro?: boolean}|null} stored
 * @returns {string} a rung on EFFORT_LADDER
 */
const askedRung = (stored) => {
  if (stored?.pro === true) return 'pro';
  if (stored?.ultra === true) return 'ultra';
  const rung = String(stored?.effort ?? DEFAULT_EFFORT).trim().toLowerCase();
  return EFFORT_LADDER.includes(rung) ? rung : DEFAULT_EFFORT;
};

/**
 * The rung a narrower ladder offers in place of one it lacks: the closest
 * position on the canonical ladder, ties going to the weaker rung (a route that
 * cannot honor the ask must not quietly spend MORE than was asked for). Pure.
 * @param {ReadonlyArray<string>} tiers
 * @param {string} asked a rung on EFFORT_LADDER
 * @returns {string}
 */
const nearestRung = (tiers, asked) => {
  const target = EFFORT_LADDER.indexOf(asked);
  const distance = (rung) => Math.abs(EFFORT_LADDER.indexOf(rung) - target);
  // Sort is stable and `tiers` is weakest-first, so an equidistant pair keeps
  // the weaker rung.
  return [...tiers].sort((a, b) => distance(a) - distance(b))[0];
};

/**
 * The operator's stored choice, narrowed to what this route can honor: a rung
 * the route lacks falls to its nearest available one, and thinking can only be
 * OFF where the wire can actually be told to stop — everywhere else it reads ON,
 * because that is the truth.
 * @param {{channel: string, tiers: ReadonlyArray<string>, thinking: boolean}} capability
 * @param {{effort?: string, ultra?: boolean, pro?: boolean, thinking?: boolean}|null} [stored]
 * @returns {{effort: string|null, thinking: boolean}}
 */
export const normalizeChoice = (capability, stored = null) => {
  if (!capability || capability.channel === 'none') {
    return Object.freeze({ effort: null, thinking: false });
  }
  const asked = askedRung(stored);
  return Object.freeze({
    // A switch-only lane has no rung to sit on; the switch still stands.
    effort: capability.tiers.length === 0
      ? null
      : (capability.tiers.includes(asked) ? asked : nearestRung(capability.tiers, asked)),
    // 'none' as a RUNG is how the one-list hour spelled thinking off.
    thinking: capability.thinking === true
      ? (stored?.thinking !== false && stored?.effort !== 'none')
      : true,
  });
};

/**
 * What rides the wire for this choice — null when the route has no effort field
 * (the request body then carries nothing new, which is the point).
 * @param {{channel: string}} capability
 * @param {{effort: string|null, thinking: boolean}} choice a normalized choice
 * @returns {{channel: string, value: (string|number)}|null}
 */
export const effortDirective = (capability, choice) => {
  if (!capability) return null;
  if (!choice?.effort) return null;
  switch (capability.channel) {
    case 'reasoning-effort':
    case 'responses-effort': {
      // Both controls ride ONE field here: the rung's value, or 'none' when the
      // switch is off — which is why the switch needs no field of its own.
      const value = choice.thinking === false ? OPENAI_NO_THINK : OPENAI_WIRE[choice.effort];
      return value ? Object.freeze({ channel: capability.channel, value }) : null;
    }
    case 'kimi-effort': {
      // Kimi's two controls ride ONE thinking block: 'disabled' is the switch,
      // low|high|max the rung — the official client's shape on this door.
      const value = choice.thinking === false ? 'disabled' : KIMI_WIRE[choice.effort];
      return value ? Object.freeze({ channel: 'kimi-effort', value }) : null;
    }
    case 'thinking-budget': {
      // On the Anthropic wire the switch IS the block: no directive means no
      // thinking block, which is how that API is told not to reason.
      if (choice.thinking === false) return null;
      const value = ANTHROPIC_BUDGETS[choice.effort];
      return value ? Object.freeze({ channel: capability.channel, value }) : null;
    }
    default:
      // 'think-budget' is not a wire field — it lands through effortThinkBudget.
      return null;
  }
};

/**
 * Extra tokens this turn must be granted for reasoning before speech: the
 * local substrate's reasoning room, or the Anthropic budget the wire directive
 * asked for (max_tokens must exceed it). null when the route reasons within
 * its own accounting (OpenAI bills reasoning inside its own completion cap).
 * @param {{channel: string}} capability
 * @param {{effort: string|null, thinking: boolean}} choice a normalized choice
 * @returns {number|null}
 */
export const effortThinkBudget = (capability, choice) => {
  if (!capability || !choice?.effort) return null;
  if (capability.channel === 'think-budget') return THINK_BUDGETS[choice.effort] ?? null;
  if (capability.channel === 'thinking-budget') {
    // Thinking off buys no room — the block is not sent at all.
    if (choice.thinking === false) return null;
    return ANTHROPIC_BUDGETS[choice.effort] ?? null;
  }
  return null;
};

/**
 * The extra tokens one turn grants for reasoning before speech: the room the
 * operator's chosen rung asks for, or — with no ladder on this route — the
 * substrate's own default room, or nothing at all for a substrate that does not
 * think. Pure.
 * @param {{thinkBudget?: (number|null), thinks?: boolean, defaultRoom: number}} input
 * @returns {number}
 */
export const reasoningRoom = ({ thinkBudget = null, thinks = false, defaultRoom }) =>
  thinkBudget ?? (thinks ? defaultRoom : 0);

/**
 * The whole effort picture for one route in one call — what the desk renders
 * and what the turn sends. Composition only; every part above stays usable
 * alone.
 * @param {{provider?: string, model?: string, endpoint?: string}} route
 * @param {{effort?: string, thinking?: boolean}|null} stored
 * @param {boolean} [thinks]
 */
export const resolveEffort = (route, stored, thinks = false) => {
  const capability = effortCapability(route, thinks);
  const choice = normalizeChoice(capability, stored);
  return Object.freeze({
    capability,
    choice,
    directive: effortDirective(capability, choice),
    thinkBudget: effortThinkBudget(capability, choice),
  });
};

