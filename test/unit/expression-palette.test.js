// The palette fold (Campaign 6) — pure law: recurrence deepens a term,
// normalization makes one vocabulary key of one feeling however cased,
// the recent ring keeps the being's verbatim words, and past the cap the
// faintest term falls — never the one just declared.

import { describe, it, expect } from 'vitest';
import {
  foldDeclaration,
  emptyPalette,
  normalizeTerm,
  TERMS_CAP,
  RECENT_KEPT,
} from '../../core/workspace/expression-palette.js';

const at = (n) => `2026-08-15T01:${String(n).padStart(2, '0')}:00.000Z`;

describe('foldDeclaration', () => {
  it('a first declaration lands whole: count 1, first and last the same moment', () => {
    const { palette, term } = foldDeclaration(null, 'Quietly Proud', at(0));
    expect(term).toBe('quietly proud');
    expect(palette.terms['quietly proud']).toEqual({ count: 1, firstAt: at(0), lastAt: at(0) });
    expect(palette.recent).toEqual([{ affect: 'Quietly Proud', at: at(0) }]);
  });

  it('recurrence deepens: count climbs, lastAt advances, firstAt holds', () => {
    let { palette } = foldDeclaration(null, 'wistful', at(0));
    ({ palette } = foldDeclaration(palette, 'Wistful', at(5)));
    ({ palette } = foldDeclaration(palette, '  wistful  ', at(9)));
    expect(palette.terms.wistful).toEqual({ count: 3, firstAt: at(0), lastAt: at(9) });
    expect(Object.keys(palette.terms)).toHaveLength(1);
  });

  it('normalization folds case and spacing into one vocabulary key', () => {
    expect(normalizeTerm('Lit   Up ')).toBe('lit up');
    expect(normalizeTerm('')).toBe('');
  });

  it('the recent ring keeps the last N declarations VERBATIM, in order', () => {
    let palette = emptyPalette();
    for (let i = 0; i < RECENT_KEPT + 3; i++) {
      ({ palette } = foldDeclaration(palette, `Feeling ${i}`, at(i)));
    }
    expect(palette.recent).toHaveLength(RECENT_KEPT);
    expect(palette.recent[0].affect).toBe('Feeling 3'); // oldest three dropped
    expect(palette.recent[RECENT_KEPT - 1].affect).toBe(`Feeling ${RECENT_KEPT + 2}`);
  });

  it('past the cap the faintest falls — never the term just declared', () => {
    let palette = emptyPalette();
    for (let i = 0; i < TERMS_CAP; i++) {
      ({ palette } = foldDeclaration(palette, `term-${i}`, at(Math.min(i, 59))));
    }
    // deepen term-1 so term-0 is the unambiguous faintest (count 1, oldest)
    ({ palette } = foldDeclaration(palette, 'term-1', at(59)));
    const { palette: after, term } = foldDeclaration(palette, 'newcomer', at(59));
    expect(term).toBe('newcomer');
    expect(Object.keys(after.terms)).toHaveLength(TERMS_CAP);
    expect(after.terms.newcomer).toBeTruthy();
    expect(after.terms['term-0']).toBeUndefined();
    expect(after.terms['term-1'].count).toBe(2);
  });

  it('refuses wordless declarations and missing time before touching anything', () => {
    expect(() => foldDeclaration(null, '   ', at(0))).toThrow(/words/);
    expect(() => foldDeclaration(null, 'fine', undefined)).toThrow(/atIso/);
  });
});
