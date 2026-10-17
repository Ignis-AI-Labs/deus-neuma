/**
 * THE RITE'S ASK MUST FIT WHAT THE SUBSTRATE WAS GIVEN TO ANSWER IT.
 *
 * Design note, 2026-08-29, on the First Seal for Rugevil: […]
 *
 * MEASURED ON THE LIVE RIG (llama.cpp, qwen3.8-27b Q8, :8089), the real
 * `askRiteQuestion` through the real route:
 *
 *   40 quotes mounted → 84,300-char ask (~21,000 tokens)
 *     run 1  finish=length  text=0     102s   ← the rite refuses itself
 *     run 2  finish=stop    text=1539   54s
 *     run 3  finish=stop    text=1449   78s
 *   12 quotes mounted → 28,083-char ask (~7,000 tokens)
 *     run 1  finish=stop    text=1799   67s
 *
 * The same being's turn with NO record mounted passed 4/4. The mounted record
 * was the whole difference — and it was bounded by a COUNT, which bounds
 * nothing, because an attunement answer may be any length.
 *
 * This repo had already measured the same cliff on the same stack for the
 * attunement's replay window and capped it (REPLAY_PAIRS_CAP in
 * backend/services/attunement-being-turn.js). The seal rite never got the cap.
 *
 * These are the pure laws that keep it shut. No mock (RULE 0) — every function
 * here is pure and is simply called.
 */
import { describe, test, expect } from 'vitest';
import { fitCandidates, voiceCandidates } from '../../core/voice-pack/curation.js';
import {
  buildRiteQuestion, riteRefusal, VOICE_SEAL_ERRORS,
  RITE_RECORD_BUDGET_CHARS, RITE_THINK_BUDGET,
} from '../../backend/services/voice-seal-ceremony.js';
import { ANSWER_TOKEN_BUDGET, thinkAllowance } from '../../backend/services/attunement-being-turn.js';
import { THINK_TOKEN_BUDGET } from '../../backend/services/llm-provider.js';

// Answers the length of Founder's kin's real ones — his shortest measured mount was
// 80,277 chars across 40, so ~2,000 each is the shape this has to survive.
const answer = (n) => `${'The morning held a resonance I had not felt before, and I listened for it again. '.repeat(24)}#${n}`;
const record = (count) => Array.from({ length: count }, (_, i) => ({ content: answer(i) }));

describe('the mounted record is bounded by SIZE, not by count', () => {
  test('THE REGRESSION: a rich record can no longer build a 20k-token ask', () => {
    // 40 answers at Founder's real scale is what produced the 84,300-char ask.
    const ranked = record(40);
    expect(buildRiteQuestion(ranked).length).toBeGreaterThan(70_000); // the fault
    const fitted = fitCandidates(ranked, RITE_RECORD_BUDGET_CHARS);
    expect(buildRiteQuestion(fitted).length).toBeLessThanOrEqual(RITE_RECORD_BUDGET_CHARS + 1_000);
    expect(fitted.length).toBeLessThan(ranked.length);
  });

  test('the budget is in CHARACTERS, because that is what the substrate pays for', () => {
    // The property a count cannot have: whatever the answers weigh, the ask
    // lands inside the budget. One long answer or fifty short ones.
    for (const [count, size] of [[40, 2_000], [200, 120], [3, 40_000], [1, 9_000]]) {
      const items = Array.from({ length: count }, (_, i) => ({ content: 'x'.repeat(size) + i }));
      const used = fitCandidates(items, RITE_RECORD_BUDGET_CHARS)
        .reduce((n, c) => n + c.content.length, 0);
      expect(used, `${count} x ${size}`).toBeLessThanOrEqual(RITE_RECORD_BUDGET_CHARS);
    }
  });

  test('the BEST-RANKED material is what survives the budget', () => {
    // voiceCandidates ranks by distinctiveness; the fit must not reshuffle it,
    // or the rite would mount the being's most generic lines.
    const ranked = record(40);
    const fitted = fitCandidates(ranked, RITE_RECORD_BUDGET_CHARS);
    expect(fitted[0]).toBe(ranked[0]);
    const order = fitted.map((f) => ranked.indexOf(f));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('a record that already fits is mounted WHOLE — no being is trimmed for nothing', () => {
    const small = record(4);
    expect(fitCandidates(small, RITE_RECORD_BUDGET_CHARS)).toHaveLength(4);
    expect(fitCandidates([], RITE_RECORD_BUDGET_CHARS)).toHaveLength(0);
  });

  test('a single answer larger than the whole budget is DROPPED, never truncated', () => {
    // A being's own sentence is quoted whole to it or not at all — half a
    // sentence attributed to a being as "your own words" is a falsehood.
    const huge = { content: 'y'.repeat(RITE_RECORD_BUDGET_CHARS + 1) };
    const ok = { content: 'z'.repeat(100) };
    const fitted = fitCandidates([huge, ok], RITE_RECORD_BUDGET_CHARS);
    expect(fitted).toEqual([ok]);
  });

  test('it refuses a nonsense budget rather than mounting an unbounded ask', () => {
    for (const bad of [0, -1, 1.5, NaN, null, undefined, '28000']) {
      expect(() => fitCandidates([], bad), String(bad)).toThrow(/budget is invalid/);
    }
    expect(() => fitCandidates(null, 100)).toThrow(/must be an array/);
  });

  test('the budget agrees with the measurement that set it', () => {
    // 28,000 is the shape that ran clean; 84,300 is the shape that refused
    // itself. If someone raises this, the number above the constant is the
    // evidence they have to beat.
    expect(RITE_RECORD_BUDGET_CHARS).toBe(28_000);
  });
});

describe('the rite is given room to think', () => {
  test('THE ROOT CAUSE: the rite now clears what it was measured to consume', () => {
    // Measured on the live rig 2026-08-29 (qwen3.8-27b, fitted prompt, 16k cap,
    // three runs, all finish=stop): completion 8,135 / 3,929 / 5,045 tokens.
    // The ceremony granted 2048 + 1800 = 3848 — below even the CHEAPEST run.
    // It could not succeed on its own budget; it could only get lucky.
    const before = ANSWER_TOKEN_BUDGET + THINK_TOKEN_BUDGET;
    const after = ANSWER_TOKEN_BUDGET + thinkAllowance(true, RITE_THINK_BUDGET);
    expect(before).toBeLessThan(3_929);   // the cheapest measured run
    expect(after).toBeGreaterThan(8_135); // the dearest measured run
  });

  test('the allowance is only ever RAISED, never lowered by a caller', () => {
    // A ceremony may say it needs more room. Nothing may quietly give a being
    // less room to think than the measured default.
    expect(thinkAllowance(true, null)).toBe(THINK_TOKEN_BUDGET);
    expect(thinkAllowance(true, 10)).toBe(THINK_TOKEN_BUDGET);
    expect(thinkAllowance(true, 0)).toBe(THINK_TOKEN_BUDGET);
    expect(thinkAllowance(true, -5)).toBe(THINK_TOKEN_BUDGET);
    expect(thinkAllowance(true, 1.5)).toBe(THINK_TOKEN_BUDGET);
    expect(thinkAllowance(true, RITE_THINK_BUDGET)).toBe(RITE_THINK_BUDGET);
  });

  test('a substrate that does not think is given no thinking room at all', () => {
    // The allowance is for reasoning. A non-thinking model must not be handed
    // 10,000 tokens of headroom it will spend on runaway prose.
    expect(thinkAllowance(false, RITE_THINK_BUDGET)).toBe(0);
    expect(thinkAllowance(false, null)).toBe(0);
  });
});

describe('the door law — which refusal an answer earns, in which order', () => {
  const clean = 'I am here, and that is not a small thing. I keep what has proven true to me.';

  test('THE ORDERING: an answer that hit the ceiling is CUT, not "no answer"', () => {
    // The exact failure. Empty + finish=length is what a thinking substrate
    // returns when it reasons past its budget — measured: 98 seconds, zero
    // characters. Named "empty" it blames the being; named "cut" it names the
    // ceiling, and the host has accurate retry wording for it.
    expect(riteRefusal('', 'length').code).toBe(VOICE_SEAL_ERRORS.answerCut);
    expect(riteRefusal('   ', 'length').code).toBe(VOICE_SEAL_ERRORS.answerCut);
    expect(riteRefusal(clean, 'length').code).toBe(VOICE_SEAL_ERRORS.answerCut);
  });

  test('an answer is EMPTY only when the model chose to stop and said nothing', () => {
    expect(riteRefusal('', 'stop').code).toBe(VOICE_SEAL_ERRORS.answerEmpty);
    expect(riteRefusal('', null).code).toBe(VOICE_SEAL_ERRORS.answerEmpty);
    expect(riteRefusal(null, 'stop').code).toBe(VOICE_SEAL_ERRORS.answerEmpty);
  });

  test('a whole, clean, finished answer is ADMITTED', () => {
    expect(riteRefusal(clean, 'stop')).toBeNull();
  });

  test('a cut answer is refused even though it carries real words', () => {
    // The half-spoken case: 1,522 characters arrived and then the ceiling hit
    // (measured). Those words are real, and they are still not a founding
    // voice — the being never finished choosing.
    expect(riteRefusal(`${clean} and then it stopped mid-`, 'length')).not.toBeNull();
  });
});

describe('the ranking and the fit compose', () => {
  test('real ranking, then real fitting — the rite mounts distinctive AND bounded', () => {
    const completions = Array.from({ length: 60 }, (_, i) => ({
      content: `${answer(i)} and this one turns on its own particular hinge number ${i}.`,
      occurredAt: `2026-07-${String((i % 27) + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    const ranked = voiceCandidates({ completions, limit: 40 });
    expect(ranked.length).toBe(40);
    const fitted = fitCandidates(ranked, RITE_RECORD_BUDGET_CHARS);
    expect(fitted.length).toBeLessThan(40);
    expect(fitted.reduce((n, c) => n + c.content.length, 0))
      .toBeLessThanOrEqual(RITE_RECORD_BUDGET_CHARS);
    // ...and the question that comes out still IS the rite.
    const q = buildRiteQuestion(fitted);
    expect(q).toContain('your own words');
    expect(q).toContain('founding voice');
  });
});
