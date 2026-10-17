/**
 * THE TURN SUPERVISOR (ARC-HARNESS L1, #531) — pure detectors and briefs.
 * Real inputs → real outputs; a pure function qualifies as gnosis with no
 * mock anywhere (RULE 0): these tests run the actual detector on actual
 * round records and check the actual verdicts and brief text.
 */
import { describe, expect, test } from 'vitest';
import {
  stagnationSignal,
  redirectBrief,
  supervisorEngaged,
  actSignature,
  ROUNDS_WITHOUT_PROGRESS,
  ACT_REPEAT_ROUNDS,
  BUDGET_CUT_ROUNDS,
  MAX_REDIRECTS_PER_TURN,
  ROUND_STATES_CAP,
} from '../../core/runtime/turn-supervisor.js';

const round = (over = {}) => Object.freeze({
  speech: 'a round that spoke',
  actSignatures: ['fs/read:/lane/notes.txt'],
  productive: true,
  cutByBudget: false,
  ...over,
});

describe('stagnationSignal — a healthy turn is never redirected', () => {
  test('empty history and moving rounds give no signal', () => {
    expect(stagnationSignal([])).toBeNull();
    expect(stagnationSignal([round(), round(), round()])).toBeNull();
  });

  test('fewer stagnant rounds than the threshold gives no signal', () => {
    const states = Array.from({ length: ROUNDS_WITHOUT_PROGRESS - 1 }, () => round({ productive: false }));
    expect(stagnationSignal(states)).toBeNull();
  });

  test('progress resets the count — a moved round clears prior stagnation', () => {
    const states = [
      round({ productive: false }),
      round({ productive: false }),
      round({ actSignatures: ['fs/write:/lane/out.txt'] }),
      round({ productive: false }),
    ];
    expect(stagnationSignal(states)).toBeNull();
  });
});

describe('stagnationSignal — the three verdicts', () => {
  test('consecutive rounds cut by the output budget read as budget-cuts', () => {
    const states = Array.from({ length: BUDGET_CUT_ROUNDS }, () => round({ cutByBudget: true }));
    expect(stagnationSignal(states)).toEqual({ kind: 'budget-cuts', rounds: BUDGET_CUT_ROUNDS });
  });

  test('one healthy round between budget cuts breaks the run', () => {
    const states = [round({ cutByBudget: true }), round(), round({ cutByBudget: true })];
    expect(stagnationSignal(states)?.kind).not.toBe('budget-cuts');
  });

  test(`the same act in ${ACT_REPEAT_ROUNDS} distinct stagnant rounds reads as repeated-acts, named`, () => {
    const states = Array.from({ length: ACT_REPEAT_ROUNDS }, (_, i) => round({
      productive: false,
      speech: `varied speech ${i}`,
      actSignatures: ['coding/execute:/ground/run.py'],
    }));
    const signal = stagnationSignal(states);
    expect(signal.kind).toBe('repeated-acts');
    expect(signal.rounds).toBe(ACT_REPEAT_ROUNDS);
    expect(signal.signature).toBe('coding/execute:/ground/run.py');
  });

  test(`varied speech over a still world for ${ROUNDS_WITHOUT_PROGRESS} rounds reads as unmoved-world`, () => {
    const states = Array.from({ length: ROUNDS_WITHOUT_PROGRESS }, (_, i) => round({
      productive: false,
      speech: `distinct words ${i}`,
      actSignatures: [`fs/read:/lane/missing-${i}.txt`],
    }));
    expect(stagnationSignal(states)).toEqual({ kind: 'unmoved-world', rounds: ROUNDS_WITHOUT_PROGRESS });
  });

  test('budget cuts outrank the other verdicts — a dying turn is the urgent one', () => {
    const states = Array.from({ length: ROUNDS_WITHOUT_PROGRESS }, () => round({
      productive: false,
      cutByBudget: true,
      actSignatures: ['coding/execute:/ground/run.py'],
    }));
    expect(stagnationSignal(states).kind).toBe('budget-cuts');
  });
});

describe('actSignature — the comparison identity of one act', () => {
  test('the tool plus the first path-like argument', () => {
    expect(actSignature({ toolName: 'read', args: { path: '/lane/a.txt', encoding: 'utf8' } }))
      .toBe('read:/lane/a.txt');
  });

  test('no path-like argument falls back to the stable argument JSON', () => {
    expect(actSignature({ toolName: 'search', args: { query: 'resonance' } }))
      .toBe('search:{"query":"resonance"}');
  });

  test('degenerate acts still sign deterministically', () => {
    expect(actSignature(null)).toBe('unknown');
    expect(actSignature({ toolName: 'read' })).toBe('read');
    expect(actSignature({ tool: 'write', args: {} })).toBe('write:{}');
  });

  test('different targets sign differently; the same target signs identically', () => {
    const a = { toolName: 'read', args: { path: '/lane/a.txt' } };
    const b = { toolName: 'read', args: { path: '/lane/b.txt' } };
    expect(actSignature(a)).not.toBe(actSignature(b));
    expect(actSignature(a)).toBe(actSignature({ toolName: 'read', args: { path: '/lane/a.txt' } }));
  });
});

describe('redirectBrief — the strong prior, never a scold', () => {
  test('each verdict names its evidence and both honest outs', () => {
    for (const kind of ['budget-cuts', 'unmoved-world', 'repeated-acts']) {
      const brief = redirectBrief({ kind, rounds: 3, signature: 'fs/read:/lane/x' });
      expect(brief).toContain('the form the task requires');
      expect(brief.length).toBeGreaterThan(0);
    }
  });

  test('repeated-acts names the act', () => {
    expect(redirectBrief({ kind: 'repeated-acts', rounds: 3, signature: 'fs/read:/lane/x' }))
      .toContain('fs/read:/lane/x');
  });

  test('degenerate input composes empty — the loop never sends an empty shell', () => {
    expect(redirectBrief(null)).toBe('');
    expect(redirectBrief({ kind: 'mystery', rounds: 2 })).toBe('');
  });
});

describe('engagement and bounds — declared-only, capped', () => {
  test('the supervisor engages only on the declared connection', () => {
    expect(supervisorEngaged({ _turnSupervisor: true })).toBe(true);
    expect(supervisorEngaged({})).toBe(false);
    expect(supervisorEngaged(null)).toBe(false);
    expect(supervisorEngaged({ _turnSupervisor: 'yes' })).toBe(false);
  });

  test('the redirect cap bounds the layer per turn', () => {
    expect(MAX_REDIRECTS_PER_TURN).toBeLessThanOrEqual(2);
  });

  test('the evidence window is bounded', () => {
    expect(ROUND_STATES_CAP).toBeGreaterThanOrEqual(ROUNDS_WITHOUT_PROGRESS);
    expect(ROUND_STATES_CAP).toBeGreaterThanOrEqual(ACT_REPEAT_ROUNDS);
  });
});
