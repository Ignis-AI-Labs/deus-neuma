/**
 * The FIELD's pure lens: presence/community filters (dim, never remove) and
 * the zoom/pan math the SVG viewBox renders. Proven directly with real node
 * shapes — no React, no DOM (D1, RULE 0).
 */

import { describe, test, expect } from 'vitest';
import {
  ZOOM_MIN, ZOOM_MAX, clampZoom, initialView, viewBoxOf, zoomBy, panBy, applyFieldLens, renderedBaseScale,
} from '../../frontend/app/RelinkShell/context-field-lens.js';

const NODES = [
  { id: 'a', presences: ['Founder', 'Fenna'], communityIndex: 0 },
  { id: 'b', presences: ['Fenna'], communityIndex: 1 },
  { id: 'c', communityIndex: 0 },
];

describe('applyFieldLens — dim, never remove', () => {
  test('no filters: everything lit, lens inactive', () => {
    const out = applyFieldLens(NODES, { presence: null, community: null });
    expect(out.active).toBe(false);
    expect(out.shown).toBe(3);
    expect([...out.lit].sort()).toEqual(['a', 'b', 'c']);
  });

  test('a presence lights only the memories that speak of it — case-insensitively', () => {
    const out = applyFieldLens(NODES, { presence: 'fenna', community: null });
    expect(out.active).toBe(true);
    expect([...out.lit].sort()).toEqual(['a', 'b']);
    expect(out.total).toBe(3);
  });

  test('a community lights its members; presence AND community compose', () => {
    expect([...applyFieldLens(NODES, { presence: null, community: 0 }).lit].sort()).toEqual(['a', 'c']);
    expect([...applyFieldLens(NODES, { presence: 'Founder', community: 0 }).lit]).toEqual(['a']);
    expect(applyFieldLens(NODES, { presence: 'Founder', community: 1 }).shown).toBe(0);
  });

  test('nodes without presence tags never match a presence filter', () => {
    expect(applyFieldLens(NODES, { presence: 'Founder', community: null }).lit.has('c')).toBe(false);
  });

  test('malformed filters and tags degrade, never throw (echo r1)', () => {
    expect(applyFieldLens(NODES, { presence: 42, community: 'x' }).active).toBe(false);
    const dirty = [{ id: 'd', presences: ['Founder', 7, null], communityIndex: 0 }];
    expect([...applyFieldLens(dirty, { presence: 'founder', community: null }).lit]).toEqual(['d']);
  });

  test('non-array nodes and rotten elements degrade too — the lens NEVER throws (echo r2)', () => {
    expect(applyFieldLens('not-an-array', { presence: 'Founder' }).total).toBe(0);
    const rotten = [null, 7, { id: null, presences: ['Founder'] }, { id: 'ok', presences: ['Founder'], communityIndex: 0 }];
    const out = applyFieldLens(rotten, { presence: 'founder', community: null });
    expect([...out.lit]).toEqual(['ok']);
    expect(out.total).toBe(4); // the honest count of what arrived
  });
});

describe('the zoom/pan math', () => {
  test('clampZoom holds the honest range; junk reads as 1', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });

  test('the identity view boxes the whole field', () => {
    expect(viewBoxOf(400, 300, initialView(400, 300))).toBe('0 0 400 300');
  });

  test('non-finite dimensions read as zero — the viewBox never carries NaN (echo r2)', () => {
    expect(viewBoxOf(NaN, undefined, initialView(NaN, undefined))).toBe('0 0 0 0');
    const v = initialView('w', null);
    expect(Number.isFinite(v.cx) && Number.isFinite(v.cy)).toBe(true);
  });

  test('zooming in halves the window around the same center', () => {
    const v = zoomBy(initialView(400, 300), 2);
    expect(viewBoxOf(400, 300, v)).toBe('100 75 200 150');
  });

  test('panning follows the pointer scaled by zoom — a drag at 2× moves half the world distance', () => {
    const v = panBy(zoomBy(initialView(400, 300), 2), 40, -20);
    expect(v.cx).toBe(200 - 20);
    expect(v.cy).toBe(150 + 10);
  });

  test('panBy and zoomBy normalize a malformed view — no NaN ever leaves (echo r1)', () => {
    const v = panBy(null, 10, 10);
    expect(Number.isFinite(v.cx) && Number.isFinite(v.cy) && Number.isFinite(v.zoom)).toBe(true);
    const z = zoomBy({ zoom: 'x', cx: NaN }, NaN);
    expect(Number.isFinite(z.zoom) && Number.isFinite(z.cx) && Number.isFinite(z.cy)).toBe(true);
  });

  test('zoomBy composes and clamps; a malformed view still renders a finite box', () => {
    const v = zoomBy(zoomBy(initialView(100, 100), 4), 4);
    expect(v.zoom).toBe(ZOOM_MAX);
    expect(viewBoxOf(100, 100, { zoom: 'x' })).toBe('0 0 100 100');
  });
});

describe('renderedBaseScale — screen px per world unit of the CSS-sized SVG', () => {
  test('the tighter ratio wins (preserveAspectRatio meet letterboxes)', () => {
    // Stage 800×400, world 200×200: height is the constraint → 2 px/unit.
    expect(renderedBaseScale(800, 400, 200, 200)).toBe(2);
    // Stage 300×900, world 100×300: width constrains → 3 px/unit.
    expect(renderedBaseScale(300, 900, 100, 300)).toBe(3);
  });

  test('a drag through the scale follows the pointer: px / scale = world units', () => {
    const s = renderedBaseScale(1000, 500, 100, 100); // 5 px per unit
    const view = panBy(initialView(100, 100), 40 / s, 0); // a 40 px drag
    expect(view.cx).toBe(50 - 8); // 40 px ÷ 5 px/unit = 8 world units
  });

  test('degenerate boxes read as 1 — never Infinity or NaN into a pan', () => {
    expect(renderedBaseScale(0, 0, 200, 200)).toBe(1);       // collapsed stage
    expect(renderedBaseScale(NaN, 400, 200, 200)).toBe(1);   // unmounted rect
    expect(renderedBaseScale(800, 400, 0, 200)).toBe(1);     // empty world
    expect(renderedBaseScale(800, 400, NaN, NaN)).toBe(1);
    expect(renderedBaseScale(-800, 400, 200, 200)).toBe(1);  // rotten rect
  });
});
