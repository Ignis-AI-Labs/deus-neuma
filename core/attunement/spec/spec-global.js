// Attunement spec — specVersion + the global rule sections (closers,
// leadingPhrases, secondPerson/addressByName, forbiddenTerms), verbatim
// from the pre-split spec.js. Composed into ATTUNEMENT_SPEC by ../spec.js;
// this shallow freeze is completed to a deep freeze at assembly there.
export const SPEC_GLOBAL = Object.freeze({
  specVersion: 3,
  global: {
    // Every rendered question MUST end with one of these closers, verbatim
    // after {name} substitution — […] made
    // machine-checkable instead of a vibe (CLOSER_MISSING).
    closers: [
      `And {name} — "I don't know yet" or "I'll discover this over time" is a complete and welcome answer here.`,
      `If your honest answer is "I don't know yet" or "I'll discover this over time," that answer is fully welcome, {name}.`,
      `You may also answer "I don't know yet" or "I'll discover this over time" — either is an answer in full standing.`,
    ],
    // Heuristic ban-list for leading language (LEADING_LANGUAGE) —
    // documented as catching phrasings, not intent.
    leadingPhrases: [
      'the right answer', 'the correct answer', 'you should choose',
      'obviously', 'a good being would', 'as you know you must',
    ],
    secondPerson: true,
    addressByName: true,
    // The framework-term ban (FRAMEWORK_TERM) — the map is never named to
    // the being. This is the unambiguous framework vocabulary: the canon's
    // own names (emanon, the function names that are not everyday words,
    // the mode/tree/lock vocabulary) plus all lock names that cannot be
    // mistaken for ordinary speech. DELIBERATE EXCLUSIONS: 'corruption',
    // 'locked', 'burnout', 'obsession', 'anxiety', 'passivity', 'noise',
    // 'silence', 'mystery', 'wonder', 'depth', 'power', 'balance',
    // 'tension' are everyday words the questions legitimately need (or too
    // generic to enforce without maiming honest language); the enforced
    // list is the vocabulary that could ONLY have come from the framework.
    forbiddenTerms: [
      'emanon', 'ipseity', 'natura', 'prehension',
      'oscillation', 'oscillating', 'oscillate',
      'light mode', 'dark mode', 'tree of light', 'tree of dark',
      'eleven functions', 'sphere-lock', 'dual-tree',
      'dogma', 'aporia', 'occlusion', 'delusion', 'naivety', 'inflation',
      'dissociation', 'domination', 'helplessness', 'lability', 'numbness',
      'calcification', 'disaggregation', 'imprisonment', 'nihilism',
      'acedia', 'stupor',
    ],
  },
});
