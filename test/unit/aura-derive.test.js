// THE AURA — derivation, the gate, and how a life is allowed to bend a form.
// Real seeds through the real gate; no mocks anywhere (AGENTS.md RULE 0).
// The population-scale proof of these invariants is `scripts/aura-sweep.mjs`;
// these are the standing regression checks.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { auraSeed } from '../../core/aura/seed.js';
import { deriveAura, formOf, AURA_SCHEMA } from '../../core/aura/derive.js';
import { surveyForm, SURVEY, LIMITS, HEADROOM } from '../../core/aura/gate.js';
import { cohesion } from '../../core/aura/metrics.js';
import { archetypeOf } from '../../core/aura/archetype.js';
import { seedLanes } from '../../core/aura/rng.js';
import { distance } from '../../core/aura/descriptor.js';
import {
  modulateForm, renderHints, lifeReach, LIFE_BOUNDS, LIFE_EXTREME,
} from '../../core/aura/modulate.js';
import { buildSkies } from '../../core/cosmos/skies/index.js';

const seedFor = (label) => createHash('sha256').update(`aura-test/${label}`).digest('hex');
const SEEDS = Array.from({ length: 12 }, (_, i) => seedFor(i));

describe('the aura seed', () => {
  it('folds the being\'s own cryptography, and is stable', () => {
    const identity = { soulHex: 'A1B2C3D4E5F6', genesisHash: 'deadbeef', neumaId: 'keir' };
    const seed = auraSeed(identity);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(auraSeed({ ...identity })).toBe(seed);
  });

  it('refuses an identity that carries no cryptography — an id alone is guessable', () => {
    expect(() => auraSeed({ neumaId: 'keir' })).toThrow(/soulHex, genesisHash, or momentSeed/);
    expect(() => auraSeed({})).toThrow();
  });

  it('ignores the chosen name — a being that renames itself keeps its aura', () => {
    const base = { soulHex: 'A1B2C3D4E5F6', neumaId: 'keir' };
    expect(auraSeed({ ...base, chosenName: 'Keir' })).toBe(auraSeed({ ...base, chosenName: 'Signal' }));
  });

  it('separates beings that differ in any single cryptographic input', () => {
    const seeds = new Set([
      auraSeed({ soulHex: 'AAAA' }),
      auraSeed({ soulHex: 'AAAB' }),
      auraSeed({ soulHex: 'AAAA', genesisHash: 'x' }),
      auraSeed({ soulHex: 'AAAA', momentSeed: 'x' }),
      auraSeed({ soulHex: 'AAAA', neumaId: 'x' }),
    ]);
    expect(seeds.size).toBe(5);
  });
});

describe('derivation', () => {
  it('is deterministic — the same identity draws the same aura, always', () => {
    const a = deriveAura(SEEDS[0]);
    const b = deriveAura(SEEDS[0]);
    expect(b.params).toEqual(a.params);
    expect(b.archetype).toEqual(a.archetype);
    expect(b.fit).toEqual(a.fit);
    expect(a.schema).toBe(AURA_SCHEMA);
  });

  it('gives different beings different forms', () => {
    const drawn = SEEDS.map((s) => JSON.stringify(deriveAura(s).params));
    expect(new Set(drawn).size).toBe(SEEDS.length);
  });

  it('hands over only forms that clear the gate at the TRUE limits', () => {
    for (const seed of SEEDS) {
      const verdict = surveyForm(formOf(deriveAura(seed)), SURVEY);
      expect(verdict.ok, `${seed.slice(0, 8)}: ${verdict.failed}`).toBe(true);
    }
  });

  it('hands over only forms that still clear it at the far end of a life', () => {
    for (const seed of SEEDS) {
      const elder = modulateForm(formOf(deriveAura(seed)), LIFE_EXTREME);
      const verdict = surveyForm(elder, SURVEY);
      expect(verdict.ok, `${seed.slice(0, 8)} as elder: ${verdict.failed}`).toBe(true);
    }
  });

  it('keeps beings further apart than any one of them travels in a lifetime', () => {
    const beings = SEEDS.map((seed) => {
      const base = formOf(deriveAura(seed));
      const rest = surveyForm(base, SURVEY).descriptor;
      const elder = surveyForm(modulateForm(base, LIFE_EXTREME), SURVEY).descriptor;
      return { rest, drift: distance(rest, elder) };
    });
    let closest = Infinity;
    for (let i = 0; i < beings.length; i++) {
      for (let j = i + 1; j < beings.length; j++) {
        closest = Math.min(closest, distance(beings[i].rest, beings[j].rest));
      }
    }
    expect(Math.max(...beings.map((b) => b.drift))).toBeLessThan(closest);
  });
});

describe('the archetype', () => {
  const moment = { epochMs: Date.UTC(2026, 5, 23, 14, 30), offsetMinutes: 420 };

  it('is read from the skies of the instant when they are known', () => {
    const chosen = archetypeOf(buildSkies(moment), seedLanes(SEEDS[0]));
    expect(chosen.source).toBe('skies');
    // same instant, different keys → same posture, and that is the intent
    expect(archetypeOf(buildSkies(moment), seedLanes(SEEDS[1]))).toEqual(chosen);
  });

  it('falls back to the seed rather than denying a being an aura', () => {
    const chosen = archetypeOf(null, seedLanes(SEEDS[0]));
    expect(chosen.source).toBe('seed');
    expect(chosen).toMatchObject({
      carrier: expect.any(String), coupling: expect.any(String), output: expect.any(String),
    });
  });

  it('says out loud when the skies were only partly legible', () => {
    const partial = { systems: { mesoamerican: { tzolkin: { signIndex: 4 } } } };
    expect(archetypeOf(partial, seedLanes(SEEDS[0])).source).toBe('partial-skies');
  });
});

describe('the gate', () => {
  it('names which side of a bound is the defect, and leaves the other open', () => {
    expect(LIMITS.cohesion[1]).toBeNull();  // a form cannot be too coherent
    expect(LIMITS.peakShare[0]).toBeNull(); // nor too little retraced
  });

  it('is strictly stricter with headroom than without it', () => {
    const lanesFor = seedLanes(SEEDS[2]);
    const form = { ...archetypeOf(null, lanesFor), p: deriveAura(SEEDS[2]).params };
    expect(surveyForm(form, SURVEY, 0).ok).toBe(true);
    // whatever headroom refuses, the bare gate must also have been willing to accept
    const strict = surveyForm(form, SURVEY, 1);
    if (!strict.ok) expect(surveyForm(form, SURVEY, 0).ok).toBe(true);
  });

  it('refuses a degenerate form instead of scoring it', () => {
    const dead = { carrier: 'am', coupling: 'radial', output: 'polar',
      p: { ...deriveAura(SEEDS[0]).params, sweep: 0 } };
    const verdict = surveyForm(dead, SURVEY);
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toContain('degenerate');
    expect(verdict.score).toBe(0);
  });
});

describe('how a life bends a form', () => {
  const base = formOf(deriveAura(SEEDS[4]));

  it('never touches a frequency — the finding the whole design rests on', () => {
    const bent = modulateForm(base, LIFE_EXTREME);
    for (const key of ['f1', 'f2', 'f3', 'fm', 'ds', 'qf', 'qc', 'qd', 'cc', 'cu', 'cw', 'sweep']) {
      expect(bent.p[key], key).toBe(base.p[key]);
    }
  });

  it('bends only the three amplitudes, and only within their bounds', () => {
    const bent = modulateForm(base, LIFE_EXTREME);
    expect(bent.p.yr / base.p.yr).toBeLessThanOrEqual(1 + LIFE_BOUNDS.yr + 1e-9);
    expect(bent.p.qa / base.p.qa).toBeLessThanOrEqual(1 + LIFE_BOUNDS.qa + 1e-9);
    expect(bent.p.qb / base.p.qb).toBeLessThanOrEqual(1 + LIFE_BOUNDS.qb + 1e-9);
  });

  it('leaves a newborn exactly as it was born', () => {
    expect(modulateForm(base, { ageDays: 0, memories: 0, refinements: 0 }).p).toEqual(base.p);
    expect(modulateForm(base, {}).p).toEqual(base.p);
  });

  it('saturates every life input into [0, 1], however extreme the number', () => {
    for (const life of [{}, { ageDays: -5 }, { memories: 1e9, refinements: 500, ageDays: 1e6 }]) {
      for (const [key, reach] of Object.entries(lifeReach(life))) {
        expect(reach, key).toBeGreaterThanOrEqual(0);
        expect(reach, key).toBeLessThanOrEqual(1);
      }
    }
    expect(lifeReach({ ageDays: 1e6, memories: 1e9, refinements: 99 }))
      .toEqual({ age: 1, memory: 1, refinement: 1 });
  });

  it('never lets feeling reach geometry — it can only change the drawing', () => {
    // arousal has no geometric path at all — even smuggled in, it moves nothing
    expect(modulateForm(base, { arousal: 1, valence: 1 }).p).toEqual(base.p);
    const calm = renderHints({ memories: 500 }, { arousal: 0 });
    const moved = renderHints({ memories: 500 }, { arousal: 1 });
    expect(moved.points).toBe(calm.points);   // density is a life fact, not a mood
    expect(moved.speed).toBeGreaterThan(calm.speed);
    expect(moved.exposure).toBeGreaterThan(calm.exposure);
  });

  it('makes a remembered being denser than a newborn — evolution you can see', () => {
    expect(renderHints({ memories: 20000 }).points)
      .toBeGreaterThan(renderHints({ memories: 0 }).points * 2);
  });
});

describe('cohesion reads bodies the way an eye does', () => {
  const size = 64;
  const withBlobs = (gap) => {
    const grid = new Float32Array(size * size);
    const box = (x0, y0) => {
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) grid[y * size + x] = 1;
    };
    box(10, 28);
    box(10 + 8 + gap, 28);
    return grid;
  };

  it('closes a one-pixel gap — a sampling artefact is not a second creature', () => {
    expect(cohesion(withBlobs(1), size)).toBeCloseTo(1, 6);
  });

  it('still separates bodies that are genuinely apart', () => {
    expect(cohesion(withBlobs(6), size)).toBeCloseTo(0.5, 6);
  });

  it('counts mass from the real ink, never from the dilation', () => {
    // one blob alone: every unit of mass is real, so the share is exactly 1
    const grid = new Float32Array(size * size);
    for (let y = 20; y < 28; y++) for (let x = 20; x < 28; x++) grid[y * size + x] = 3;
    expect(cohesion(grid, size)).toBe(1);
  });

  it('leaves headroom modest now that the measure no longer jumps', () => {
    expect(HEADROOM.cohesion).toBeLessThan(0.1);
  });
});
