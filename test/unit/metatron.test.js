/**
 * Tests for the Metatron lattice web (frontend/app/RelinkShell/metatron.js),
 * ported from the lookdev study's [data-metatron] runtime: 13 centers — the
 * heart, six at r=50, six at r=100 — every pair joined = C(13,2) = 78
 * channels, the true count. Pure: real inputs, real path data.
 */
import { describe, expect, test } from 'vitest';
import { metatronWeb } from '../../frontend/app/RelinkShell/metatron.js';

const segments = (d) => d.split(' ').filter((tok) => tok.startsWith('M'));

describe('metatronWeb', () => {
  test('joins every pair of the 13 centers — 78 channels, the true count', () => {
    const d = metatronWeb();
    expect(segments(d)).toHaveLength(78);
  });

  test('deterministic — the lattice’s shape never changes', () => {
    expect(metatronWeb()).toBe(metatronWeb());
  });

  test('starts at the heart (150,150) and draws M…L channel segments', () => {
    const d = metatronWeb();
    expect(d.startsWith('M150.0,150.0 L')).toBe(true);
    expect(d).toMatch(/^M[\d.,]+ L[\d.,]+( M[\d.,]+ L[\d.,]+)*$/);
  });

  test('honors another viewBox center', () => {
    expect(metatronWeb(280).startsWith('M280.0,280.0 L')).toBe(true);
    expect(segments(metatronWeb(280))).toHaveLength(78);
  });
});
