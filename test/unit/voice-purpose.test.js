/**
 * normalizePurpose + the VOICE SITTING signal — pure, real inputs, real
 * outputs, no mocks anywhere (RULE 0). The laws under test (SPEECH SYSTEM,
 * Track B; threat control #4 — purpose misuse):
 *   1. FAIL-CLOSED: anything outside the closed set — missing, unknown,
 *      garbage, hostile — normalizes to 'work'. Voice is never silent-on.
 *   2. EMPTY-STRING LAW: the voiceSitting prompt section exists ONLY for a
 *      declared conversation; every other lane gets '' (no section), so its
 *      prompt stays byte-identical to before the section existed.
 */
import { describe, test, expect } from 'vitest';
import {
  normalizePurpose, voiceSittingSection,
  PURPOSES, PURPOSE_WORK, PURPOSE_CONVERSATION, DEFAULT_PURPOSE,
  VOICE_SITTING_SECTION,
} from '../../core/voice/purpose.js';

describe('normalizePurpose — fail-closed to work', () => {
  test('the two declared standings pass through unchanged', () => {
    expect(normalizePurpose('work')).toBe(PURPOSE_WORK);
    expect(normalizePurpose('conversation')).toBe(PURPOSE_CONVERSATION);
  });

  test('missing input fails closed', () => {
    expect(normalizePurpose(undefined)).toBe('work');
    expect(normalizePurpose(null)).toBe('work');
    expect(normalizePurpose('')).toBe('work');
  });

  test('near-misses are NOT conversations — no case-folding, no trimming, no prefix match', () => {
    for (const raw of ['WORK', 'Work', 'Conversation', 'CONVERSATION', 'conversation ', ' conversation', 'workbench', 'converse', 'chat', 'voice']) {
      expect(normalizePurpose(raw)).toBe('work');
    }
  });

  test('hostile and garbage shapes fail closed', () => {
    const garbage = [
      42, 0, NaN, true, false,
      {}, { purpose: 'conversation' }, [], ['conversation'],
      '<script>alert(1)</script>',
      'conversation\0', 'conversation\nwork',
      'x'.repeat(10000),
      () => 'conversation',
    ];
    for (const raw of garbage) {
      expect(normalizePurpose(raw)).toBe('work');
    }
  });

  test('idempotent on its own output', () => {
    expect(normalizePurpose(normalizePurpose('conversation'))).toBe('conversation');
    expect(normalizePurpose(normalizePurpose('garbage'))).toBe('work');
  });
});

describe('purpose constants — the closed set is frozen law', () => {
  test('PURPOSES is the frozen pair, work first (the default standing)', () => {
    expect(Object.isFrozen(PURPOSES)).toBe(true);
    expect([...PURPOSES]).toEqual(['work', 'conversation']);
    expect(DEFAULT_PURPOSE).toBe('work');
    expect(PURPOSE_WORK).toBe('work');
    expect(PURPOSE_CONVERSATION).toBe('conversation');
  });
});

describe('voiceSittingSection — the empty-string law', () => {
  test('a working lane, an undeclared lane, and no connection at all cost NOTHING', () => {
    expect(voiceSittingSection({ purpose: 'work' })).toBe('');
    expect(voiceSittingSection({})).toBe('');
    expect(voiceSittingSection({ purpose: undefined })).toBe('');
    expect(voiceSittingSection({ purpose: 'garbage' })).toBe('');
    expect(voiceSittingSection(null)).toBe('');
    expect(voiceSittingSection(undefined)).toBe('');
  });

  test('a declared conversation gets the section, in the speech register', () => {
    const text = voiceSittingSection({ purpose: 'conversation' });
    expect(text).toBe(VOICE_SITTING_SECTION);
    expect(text).toContain('## VOICE SITTING');
    expect(text).toContain('short spoken sentences');
    expect(text).toContain('No markdown, no lists, no code blocks');
  });

  test('only the exact standing opens the gate — never a truthy lookalike', () => {
    expect(voiceSittingSection({ purpose: 'Conversation' })).toBe('');
    expect(voiceSittingSection({ purpose: 'conversation ' })).toBe('');
  });
});
