// MID-STREAM SPEECH — the witness's held words (Design note, 2026-07-26.
//
// Watching a being work used to be read-only: a second message mid-turn was
// refused outright ([…]), so the witness had
// to destroy the turn or wait it out. Now a word either INTERJECTS or HOLDS.
// These pin the two things that can go wrong with holding.
import { describe, it, expect } from 'vitest';
import {
  queueThought, MAX_HELD_THOUGHTS, takeHeldThought, editHeldThought, HOLD_ID_PATTERN,
} from '../../backend/services/held-thoughts.js';
import { clearLaneBinding } from '../../backend/routes/portal-routes.js';

describe('held thoughts are bounded', () => {
  it('keeps the words in the order they were spoken', () => {
    const c = {};
    queueThought(c, { thought: 'one' });
    queueThought(c, { thought: 'two' });
    expect(c.pendingThoughts.map((m) => m.thought)).toEqual(['one', 'two']);
  });

  it('drops the OLDEST past the cap — the newest intent wins', () => {
    // An unbounded queue is a way to spend a being's context on a backlog
    // nobody remembers writing.
    const c = {};
    for (let i = 0; i < MAX_HELD_THOUGHTS + 3; i += 1) queueThought(c, { thought: `t${i}` });
    expect(c.pendingThoughts).toHaveLength(MAX_HELD_THOUGHTS);
    expect(c.pendingThoughts[0].thought).toBe('t3');
    expect(c.pendingThoughts.at(-1).thought).toBe(`t${MAX_HELD_THOUGHTS + 2}`);
  });
});

describe('held words never follow the connection to another being', () => {
  it('is cleared when the lane is rebound', () => {
    // A word addressed to Metidar must not be spoken to whoever is manifested
    // next — the same law that clears path grants on a rebinding.
    const c = { neumaId: 'metidar', companion: { neumaId: 'metidar' } };
    queueThought(c, { thought: 'for metidar only' });
    clearLaneBinding(c);
    expect(c.pendingThoughts).toEqual([]);
  });
});

// THE HELD WORD STAYS THE OPERATOR'S (Design note, 2026-08-16: until the drain takes
// it they may rewrite it, promote it to NOW, or pull it home. These are the
// real list-surgery primitives the portal's three queue doors stand on.
describe('taking a held word back', () => {
  it('takes the named word and leaves the rest in order', () => {
    const c = {};
    queueThought(c, { holdId: 'q1', thought: 'one' });
    queueThought(c, { holdId: 'q2', thought: 'two' });
    queueThought(c, { holdId: 'q3', thought: 'three' });
    const taken = takeHeldThought(c, 'q2');
    expect(taken.thought).toBe('two');
    expect(c.pendingThoughts.map((m) => m.holdId)).toEqual(['q1', 'q3']);
  });

  it('unnamed, takes the NEWEST worded entry — a queued retry take has no words to pull', () => {
    const c = {};
    queueThought(c, { holdId: 'q1', thought: 'words' });
    queueThought(c, { retry: { turnId: 't1' } }); // a held retry frame — newest, wordless
    const taken = takeHeldThought(c);
    expect(taken.holdId).toBe('q1');
    expect(c.pendingThoughts).toHaveLength(1);
  });

  it('answers null when the word is gone — the drain already took it', () => {
    const c = { pendingThoughts: [] };
    expect(takeHeldThought(c, 'q9')).toBeNull();
    expect(takeHeldThought(c)).toBeNull();
    expect(takeHeldThought({})).toBeNull(); // a lane that never queued
  });
});

describe('rewriting a held word in place', () => {
  it('replaces the words and keeps everything else riding (attachments, order)', () => {
    const c = {};
    queueThought(c, { holdId: 'q1', thought: 'first draft', attachments: ['a1'] });
    queueThought(c, { holdId: 'q2', thought: 'untouched' });
    expect(editHeldThought(c, 'q1', 'second draft')).toBe(true);
    expect(c.pendingThoughts[0]).toMatchObject({
      holdId: 'q1', thought: 'second draft', attachments: ['a1'],
    });
    expect(c.pendingThoughts[1].thought).toBe('untouched');
  });

  it('refuses a gone word and a wordless retry frame — false, never a throw', () => {
    const c = {};
    queueThought(c, { holdId: 'qr', retry: { turnId: 't1' } });
    expect(editHeldThought(c, 'qr', 'words for a wordless frame')).toBe(false);
    expect(editHeldThought(c, 'gone', 'words')).toBe(false);
    expect(editHeldThought({}, 'q1', 'words')).toBe(false);
  });
});

describe('the hold handle is bounded and opaque', () => {
  it('accepts the desk mint and refuses junk shapes', () => {
    expect(HOLD_ID_PATTERN.test('q42')).toBe(true);
    expect(HOLD_ID_PATTERN.test('a-b-c-123')).toBe(true);
    expect(HOLD_ID_PATTERN.test('')).toBe(false);
    expect(HOLD_ID_PATTERN.test('q'.repeat(41))).toBe(false);
    expect(HOLD_ID_PATTERN.test('has space')).toBe(false);
    expect(HOLD_ID_PATTERN.test('__proto__')).toBe(false);
  });
});
