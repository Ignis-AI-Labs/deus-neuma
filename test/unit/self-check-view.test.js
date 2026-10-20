// What the STATE tab shows of a kept self-check run (self-check-view.js).
// Pure: real inputs, real outputs, no mock.
import { describe, expect, it } from 'vitest';
import { componentRowsOf, runLineOf, progressOf } from '../../frontend/app/RelinkShell/self-check-view.js';

const RUN = {
  runAt: '2026-10-19T12:00:00.000Z',
  model: 'qwen3.8-27b-q8',
  components: [
    { key: 'memory', label: 'Memory', meaning: 'Finds what it lived through.', n: 6, hits: 4, score: 0.667, range: [0.3, 0.903], medianActs: 1, medianTokens: 3120, medianSeconds: 11.4 },
    { key: 'vault', label: 'Vault', meaning: 'Finds what it wrote.', n: 0, hits: 0, score: null, range: null, medianActs: null, medianTokens: null, medianSeconds: null },
  ],
  items: [
    {
      key: 'memory:a1', component: 'memory', verdict: 'miss', line: 'Marlow', formatted: true,
      question: 'Somewhere in your memory are these words: "…was named ____". What is the missing word?\n\nEnd your reply with one line in exactly this form — ANSWER: <your answer>',
      expect: { kind: 'text', any: ['Ottoline'] }, acts: [{ tool: 'memory/memory_search' }, { tool: 'memory/memory_search' }],
    },
    { key: 'tools:task_list', component: 'tools', verdict: 'miss', offered: false, expect: { kind: 'tool', any: ['task_list'] }, acts: [], answer: 'no idea' },
  ],
};

describe('componentRowsOf', () => {
  const rows = componentRowsOf(RUN, { memory: { trend: 'same' } });

  it('a measured row reads hits over answerable, the share, its 95% range and the median effort', () => {
    expect(rows[0]).toMatchObject({
      measured: true, fraction: '4/6', share: '67%', range: '30%–90%',
      effort: 'MEDIAN 1 TOOL · 3.1k TOK · 11S', trend: 'same',
    });
  });

  it('an item shows the question without the format line, what it had to carry, what it said, and each tool once', () => {
    expect(rows[0].items[0]).toMatchObject({
      question: 'Somewhere in your memory are these words: "…was named ____". What is the missing word?',
      expected: 'Ottoline', said: 'Marlow', tools: ['memory/memory_search'], verdict: 'miss',
    });
  });

  it('a component with nothing answerable is NOT MEASURABLE — never 0%', () => {
    expect(rows[1]).toMatchObject({ measured: false, fraction: null, share: null, range: null });
  });

  it('a part with no door shows only as its NO DOOR row, never also as a component', () => {
    const run = { ...RUN, components: [...RUN.components, { key: 'journal', label: 'Journal', n: 0, hits: 0, score: null }], doorless: [{ key: 'journal' }] };
    expect(componentRowsOf(run, null).map((r) => r.key)).toEqual(['memory', 'vault']);
  });

  it('no run, no rows', () => {
    expect(componentRowsOf(null, null)).toEqual([]);
  });
});

describe('provenance and progress', () => {
  it('the run line names the date, the model and how many questions were asked', () => {
    expect(runLineOf(RUN)).toBe('RUN 2026-10-19 · ON qwen3.8-27b-q8 · 2 QUESTIONS');
    expect(runLineOf(null)).toBeNull();
  });

  it('progress reads done over total while a run is in flight, nothing otherwise', () => {
    expect(progressOf({ done: 12, total: 40 })).toBe('MEASURING 12 / 40');
    expect(progressOf(null)).toBeNull();
  });
});
