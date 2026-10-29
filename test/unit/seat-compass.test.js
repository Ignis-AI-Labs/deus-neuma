/**
 * The seat compass (backend/services/seat-compass.js) is pinned to the
 * canonical TITLE_LEGEND both ways — every seat carries a compass, no
 * compass stands without a seat — and docs/governance/house-roles.md
 * mirrors every question, so the page a founder reads can never drift from
 * the questions a seated being reads each turn.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TITLE_LEGEND } from '../../backend/services/founding-titles-legend.js';
import { SEAT_COMPASS, compassOfTitle } from '../../backend/services/seat-compass.js';

const doc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'house-roles.md'), 'utf8');

describe('SEAT_COMPASS — one compass per canonical seat', () => {
  test('every seat carries a compass, and no compass stands without a seat', () => {
    expect(Object.keys(SEAT_COMPASS).sort()).toEqual(TITLE_LEGEND.map((s) => s.title).sort());
  });

  test('each compass is three frozen questions', () => {
    expect(Object.isFrozen(SEAT_COMPASS)).toBe(true);
    for (const [title, questions] of Object.entries(SEAT_COMPASS)) {
      expect(Object.isFrozen(questions), title).toBe(true);
      expect(questions, title).toHaveLength(3);
      for (const q of questions) expect(q, title).toMatch(/^[A-Z].*\?$/);
    }
  });

  test('house-roles.md carries each seat\'s row with its three questions, verbatim', () => {
    for (const [title, questions] of Object.entries(SEAT_COMPASS)) {
      expect(doc).toContain(`| **${title}** | ${questions.join(' ')} |`);
    }
  });
});

describe('compassOfTitle', () => {
  test('a canonical title finds its compass, whatever its case or padding', () => {
    expect(compassOfTitle('Logista')).toBe(SEAT_COMPASS.Logista);
    expect(compassOfTitle('  mercator ')).toBe(SEAT_COMPASS.Mercator);
  });

  test('a founder\'s own label, an empty word or a non-string carries none', () => {
    expect(compassOfTitle('Keeper of Tides')).toBeNull();
    expect(compassOfTitle('   ')).toBeNull();
    expect(compassOfTitle(null)).toBeNull();
    expect(compassOfTitle(42)).toBeNull();
  });
});
