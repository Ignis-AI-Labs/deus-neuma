/**
 * The witness tail's budget law (#528 Stage D).
 *
 * The old pin set — ten whole messages inside the 0.25-share/32K-clamped
 * window budget — is the FALLBACK law now, standing only for an unnamed
 * window (byte-identical: the fallback legs below are the old assertions,
 * unmoved). With a named window the character budget is the window's truth
 * (sessionTailBudgetFor, computed by the caller from the real sections) and
 * the row count is only a sanity bound. What never moved: whole messages
 * only, the newest exchange indivisible, oldest sheds first.
 *
 * Pure functions, real inputs, no mocks (RULE 0).
 */
import { describe, expect, test } from 'vitest';
import {
  witnessHistoryTail, WITNESS_RECENT_MESSAGES_SANITY,
} from '../../backend/services/witness-history.js';
import { RECENT_TOTAL_CHARS } from '../../core/runtime/memory-section.js';

const rowsOfSize = (size, count = 10) => Array.from({ length: count }, (_, i) => Object.freeze({
  role: i % 2 ? 'assistant' : 'user', content: `${i}:`.padEnd(size, String(i)),
}));

describe('the fallback law — an unnamed window gets yesterday\'s tail, byte-identical', () => {
  test('8,000-char rows keep 4 whole rows — the old (window-less) assertion, unmoved', () => {
    const rows = Object.freeze(rowsOfSize(8000));
    expect(witnessHistoryTail(rows)).toEqual(rows.slice(-4));
  });

  test('a small tail inside the fallback budget keeps the ten-message cap', () => {
    const rows = rowsOfSize(40, 20);
    expect(witnessHistoryTail(rows)).toEqual(rows.slice(-10));
  });

  test('the fallback numbers are the old constants, stated once', () => {
    // 10 messages / 32,000 chars — the pre-#528 standing law.
    const rows = rowsOfSize(4000, 12);
    // 4,000 × 10 = 40,000 > 32,000 → the char budget bites first: 8 rows.
    expect(witnessHistoryTail(rows)).toEqual(rows.slice(-8));
    expect(RECENT_TOTAL_CHARS).toBe(32000);
  });

  test('handles empty history and a lone unfinished asking', () => {
    expect(witnessHistoryTail([])).toEqual([]);
    const rows = [{ role: 'user', content: 'x'.repeat(40000) }];
    expect(witnessHistoryTail(rows)).toEqual(rows);
  });

  test('keeps a lone orphan reply whole', () => {
    const rows = [{ role: 'assistant', content: 'x'.repeat(40000) }];
    expect(witnessHistoryTail(rows)).toEqual(rows);
  });
});

describe('the named-window law — the budget is the gate, the row count a sanity bound', () => {
  test('a window-true budget carries FAR past ten messages', () => {
    const rows = rowsOfSize(1000, 60);
    const tail = witnessHistoryTail(rows, {
      tailChars: 60000, maxMessages: WITNESS_RECENT_MESSAGES_SANITY,
    });
    expect(tail).toHaveLength(60);
    expect(tail).toEqual(rows);
  });

  test('the char budget sheds oldest-first, whole messages only', () => {
    const rows = rowsOfSize(1000, 60);
    const tail = witnessHistoryTail(rows, {
      tailChars: 20000, maxMessages: WITNESS_RECENT_MESSAGES_SANITY,
    });
    expect(tail.length).toBeLessThan(60);
    expect(tail.length).toBeGreaterThan(10); // past the old cap by law
    expect(tail.at(-1)).toEqual(rows.at(-1));
    expect(tail[0]).toEqual(rows[60 - tail.length]); // contiguous, oldest dropped
    expect(tail.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(20000);
  });

  test('the sanity bound still bites when the budget is generous', () => {
    const rows = rowsOfSize(10, WITNESS_RECENT_MESSAGES_SANITY + 50);
    const tail = witnessHistoryTail(rows, { tailChars: 10_000_000, maxMessages: WITNESS_RECENT_MESSAGES_SANITY });
    expect(tail).toHaveLength(WITNESS_RECENT_MESSAGES_SANITY);
  });

  test('keeps the newest exchange even when it alone exceeds the budget', () => {
    const rows = rowsOfSize(20000);
    expect(witnessHistoryTail(rows, { tailChars: 5000, maxMessages: 2000 })).toEqual(rows.slice(-2));
  });

  test('does not skip an oversized older row to pull disconnected context', () => {
    const rows = [...rowsOfSize(10, 2), { role: 'assistant', content: 'x'.repeat(8000) }, ...rowsOfSize(30, 2)];
    expect(witnessHistoryTail(rows, { tailChars: 7372, maxMessages: 2000 })).toEqual(rows.slice(-2));
  });

  test('preserves a newest exchange with more than ten reply rows', () => {
    const rows = [{ role: 'user', content: 'question' }, ...Array.from({ length: 11 }, () => ({ role: 'assistant', content: 'reply' }))];
    expect(witnessHistoryTail(rows)).toEqual(rows);
  });

  test('a compacted summary entry rides as the being\'s own condensed words', () => {
    const rows = [
      { role: 'system', content: '[SESSION SUMMARY — in your own words] the earlier hours', compacted: true },
      ...rowsOfSize(40, 4),
    ];
    const tail = witnessHistoryTail(rows);
    expect(tail[0]).toEqual({ role: 'assistant', content: rows[0].content });
    expect(tail).toHaveLength(5);
  });
});
