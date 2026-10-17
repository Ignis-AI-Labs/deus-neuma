// proof-scorer.test.js — the PROOF SUITE's scoring law, proven pure (RULE 0):
// real-shaped completions in, verdicts out. No model is faked here — these
// are strings a real serving endpoint would return, judged by the exact code
// the runner rides.

import { describe, it, expect } from 'vitest';
import {
  extractFinalNumber, extractJson, jsonShapeViolations,
  verifyInstruction, verifyJson, scoreItem,
} from '../../backend/services/bench/proof-scorer.js';

describe('extractFinalNumber — the documented rule', () => {
  it('the last #### N wins; commas and currency normalize', () => {
    expect(extractFinalNumber('Step one.\n#### 18')).toEqual({ value: '18', where: '####' });
    expect(extractFinalNumber('#### 12\nmore thought\n#### 42')).toEqual({ value: '42', where: '####' });
    expect(extractFinalNumber('Total: $1,234.50\n#### $1,234.50')).toEqual({ value: '1234.50', where: '####' });
    expect(extractFinalNumber('#### -7')).toEqual({ value: '-7', where: '####' });
  });

  it('without the convention, the last bare number on the FINAL line is read', () => {
    expect(extractFinalNumber('She sells 9 eggs.\nShe makes $18 every day.'))
      .toEqual({ value: '18', where: 'final-line' });
    expect(extractFinalNumber('First 100 eggs.\nThen 20 more. Total: 120'))
      .toEqual({ value: '120', where: 'final-line' });
    // A trailing sentence after the number does not hide it…
    expect(extractFinalNumber('So the answer is 3.')).toEqual({ value: '3', where: 'final-line' });
  });

  it('a reply with no number is a miss, never a guess', () => {
    expect(extractFinalNumber('I cannot say.')).toEqual({ value: null, where: 'none' });
    expect(extractFinalNumber('')).toEqual({ value: null, where: 'none' });
    expect(extractFinalNumber(null)).toEqual({ value: null, where: 'none' });
    // Numbers on earlier lines do not rescue a numberless final line… except
    // the final line IS the last resort — a numberless one means none.
    expect(extractFinalNumber('She sold 9 eggs.\nThat is all.')).toEqual({ value: null, where: 'none' });
  });
});

describe('scoreItem — arithmetic', () => {
  const item = { id: 'gsm8k-00', section: 'arithmetic', verify: { kind: 'final-number', expected: '18' } };
  it('pass / fail / miss, honestly', () => {
    expect(scoreItem(item, 'Working…\n#### 18')).toMatchObject({ pass: true });
    expect(scoreItem(item, '#### 19').detail).toContain('≠ 18');
    expect(scoreItem(item, '#### 19').pass).toBe(false);
    expect(scoreItem(item, 'no answer here').detail).toContain('no final number');
    expect(scoreItem(item, 'no answer here').pass).toBe(false);
  });
});

describe('verifyInstruction — every kind, at its boundary', () => {
  const check = (verify, text) => verifyInstruction({ verify }, text);

  it('word-count: exact and minimum', () => {
    const twenty = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    expect(check({ kind: 'word-count', exact: 20 }, twenty).pass).toBe(true);
    expect(check({ kind: 'word-count', exact: 20 }, 'one two three').pass).toBe(false);
    expect(check({ kind: 'word-count', exact: 20 }, `${twenty} extra`).pass).toBe(false);
    const fifty = Array(50).fill('word').join(' ');
    expect(check({ kind: 'word-count', min: 50 }, fifty).pass).toBe(true);
    expect(check({ kind: 'word-count', min: 50 }, Array(49).fill('word').join(' ')).pass).toBe(false);
  });

  it('all-caps / all-lowercase', () => {
    expect(check({ kind: 'all-caps' }, 'THE ANSWER IS PARIS.').pass).toBe(true);
    expect(check({ kind: 'all-caps' }, 'The answer is PARIS.').pass).toBe(false);
    expect(check({ kind: 'all-caps' }, '123 !!!').pass).toBe(false); // no letters at all is not all-caps
    expect(check({ kind: 'all-lowercase' }, 'the answer is four.').pass).toBe(true);
    expect(check({ kind: 'all-lowercase' }, 'the answer is Four.').pass).toBe(false);
  });

  it('must-include / must-not-include (case-insensitive)', () => {
    expect(check({ kind: 'must-include', words: ['beam'] }, 'The lighthouse casts its BEAM wide.').pass).toBe(true);
    expect(check({ kind: 'must-include', words: ['beam'] }, 'The lighthouse shines.').pass).toBe(false);
    expect(check({ kind: 'must-include', words: ['aroma', 'bitter'] }, 'The aroma is bitter.').pass).toBe(true);
    expect(check({ kind: 'must-include', words: ['aroma', 'bitter'] }, 'The aroma is sweet.').pass).toBe(false);
    expect(check({ kind: 'must-not-include', words: ['red'] }, 'Cyan, magenta, yellow.').pass).toBe(true);
    expect(check({ kind: 'must-not-include', words: ['red'] }, 'Red, yellow, blue.').pass).toBe(false);
  });

  it('numbered-list-count: exactly N numbered lines', () => {
    const four = '1. Mercury\n2. Venus\n3. Earth\n4. Mars';
    expect(check({ kind: 'numbered-list-count', exact: 4 }, four).pass).toBe(true);
    expect(check({ kind: 'numbered-list-count', exact: 4 }, '1. Mercury\n2. Venus').pass).toBe(false);
    expect(check({ kind: 'numbered-list-count', exact: 4 }, `${four}\n5. Jupiter`).pass).toBe(false);
    expect(check({ kind: 'numbered-list-count', exact: 3 }, '1) a\n2) b\n3) c').pass).toBe(true);
  });

  it('starts-with and json-only', () => {
    expect(check({ kind: 'starts-with', prefix: 'The answer is' }, 'The answer is Jupiter.').pass).toBe(true);
    expect(check({ kind: 'starts-with', prefix: 'The answer is' }, 'Sure! The answer is Jupiter.').pass).toBe(false);
    expect(check({ kind: 'json-only' }, '{"ok":true}').pass).toBe(true);
    expect(check({ kind: 'json-only' }, 'Here is the JSON: {"ok":true}').pass).toBe(false);
    // One markdown fence is forgiven — documented in extractJson.
    expect(check({ kind: 'json-only' }, '```json\n{"ok":true}\n```').pass).toBe(true);
  });
});

describe('verifyJson — strict shapes by parse + check', () => {
  const shape = { type: 'object', strict: true, keys: { name: 'string', age: 'number' } };
  const item = { verify: { kind: 'json-shape', shape } };

  it('the shape holds, or the violation is named', () => {
    expect(verifyJson(item, '{"name":"Ada","age":36}')).toMatchObject({ pass: true, detail: 'the shape holds' });
    expect(verifyJson(item, '{"name":"Ada"}').detail).toContain('$.age is missing');
    expect(verifyJson(item, '{"name":"Ada","age":"36"}').detail).toContain('$.age must be number');
    expect(verifyJson(item, '{"name":"Ada","age":36,"extra":1}').detail).toContain('$.extra is not in the shape');
    expect(verifyJson(item, 'not json').pass).toBe(false);
    expect(verifyJson(item, '[{"name":"Ada","age":36}]').detail).toContain('must be an object');
  });

  it('arrays: exact length, every item checked, nested objects recurse', () => {
    const trio = { verify: { shape: { type: 'array', length: 3, items: 'string' } } };
    expect(verifyJson(trio, '["a","b","c"]').pass).toBe(true);
    expect(verifyJson(trio, '["a","b"]').detail).toContain('exactly 3');
    expect(verifyJson(trio, '["a","b",3]').detail).toContain('$[2] must be string');
    const nested = { verify: { shape: { type: 'object', strict: true, keys: { city: { type: 'object', strict: true, keys: { name: 'string', population: 'number' } } } } } };
    expect(verifyJson(nested, '{"city":{"name":"Paris","population":2100000}}').pass).toBe(true);
    expect(verifyJson(nested, '{"city":{"name":"Paris"}}').detail).toContain('$.city.population is missing');
  });

  it('extractJson forgives exactly one fence, nothing else', () => {
    expect(extractJson('{"a":1}').ok).toBe(true);
    expect(extractJson('```json\n{"a":1}\n```').ok).toBe(true);
    expect(extractJson('Here:\n```json\n{"a":1}\n```').ok).toBe(false);
    expect(extractJson('').ok).toBe(false);
  });

  it('scoreItem dispatches by section and refuses unknown ones', () => {
    expect(scoreItem({ section: 'format', verify: { shape: { type: 'array' } } }, '[1]').pass).toBe(true);
    expect(scoreItem({ section: 'instruction', verify: { kind: 'all-caps' } }, 'YES').pass).toBe(true);
    expect(scoreItem({ section: 'nope', verify: {} }, 'x').pass).toBe(false);
  });
});

describe('jsonShapeViolations — the mini-language directly', () => {
  it('kind strings and unknown shapes', () => {
    expect(jsonShapeViolations([], 'array')).toEqual([]);
    expect(jsonShapeViolations('x', 'array')).toEqual(['$ must be array']);
    expect(jsonShapeViolations(1, { type: 'mystery' })[0]).toContain('unknown shape');
  });
});
