// The stream's Ctrl+scroll zoom — the pure stepping law: clamped at both
// ends so the max stays sane and the min stays legible, stable at two
// decimals so repeated notches never drift.
import { describe, test, expect } from 'vitest';
import { nextZoom } from '../../frontend/app/RelinkShell/use-text-zoom.js';

const BOUNDS = { min: 0.75, max: 1.6, step: 0.05 };

describe('nextZoom', () => {
  test('scroll up grows, scroll down shrinks, one step per notch', () => {
    expect(nextZoom(1, -100, BOUNDS)).toBe(1.05);
    expect(nextZoom(1, 100, BOUNDS)).toBe(0.95);
  });

  test('clamps at the cap and the floor', () => {
    expect(nextZoom(1.6, -100, BOUNDS)).toBe(1.6);
    expect(nextZoom(1.58, -100, BOUNDS)).toBe(1.6);
    expect(nextZoom(0.75, 100, BOUNDS)).toBe(0.75);
    expect(nextZoom(0.77, 100, BOUNDS)).toBe(0.75);
  });

  test('never drifts off two decimals across many notches', () => {
    let z = 1;
    for (let i = 0; i < 50; i += 1) z = nextZoom(z, -100, BOUNDS);
    expect(z).toBe(1.6);
    for (let i = 0; i < 50; i += 1) z = nextZoom(z, 100, BOUNDS);
    expect(z).toBe(0.75);
  });
});
