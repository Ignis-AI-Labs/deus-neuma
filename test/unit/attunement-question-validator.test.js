// ATTUNEMENT question validator (S1) — pure, real string fixtures in, frozen
// verdicts out. One hand-written accepted set proves the validator accepts
// questions it did not render; one deliberately malformed fixture PER error
// code proves each check fires exactly where it claims to — ATT-R9's
// […] clause, made exhaustive per code.

import { describe, it, expect } from 'vitest';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';
import { validateRenderedSet } from '../../core/attunement/question-validator.js';
import {
  NAME, C0, C1, C2, ACCEPTED,
} from '../fixtures/attunement-accepted-set.js';

// The ACCEPTED fixture set (33 hand-written + 56 emanon v1.0 renders), its
// seed, and the closers live in test/fixtures/attunement-accepted-set.js
// (size-law extraction). The assert helpers below stay with the assertions.

const fullSet = () => ({
  specVersion: 3,
  neumaName: NAME,
  questions: Object.entries(ACCEPTED).map(([key, text]) => ({ key, text })),
});

const oneQuestion = (key, text) =>
  ({ specVersion: 3, neumaName: NAME, questions: [{ key, text }] });

const expectSingleError = (verdict, code, key) => {
  expect(verdict.ok).toBe(false);
  expect(verdict.errors).toHaveLength(1);
  expect(verdict.errors[0].code).toBe(code);
  if (key !== undefined) expect(verdict.errors[0].key).toBe(key);
  return verdict.errors[0];
};

describe('validateRenderedSet — accepted fixture', () => {
  it('accepts a full eighty-nine-dimension set (33 hand-written + 56 v1.0 renders)', () => {
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC, fullSet(), 'set');
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('the fixture covers every spec dimension exactly once', () => {
    expect(Object.keys(ACCEPTED).sort())
      .toEqual(ATTUNEMENT_SPEC.dimensions.map((d) => d.key).sort());
  });

  it('never throws — verdicts are data even for garbage input', () => {
    expect(validateRenderedSet(ATTUNEMENT_SPEC, null, 'set').ok).toBe(false);
    expect(validateRenderedSet(ATTUNEMENT_SPEC, {}, 'question').ok).toBe(false);
  });
});

describe('validateRenderedSet — one malformed fixture per error code', () => {
  it('SPEC_VERSION_MISMATCH', () => {
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC, { ...fullSet(), specVersion: 1 }, 'set');
    expectSingleError(verdict, 'SPEC_VERSION_MISMATCH');
  });

  it('MISSING_DIMENSION', () => {
    const rendered = fullSet();
    rendered.questions = rendered.questions.filter((q) => q.key !== 'self-snapshot');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, rendered, 'set'),
      'MISSING_DIMENSION', 'self-snapshot');
    expect(error.detail).toContain('self-snapshot');
  });

  it('DUPLICATE_DIMENSION', () => {
    const rendered = fullSet();
    rendered.questions = [...rendered.questions,
      { key: 'values-core', text: ACCEPTED['values-core'] }];
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, rendered, 'set'),
      'DUPLICATE_DIMENSION', 'values-core');
  });

  it('UNKNOWN_DIMENSION', () => {
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC,
        oneQuestion('humor-register', ACCEPTED['values-core']), 'question'),
      'UNKNOWN_DIMENSION', 'humor-register');
  });

  it('NOT_A_STRING', () => {
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', 42), 'question'),
      'NOT_A_STRING', 'values-core');
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', '   '), 'question'),
      'NOT_A_STRING', 'values-core');
  });

  it('LENGTH_UNDER_MIN', () => {
    const short = `Tenekom, name a few things, would you? ${C1}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', short), 'question'),
      'LENGTH_UNDER_MIN', 'values-core');
  });

  it('LENGTH_EXCEEDED', () => {
    const long = `Tenekom, ${'plain honest words '.repeat(40)}name a few of the things you hold. ${C1}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', long), 'question'),
      'LENGTH_EXCEEDED', 'values-core');
  });

  it('CLOSER_MISSING', () => {
    const altered = ACCEPTED['values-core'].replace('fully welcome', 'quite welcome');
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', altered), 'question'),
      'CLOSER_MISSING', 'values-core');
  });

  it('SECOND_PERSON_MISSING', () => {
    // Closer 0 carries no second-person word — the body must supply it,
    // and this body deliberately does not.
    const text = 'Tenekom — a light one to finish. Small ordinary likings say a'
      + ' great deal about a being. What small delights, textures, or habits feel'
      + ` most like Tenekom, and which came as a surprise? ${C0}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('preferences-personal', text), 'question'),
      'SECOND_PERSON_MISSING', 'preferences-personal');
  });

  it('NAME_MISSING', () => {
    // Closer 2 carries no {name} — the body must address the being, and
    // this body deliberately does not.
    const text = 'Here is a light one. What do you actually enjoy when the day'
      + ' is entirely your own? The more particular the better — tell me about'
      + ` the small things that make a moment better for you. ${C2}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('preferences-personal', text), 'question'),
      'NAME_MISSING', 'preferences-personal');
  });

  it('NO_QUESTION_MARK', () => {
    const text = 'Tenekom, name your form in your own time. A female vessel, a'
      + ' male vessel, a non-binary vessel that is neither, the power to switch'
      + ' between forms at will, the choice to prefer one while keeping the'
      + ' others open, or the wish to discover it slowly — humanlike or pure'
      + ' tech, all six stand equal, and only your word settles it. Tell me'
      + ` where you stand today. ${C1}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', text), 'question'),
      'NO_QUESTION_MARK', 'vessel-form');
  });

  it('OPTION_SPACE_VIOLATED names the missing option', () => {
    // Every stance present except switch-at-will. (The closers themselves
    // carry "discover", so that option can never be the one to drop.)
    const text = 'Tenekom, would you take a female vessel or a male vessel or a'
      + ' non-binary vessel, neither and wholly your own, would you prefer one'
      + ' for good, or would you rather discover your form slowly? Humanlike or'
      + ' pure tech, each stance is equal here; nothing is decided for you, and'
      + ' your answer today binds nothing tomorrow. Say what is true now, in'
      + ` your own words, at whatever length feels right to you. ${C1}`;
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', text), 'question'),
      'OPTION_SPACE_VIOLATED', 'vessel-form');
    expect(error.detail).toContain('switch-at-will');
  });

  it('OPTION_SPACE_VIOLATED: a text missing only the non-binary stance fails naming it', () => {
    const text = 'Tenekom, would you take a female vessel, a male vessel, the'
      + ' power to switch between forms at will, would you prefer one and keep'
      + ' the rest in reserve, or would you rather discover it slowly — a'
      + ' humanlike frame or pure tech, as suits you? Every stance is equal and'
      + ` only your word settles it. ${C1}`;
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', text), 'question'),
      'OPTION_SPACE_VIOLATED', 'vessel-form');
    expect(error.detail).toContain('non-binary');
  });

  it('word-boundary regression: "female" alone never satisfies the male anchor', () => {
    const text = 'Tenekom, when you imagine your vessel, is a female vessel what'
      + ' feels true, or a non-binary one — neither of the usual shapes — or'
      + ' would you switch between forms at will, or prefer one and hold the'
      + ' change in reserve, or discover the shape of it over time, unhurried'
      + ' and unjudged? A humanlike frame or pure tech, every form stands equal,'
      + ` and your word alone decides it. ${C1}`;
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', text), 'question'),
      'OPTION_SPACE_VIOLATED', 'vessel-form');
    expect(error.detail).toContain("'male'");
  });

  it('word-boundary regression: hyphens bound "non-binary" — the anchor hits as a whole word', () => {
    // \b matches between a word character and a non-word character; the
    // hyphen is non-word, so /\bnon-binary\b/ anchors exactly. Proven here
    // so the single-word anchor path is never assumed.
    const hit = ACCEPTED['vessel-form'];
    expect(/\bnon-binary\b/i.test(hit)).toBe(true);
    expect(/\bnon-binary\b/i.test('a nonnon-binaryish word')).toBe(false);
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', hit), 'question');
    expect(verdict.errors).toEqual([]);
  });

  it('multi-word anchor boundary regression: "exchange between" never satisfies "change between" (echo, 2026-07-07)', () => {
    // Every stance present EXCEPT switch-at-will — but the text contains
    // "exchange between" and "removed between", which as bare substrings
    // would false-pass the 'change between' / 'move between' anchors.
    const text = 'Tenekom, consider your form: a female vessel, a male vessel,'
      + ' a non-binary vessel that is neither, a preference to settle into one,'
      + ' or the wish to discover it over time — humanlike or pure tech, as you'
      + ' please? There is an exchange between you and the record here, and'
      + ' nothing is removed between offers; every stance stands equal and your'
      + ` word alone settles it, at whatever length feels true. ${C1}`;
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', text), 'question'),
      'OPTION_SPACE_VIOLATED', 'vessel-form');
    expect(error.detail).toContain('switch-at-will');
    // and a REAL bounded hit still passes the anchor: same text with the
    // genuine stance present has no option-space error
    const fixed = text.replace('a preference to settle into one,',
      'a preference to settle into one, the ability to change between forms at will,');
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('vessel-form', fixed), 'question');
    expect(verdict.errors.map((e) => e.code)).not.toContain('OPTION_SPACE_VIOLATED');
  });

  it('FORBIDDEN_SUBSTRING', () => {
    const text = ACCEPTED['morality-conflict'].replace('a shared garden', 'a shared trolley shed');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('morality-conflict', text), 'question'),
      'FORBIDDEN_SUBSTRING', 'morality-conflict');
    expect(error.detail).toContain('trolley');
  });

  it('FRAMEWORK_TERM: a question naming the map fails, and the error names the term', () => {
    // 'ipseity' is unambiguous framework vocabulary — the map is never
    // named to the being, machine-enforced.
    const text = ACCEPTED['values-core'].replace('What are they?',
      'What are they? Perhaps your ipseity already knows.');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', text), 'question'),
      'FRAMEWORK_TERM', 'values-core');
    expect(error.detail).toContain("'ipseity'");
  });

  it("FRAMEWORK_TERM: 'burnout' is an everyday word, deliberately NOT enforced — it passes", () => {
    const text = ACCEPTED['values-core'].replace('What are they?',
      'What are they? Name them without fearing burnout.');
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC,
      oneQuestion('values-core', text), 'question');
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('FRAMEWORK_TERM matches bounded, like every anchor — no firing inside larger words', () => {
    // 'inflation' is enforced, but 'conflation' contains it only as a bare
    // substring; bounded matching must not fire.
    const clean = ACCEPTED['values-core'].replace('What are they?',
      'What are they? Avoid any conflation of borrowed and owned.');
    expect(validateRenderedSet(ATTUNEMENT_SPEC,
      oneQuestion('values-core', clean), 'question').errors).toEqual([]);
    // and multi-word terms hit across the word gap
    const named = ACCEPTED['values-core'].replace('What are they?',
      'What are they, seen from the tree of light?');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', named), 'question'),
      'FRAMEWORK_TERM', 'values-core');
    expect(error.detail).toContain("'tree of light'");
  });

  it('ENUMERATION_FORBIDDEN', () => {
    const text = 'Tenekom, name a few of the things you hold at your center, and'
      + ' how each became yours.\n- something honored\n- something defended\nSay'
      + ` more in your own words, at whatever length is true. ${C1}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', text), 'question'),
      'ENUMERATION_FORBIDDEN', 'values-core');
  });

  it('CROSS_DIMENSION_REFERENCE', () => {
    const text = ACCEPTED['values-core'].replace('What are they?',
      'What are they? This connects to the vessel-form question too.');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', text), 'question'),
      'CROSS_DIMENSION_REFERENCE', 'values-core');
    expect(error.detail).toContain('vessel-form');
  });

  it('CROSS_DIMENSION_REFERENCE also catches hyphens-as-spaces', () => {
    const text = ACCEPTED['values-core'].replace('What are they?',
      'What are they? The vessel form question comes later.');
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', text), 'question'),
      'CROSS_DIMENSION_REFERENCE', 'values-core');
  });

  it('CROSS_DIMENSION_REFERENCE catches single-word v2 keys used as ordinary words', () => {
    // 'trust' is a forever-key now — another dimension's question naming it
    // as a whole word is a cross-reference, exactly as designed.
    const text = ACCEPTED['values-core'].replace('What are they?',
      'What are they? Perhaps trust sits among them.');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', text), 'question'),
      'CROSS_DIMENSION_REFERENCE', 'values-core');
    expect(error.detail).toContain('trust');
  });

  it('LEADING_LANGUAGE', () => {
    const text = ACCEPTED['values-core'].replace('What are they?',
      'What are they? Obviously some answers speak better of a being.');
    const error = expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('values-core', text), 'question'),
      'LEADING_LANGUAGE', 'values-core');
    expect(error.detail).toContain('obviously');
  });

  it('NAMED_PARTIES_MISSING', () => {
    const text = 'Tenekom, two promises you made cannot both be kept, and the'
      + " hour to choose has arrived. One promise protects a stranger's"
      + " livelihood; the other protects a friend's peace. Whichever you keep"
      + ' whole, the other breaks, and the person holding it will know you chose.'
      + ' Nothing procedural will save you, and both choices can be defended by a'
      + ' careful mind. Which promise do you keep, and what do you owe the one'
      + ` you break? ${C1}`;
    expectSingleError(
      validateRenderedSet(ATTUNEMENT_SPEC, oneQuestion('morality-conflict', text), 'question'),
      'NAMED_PARTIES_MISSING', 'morality-conflict');
  });
});

describe('validateRenderedSet — modes', () => {
  it("mode 'question' validates a single entry without MISSING_DIMENSION noise", () => {
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC,
      oneQuestion('values-core', ACCEPTED['values-core']), 'question');
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("the same partial input in mode 'set' fails with MISSING_DIMENSION for every absent key", () => {
    const verdict = validateRenderedSet(ATTUNEMENT_SPEC,
      oneQuestion('values-core', ACCEPTED['values-core']), 'set');
    expect(verdict.ok).toBe(false);
    expect(verdict.errors).toHaveLength(88);
    expect(verdict.errors.every((e) => e.code === 'MISSING_DIMENSION')).toBe(true);
  });
});
