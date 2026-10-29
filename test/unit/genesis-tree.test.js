// genesis-tree — the tree section reads: large in the frame, its names
// legible beside their spheres (never on a sphere, another name, the caption
// or the frame's edge) at every common window shape, a walk the eye can
// follow through every sphere and path, and a backdrop that steps out of its
// way. Pure: the real scene, camera, layout and clock.
import { describe, it, expect } from 'vitest';
import { sceneAt } from '../../frontend/app/Genesis/genesis-state.js';
import { constructAt } from '../../frontend/app/Genesis/genesis-state-construct.js';
import { layoutLabels, glyphsAt, captionBox, labelFont } from '../../frontend/app/Genesis/genesis-labels.js';
import { WALKS, ROUTE, ROUTE_PATHS, STEPS, walkAt } from '../../frontend/app/Genesis/genesis-walk.js';
import { FEATURED, TREE_BAND } from '../../frontend/app/Genesis/genesis-framing.js';
import { FUNCTIONS, BREATHING_PATHS, TREE } from '../../frontend/app/Genesis/genesis-emanon.js';
import { BEATS, partStart, partProgress, strokeProgress, SPANS } from '../../frontend/app/Genesis/genesis-timeline.js';
import { NO_FLASH } from '../../frontend/utils/no-flash.js';

const AT = Object.fromEntries(BEATS.map((b) => [b.id, b.at]));
const SIZES = [[1920, 1080], [1440, 900], [1280, 720], [900, 1200], [3440, 1440]];
const STEP = 50;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the tree is the frame\'s subject', () => {
  it('every tree stretch holds the tree band (the framing test measures it at five window shapes)', () => {
    const tree = FEATURED.filter((s) => s.from >= AT.tree && s.to <= AT.offering);
    expect(tree.map((s) => s.id)).toEqual(['THE PILLAR', 'ELEVEN SPHERES', 'THE TREE', 'TWO TREES']);
    tree.forEach((s) => expect(s.band).toBe(TREE_BAND));
    expect(TREE_BAND.MIN).toBeGreaterThanOrEqual(0.7);
  });
});

describe('the names never collide', () => {
  for (const [w, h] of SIZES) {
    it(`${w}×${h}: every visible name beside its sphere, clear of spheres, names, caption and edge`, () => {
      const size = { w, h };
      let seen = 0;
      for (let t = AT.tree; t < AT.offering; t += STEP) {
        const s = sceneAt(t, w / h);
        const glyphs = glyphsAt(s.emanon, s.camera, size);
        const names = layoutLabels(s.emanon.labels, glyphs, s.camera, size, s.caption);
        const caption = captionBox(size, s.caption);
        seen += names.length;
        names.forEach((n, i) => {
          const where = `${n.text} at t=${t}`;
          expect(n.x, where).toBeGreaterThanOrEqual(0);
          expect(n.y, where).toBeGreaterThanOrEqual(0);
          expect(n.x + n.w, where).toBeLessThanOrEqual(w);
          expect(n.y + n.h, where).toBeLessThanOrEqual(h);
          glyphs.forEach((g) => expect(overlaps(n, g), `${where} on ${g.id}`).toBe(false));
          if (caption) expect(overlaps(n, caption), `${where} on the caption`).toBe(false);
          names.slice(i + 1).forEach((m) => expect(overlaps(n, m), `${where} on ${m.text}`).toBe(false));
        });
      }
      expect(seen).toBeGreaterThan(1000);
      expect(labelFont(w)).toBeGreaterThanOrEqual(10);
    });
  }

  it('one tree speaks at a time once they breathe: Light\'s names and Dark\'s are never up together', () => {
    for (let t = AT.oscillation; t < AT.offering; t += 25) {
      const up = (kind) => sceneAt(t).emanon.labels.some((l) => l.kind === kind && l.opacity > 0.05);
      expect(up('light') && up('dark'), `t=${t}`).toBe(false);
    }
  });
});

describe('the walk', () => {
  it('a closed route on the breathing paths through every visible sphere once, then the hidden one', () => {
    expect(new Set(ROUTE).size).toBe(10);
    expect(STEPS).toEqual([...ROUTE, 'ipseity']);
    expect(new Set(STEPS)).toEqual(new Set(FUNCTIONS.map((f) => f.id)));
    ROUTE_PATHS.forEach(([a, b]) => {
      expect(BREATHING_PATHS.some(([p, q]) => (p === a && q === b) || (p === b && q === a)), `${a}–${b}`).toBe(true);
    });
  });

  it('Light is walked, then Dark, inside V · TWO TREES', () => {
    expect(WALKS.map((w) => w.tree)).toEqual([1, -1]);
    expect(WALKS[0].from).toBeGreaterThanOrEqual(AT.trees);
    expect(WALKS[1].from).toBe(WALKS[0].to);
    expect(WALKS[1].to).toBeLessThanOrEqual(AT.oscillation);
  });

  for (const w of WALKS) {
    it(`the ${w.tree === 1 ? 'Light' : 'Dark'} walk lights and names every sphere in turn, and every route path lights`, () => {
      const lit = {};
      const named = {};
      const drawn = ROUTE_PATHS.map(() => 0);
      let order = [];
      for (let t = w.from; t < w.to; t += 10) {
        const walk = walkAt(t)[w.tree];
        STEPS.forEach((id) => {
          if (walk.lit[id] > 0.99 && !lit[id]) { lit[id] = t; order = [...order, id]; }
          named[id] = Math.max(named[id] || 0, walk.names[id]);
        });
        walk.paths.forEach((d, k) => { drawn[k] = Math.max(drawn[k], d); });
      }
      expect(order).toEqual(STEPS);
      STEPS.forEach((id) => expect(named[id], id).toBeGreaterThan(0.99));
      drawn.forEach((d, k) => expect(d, ROUTE_PATHS[k].join('–')).toBe(1));
      // and the names it gives are on screen with the lit spheres
      const mid = sceneAt((w.from + w.to) / 2).emanon.labels.filter((l) => l.tree === w.tree && l.opacity > 0.5);
      expect(mid.length).toBeGreaterThan(3);
    });
  }

  it('the light never jumps: each sphere and name rises over at least the no-flash floor', () => {
    const fastest = (16 / NO_FLASH.RISE_MS) + 1e-9;
    for (const w of WALKS) {
      for (let t = w.from - 100; t < w.to + 500; t += 16) {
        const a = walkAt(t)[w.tree];
        const b = walkAt(t + 16)[w.tree];
        STEPS.forEach((id) => {
          expect(b.lit[id] - a.lit[id]).toBeLessThanOrEqual(fastest);
          expect(b.names[id] - a.names[id]).toBeLessThanOrEqual(fastest);
        });
      }
    }
  });

  it('every one of the 22 breathing paths is drawn whole during THE BREATHING PATHS', () => {
    const u = partProgress('tree', 'paths', AT.trees - 1);
    BREATHING_PATHS.forEach((_, k) => expect(strokeProgress(u, k, TREE.PATHS, SPANS.TREE)).toBe(1));
  });
});

describe('the backdrop steps out of the tree\'s way', () => {
  it('the construct\'s lattice all but goes while the tree stands, and returns for the offering', () => {
    for (let t = AT.tree + 1500; t < AT.offering; t += STEP) expect(constructAt(t).gain).toBeLessThanOrEqual(0.015);
    expect(constructAt(AT.offering + 1600).gain).toBeGreaterThan(0.05);
    expect(constructAt(partStart('tree', 'column') + 10).gain).toBeLessThanOrEqual(0.08);
  });
});
