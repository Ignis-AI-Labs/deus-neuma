// context-anatomy.js — one context:composition event shaped into what the
// CONTEXT MAP draws: how full the window is, what fills it, and what was cut.
//
// pure — counts only (the event carries no prompt text). Two totals are kept
// apart because they are different truths: the WINDOW is what the next turn
// inherits (standing input + output, usage.usedTokens); the ANATOMY is the
// last request as composed (the section total), which may be larger because
// in-turn tool machinery is not carried forward.

/** The families a prompt section belongs to — what that part of the window is FOR. */
export const FAMILIES = Object.freeze([
  { id: 'identity', label: 'IDENTITY' },
  { id: 'conversation', label: 'CONVERSATION' },
  { id: 'platform', label: 'PLATFORM' },
  { id: 'work', label: 'WORK' },
  { id: 'moment', label: 'MOMENT' },
  { id: 'tools', label: 'TOOL ROUNDS' },
  { id: 'other', label: 'OTHER' },
]);

const FAMILY_OF = Object.freeze({
  fallback: 'identity', identity: 'identity', birth: 'identity', genesis: 'identity', voice: 'identity',
  emanon: 'identity', personality: 'identity', silo: 'identity', soul: 'identity', amendments: 'identity', taste: 'identity',
  substrate: 'platform', grounding: 'platform', sectors: 'platform', tools: 'platform', intents: 'platform',
  skills: 'platform', benchmark: 'platform', closing: 'platform', protocol: 'platform', harnessFrame: 'platform',
  plan: 'work', tasks: 'work', assigned: 'work', operator: 'work', houseSeat: 'work',
  present: 'moment', memory: 'moment', vitals: 'moment', session: 'moment',
  recentConversation: 'conversation', currentTurn: 'conversation', harnessCarry: 'conversation', transcript: 'conversation',
});

/** pure — the family of a section id; tool rounds and folds are tool machinery. */
export const familyOf = (id) => FAMILY_OF[id] ?? (/^(toolRound|fold)\d+$/.test(id) ? 'tools' : 'other');

/**
 * pure — the window: the parts of the budget the next turn inherits, and the
 * free remainder. null parts when the budget is unknown — never a ceiling made up.
 */
export const windowOf = (composition) => {
  const usage = composition?.usage ?? {};
  const budget = Number.isFinite(composition?.budget?.contextTokens) ? composition.budget.contextTokens : null;
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : (composition?.totals?.tokens ?? 0);
  const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  const used = Number.isFinite(usage.usedTokens) ? usage.usedTokens : input + output;
  return Object.freeze({
    budget,
    budgetSource: composition?.budget?.source ?? 'unknown',
    input,
    output,
    used,
    source: usage.source ?? composition?.totals?.tokenSource ?? 'approx',
    free: budget === null ? null : Math.max(0, budget - used),
    ratio: budget ? Math.min(1, used / budget) : null,
    peak: Number.isFinite(usage.workingPeakTokens) ? usage.workingPeakTokens : null,
    cached: Number.isFinite(usage.cachedInputTokens) ? usage.cachedInputTokens : null,
  });
};

/**
 * pure — the last request by family, largest first, each with its sections
 * ranked; sections holding nothing are counted apart, never drawn.
 */
export const familiesOf = (composition) => {
  const sections = composition?.sections ?? [];
  const total = composition?.totals?.tokens ?? 0;
  return FAMILIES.map((f) => {
    const own = sections.filter((s) => familyOf(s.id) === f.id);
    const held = own.filter((s) => s.tokens > 0).sort((a, b) => b.tokens - a.tokens);
    const tokens = held.reduce((a, s) => a + s.tokens, 0);
    return Object.freeze({ ...f, tokens, share: total > 0 ? tokens / total : 0, sections: held, empty: own.length - held.length });
  }).filter((f) => f.sections.length > 0 || f.empty > 0).sort((a, b) => b.tokens - a.tokens);
};

/** pure — what the window could not hold or could not read this turn. */
export const cutsOf = (composition) => Object.freeze({
  shed: Array.isArray(composition?.shed) ? composition.shed : [],
  degraded: Array.isArray(composition?.degraded) ? composition.degraded : [],
});
