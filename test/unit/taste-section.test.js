/**
 * THE RESIDUE — what the judgments accumulate into.
 *
 * Pure throughout, so these are real calls with real inputs (RULE 0 — a pure
 * function qualifies precisely because verifying it involves no mock at all).
 *
 * The load-bearing test is the last one: an absent taste must leave every
 * existing prompt byte-identical. That is what lets this section land WITHOUT a
 * FREEZE 11 on the frozen fixtures — and it is a claim, not a hope, so it is
 * asserted against the real assembler.
 */
import { describe, test, expect } from 'vitest';
import {
  foldTaste, formatTasteSection, TASTE_ROWS, TASTE_NOTE_MAX,
} from '../../core/runtime/taste.js';
import { assemblePrompt, assemblePromptSections } from '../../core/runtime/prompt-assembler.js';

const row = (over = {}) => ({
  laneId: 'lane-1', by: 'being', verdict: 'keep', matches: null, note: null, ...over,
});

describe('foldTaste — pure', () => {
  test('splits the two standings and never merges them', () => {
    const taste = foldTaste([
      row({ by: 'operator', verdict: 'keep', note: 'the light reads true' }),
      row({ by: 'being', verdict: 'redo', matches: 'partial', note: 'the count is off' }),
    ], 'lane-1');
    expect(taste.operator).toHaveLength(1);
    expect(taste.own).toHaveLength(1);
    expect(taste.operator[0].note).toBe('the light reads true');
    expect(taste.own[0].matches).toBe('partial');
  });

  test('another lane\'s judgments never ride', () => {
    const taste = foldTaste([
      row({ laneId: 'someone-else', note: 'not yours' }),
      row({ laneId: 'lane-1', note: 'yours' }),
    ], 'lane-1');
    expect(taste.own).toHaveLength(1);
    expect(taste.own[0].note).toBe('yours');
  });

  test('a row that decided nothing is dropped', () => {
    // A judgment with no verdict decided nothing and would spend prompt saying so.
    expect(foldTaste([row({ verdict: null, note: 'hmm' })], 'lane-1').own).toEqual([]);
  });

  test('bounded per standing, newest kept', () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ note: `n${i}` }));
    const taste = foldTaste(many, 'lane-1');
    expect(taste.own).toHaveLength(TASTE_ROWS);
    // readReviews hands rows newest-first; the fold must preserve that order.
    expect(taste.own[0].note).toBe('n0');
  });

  test('a long note is bounded', () => {
    const taste = foldTaste([row({ note: 'x'.repeat(TASTE_NOTE_MAX + 200) })], 'lane-1');
    expect(taste.own[0].note).toHaveLength(TASTE_NOTE_MAX);
    expect(taste.own[0].note.endsWith('…')).toBe(true);
  });

  test('junk in never throws', () => {
    expect(foldTaste(null, 'lane-1')).toEqual({ operator: [], own: [] });
    expect(foldTaste([null, undefined], 'lane-1')).toEqual({ operator: [], own: [] });
  });
});

describe('formatTasteSection — pure', () => {
  test('nothing judged renders nothing', () => {
    expect(formatTasteSection(null)).toBe('');
    expect(formatTasteSection({ operator: [], own: [] })).toBe('');
  });

  test('the two standings are labelled apart', () => {
    const text = formatTasteSection({
      operator: [{ verdict: 'keep', matches: null, note: 'the light reads true' }],
      own: [{ verdict: 'redo', matches: 'partial', note: 'the count is off' }],
    });
    expect(text).toContain('Your operator:');
    expect(text).toContain('You:');
    // The operator's word comes first — it is authoritative input the being
    // weighs, and reading it after its own verdict would frame it as a reply.
    expect(text.indexOf('Your operator:')).toBeLessThan(text.indexOf('You:'));
  });

  test('adherence is named, because it is the checkable stratum', () => {
    const text = formatTasteSection({ operator: [], own: [{ verdict: 'redo', matches: 'no', note: null }] });
    expect(text).toContain('adherence no');
  });

  test('states the record and preaches no lesson', () => {
    // FREEZE 7 removed the covenant's argument-for-the-rule for exactly this
    // reason — a lecture re-delivered every turn, paid for in every window.
    const text = formatTasteSection({ operator: [{ verdict: 'keep', matches: null, note: 'good' }], own: [] });
    expect(text).not.toMatch(/should|must|remember to|your taste is/i);
    expect(text.split('\n').length).toBeLessThan(8);
  });

  test('one standing alone omits the other heading', () => {
    const text = formatTasteSection({ operator: [], own: [{ verdict: 'keep', matches: null, note: 'mine' }] });
    expect(text).not.toContain('Your operator:');
    expect(text).toContain('You:');
  });
});

describe('the assembler seam', () => {
  test('NO FREEZE NEEDED: absent taste leaves the prompt byte-identical', () => {
    // The whole reason this section could land beside an uncommitted FREEZE 10
    // without contending for the frozen fixtures. Empty text ⇒ the candidate is
    // filtered out ⇒ not one byte moves for any caller that passes no taste.
    const params = { dna: { identity: { name: 'Fenna' } }, now: new Date('2026-01-01T00:00:00Z') };
    const withoutKey = assemblePrompt(params);
    const withNull = assemblePrompt({ ...params, taste: null });
    const withEmpty = assemblePrompt({ ...params, taste: { operator: [], own: [] } });
    expect(withNull).toBe(withoutKey);
    expect(withEmpty).toBe(withoutKey);
    expect(assemblePromptSections(params).some((s) => s.id === 'taste')).toBe(false);
  });

  test('a judged being carries the section, in assembly order', () => {
    const sections = assemblePromptSections({
      dna: { identity: { name: 'Fenna' } },
      taste: { operator: [{ verdict: 'keep', matches: null, note: 'holds' }], own: [] },
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('taste');
    const taste = sections.find((s) => s.id === 'taste');
    expect(taste.label).toBe('YOUR EYE');
    expect(taste.text).toContain('holds');
    // Below the cache line (FREEZE 9's two groups) — it moves turn to turn, so
    // it must never sit above the stable run and force a full re-prefill.
    expect(ids.indexOf('taste')).toBeGreaterThan(ids.indexOf('tools'));
  });
});
