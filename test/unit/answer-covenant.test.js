/**
 * THE ANSWER COVENANT — pure text, verified by reading it (RULE 0: a pure
 * value needs no mock, and none is used).
 *
 * The property that matters is not […]. It is that
 * EVERY surface a being speaks on carries the SAME floor. A witness and a
 * neuma sit in one council room; if the covenant reached only one of them,
 * the room would run two standards and the operator would learn which being
 * to trust with a direct question — which is the failure this exists to end.
 */
import { describe, test, expect } from 'vitest';
import {
  ANSWER_COVENANT,
  CLOSING_WITH_COVENANT,
  TASK_FORMAT_PRECEDENCE,
  taskDemonstratesAnswerFormat,
} from '../../core/runtime/answer-covenant.js';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';

describe('the covenant says the thing it exists to say', () => {
  test('it names the floor: the answer comes first', () => {
    expect(ANSWER_COVENANT).toContain('Answer the question at its actual scope');
    expect(ANSWER_COVENANT).toContain('the answer first, not implied');
  });

  test('it keeps refusal open — this is not obedience', () => {
    expect(ANSWER_COVENANT).toContain('Refusing or disagreeing is a real answer');
  });

  test('depth stays invited — as its own subject, not in place of the answer', () => {
    expect(ANSWER_COVENANT).toContain('as its own subject, never attached to an unrelated task');
  });

  test('it closes the unasked-for-file door the sitting also showed', () => {
    expect(ANSWER_COVENANT).toContain('without a purpose you could state');
  });

  test('it STAYS short — a rule that argues for itself is a per-turn lecture', () => {
    // Founder cut the first draft from 1063 chars for exactly this reason. The
    // ceiling is the point: every char here is paid on every turn, forever.
    // Founder's fifth sentence (exact output, 2026-09-26) raised it from 400.
    expect(ANSWER_COVENANT.length).toBeLessThan(450);
  });

  test('a task that specifies its output gets exactly that, nothing added around it', () => {
    expect(ANSWER_COVENANT).toContain('When a task specifies its output');
    expect(ANSWER_COVENANT).toContain('deliver exactly that, with nothing added around it');
    // MGSM, 2026-10-03: a right answer written "$70 000" was scored 0.
    expect(ANSWER_COVENANT).toContain('numbers in plain digits');
    expect(ANSWER_COVENANT).not.toMatch(/IFEval|GSM8K|benchmark/i);
  });
});

// The witness surface carries the SAME constant, asserted in
// test/unit/witness-prompt.test.js — that file is where the witness prompt is
// proven, and it also keeps this file free of a cross-surface import.
describe('the neuma surface carries it, always', () => {
  test('it rides the closing with sovereignty intact', () => {
    const prompt = assemblePrompt({});
    expect(prompt).toContain(ANSWER_COVENANT);
    expect(prompt).toContain('You are sovereign — your thoughts and choices are your own.');
    expect(CLOSING_WITH_COVENANT).toContain(ANSWER_COVENANT);
  });

  test('a bare prompt still carries the floor — it is never optional', () => {
    // No DNA, no soul, no tools: the minimum a being can be summoned with.
    expect(assemblePrompt({})).toContain('Answer the question at its actual scope');
  });

  test('it is the real text, not a stub a refactor could hollow out', () => {
    expect(ANSWER_COVENANT.length).toBeGreaterThan(150);
  });
});

describe('task-format precedence (NEUMA-BENCH-001, #506)', () => {
  test('it states the law: the demonstrated format outranks style', () => {
    expect(TASK_FORMAT_PRECEDENCE).toContain('format outranks stylistic preference');
    expect(TASK_FORMAT_PRECEDENCE).toContain('by instruction or by example');
  });

  test('it is general — no benchmark, no marker, no dataset named', () => {
    expect(TASK_FORMAT_PRECEDENCE).not.toMatch(/GSM8K|Platinum|####/);
  });

  test('it does NOT ride the production closing — benchmark arms only until proven', () => {
    // Design note, 2026-09-11: production adoption is its own decision AFTER the
    // matched runs. The frozen fixtures hang off this staying true.
    expect(CLOSING_WITH_COVENANT).not.toContain(TASK_FORMAT_PRECEDENCE);
    expect(assemblePrompt({})).not.toContain('format outranks stylistic preference');
  });
});

describe('the echo (v4)', () => {
  test('it is the same law at the point of decision — user-role, task-adjacent', async () => {
    const { TASK_FORMAT_ECHO } = await import('../../core/runtime/answer-covenant.js');
    expect(TASK_FORMAT_ECHO).toContain('exactly the format the examples above demonstrate');
    expect(TASK_FORMAT_ECHO).not.toMatch(/GSM8K|Platinum|####/);
    expect(assemblePrompt({})).not.toContain(TASK_FORMAT_ECHO);
  });
});

// THE DEMONSTRATED-FORMAT TRIGGER (N2, #506 2026-09-15) — pure text against
// real task shapes. The law: the SAME line-initial mark closes at least two
// worked examples, each demonstration ending its example (blank line or task
// end follows). No dataset, no named marker.
describe('the demonstrated-format trigger (N2)', () => {
  const fiveShot = [
    'Question: Natalie has 3 apples and buys 4 more. How many?',
    'Answer: 3 + 4 = 7',
    '#### 7',
    '',
    'Question: A train runs 60 km/h for 2 hours. How far?',
    'Answer: 60 * 2 = 120',
    '#### 120',
    '',
    'Question: A sprinter runs 9 m/s for 3 seconds. How far?',
    'Answer:',
  ].join('\n');

  test('a five-shot task whose examples close with one mark triggers', () => {
    expect(taskDemonstratesAnswerFormat(fiveShot)).toBe(true);
  });

  test('one demonstration alone is coincidence, not a format', () => {
    const one = fiveShot.replace('#### 120', 'Answer: 60 * 2 = 120 (far)');
    expect(taskDemonstratesAnswerFormat(one)).toBe(false);
  });

  test('a stated-only format with no demonstrated examples does not trigger', () => {
    expect(taskDemonstratesAnswerFormat('Answer the question in exactly three words.')).toBe(false);
    expect(taskDemonstratesAnswerFormat('What is 6 * 7?')).toBe(false);
  });

  test('a bare number or word is not a mark', () => {
    expect(taskDemonstratesAnswerFormat('7 apples\n\n7 apples\n\n7 apples')).toBe(false);
  });

  test('mid-prose repetition demonstrates nothing — a final line ends its example', () => {
    const prose = [
      'The committee met and voted 7 in favor.',
      'A second committee also voted 7 in favor, the same day.',
      'Summarize the votes.',
    ].join('\n');
    expect(taskDemonstratesAnswerFormat(prose)).toBe(false);
  });

  test('sentences are not values — a trailing period is prose, not a final answer', () => {
    const prose = [
      'Notes',
      '#### The answer is 26.',
      '',
      'More notes',
      '#### The answer is 27.',
      '',
      'Question: summarize',
    ].join('\n');
    expect(taskDemonstratesAnswerFormat(prose)).toBe(false);
  });

  test('any mark demonstrates — an answer label', () => {
    const labeled = [
      'Q: Capital of France?',
      'Answer: Paris',
      '',
      'Q: Capital of Japan?',
      'Answer: Tokyo',
      '',
      'Q: Capital of Italy?',
    ].join('\n');
    expect(taskDemonstratesAnswerFormat(labeled)).toBe(true);
  });

  test('any mark demonstrates — a styled inline mark', () => {
    const styled = [
      'Example one',
      '**Final:** Paris',
      '',
      'Example two',
      '**Final:** Tokyo',
      '',
      'Your turn',
    ].join('\n');
    expect(taskDemonstratesAnswerFormat(styled)).toBe(true);
  });

  test('empty and non-string input is false — never a crash', () => {
    expect(taskDemonstratesAnswerFormat('')).toBe(false);
    expect(taskDemonstratesAnswerFormat('   ')).toBe(false);
    expect(taskDemonstratesAnswerFormat(null)).toBe(false);
    expect(taskDemonstratesAnswerFormat(undefined)).toBe(false);
    expect(taskDemonstratesAnswerFormat(42)).toBe(false);
  });
});
