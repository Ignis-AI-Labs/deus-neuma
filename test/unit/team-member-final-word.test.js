// A member's part is its final word — the speech after its last act (pure,
// real inputs → real outputs).

import { describe, it, expect } from 'vitest';
import { finalWord } from '../../backend/services/team-member-turn.js';

const ANSWER = 'Done means a file you can open.';
const SIGNOFF = '\nSTATUS:\n- done\nTORCH:\n- wrote it';

describe('finalWord — the part is what the member said after its last act', () => {
  it('an answer written beside the tool call and again after it is carried ONCE', () => {
    const round1 = `${ANSWER}${SIGNOFF}\n`;
    const text = `${round1}${ANSWER}${SIGNOFF}`;
    expect(finalWord(text, round1.length)).toBe(`${ANSWER}${SIGNOFF}`);
  });

  it('narration before the last act is working out loud — dropped from the part', () => {
    const before = 'Let me check the workspace first.\n';
    expect(finalWord(`${before}${ANSWER}${SIGNOFF}`, before.length)).toBe(`${ANSWER}${SIGNOFF}`);
  });

  it('a final word holding only the check-in keeps the WHOLE turn — real work is never dropped', () => {
    const work = `${ANSWER}\n`;
    expect(finalWord(`${work}${SIGNOFF}`, work.length)).toBe(`${ANSWER}\n${SIGNOFF}`.trim());
  });

  it('a turn with no act, or nothing after it, is the whole turn', () => {
    expect(finalWord(`${ANSWER}${SIGNOFF}`, 0)).toBe(`${ANSWER}${SIGNOFF}`);
    expect(finalWord(ANSWER, ANSWER.length)).toBe(ANSWER);
  });
});
