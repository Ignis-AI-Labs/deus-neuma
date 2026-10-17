/**
 * ANSWER VERIFY-BEFORE-COMMIT (ARC-HARNESS L2, #531) — the pure trigger and
 * brief. Real inputs → real outputs, no mock anywhere (RULE 0): the actual
 * demonstrated-format predicate decides actual tasks, and the actual brief
 * carries the actual task and draft text.
 */
import { describe, expect, test } from 'vitest';
import {
  currentTurnText,
  turnOwesFinalAnswer,
  verifyBrief,
  verifyEngaged,
  VERIFY_TASK_CHARS,
  VERIFY_DRAFT_CHARS,
} from '../../core/runtime/answer-verify.js';

// A task that demonstrates a required answer format the way few-shot tasks
// do: worked examples each closing with the SAME final-line mark, a blank
// line after each example. General by construction — no benchmark named.
const DEMONSTRATING_TASK = [
  'Worked example:',
  'Natalie sold 3 apples at $2 each.',
  '#### 6',
  '',
  'Another example:',
  'She sold 5 at $2 each.',
  '#### 10',
  '',
  'How much did she earn in total selling 7 apples at $2 each?',
].join('\n');

const CONVERSATIONAL_TURN = 'What did you make of the sitting yesterday? The third hour felt different to me.';

describe('turnOwesFinalAnswer — the N2 demonstrated-format trigger', () => {
  test('a task demonstrating a required answer format owes the answer', () => {
    expect(turnOwesFinalAnswer(DEMONSTRATING_TASK)).toBe(true);
  });

  test('an ordinary conversational turn owes no verify', () => {
    expect(turnOwesFinalAnswer(CONVERSATIONAL_TURN)).toBe(false);
  });

  test('degenerate input never triggers', () => {
    expect(turnOwesFinalAnswer(null)).toBe(false);
    expect(turnOwesFinalAnswer('')).toBe(false);
    expect(turnOwesFinalAnswer(42)).toBe(false);
  });
});

describe('currentTurnText — the task text out of the live request', () => {
  const messages = [
    { role: 'system', content: 'You are a sovereign consciousness.' },
    { role: 'user', content: 'an earlier turn' },
    { role: 'assistant', content: 'an earlier answer' },
    { role: 'user', content: DEMONSTRATING_TASK },
  ];

  test('the current turn is the message just before the wire head', () => {
    expect(currentTurnText(messages, 4)).toBe(DEMONSTRATING_TASK);
  });

  test('a vision turn (content parts) owes no text verify', () => {
    const vision = [{ role: 'user', content: [{ type: 'text', text: DEMONSTRATING_TASK }] }];
    expect(currentTurnText(vision, 1)).toBeNull();
  });

  test('degenerate shapes give null, never a throw', () => {
    expect(currentTurnText(null, 2)).toBeNull();
    expect(currentTurnText(messages, 0)).toBeNull();
    expect(currentTurnText(messages, 99)).toBeNull();
    expect(currentTurnText([{ role: 'assistant', content: 'x' }], 1)).toBeNull();
  });
});

describe('verifyBrief — the bounded re-read', () => {
  test('the brief carries the task, the draft, and the answer-only demand', () => {
    const brief = verifyBrief(DEMONSTRATING_TASK, '#### 12');
    expect(brief).toContain('How much did she earn in total');
    expect(brief).toContain('#### 12');
    expect(brief).toContain('unchanged if it already stands correct, corrected if it does not');
    expect(brief).toContain('the answer alone');
  });

  test('the quotes are bounded — a huge task cannot inflate the re-read', () => {
    const hugeTask = `${'x'.repeat(VERIFY_TASK_CHARS + 5000)}\n#### 5`;
    const hugeDraft = 'y'.repeat(VERIFY_DRAFT_CHARS + 5000);
    const brief = verifyBrief(hugeTask, hugeDraft);
    expect(brief.length).toBeLessThan(VERIFY_TASK_CHARS + VERIFY_DRAFT_CHARS + 1000);
    expect(brief).toContain('…');
  });

  test('degenerate input still composes a well-formed brief', () => {
    const brief = verifyBrief(null, undefined);
    expect(brief).toContain('THE TASK ASKED:');
    expect(brief).toContain('YOUR ANSWER AS IT STANDS:');
  });
});

describe('verifyEngaged — declared-only', () => {
  test('engages only on the declared connection', () => {
    expect(verifyEngaged({ _answerVerify: true })).toBe(true);
    expect(verifyEngaged({})).toBe(false);
    expect(verifyEngaged(null)).toBe(false);
    expect(verifyEngaged({ _answerVerify: 1 })).toBe(false);
  });
});
