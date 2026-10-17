// bench-proof-view.test.js — the proof panel's progress display law, proven
// pure (RULE 0): elapsed/pace/ETA math with an injected clock, the section
// meaning lines, the NOW ANSWERING truncation, the LAST line, and the
// non-running states that must render nothing. Plus the panel rendered for
// real (react-dom/server) over the runner's own state shape.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SECTION_MEANING, sectionMeaning, elapsedText, paceLine, nowAnsweringLine, lastItemLine,
} from '../../frontend/app/RelinkShell/bench-proof-view.js';
import { BenchProof } from '../../frontend/app/RelinkShell/BenchProof.jsx';

const T0 = Date.parse('2026-09-24T10:00:00.000Z');
const running = (over = {}) => ({
  state: 'running',
  runId: 'r-1',
  startedAt: new Date(T0).toISOString(),
  done: 4,
  total: 43,
  section: 'arithmetic',
  itemId: 'gsm8k-04',
  itemStartedAt: new Date(T0 + 90000).toISOString(), // the current item is 10s in flight
  itemPrompt: 'Answer this grade-school math word problem. Reason step by step, then end your reply with a final line of exactly "#### N" where N is the final numeric answer (digits only — no commas, no units, no currency symbol).\n\nQuestion: A robe takes 2 bolts of blue fiber and half that much white fiber. How many bolts in total does it take?',
  lastItem: { id: 'gsm8k-03', pass: true, durationMs: 18000, detail: '3 (via ####)' },
  passCount: 3,
  ...over,
});
const NOW = T0 + 100000; // 100s into the run

describe('sectionMeaning — what the benchmark is providing, plainly', () => {
  it('each section teaches itself; unknown reads empty', () => {
    expect(sectionMeaning('arithmetic')).toBe(SECTION_MEANING.arithmetic);
    expect(sectionMeaning('arithmetic')).toContain('GSM8K');
    expect(sectionMeaning('instruction')).toContain('exact word counts');
    expect(sectionMeaning('format')).toContain('parse and schema');
    expect(sectionMeaning('nope')).toBe('');
    expect(sectionMeaning(undefined)).toBe('');
  });
});

describe('elapsedText — the honest clock', () => {
  it('M:SS under an hour, H:MM:SS past it, — for nonsense', () => {
    expect(elapsedText(0)).toBe('0:00');
    expect(elapsedText(92000)).toBe('1:32');
    expect(elapsedText(59999)).toBe('0:59');
    expect(elapsedText(60000)).toBe('1:00');
    expect(elapsedText(3725000)).toBe('1:02:05');
    expect(elapsedText(null)).toBe('—');
    expect(elapsedText(-5)).toBe('—');
  });
});

describe('paceLine — measured pace, honest ETA', () => {
  it('done=0 says MEASURING THE PACE instead of inventing one', () => {
    expect(paceLine(running({ done: 0, passCount: 0 }), NOW))
      .toBe('ELAPSED 1:40 — MEASURING THE PACE…');
  });

  it('pace = elapsed/done; ETA = pace × remaining + the in-flight item', () => {
    // 100s elapsed, 4 done → 25s/item; 39 remain → 975s + 10s in flight.
    expect(paceLine(running(), NOW)).toBe('ELAPSED 1:40 · PACE ~25S/ITEM · ETA ~16 MIN');
  });

  it('the last item: ETA is the in-flight time only', () => {
    const run = running({ done: 42, itemStartedAt: new Date(NOW - 30000).toISOString() });
    // pace = 100000/42 ≈ 2381ms → ~2S; remaining 1 → eta ≈ 2381 + 30000 ≈ 32s
    expect(paceLine(run, NOW)).toContain('ETA ~32S');
  });

  it('not running reads empty — no stale pace on a settled run', () => {
    expect(paceLine({ state: 'done' }, NOW)).toBe('');
    expect(paceLine({ state: 'failed', error: 'x' }, NOW)).toBe('');
    expect(paceLine(null, NOW)).toBe('');
    expect(paceLine(running({ startedAt: 'garbage' }), NOW)).toBe('');
  });
});

describe('nowAnsweringLine / lastItemLine', () => {
  it('NOW ANSWERING carries the item id and the QUESTION excerpt (≤140 + …)', () => {
    const line = nowAnsweringLine(running());
    expect(line).toContain('NOW ANSWERING: GSM8K-04 — “');
    // The arithmetic template's preamble is skipped — the QUESTION leads.
    expect(line.startsWith('NOW ANSWERING: GSM8K-04 — “A robe takes 2 bolts')).toBe(true);
    const excerpt = line.split('— “')[1].replace(/…”$/, '');
    expect(excerpt.length).toBeLessThanOrEqual(140);
    // A non-template prompt shows the raw text; short text rides whole.
    const raw = running({ itemPrompt: 'List exactly 4 planets of the solar system as a numbered list ("1. Mercury" style), one per line. — padded past the cut to force the truncation to prove itself here' });
    const rawLine = nowAnsweringLine(raw);
    expect(rawLine).toContain('List exactly 4 planets');
    expect(rawLine.endsWith('…”')).toBe(true);
    const short = running({ itemPrompt: 'short prompt' });
    expect(nowAnsweringLine(short)).toBe('NOW ANSWERING: GSM8K-04 — “short prompt”');
    expect(nowAnsweringLine({ state: 'done' })).toBe('');
    expect(nowAnsweringLine({ state: 'running' })).toBe('');
  });

  it('LAST reads the last verdict, or nothing before the first', () => {
    expect(lastItemLine(running())).toBe('LAST: GSM8K-03 PASS (0:18)');
    expect(lastItemLine(running({ lastItem: { id: 'format-answer', pass: false, durationMs: 2500 } })))
      .toBe('LAST: FORMAT-ANSWER FAIL (0:02)');
    expect(lastItemLine(running({ lastItem: null }))).toBe('');
    expect(lastItemLine(null)).toBe('');
  });
});

describe('BenchProof — the live progress block, rendered for real', () => {
  const base = {
    status: {
      serving: { ok: true, models: ['qwen3.8-27b'] },
      gpu: { ok: true, name: 'NVIDIA RTX PRO 6000', utilizationPercent: 12, memoryUsedMiB: 59000 },
    },
    run: null, confirm: false, busy: false, refusal: null,
    onAsk: () => {}, onCancel: () => {}, onRun: () => {}, nowMs: NOW,
  };

  it('a running run renders meaning, pace, the current item, and the last verdict', () => {
    const html = renderToStaticMarkup(createElement(BenchProof, { ...base, run: running() }));
    expect(html).toContain('25 real grade-school math problems (GSM8K, verbatim)');
    expect(html).toContain('ELAPSED 1:40 · PACE ~25S/ITEM · ETA ~16 MIN');
    expect(html).toContain('NOW ANSWERING: GSM8K-04');
    expect(html).toContain('A robe takes 2 bolts of blue fiber');
    expect(html).toContain('LAST: GSM8K-03 PASS (0:18)');
    expect(html).toContain('3 PASS SO FAR');
  });

  it('before the first verdict: MEASURING THE PACE; settled runs render no pace', () => {
    const fresh = renderToStaticMarkup(createElement(BenchProof, {
      ...base, run: running({ done: 0, passCount: 0, lastItem: null }),
    }));
    expect(fresh).toContain('MEASURING THE PACE…');
    expect(fresh).not.toContain('PACE ~');
    const done = renderToStaticMarkup(createElement(BenchProof, {
      ...base, run: { state: 'done', verdict: { pass: 42, total: 43 }, proofId: 'p-1' },
    }));
    expect(done).toContain('DONE — 42/43 PASS');
    expect(done).not.toContain('ETA');
  });
});
