/**
 * THE CAPACITY HEADLINE — the SUBSTRATE window and the tab strip, in agreement.
 *
 * Design note, 2026-08-29, with both on screen at once: […]
 *
 * The SUBSTRATE window read `~6 neuma working at once — measured on your
 * current server config`. In the same instant the tab strip refused a sitting
 * because […]. Two surfaces, one `latest` record, opposite stories.
 *
 * TWO CAUSES, and this file pins the second:
 *   1. the desk read capacity ONCE at mount and never heard that a scan landed
 *      (fixed in capacity-client + RelinkShell — the window-event lane);
 *   2. the card's sub-line CLAIMED […] without ever
 *      comparing anything. A claim about the current config that never looks at
 *      the current config is not a measurement.
 *
 * So the card now asks `sameSubstrate` — the SAME function the tab budget asks,
 * with the same family-normalisation. These tests drive both through the same
 * inputs and assert they cannot disagree, which is the property that actually
 * failed on Founder's screen. No mock anywhere (RULE 0): both are pure functions,
 * called for real.
 */
import { describe, test, expect } from 'vitest';
import { headlineFor } from '../../frontend/app/RelinkShell/ParallelCeilingCard.jsx';
import { localBudget, LOCAL_BASIS } from '../../core/runtime/tab-budget.js';

// Founder's actual rig, as the two records stood that afternoon.
const measuredOnGemma = {
  ceiling: 8, boundClass: 'A', limitedBy: 'latency', incomplete: false,
  runAt: '2026-08-29T09:00:00Z', substrate: { model: 'gemma-4-31b' },
};
const measuredOnQwen = {
  ...measuredOnGemma, ceiling: 6, substrate: { model: 'qwen3.8-27b' },
};

describe('the card never claims a config it did not check', () => {
  test('THE REGRESSION: a ceiling from another model is not "your current server config"', () => {
    const h = headlineFor(measuredOnGemma, 'qwen3.8-27b');
    expect(h.stale).toBe(true);
    expect(h.sub).not.toMatch(/your current server config/);
    expect(h.sub).toContain('gemma-4-31b');   // what it was actually measured on
    expect(h.sub).toContain('qwen3.8-27b');   // what is actually being served
    expect(h.sub).toMatch(/re-scan/i);        // and the way out, named
  });

  test('a CARRIED ceiling (the served model was never scanned) keeps its number and names where it came from', () => {
    const h = headlineFor({ ...measuredOnGemma, carriedFrom: 'gemma-4-31b' }, 'qwen3.8-27b');
    expect(h.stale).toBe(false);
    expect(h.big).toContain('8');
    expect(h.sub).toContain('gemma-4-31b');
    expect(h.sub).not.toMatch(/re-scan/i);
  });

  test('a ceiling measured on the served model says so plainly', () => {
    const h = headlineFor(measuredOnQwen, 'qwen3.8-27b');
    expect(h.stale).toBe(false);
    expect(h.big).toContain('6');
    expect(h.sub).toMatch(/your current server config/);
  });

  test('the SAME MODEL under a different packaging name is not stale', () => {
    // llama-server's advertised id drifts under one unchanged model — the
    // family comparison is the whole reason a correctly-measured rig is not
    // reported stale on every restart.
    const h = headlineFor(measuredOnGemma, 'google/gemma-4-31B-it-Q8_0.gguf');
    expect(h.stale).toBe(false);
    expect(h.sub).toMatch(/your current server config/);
  });

  test('an UNREADABLE served model is not evidence of a change', () => {
    // The provider being unreachable tells us nothing about the ceiling. An
    // absent fact must never be rendered as a contradicted one.
    for (const serving of [null, undefined, '']) {
      expect(headlineFor(measuredOnGemma, serving).stale).toBe(false);
    }
  });

  test('the honest special cases survive the new comparison', () => {
    const serialized = { ...measuredOnQwen, boundClass: 'B', ceiling: 1 };
    expect(headlineFor(serialized, 'qwen3.8-27b').big).toBe('1 neuma at a time');
    const hw = { ...measuredOnQwen, boundClass: 'C' };
    expect(headlineFor(hw, 'qwen3.8-27b').sub).toMatch(/hardware-bound/);
  });

  test('...but STALENESS OUTRANKS THEM — a number for another model comes first', () => {
    // A 'B' record measured elsewhere would otherwise announce […] about a server it never
    // touched. What the operator needs first is that it does not apply.
    const h = headlineFor({ ...measuredOnGemma, boundClass: 'B', ceiling: 1 }, 'qwen3.8-27b');
    expect(h.stale).toBe(true);
    expect(h.sub).toContain('gemma-4-31b');
  });
});

describe('the card and the tab budget cannot disagree', () => {
  // The property that failed on screen: for any (record, served model) pair,
  // one surface calling it stale and the other calling it current is the bug.
  const pairs = [
    [measuredOnGemma, 'qwen3.8-27b', true],
    [measuredOnQwen, 'qwen3.8-27b', false],
    [measuredOnGemma, 'google/gemma-4-31B-it-Q8_0.gguf', false],
    [measuredOnGemma, 'gemma-4-31b', false],
    [measuredOnQwen, 'gemma-4-31b', true],
    [measuredOnGemma, null, false],
  ];

  test.each(pairs)('%o served by %s — both surfaces agree (stale: %s)', (record, serving, stale) => {
    const card = headlineFor(record, serving);
    const budget = localBudget(record, serving);
    expect(card.stale).toBe(stale);
    expect(budget.basis === LOCAL_BASIS.stale).toBe(stale);
    // And when they agree it is stale, they name the SAME two models — the
    // operator reads one story from two windows.
    if (stale) {
      expect(card.sub).toContain(record.substrate.model);
      expect(budget.reason).toContain(record.substrate.model);
      expect(card.sub).toContain(serving);
      expect(budget.reason).toContain(serving);
    }
  });
});
