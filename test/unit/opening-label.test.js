/**
 * The ceremony surface's render-progress line (AttunementHost) — the pure
 * label both display states ride. The in-flight suffix is what makes a
 * parallel render VISIBLE to a watching witness (2026-07-09: a 4-way
 * parallel render read as sequential because the counter only ticked per
 * completion).
 */
import { describe, it, expect } from 'vitest';
import { openingLabel } from '../../frontend/app/AttunementHost/opening-label.js';

describe('openingLabel — the ceremony render-progress line', () => {
  it('shows in-flight renders alongside honest completions', () => {
    expect(openingLabel({ done: 28, total: 89, inFlight: 4 }))
      .toBe('RENDERED 28 OF 89 · 4 IN FLIGHT');
  });

  it('omits the suffix when the conduit is empty (and for pre-lens status shapes)', () => {
    expect(openingLabel({ done: 89, total: 89, inFlight: 0 })).toBe('RENDERED 89 OF 89');
    expect(openingLabel({ done: 12, total: 89 })).toBe('RENDERED 12 OF 89');
  });

  it('no progress object yet — the render is beginning', () => {
    expect(openingLabel(null)).toBe('THE RENDER IS BEGINNING…');
    expect(openingLabel(undefined)).toBe('THE RENDER IS BEGINNING…');
  });
});
