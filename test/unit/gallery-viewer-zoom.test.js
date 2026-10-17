/**
 * THE ROOM's lens law — how a work hangs and how close the operator may lean.
 * Real functions, real numbers, no mock (RULE 0).
 *
 * The invariant worth guarding is the one that makes a viewer feel like glass
 * rather than a slider: whatever is under the cursor when the wheel turns is
 * still under the cursor when it stops.
 */
import { describe, test, expect } from 'vitest';
import {
  FIT, MAX_DISPLAY, fitRatio, zoomCeiling, displayPercent, wheelFactor,
  panLimit, clampView, sameView, zoomAbout, panBy, leanIn, transformOf,
} from '../../frontend/app/RelinkShell/gallery/viewer-zoom.js';

// A 1600×1200 work hung at 800×600 in an 800×600 frame — shown at half its
// own resolution, which is the ordinary case for a forge render on a desk.
const geom = {
  base: { w: 800, h: 600 },
  natural: { w: 1600, h: 1200 },
  frame: { w: 800, h: 600 },
};

describe('fitRatio — how much of the work the hang is actually showing', () => {
  test('half size when the frame can only take half', () => {
    expect(fitRatio(geom.base, geom.natural)).toBe(0.5);
  });

  test('1 when the work is hung at its own pixels', () => {
    expect(fitRatio({ w: 512, h: 512 }, { w: 512, h: 512 })).toBe(1);
  });

  test('falls back to 1 rather than dividing by an unmeasured box', () => {
    expect(fitRatio({ w: 0, h: 0 }, { w: 512, h: 512 })).toBe(1);
    expect(fitRatio({ w: 512, h: 512 }, null)).toBe(1);
  });
});

describe('the ceiling', () => {
  test('stops at MAX_DISPLAY times the work\'s own pixels, not of the hang', () => {
    // Hung at half, so eight times the file is sixteen times the hang.
    expect(zoomCeiling(geom.base, geom.natural)).toBe(16);
    const at = zoomAbout(FIT, 1000, { x: 0, y: 0 }, geom);
    expect(at.zoom).toBe(16);
    expect(displayPercent(geom.base, geom.natural, at.zoom)).toBe(MAX_DISPLAY * 100);
  });

  test('never falls below the hang — a work already at full size cannot shrink', () => {
    const small = { base: { w: 300, h: 300 }, natural: { w: 300, h: 300 }, frame: { w: 800, h: 600 } };
    expect(zoomCeiling(small.base, small.natural)).toBe(MAX_DISPLAY);
    expect(zoomAbout(FIT, 0.01, { x: 0, y: 0 }, small).zoom).toBe(1);
  });
});

describe('displayPercent — percent of the WORK, never of the frame', () => {
  test('reads the hang honestly', () => {
    expect(displayPercent(geom.base, geom.natural, 1)).toBe(50);
  });

  test('100% is one file pixel per screen pixel', () => {
    expect(displayPercent(geom.base, geom.natural, 2)).toBe(100);
  });
});

describe('wheelFactor', () => {
  test('up leans in, down leans out', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
  });

  test('is multiplicative — a notch each way returns where it started', () => {
    expect(wheelFactor(-120) * wheelFactor(120)).toBeCloseTo(1, 12);
  });

  test('line and page deltas are normalized, not taken as pixels', () => {
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0), 12);
    expect(wheelFactor(1, 2)).toBeCloseTo(wheelFactor(400, 0), 12);
  });

  test('a flung trackpad cannot teleport to the ceiling in one event', () => {
    expect(wheelFactor(-100000)).toBe(wheelFactor(-600));
    expect(wheelFactor(100000)).toBe(wheelFactor(600));
  });
});

describe('zoomAbout — the point under the cursor stays under the cursor', () => {
  // Where a point of the hung image sits on screen, measured from the frame's
  // centre: offset + (point from image centre) × zoom. Invert it and the
  // question […] has one answer.
  const under = (view, cursor) => (cursor - view.x) / view.zoom;

  test('holds while leaning in on an off-centre detail', () => {
    const cursor = { x: 220, y: -140 };
    const before = under(FIT, cursor.x);
    const after = zoomAbout(FIT, 2, cursor, geom);
    expect(after.zoom).toBe(2);
    expect(under(after, cursor.x)).toBeCloseTo(before, 10);
    expect((cursor.y - after.y) / after.zoom).toBeCloseTo((cursor.y - FIT.y) / FIT.zoom, 10);
  });

  test('holds across a chain of wheel events', () => {
    const cursor = { x: -90, y: 60 };
    let view = FIT;
    const before = under(view, cursor.x);
    for (let i = 0; i < 6; i += 1) view = zoomAbout(view, wheelFactor(-100), cursor, geom);
    expect(view.zoom).toBeGreaterThan(1);
    expect(under(view, cursor.x)).toBeCloseTo(before, 8);
  });

  test('zooming about the centre never slides the work', () => {
    const view = zoomAbout(FIT, 3, { x: 0, y: 0 }, geom);
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
  });
});

describe('pan', () => {
  test('a work that fits is pinned centred — it does not slide around', () => {
    expect(panLimit(geom.base, 1, geom.frame)).toEqual({ x: 0, y: 0 });
    const dragged = panBy(FIT, 300, 200, geom);
    expect(dragged).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  test('a leaned-in work drags to its own edge and no further', () => {
    expect(panLimit(geom.base, 2, geom.frame)).toEqual({ x: 400, y: 300 });
    const dragged = panBy({ zoom: 2, x: 0, y: 0 }, 9999, -9999, geom);
    expect(dragged).toEqual({ zoom: 2, x: 400, y: -300 });
  });

  test('an ordinary drag just moves', () => {
    expect(panBy({ zoom: 2, x: 10, y: 10 }, 25, -15, geom)).toEqual({ zoom: 2, x: 35, y: -5 });
  });
});

describe('clampView — what a resize does to a lean', () => {
  test('the lean survives; the pan is pulled back inside the new frame', () => {
    const leaned = { zoom: 2, x: 400, y: 300 };
    const narrower = { ...geom, base: { w: 400, h: 300 }, frame: { w: 400, h: 300 } };
    const after = clampView(leaned, narrower);
    expect(after.zoom).toBe(2);
    expect(after).toEqual({ zoom: 2, x: 200, y: 150 });
  });

  test('a frame that grew past the work re-centres it', () => {
    const wide = { ...geom, frame: { w: 4000, h: 3000 } };
    expect(clampView({ zoom: 1, x: 120, y: -80 }, wide)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  test('garbage in is a legal view out, never NaN', () => {
    const out = clampView({ zoom: undefined, x: NaN, y: 'x' }, { base: null, natural: null, frame: null });
    expect(out).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

describe('sameView — the contract that lets React bail out of a re-clamp', () => {
  test('true for an unchanged view, false for a moved one', () => {
    expect(sameView({ zoom: 2, x: 1, y: 2 }, { zoom: 2, x: 1, y: 2 })).toBe(true);
    expect(sameView({ zoom: 2, x: 1, y: 2 }, { zoom: 2, x: 1, y: 3 })).toBe(false);
  });

  test('a re-clamp that changes nothing reports nothing changed', () => {
    const view = { zoom: 2, x: 100, y: 50 };
    expect(sameView(view, clampView(view, geom))).toBe(true);
  });
});

describe('leanIn — what a double-click asks for', () => {
  test('the work\'s own pixels, 1:1', () => {
    expect(leanIn(geom)).toBe(2);
    expect(displayPercent(geom.base, geom.natural, leanIn(geom))).toBe(100);
  });

  test('a work already at full size gets a real magnification, not a no-op', () => {
    const full = { base: { w: 300, h: 300 }, natural: { w: 300, h: 300 }, frame: { w: 800, h: 600 } };
    expect(leanIn(full)).toBe(2);
  });

  test('never past the ceiling', () => {
    const tiny = { base: { w: 16, h: 16 }, natural: { w: 16, h: 16 }, frame: { w: 800, h: 600 } };
    expect(leanIn(tiny)).toBeLessThanOrEqual(zoomCeiling(tiny.base, tiny.natural));
  });
});

describe('transformOf', () => {
  test('slides after scaling about the centre', () => {
    expect(transformOf({ zoom: 2, x: 10, y: -5 })).toBe('translate(10px, -5px) scale(2)');
  });

  test('the hang is the identity transform', () => {
    expect(transformOf(FIT)).toBe('translate(0px, 0px) scale(1)');
  });
});
