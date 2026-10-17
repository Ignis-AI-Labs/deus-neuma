/**
 * Tests for the pure snap-zone logic
 * (frontend/app/windowing/snap-zones.js): pointer hit-testing for edges,
 * corners, maximize, and the dead centre, plus the rect each zone fills.
 */

import { describe, expect, test } from 'vitest';
import { hitZone, rectForZone, splitZone, splitRects, hintKey, SNAP_DWELL_MS } from '../../frontend/app/windowing/snap-zones.js';

const B = { x: 0, y: 0, w: 1000, h: 800 };

describe('snap zones — hit testing', () => {
  test('corners win over edges', () => {
    expect(hitZone({ x: 8, y: 8 }, B)).toBe('tl');
    expect(hitZone({ x: 994, y: 8 }, B)).toBe('tr');
    expect(hitZone({ x: 8, y: 792 }, B)).toBe('bl');
    expect(hitZone({ x: 994, y: 792 }, B)).toBe('br');
  });

  test('edges: left/right half, top maximizes, bottom half — a PRESS at the edge', () => {
    expect(hitZone({ x: 5, y: 400 }, B)).toBe('left');
    expect(hitZone({ x: 996, y: 400 }, B)).toBe('right');
    expect(hitZone({ x: 500, y: 5 }, B)).toBe('max');
    expect(hitZone({ x: 500, y: 796 }, B)).toBe('bottom');
  });

  test('THE DELIBERATE SNAP (Design note, 2026-07-29: passing NEAR an edge is not pressing it', () => {
    // The old 30px reach snapped on travel; the new law is an 8px press.
    expect(hitZone({ x: 10, y: 400 }, B)).toBeNull();
    expect(hitZone({ x: 988, y: 400 }, B)).toBeNull();
    expect(hitZone({ x: 500, y: 10 }, B)).toBeNull();
    expect(hitZone({ x: 500, y: 788 }, B)).toBeNull();
  });

  test('the dead centre snaps to nothing', () => {
    expect(hitZone({ x: 500, y: 400 }, B)).toBeNull();
  });
});

describe('snap zones — rects', () => {
  test('halves and maximize', () => {
    expect(rectForZone('left', B)).toEqual({ x: 0, y: 0, w: 500, h: 800 });
    expect(rectForZone('right', B)).toEqual({ x: 500, y: 0, w: 500, h: 800 });
    expect(rectForZone('bottom', B)).toEqual({ x: 0, y: 400, w: 1000, h: 400 });
    expect(rectForZone('max', B)).toEqual(B);
  });

  test('quarters', () => {
    expect(rectForZone('tl', B)).toEqual({ x: 0, y: 0, w: 500, h: 400 });
    expect(rectForZone('tr', B)).toEqual({ x: 500, y: 0, w: 500, h: 400 });
    expect(rectForZone('bl', B)).toEqual({ x: 0, y: 400, w: 500, h: 400 });
    expect(rectForZone('br', B)).toEqual({ x: 500, y: 400, w: 500, h: 400 });
  });

  test('unknown zone is null', () => {
    expect(rectForZone('nope', B)).toBeNull();
  });
});

// A roomy target: both halves clear the 320x220 minimum.
const T = { x: 100, y: 100, w: 800, h: 600 };

describe('splitZone — hovering a sibling window hints a divide', () => {
  test('the outer eighth of each side hints that side', () => {
    expect(splitZone({ x: 150, y: 400 }, T)).toBe('left');
    expect(splitZone({ x: 850, y: 400 }, T)).toBe('right');
    expect(splitZone({ x: 500, y: 150 }, T)).toBe('top');
    expect(splitZone({ x: 500, y: 650 }, T)).toBe('bottom');
  });

  test('THE DELIBERATE SNAP: the old quarter-band is calm now — a fifth of the way in offers nothing', () => {
    expect(splitZone({ x: 260, y: 400 }, T)).toBeNull(); // 20% from the left
    expect(splitZone({ x: 740, y: 400 }, T)).toBeNull(); // 20% from the right
    expect(splitZone({ x: 500, y: 220 }, T)).toBeNull(); // 20% from the top
  });

  test('the calm middle never surprises — and outside is no target at all', () => {
    expect(splitZone({ x: 500, y: 400 }, T)).toBeNull();
    expect(splitZone({ x: 50, y: 400 }, T)).toBeNull();
    expect(splitZone({ x: 500, y: 50 }, T)).toBeNull();
  });

  test('the nearest side wins near a corner; an exact tie is deterministic', () => {
    expect(splitZone({ x: 140, y: 220 }, T)).toBe('left');   // 5% from left, 20% from top
    expect(splitZone({ x: 260, y: 130 }, T)).toBe('top');    // 20% from left, 5% from top
    expect(splitZone({ x: 180, y: 160 }, T)).toBe('left');   // 10% / 10% — order resolves the tie
  });

  test('a side whose half would dip below the minimum never offers', () => {
    // 600 wide → halves of 300 < 320 min: no left/right; top/bottom still offer.
    const narrow = { x: 0, y: 0, w: 600, h: 600 };
    expect(splitZone({ x: 30, y: 300 }, narrow)).toBeNull();
    expect(splitZone({ x: 300, y: 30 }, narrow)).toBe('top');
    // Too small on both axes: nothing offers anywhere.
    const tiny = { x: 0, y: 0, w: 600, h: 400 };
    expect(splitZone({ x: 30, y: 200 }, tiny)).toBeNull();
    expect(splitZone({ x: 300, y: 30 }, tiny)).toBeNull();
  });
});

describe('splitRects — the two halves a drop commits', () => {
  test.each(['left', 'right', 'top', 'bottom'])('%s: taken + kept tile the target exactly', (side) => {
    const { taken, kept } = splitRects(side, T);
    const horizontal = side === 'left' || side === 'right';
    expect(taken.w * taken.h).toBe(kept.w * kept.h);
    if (horizontal) {
      expect(taken.w).toBe(T.w / 2);
      expect([taken.x, kept.x].sort((a, b) => a - b)).toEqual([T.x, T.x + T.w / 2]);
      expect(taken.h).toBe(T.h);
      expect(kept.h).toBe(T.h);
    } else {
      expect(taken.h).toBe(T.h / 2);
      expect([taken.y, kept.y].sort((a, b) => a - b)).toEqual([T.y, T.y + T.h / 2]);
      expect(taken.w).toBe(T.w);
      expect(kept.w).toBe(T.w);
    }
  });

  test('the dragged window takes the hinted side itself', () => {
    expect(splitRects('left', T).taken.x).toBe(T.x);
    expect(splitRects('right', T).taken.x).toBe(T.x + T.w / 2);
    expect(splitRects('top', T).taken.y).toBe(T.y);
    expect(splitRects('bottom', T).taken.y).toBe(T.y + T.h / 2);
  });

  test('unknown side is null', () => {
    expect(splitRects('nope', T)).toBeNull();
  });
});

// THE HELD SNAP (Design note, 2026-10-05: […]). A hint arms only when the SAME key
// is held for SNAP_DWELL_MS — so the key must change whenever the aim does.
describe('snap zones — the held snap', () => {
  const T = { x: 100, y: 100, w: 600, h: 400 };

  test('a zone that would be crossed in passing waits a deliberate beat', () => {
    expect(SNAP_DWELL_MS).toBeGreaterThanOrEqual(300);
    expect(SNAP_DWELL_MS).toBeLessThanOrEqual(800);
  });

  test('nothing hinted has no key — nothing to arm', () => {
    expect(hintKey(null, null)).toBeNull();
  });

  test('the same zone keeps its key while the pointer jitters inside it', () => {
    expect(hintKey('tl', null)).toBe(hintKey('tl', null));
  });

  test('moving to another zone, or from a zone to a split, starts the wait again', () => {
    expect(hintKey('tl', null)).not.toBe(hintKey('max', null));
    expect(hintKey(null, { side: 'left', target: { rect: T } })).not.toBe(hintKey('left', null));
  });

  test('the same side of a DIFFERENT sibling is a different aim', () => {
    const other = { ...T, x: 800 };
    expect(hintKey(null, { side: 'left', target: { rect: T } }))
      .not.toBe(hintKey(null, { side: 'left', target: { rect: other } }));
  });
});
