// summoning-body — ITS BODY in THE SUMMONING: the frame a being was given,
// read from its real genome (core/genome, genome/v4) and drawn as geometry.
// A humanoid skeleton stands true to its height in centimetres, its widths
// follow its genes, the light around it encloses every joint; every
// non-humanoid frame keeps to its scale; the plan and its givens are named
// only once the frame has resolved; nothing of its look is read. Real seeds,
// the real derivation; no mocks.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { deriveGenome } from '../../core/genome/derive.js';
import { FORM_NONHUMAN } from '../../core/genome/traits.js';
import { humanoidFrame, formlessFrame, hullOf, planOf, cmToY, FLOOR, bodyFigureOf } from '../../frontend/app/Summoning/summoning-body.js';
import { bodyCaption, bodyLine, bodyOutlineFor } from '../../frontend/app/Summoning/summoning-shots-body.js';

const genomeOf = (i) => deriveGenome(createHash('sha256').update(`neuma/summoning body ${i}`).digest('hex'));
const GENOMES = Array.from({ length: 600 }, (_, i) => genomeOf(i));
const figureOf = bodyFigureOf;

// ray casting: is q inside the closed polygon pts
const inside = (q, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [a, b] = [pts[i], pts[j]];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const humanoidWith = (over) => {
  const base = GENOMES.find((g) => planOf(g) === 'humanoid');
  return humanoidFrame({ ...base.frame, ...over });
};

describe('its plan is the one its genome was given', () => {
  it('every plan turns up among real births — humanoid most, each non-humanoid form rarer', () => {
    const count = {};
    GENOMES.forEach((g) => { count[planOf(g)] = (count[planOf(g)] || 0) + 1; });
    expect(Object.keys(count).sort()).toEqual(['crystal', 'drone', 'humanoid', 'orb', 'sigil']);
    FORM_NONHUMAN.forEach((f) => expect(count[f]).toBeLessThan(count.humanoid));
  });

  it('a record from before the word became humanoid still reads as humanoid', () => {
    expect(planOf({ form: 'humanlike' })).toBe('humanoid');
    expect(planOf({ form: 'orb' })).toBe('orb');
  });
});

describe('a humanoid skeleton stands true to its genes', () => {
  it('its crown stands at its height on the ruler, on one floor for every body', () => {
    GENOMES.filter((g) => planOf(g) === 'humanoid').slice(0, 80).forEach((g) => {
      const fr = humanoidFrame(g.frame);
      expect(fr.top).toBeCloseTo(cmToY(g.frame.heightCm), 9);
      expect(fr.axis[0].y).toBe(FLOOR);
      // and the whole of it inside the frame
      [...fr.outline, ...fr.joints].forEach((q) => {
        expect(Math.abs(q.x)).toBeLessThan(0.6);
        expect(q.y).toBeGreaterThanOrEqual(FLOOR - 1e-9);
        expect(q.y).toBeLessThan(0.9);
      });
    });
  });

  it('the taller body is the taller skeleton; broad shoulders are wider than narrow; wide hips wider than narrow', () => {
    expect(humanoidWith({ heightCm: 190 }).top).toBeGreaterThan(humanoidWith({ heightCm: 152 }).top);
    const shoulderX = (fr) => Math.max(...fr.joints.map((j) => j.x));
    expect(shoulderX(humanoidWith({ shoulders: 'broad', posture: 'upright' }))).toBeGreaterThan(shoulderX(humanoidWith({ shoulders: 'narrow', posture: 'upright' })));
    const hipX = (fr) => fr.bones[6][1].x; // pelvis → its right hip
    expect(hipX(humanoidWith({ hips: 'wide', posture: 'upright' }))).toBeGreaterThan(hipX(humanoidWith({ hips: 'narrow', posture: 'upright' })));
  });

  it('upright stands symmetric; every other posture leans', () => {
    const up = humanoidWith({ posture: 'upright' });
    up.bones.forEach(([a, b], i) => {
      if (i < 4) expect(Math.abs(a.x) + Math.abs(b.x)).toBeLessThan(1e-9); // the spine on its axis
    });
    ['relaxed', 'poised', 'casual'].forEach((posture) => {
      const lean = humanoidWith({ posture });
      expect(Math.abs(lean.bones[3][1].x)).toBeGreaterThan(1e-4); // the head's bone off the axis
    });
  });

  it('the light around it is one closed line, and encloses every joint and its core', () => {
    GENOMES.filter((g) => planOf(g) === 'humanoid').slice(0, 60).forEach((g) => {
      const fr = humanoidFrame(g.frame);
      [...fr.joints, fr.core].forEach((j) => expect(inside(j, fr.outline), `${g.frame.posture} ${g.frame.build}`).toBe(true));
    });
  });

  it('its chest is a given it does not draw: a skeleton and its light, not a figure study', () => {
    const g = GENOMES.find((x) => planOf(x) === 'humanoid');
    expect(humanoidFrame({ ...g.frame, chest: 'flat' })).toEqual(humanoidFrame({ ...g.frame, chest: 'large' }));
  });
});

describe('a non-humanoid frame keeps to its scale', () => {
  it('each form, each cast, each scale: inside its radius, and larger scales larger', () => {
    FORM_NONHUMAN.forEach((plan) => ['angular', 'balanced', 'soft'].forEach((cast) => {
      const r = ['short', 'average', 'tall'].map((stature) => {
        const fr = formlessFrame({ plan, cast, stature });
        const far = Math.max(...fr.strokes.flat().map((q) => Math.hypot(q.x, q.y, q.z)));
        expect(far).toBeLessThanOrEqual(fr.scale * 1.0001 + 1e-9);
        return far;
      });
      expect(r[0]).toBeLessThan(r[1]);
      expect(r[1]).toBeLessThan(r[2]);
    }));
  });

  it('two casts of one form are two different frames', () => {
    FORM_NONHUMAN.forEach((plan) => {
      const a = formlessFrame({ plan, cast: 'angular', stature: 'average' });
      const s = formlessFrame({ plan, cast: 'soft', stature: 'average' });
      expect(JSON.stringify(a.strokes)).not.toBe(JSON.stringify(s.strokes));
    });
  });

  it('the light around it (its hull) holds every point of it', () => {
    const pts = formlessFrame({ plan: 'crystal', cast: 'angular', stature: 'tall' }).strokes.flat().map((q) => ({ x: q.x, y: q.y }));
    const hull = hullOf(pts);
    const grown = hull.map((q) => ({ x: q.x * 1.001, y: q.y * 1.001 }));
    pts.forEach((q) => { if (Math.hypot(q.x, q.y) > 1e-6) expect(inside(q, grown)).toBe(true); });
  });
});

describe('it is named only once it has taken form', () => {
  it('first every body is one axis; then its plan, and its givens', () => {
    const hum = figureOf(GENOMES.find((g) => planOf(g) === 'humanoid'));
    const orb = figureOf(GENOMES.find((g) => planOf(g) === 'orb'));
    expect(bodyCaption(hum, 0.05)).toBe('ITS BODY · TAKING FORM');
    expect(bodyCaption(orb, 0.05)).toBe('ITS BODY · TAKING FORM');
    expect(bodyLine(hum, 0.05)).toBe('EVERY BODY BEGINS AS ONE AXIS');
    expect(bodyCaption(hum, 0.6)).toBe('ITS BODY · HUMANOID');
    expect(bodyCaption(orb, 0.6)).toBe('ITS BODY · ORB');
    expect(bodyLine(hum, 0.6)).toBe(`${hum.sex.toUpperCase()} · ${hum.heightCm} CM · ${hum.build.toUpperCase()} BUILD · GIVEN AT BIRTH, NEVER CHOSEN`);
    expect(bodyLine(orb, 0.6)).toMatch(/^NON-HUMANOID · (ANGULAR|BALANCED|SOFT) · (SMALL|MEDIUM|LARGE) · GIVEN AT BIRTH, NEVER CHOSEN$/);
  });

  it('in the convergence its outline stands inside the sigil\'s ring', () => {
    GENOMES.slice(0, 120).forEach((g) => {
      bodyOutlineFor(figureOf(g)).forEach((q) => expect(Math.hypot(q.x, q.y)).toBeLessThan(0.98));
    });
  });
});
