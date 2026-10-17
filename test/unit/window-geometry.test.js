/**
 * Tests for the pure window geometry math
 * (frontend/app/windowing/geometry.js): clamp, move, resize from every
 * edge/corner, min-size pinning, bounds clipping, maximize, default.
 */

import { describe, expect, test } from 'vitest';
import {
  MIN,
  clampRect,
  moveRect,
  resizeRect,
  maxRect,
  defaultRect,
  insetBounds,
} from '../../frontend/app/windowing/geometry.js';

const BOUNDS = { x: 0, y: 0, w: 1000, h: 800 };

describe('window geometry', () => {
  test('clampRect pulls an out-of-bounds rect back inside', () => {
    expect(clampRect({ x: -50, y: -50, w: 400, h: 300 }, BOUNDS)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(clampRect({ x: 900, y: 700, w: 400, h: 300 }, BOUNDS)).toEqual({ x: 600, y: 500, w: 400, h: 300 });
  });

  test('clampRect enforces min and max size', () => {
    expect(clampRect({ x: 0, y: 0, w: 10, h: 10 }, BOUNDS)).toMatchObject({ w: MIN.w, h: MIN.h });
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, BOUNDS)).toMatchObject({ w: 1000, h: 800 });
  });

  test('moveRect translates then clamps', () => {
    expect(moveRect({ x: 100, y: 100, w: 400, h: 300 }, 50, -30, BOUNDS)).toEqual({ x: 150, y: 70, w: 400, h: 300 });
    // can't move past the right/bottom edge
    expect(moveRect({ x: 600, y: 500, w: 400, h: 300 }, 200, 200, BOUNDS)).toEqual({ x: 600, y: 500, w: 400, h: 300 });
  });

  test('resizeRect grows/shrinks from the correct edge', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    expect(resizeRect(r, 'e', 50, 0, BOUNDS)).toEqual({ x: 100, y: 100, w: 450, h: 300 });
    expect(resizeRect(r, 's', 0, 50, BOUNDS)).toEqual({ x: 100, y: 100, w: 400, h: 350 });
    expect(resizeRect(r, 'w', 50, 0, BOUNDS)).toEqual({ x: 150, y: 100, w: 350, h: 300 });
    expect(resizeRect(r, 'n', 0, 50, BOUNDS)).toEqual({ x: 100, y: 150, w: 400, h: 250 });
  });

  test('resizeRect corner moves both axes', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    expect(resizeRect(r, 'se', 60, 40, BOUNDS)).toEqual({ x: 100, y: 100, w: 460, h: 340 });
    expect(resizeRect(r, 'nw', -60, -40, BOUNDS)).toEqual({ x: 40, y: 60, w: 460, h: 340 });
  });

  test('resizeRect pins the moving edge at min size', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    // east shrink below min just clamps width
    expect(resizeRect(r, 'e', -200, 0, BOUNDS)).toMatchObject({ x: 100, w: MIN.w });
    // west shrink below min pins x so the right edge holds
    expect(resizeRect(r, 'w', 200, 0, BOUNDS)).toMatchObject({ x: 100 + 400 - MIN.w, w: MIN.w });
  });

  test('resizeRect clips growth to bounds', () => {
    const r = { x: 100, y: 100, w: 400, h: 300 };
    expect(resizeRect(r, 'e', 700, 0, BOUNDS)).toEqual({ x: 100, y: 100, w: 900, h: 300 });
  });

  test('maxRect fills the bounds; defaultRect centres within them', () => {
    expect(maxRect(BOUNDS)).toEqual(BOUNDS);
    const d = defaultRect(BOUNDS);
    expect(d.x).toBeCloseTo((BOUNDS.w - d.w) / 2);
    expect(d.y).toBeCloseTo((BOUNDS.h - d.h) / 2);
    expect(d.w).toBeLessThanOrEqual(BOUNDS.w);
  });
});

// insetBounds — the Explorer-panel-aware bounds derivation (Wave 3): the
// window region's box (a flex child beside the panel) shrunk by the inset.
describe('insetBounds', () => {
  const INSET = { top: 52, right: 12, bottom: 68, left: 12 };

  test('derives snap bounds from a region box (panel-aware left edge)', () => {
    expect(insetBounds({ x: 300, y: 0, w: 1000, h: 800 }, INSET))
      .toEqual({ x: 312, y: 52, w: 976, h: 680 });
  });

  test('a viewport-shaped box reproduces the legacy viewport bounds exactly', () => {
    expect(insetBounds({ x: 0, y: 0, w: 1280, h: 720 }, INSET))
      .toEqual({ x: 12, y: 52, w: 1256, h: 600 });
  });

  test('floors at MIN when the region is smaller than its insets', () => {
    expect(insetBounds({ x: 0, y: 0, w: 20, h: 20 }, INSET)).toMatchObject({ w: MIN.w, h: MIN.h });
  });
});
