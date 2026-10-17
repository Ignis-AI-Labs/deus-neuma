// bench-arm-contract.test.js — pillar 1 of #552 on the NEUMA side (#554):
// under benchmark controls the NEUMA arm gets the format echo ONLY when the
// cell declares it (as HARNESS/SILO do), and every extra model call behind
// one answer is counted. Real functions, real inputs — no mocks.

import { describe, it, expect } from 'vitest';
import { formatEchoTurn } from '../../backend/services/portal-turn-input.js';
import { recordBenchmarkExtraCall } from '../../backend/services/benchmark-extra-calls.js';
import { TASK_FORMAT_ECHO } from '../../core/runtime/answer-covenant.js';

// The few-shot shape that self-engages the echo (the benchmark-format-echo
// integration test's own task).
const DEMONSTRATED = [
  'Question: Natalie has 3 apples and buys 4 more. How many?',
  'Answer: 3 + 4 = 7',
  '#### 7',
  '',
  'Question: A train runs 60 km/h for 2 hours. How far?',
  'Answer: 60 * 2 = 120',
  '#### 120',
  '',
  'Question: A sprinter runs 9 m/s for 3 seconds. How far?',
].join('\n');

const CONTROLS = Object.freeze({ baseWeightsOnly: true, sampling: Object.freeze({ seed: 7, temperature: 0, topP: 1, maxTokens: 512 }) });

describe('formatEchoTurn — the arm contract', () => {
  it('a live sitting still self-engages on a demonstrated format', () => {
    const connection = {};
    expect(formatEchoTurn(connection, DEMONSTRATED)).toEqual([{ role: 'user', content: TASK_FORMAT_ECHO }]);
    expect(connection._formatEchoSource).toBe('task-demonstrated');
  });

  it('a benchmark sitting never self-engages — no other arm gets an undeclared echo', () => {
    const connection = { _benchmarkControls: CONTROLS };
    expect(formatEchoTurn(connection, DEMONSTRATED)).toEqual([]);
    expect(connection._formatEchoSource).toBeUndefined();
  });

  it('a benchmark sitting carries the echo when the cell declares it (every arm then does)', () => {
    const connection = { _benchmarkControls: CONTROLS, _benchmarkFormatEcho: true };
    expect(formatEchoTurn(connection, 'Question: any task at all?')).toEqual([{ role: 'user', content: TASK_FORMAT_ECHO }]);
    expect(connection._formatEchoSource).toBe('declared');
  });
});

describe('recordBenchmarkExtraCall — every extra call is counted', () => {
  it('counts each recovery on a benchmark sitting, in order', () => {
    const connection = { _benchmarkControls: CONTROLS };
    recordBenchmarkExtraCall(connection, 'speechless', 'The answer is 27.');
    recordBenchmarkExtraCall(connection, 'budget-cut', '#### 27');
    expect(connection._benchmarkExtraCalls).toEqual([
      { kind: 'speechless', chars: 17 },
      { kind: 'budget-cut', chars: 7 },
    ]);
  });

  it('records nothing outside a benchmark sitting', () => {
    const connection = {};
    recordBenchmarkExtraCall(connection, 'budget-cut', 'anything');
    expect(connection._benchmarkExtraCalls).toBeUndefined();
  });

  it('a recovery that closes a cut thought records its tail and how much of it repeats (2026-10-03)', async () => {
    const { recordBenchmarkExtraCall, repetitionShare } = await import('../../backend/services/benchmark-extra-calls.js');
    const loop = 'The answer is B because the pronoun refers to the trophy. '.repeat(200);
    const fresh = Array.from({ length: 300 }, (_, i) => `step ${i}: weigh option ${i * 7 % 13} against ${i * 11 % 17}.`).join(' ');
    expect(repetitionShare(loop)).toBeGreaterThan(0.9);
    expect(repetitionShare(fresh)).toBeLessThan(0.2);
    expect(repetitionShare('short')).toBe(0);
    const connection = { _benchmarkControls: {} };
    recordBenchmarkExtraCall(connection, 'speechless', 'B', loop);
    recordBenchmarkExtraCall(connection, 'round-cap', 'done');
    const [closed, plain] = connection._benchmarkExtraCalls;
    expect(closed).toMatchObject({ kind: 'speechless', chars: 1, reasoningChars: loop.length });
    expect(closed.reasoningTail).toBe(loop.slice(-1200));
    expect(closed.repetition).toBeGreaterThan(0.9);
    expect(plain).toEqual({ kind: 'round-cap', chars: 4 });
  });
});
