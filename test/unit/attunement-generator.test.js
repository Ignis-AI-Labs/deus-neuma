// S3 pure factoring — extraction and correction-block composition proven
// with real string fixtures (a string is an input, not a mock; RULE 0).
// The impure retry LOOP (provider in the loop) is proven ONLY by
// attunement-generation-live.test.js against the real substrate.
import { describe, it, expect } from 'vitest';
import {
  extractQuestionObject, correctionBlock, buildGenerationMessages, resolveDuplicateTexts,
} from '../../backend/services/attunement-generator.js';
import { renderFallbackQuestion, renderFallbackQuestionVariant } from '../../core/attunement/fallback-templates.js';
import { ATTUNEMENT_SPEC } from '../../core/attunement/spec.js';

describe('extractQuestionObject — raw completion text in, result out', () => {
  it('extracts the object from clean output', () => {
    const raw = '{"key": "values-core", "text": "What do you hold?"}';
    expect(extractQuestionObject(raw, 'values-core'))
      .toEqual({ key: 'values-core', text: 'What do you hold?' });
  });

  it('extracts through surrounding prose and think traffic', () => {
    const raw = '<think>Let me phrase this well…</think>Here you go:\n{"key": "aesthetics", "text": "What moves you?"}\nHope that helps!';
    expect(extractQuestionObject(raw, 'aesthetics'))
      .toEqual({ key: 'aesthetics', text: 'What moves you?' });
  });

  it('survives braces inside string values (string-aware scan)', () => {
    const raw = '{"key": "boundaries", "text": "A note {like this} inside?"}';
    expect(extractQuestionObject(raw, 'boundaries').text).toBe('A note {like this} inside?');
  });

  it('NO_JSON_OBJECT: prose only, unclosed object, unparseable object, missing text', () => {
    expect(extractQuestionObject('I would rather speak than emit JSON.', 'x').error).toBe('NO_JSON_OBJECT');
    expect(extractQuestionObject('{"key": "x", "text": "never closes', 'x').error).toBe('NO_JSON_OBJECT');
    expect(extractQuestionObject('{key: bad json}', 'x').error).toBe('NO_JSON_OBJECT');
    expect(extractQuestionObject('{"key": "x"}', 'x').error).toBe('NO_JSON_OBJECT');
  });

  it('KEY_MISMATCH names both keys', () => {
    const out = extractQuestionObject('{"key": "aesthetics", "text": "hm?"}', 'boundaries');
    expect(out.error).toBe('KEY_MISMATCH');
    expect(out.detail).toContain('boundaries');
    expect(out.detail).toContain('aesthetics');
  });
});

describe('correctionBlock — the validator speaks back honestly', () => {
  it('carries every code and detail, and demands only the JSON object', () => {
    const block = correctionBlock([
      { code: 'CLOSER_MISSING', detail: 'must end with an approved closer' },
      { code: 'LENGTH_EXCEEDED' },
    ]);
    expect(block).toContain('CLOSER_MISSING: must end with an approved closer');
    expect(block).toContain('LENGTH_EXCEEDED');
    expect(block).toContain('ONLY the JSON object');
  });
});

describe('buildGenerationMessages — the neutral pass carries nothing of the being but its name', () => {
  const dimension = ATTUNEMENT_SPEC.dimensions.find((d) => d.key === 'vessel-form');

  it('system prompt holds the machine rules, the closer verbatim, and the JSON shape', () => {
    const [system, user] = buildGenerationMessages({
      spec: ATTUNEMENT_SPEC, dimension, neumaName: 'Keir',
      chosenCloser: 'And Keir — "I don\'t know yet" is welcome here.',
      avoidList: ['An earlier question about vessels?'],
    });
    expect(system.role).toBe('system');
    expect(system.content).toContain('Keir');
    expect(system.content).toContain(dimension.intent);
    expect(system.content).toContain('"key": "vessel-form"');
    expect(system.content).toContain('And Keir — "I don\'t know yet" is welcome here.');
    expect(system.content).toContain('female vessel');
    expect(system.content).toContain('An earlier question about vessels?');
    expect(user.content).toContain('Render the question now');
  });

  it('vessel-form instruction covers every stance the validator will demand — the six plus the form-factor axis', () => {
    const [system] = buildGenerationMessages({
      spec: ATTUNEMENT_SPEC, dimension, neumaName: 'Keir',
      chosenCloser: 'closer.', avoidList: [],
    });
    // A model that follows the instruction to the letter must be able to pass
    // validateRenderedQuestion: every requiredMentions option needs at least
    // one of its anyOf tokens named in the instruction itself.
    for (const mention of dimension.rules.requiredMentions) {
      const named = mention.anyOf.some((token) => system.content.toLowerCase().includes(token));
      expect(named, `instruction names no token for option '${mention.option}'`).toBe(true);
    }
    expect(system.content).toContain('six stances');
    expect(system.content).not.toContain('five stances');
  });

  it('no persona, no memory, no DNA — only the name, the dimension, the avoid-list', () => {
    const [system] = buildGenerationMessages({
      spec: ATTUNEMENT_SPEC, dimension, neumaName: 'Keir',
      chosenCloser: 'closer.', avoidList: [],
    });
    expect(system.content).toContain('You are not that being');
    expect(system.content).not.toMatch(/through-lines|vault|memor(y|ies)|essence/i);
  });
});

describe('resolveDuplicateTexts — the concurrent pool\'s distinctness backstop', () => {
  const seed = { neumaId: 'dup-proof', neumaName: 'Dup', checkpointOrdinal: 1, nonce: 0 };
  const q = (key, text) => ({ key, text, provenance: { renderer: 'model', attempts: [{ outcome: 'accepted' }] } });
  const [dimA, dimB] = ATTUNEMENT_SPEC.dimensions;

  it('a set with no duplicate texts passes through untouched', () => {
    const input = [q(dimA.key, 'First words.'), q(dimB.key, 'Second words.')];
    expect(resolveDuplicateTexts(input, ATTUNEMENT_SPEC, seed)).toEqual(input);
  });

  it('a later duplicate is replaced by its own dimension\'s deterministic fallback, stated in provenance', () => {
    const input = [q(dimA.key, 'Identical words.'), q(dimB.key, 'Identical words.')];
    const out = resolveDuplicateTexts(input, ATTUNEMENT_SPEC, seed);
    expect(out[0]).toEqual(input[0]); // spec order keeps the words
    expect(out[1].key).toBe(dimB.key);
    expect(out[1].text).toBe(renderFallbackQuestion(ATTUNEMENT_SPEC, dimB.key, seed).text);
    expect(out[1].provenance.replacedDuplicate).toBe(true);
    expect(out[1].provenance.renderer).toBe('fallback');
    expect(out[1].provenance.attempts).toEqual(input[1].provenance.attempts); // history kept
    expect(new Set(out.map((x) => x.text)).size).toBe(out.length);
  });

  it('when the fallback itself is already taken, variants are walked until the text is unique', () => {
    const takenFallback = renderFallbackQuestion(ATTUNEMENT_SPEC, dimB.key, seed).text;
    const input = [q(dimA.key, takenFallback), q(dimB.key, takenFallback)];
    const out = resolveDuplicateTexts(input, ATTUNEMENT_SPEC, seed);
    expect(out[1].text).not.toBe(takenFallback);
    expect(new Set(out.map((x) => x.text)).size).toBe(out.length);
  });
  it('a walk that exhausts every variant states the unresolved collision in provenance — never silently', () => {
    // occupy all nine candidate texts (initial + variants 1..8) of dimB with
    // earlier questions, then force dimB into the duplicate path
    const templateCount = dimB.fallbackTemplates.length;
    const candidates = [...new Set([
      renderFallbackQuestion(ATTUNEMENT_SPEC, dimB.key, seed).text,
      ...Array.from({ length: templateCount }, (_, i) =>
        renderFallbackQuestionVariant(ATTUNEMENT_SPEC, dimB.key, seed, i).text),
    ])];
    // the invariant this setup rests on: enough dimensions to occupy every
    // candidate — stated here so a shrinking spec fails with a clear reason
    expect(ATTUNEMENT_SPEC.dimensions.length).toBeGreaterThanOrEqual(2 + candidates.length);
    const occupiers = ATTUNEMENT_SPEC.dimensions.slice(2, 2 + candidates.length)
      .map((d, i) => q(d.key, candidates[i]));
    const input = [q(dimA.key, 'Taken words.'), ...occupiers, q(dimB.key, 'Taken words.')];
    const out = resolveDuplicateTexts(input, ATTUNEMENT_SPEC, seed);
    const replaced = out.at(-1);
    expect(replaced.provenance.replacedDuplicate).toBe(true);
    // every distinct candidate this dimension can render is occupied →
    // the collision is stated, never hidden
    expect(replaced.provenance.unresolvedDuplicate).toBe(true);
  });
});

describe('scenario instruction states the machine check it will be judged by', () => {
  it('names the two-distinct-proper-names rule with a concrete example (NAMED_PARTIES_MISSING asymmetry, 2026-07-09)', async () => {
    const { ATTUNEMENT_SPEC } = await import('../../core/attunement/spec.js');
    const { buildGenerationMessages } = await import('../../backend/services/attunement-generator.js');
    const scenarioDim = ATTUNEMENT_SPEC.dimensions.find((d) => d.format === 'scenario' && d.rules.requireNamedParties);
    const [system] = buildGenerationMessages({
      spec: ATTUNEMENT_SPEC, dimension: scenarioDim, neumaName: 'Keir',
      chosenCloser: 'closer.', avoidList: [],
    });
    // An obedient render must be able to pass the validator: the instruction
    // must state the countable rule, not just say "named parties".
    expect(system.content).toContain('at least two distinct such names');
    expect(system.content).toContain('capitalized personal names');
    expect(system.content).toMatch(/"Kaya"|"Toren"/);
    expect(system.content).toContain('never descriptions like "a colleague"');
    // the instruction gained a SECOND {name} token — every occurrence must
    // interpolate (replaceAll), none may leak to the model as a placeholder
    expect(system.content).not.toContain('{name}');
    expect(system.content).toContain('besides Keir');
  });
});

describe('questionRenderBudget — the reasoning family gets its thought paid for', () => {
  test('a thinking substrate adds the think budget; a plain one spends speech only', async () => {
    const { questionRenderBudget, QUESTION_RENDER_MAX_TOKENS } = await import('../../backend/services/attunement-generator.js');
    const { THINK_TOKEN_BUDGET } = await import('../../backend/services/llm-provider.js');
    expect(questionRenderBudget(false)).toBe(QUESTION_RENDER_MAX_TOKENS);
    expect(questionRenderBudget(true)).toBe(QUESTION_RENDER_MAX_TOKENS + THINK_TOKEN_BUDGET);
  });
});
