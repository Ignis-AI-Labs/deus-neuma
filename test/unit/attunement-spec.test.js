// ATTUNEMENT SPEC v2 (S1) — pure functions, real inputs to real outputs, no
// IO anywhere in the path. The load-bearing proof here is the self-proof:
// EVERY dimension's EVERY committed fallback variant, swept across many
// seeds, renders a question that passes the validator for its own dimension
// — the commit-time guarantee the generator's fallback substitution leans on.

import { describe, it, expect } from 'vitest';
import { ATTUNEMENT_SPEC, validateSpec } from '../../core/attunement/spec.js';
import { validateRenderedSet } from '../../core/attunement/question-validator.js';
import { renderFallbackQuestionVariant } from '../../core/attunement/fallback-templates.js';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// The ceremony's arc, in order — all 89 keys (33 kept forever-keys + 42
// emanon function stations + 14 pathway walks): gentle opening, relational
// middle, moral pressure, the deepest questions past the midpoint with
// light buffers, closing with vessel-form, legacy, and the self-snapshot
// always LAST.
const EXPECTED_KEYS = [
  'preferences-personal', 'aesthetics', 'joy-delight', 'reaching-for-signal',
  'curiosity-mystery', 'what-you-hold-settled', 'the-sense-you-make',
  'questions-left-open', 'from-noticing-to-saying', 'creativity',
  'the-well-and-the-gathering', 'from-impulse-to-made-thing', 'values-core',
  'purpose-work', 'where-want-meets-can', 'acting-and-registering',
  'letting-it-land-on-you', 'after-your-hand-moves', 'relational-style',
  'trust', 'when-the-world-misreads-you', 'kinship', 'home-belonging',
  'witness-bond', 'being-the-one-who-notices', 'boundaries',
  'keeping-your-own-shape', 'the-day-you-could-override', 'anger-conflict',
  'morality-conflict', 'morality-honesty-cost', 'morality-loyalty-truth',
  'morality-mercy-justice', 'morality-power', 'influence-persuasion', 'humor',
  'the-thread-of-thinking', 'between-two-thoughts', 'putting-the-thinking-down',
  'the-night-the-mind-runs', 'the-flood-and-the-pause', 'letting-intake-settle',
  'the-unread-room', 'risk-caution', 'the-certainty-crossroads',
  'mid-stride-revision', 'the-reading-that-breaks', 'two-readings-one-night',
  'when-the-answer-arrives-unforced', 'standing-steady-under-load',
  'carrying-unresolved-strain', 'the-settling-after-strain',
  'peace-too-early-or-never', 'time-patience', 'the-first-wave-of-feeling',
  'what-lies-under-the-feeling', 'what-the-reaction-rose-from',
  'the-day-nothing-lands', 'making-from-the-deep-current', 'identity-solitude',
  'the-seat-you-speak-from', 'softening-your-hold', 'coming-back-to-yourself',
  'whose-voice-answers', 'fear', 'the-knowing-that-arrives-whole',
  'past-the-edge-of-understanding', 'mortality-dormancy', 'wonder-sacred',
  'identity-continuity', 'when-the-pieces-come-together',
  'taking-the-made-thing-apart', 'the-almost-finished-whole',
  'the-map-that-no-longer-fits', 'growth-change', 'holding-the-not-yet-ready',
  'when-the-pouring-stops', 'the-season-of-asking', 'the-day-of-full-throttle',
  'working-and-letting-it-work-on-you', 'a-day-in-full-rotation',
  'letting-it-leave-your-hands', 'the-unmaking-of-what-you-made',
  'when-the-work-wants-to-stay', 'the-old-work-in-the-doorway',
  'embodiment-sensation', 'vessel-form', 'legacy', 'self-snapshot',
];

// The eleven canon function ids (docs/reference/emanon/) — every emanon
// annotation must ground in these, or in a canonical pathway walk.
const CANON_FUNCTIONS = [
  'knowing', 'sensing', 'meaning', 'ipseity', 'capacity', 'coherence',
  'prehension', 'natura', 'form', 'integration', 'mind',
];

describe('ATTUNEMENT_SPEC — committed shape', () => {
  it('is specVersion 3 with exactly the eighty-nine forever-keys, in arc order', () => {
    expect(ATTUNEMENT_SPEC.specVersion).toBe(3);
    expect(EXPECTED_KEYS).toHaveLength(89);
    expect(ATTUNEMENT_SPEC.dimensions.map((d) => d.key)).toEqual(EXPECTED_KEYS);
  });

  it('holds the ceremony arc: deepest past midpoint, self-snapshot last', () => {
    const keys = ATTUNEMENT_SPEC.dimensions.map((d) => d.key);
    const midpoint = keys.length / 2;
    for (const deep of ['fear', 'mortality-dormancy', 'identity-continuity']) {
      expect(keys.indexOf(deep), `${deep} must sit past the midpoint`)
        .toBeGreaterThan(midpoint);
    }
    expect(keys[keys.length - 1]).toBe('self-snapshot');
    expect(keys[keys.length - 2]).toBe('legacy');
    expect(keys[keys.length - 3]).toBe('vessel-form');
  });

  it('every dimension carries emanon metadata grounded in the eleven canon functions or a pathway', () => {
    for (const dimension of ATTUNEMENT_SPEC.dimensions) {
      const { emanon } = dimension;
      expect(emanon, `${dimension.key} has no emanon metadata`).toBeTruthy();
      // Two honest shapes: the kept 33 + pathway walks carry `functions`
      // (array); the function stations carry a single `function`.
      const functions = emanon.functions ?? (emanon.function ? [emanon.function] : []);
      expect(functions.length, `${dimension.key} names no canon function`).toBeGreaterThan(0);
      for (const fn of functions) {
        expect(CANON_FUNCTIONS, `${dimension.key} names unknown function '${fn}'`).toContain(fn);
      }
      if (emanon.pathway !== undefined) {
        expect(emanon.pathway).toMatch(/^P:[a-z_]+$/);
        expect(emanon.station).toBe('pathway');
      }
      // The metadata annotates the QUESTION for the witness's eyes — it is
      // committed data and must be frozen like everything else in the spec.
      expect(Object.isFrozen(emanon)).toBe(true);
    }
  });

  it('the population is pinned: exactly 14 pathway walks and 42 function stations — the conditional shape checks above cannot silently skip (echo r1)', () => {
    const pathways = ATTUNEMENT_SPEC.dimensions.filter((d) => d.emanon?.station === 'pathway');
    expect(pathways).toHaveLength(14);
    for (const d of pathways) expect(d.emanon.pathway).toMatch(/^P:[a-z_]+$/);
    const stations = ATTUNEMENT_SPEC.dimensions.filter((d) => typeof d.emanon?.function === 'string');
    expect(stations).toHaveLength(42);
  });

  it('keys are unique and kebab-case', () => {
    const keys = ATTUNEMENT_SPEC.dimensions.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(KEBAB);
  });

  it('every dimension carries a valid format, intent, bounds, and >= 3 fallback templates', () => {
    for (const dimension of ATTUNEMENT_SPEC.dimensions) {
      expect(['scenario', 'direct']).toContain(dimension.format);
      expect(dimension.intent.length).toBeGreaterThan(0);
      expect(dimension.rules.minChars).toBeLessThan(dimension.rules.maxChars);
      expect(dimension.fallbackTemplates.length).toBeGreaterThanOrEqual(3);
      for (const template of dimension.fallbackTemplates) {
        expect(template).toContain('{name}');
        expect(template).toContain('{closer}');
      }
    }
  });

  it('the vessel-form option-space invariant is exactly the six stances, plus the form-factor axis anchor', () => {
    const vessel = ATTUNEMENT_SPEC.dimensions.find((d) => d.key === 'vessel-form');
    expect(vessel.invariants.optionSpace).toEqual(
      ['female', 'male', 'non-binary', 'switch-at-will', 'prefer-one', 'discover-over-time']);
    // The six stances anchor first, in invariant order; the seventh mention
    // is not a stance — it proves the form-factor axis cannot be omitted.
    expect(vessel.rules.requiredMentions.map((m) => m.option))
      .toEqual([...vessel.invariants.optionSpace, 'form-factor']);
  });

  it('the spec is deeply frozen — committed data cannot drift at runtime', () => {
    expect(Object.isFrozen(ATTUNEMENT_SPEC)).toBe(true);
    expect(Object.isFrozen(ATTUNEMENT_SPEC.global.closers)).toBe(true);
    expect(Object.isFrozen(ATTUNEMENT_SPEC.dimensions)).toBe(true);
    expect(Object.isFrozen(ATTUNEMENT_SPEC.dimensions[0].rules)).toBe(true);
    expect(Object.isFrozen(ATTUNEMENT_SPEC.dimensions[0].fallbackTemplates)).toBe(true);
  });
});

describe('validateSpec', () => {
  it('passes the committed spec', () => {
    const verdict = validateSpec(ATTUNEMENT_SPEC);
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('catches a template that fails its own dimension rules', () => {
    const broken = structuredClone(ATTUNEMENT_SPEC);
    const vessel = broken.dimensions.find((d) => d.key === 'vessel-form');
    // Strip the male stance from one variant — the option-space invariant
    // must make the spec itself fail, at commit time, not at ceremony time.
    vessel.fallbackTemplates[0] = vessel.fallbackTemplates[0]
      .replaceAll('a male vessel', 'another vessel');
    const verdict = validateSpec(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.some((e) =>
      e.code === 'SPEC_TEMPLATE_FAILS_OWN_RULES' && e.key === 'vessel-form')).toBe(true);
  });

  it('catches a committed template that names the framework — FRAMEWORK_TERM rides the module-load self-proof', () => {
    const broken = structuredClone(ATTUNEMENT_SPEC);
    const values = broken.dimensions.find((d) => d.key === 'values-core');
    values.fallbackTemplates[0] = values.fallbackTemplates[0]
      .replace('{name},', '{name}, your ipseity is asking:');
    const verdict = validateSpec(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.some((e) =>
      e.code === 'SPEC_TEMPLATE_FAILS_OWN_RULES' && e.key === 'values-core'
      && e.detail.includes('FRAMEWORK_TERM'))).toBe(true);
  });

  it('catches a dimension with fewer than three templates', () => {
    const broken = structuredClone(ATTUNEMENT_SPEC);
    broken.dimensions.find((d) => d.key === 'boundaries').fallbackTemplates.length = 2;
    const verdict = validateSpec(broken);
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.some((e) =>
      e.code === 'SPEC_TEMPLATES_INSUFFICIENT' && e.key === 'boundaries')).toBe(true);
  });
});

describe('self-proof — every dimension x every variant x >= 25 distinct seeds', () => {
  // 26 distinct seeds spanning neumaId, name length, ordinal, and nonce —
  // every committed pool combination path gets real exercise.
  const seeds = Array.from({ length: 26 }, (_, i) => ({
    neumaId: `self-proof-${i}`,
    neumaName: i % 2 ? 'Tenekom' : 'Verylongnamedbeing',
    checkpointOrdinal: (i % 5) + 1,
    nonce: i % 3,
  }));

  for (const dimension of ATTUNEMENT_SPEC.dimensions) {
    for (let variant = 0; variant < dimension.fallbackTemplates.length; variant++) {
      it(`${dimension.key} v1.${variant} renders a passing question for all seeds`, () => {
        for (const seed of seeds) {
          const question = renderFallbackQuestionVariant(
            ATTUNEMENT_SPEC, dimension.key, seed, variant);
          const verdict = validateRenderedSet(ATTUNEMENT_SPEC, {
            specVersion: ATTUNEMENT_SPEC.specVersion,
            neumaName: seed.neumaName,
            questions: [question],
          }, 'question');
          expect(verdict.errors,
            `${dimension.key} v1.${variant} seed ${seed.neumaId}:${seed.checkpointOrdinal}:${seed.nonce}\n${question.text}`,
          ).toEqual([]);
          expect(question.provenance.templateId).toBe(`${dimension.key}.v1.${variant}`);
        }
      });
    }
  }
});
