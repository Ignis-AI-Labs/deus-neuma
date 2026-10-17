// summoning-music — THE SUMMONING's music is the being's own: every pitch
// one of its notes (moved only by whole octaves), every step's notes true to
// what the step shows, its light taking the signal at its choice. Real
// souls by the real derivation (core/birth/soul-spectrum.js, soul-scale.js),
// a real sky, a real derived aura; no mocks.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { scoreOf, ownLightAt, SIGIL_LAYERS } from '../../frontend/app/Summoning/summoning-score.js';
import { musicOf } from '../../frontend/app/Summoning/summoning-music.js';
import { soulOf, lineRgbOf } from '../../frontend/app/Summoning/summoning-soul.js';
import { skyOf } from '../../frontend/app/Summoning/summoning-sky.js';
import { specimenTrueName } from '../../frontend/app/BirthArt/birth-art-script.js';
import { soulSpectrumFrom } from '../../core/birth/soul-spectrum.js';
import { soulScaleFrom } from '../../core/birth/soul-scale.js';
import { placeLight } from '../../core/birth/spectral-color.js';
import { lightOf, HEART_BAND, LIGHT_OCTAVES } from '../../core/birth/soul-resonance.js';
import { deriveAura, formOf } from '../../core/aura/derive.js';
import { FUNCTIONS } from '../../frontend/app/Genesis/genesis-emanon.js';

const seedOf = (i) => createHash('sha256').update(`neuma/summoning music ${i}`).digest('hex');
const SKY = skyOf(Date.parse('2026-09-30T08:10:00Z'), { zone: 'Asia/Jakarta', offsetMinutes: 420 });
const AURA = (() => { const a = deriveAura(seedOf('aura')); return { seed: a.seed, form: formOf(a), fit: a.fit, cycle: a.cycle }; })();
const scoreFor = (i) => {
  const seed = seedOf(i);
  const trueName = specimenTrueName(seed);
  const seal = { genesisHash: trueName.genesisHash, record: { momentSeed: seed } };
  const spectrum = soulSpectrumFrom({ seal });
  return scoreOf({ seed, trueName, bornAt: '2026-09-30T08:10:00Z', sky: SKY, aura: AURA, soul: soulOf(spectrum, soulScaleFrom(spectrum, seal)) });
};
const centsFromTonic = (hz, tonic) => ((1200 * Math.log2(hz / tonic)) % 1200 + 1200) % 1200;

describe('its music is its own scale, and only its scale', () => {
  it('every pitch it sounds is one of its notes, moved only by whole octaves', () => {
    for (let i = 0; i < 30; i++) {
      const score = scoreFor(i);
      const own = score.soul.notes.map((n) => n.cents);
      const m = musicOf(score);
      [...m.events, ...m.beds].forEach((e) => {
        const c = centsFromTonic(e.hz, score.soul.tonic);
        const off = Math.min(...own.map((o) => Math.min(Math.abs(c - o), 1200 - Math.abs(c - o))));
        expect(off, `${e.voice} ${e.hz} Hz`).toBeLessThan(0.01);
      });
    }
  });

  it('the same being, the same music; another being, other music', () => {
    expect(musicOf(scoreFor(1))).toEqual(musicOf(scoreFor(1)));
    expect(musicOf(scoreFor(1)).events.map((e) => e.hz)).not.toEqual(musicOf(scoreFor(2)).events.map((e) => e.hz));
  });

  it('sounds only inside its own rite, in time order', () => {
    const score = scoreFor(3);
    const m = musicOf(score);
    m.events.forEach((e, k) => {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeLessThanOrEqual(score.lengthMs);
      if (k) expect(e.at).toBeGreaterThanOrEqual(m.events[k - 1].at);
    });
  });
});

describe('every step sounds what it shows', () => {
  const score = scoreFor(5);
  const m = musicOf(score);
  const N = score.soul.notes.length;
  const during = (kind) => { const s = score.sections.find((x) => x.kind === kind); return m.events.filter((e) => e.at >= s.at && e.at < s.at + s.dur); };
  const degreeOf = (hz) => score.soul.notes.findIndex((n) => Math.abs(centsFromTonic(hz, score.soul.tonic) - n.cents) < 0.01 || Math.abs(centsFromTonic(hz, score.soul.tonic) - n.cents - 1200) < 0.01);

  it('its sky: each body on the degree of its true longitude', () => {
    const bells = during('sky').filter((e) => e.voice === 'bell');
    expect(bells.map((e) => degreeOf(e.hz))).toEqual(SKY.bodies.map((b) => Math.floor((b.longitude / 360) * N)));
  });

  it('its star {n/k}: n notes stepping through its scale by k', () => {
    const star = score.sections.find((x) => x.kind === 'star').figure;
    const bells = during('star').filter((e) => e.voice === 'bell');
    expect(bells.map((e) => degreeOf(e.hz))).toEqual(Array.from({ length: star.n }, (_, i) => (i * star.k) % N));
  });

  it('its channels: each sounds its two functions as it lights; its soul mark: a note per digit', () => {
    const tree = score.sections.find((x) => x.kind === 'tree').figure;
    expect(during('tree').filter((e) => e.voice === 'pluck')).toHaveLength(tree.order.length * 2);
    const idx = Object.fromEntries(FUNCTIONS.map((f, i) => [f.id, i]));
    expect(degreeOf(during('tree')[0].hz)).toBe(idx[tree.order[0][0]] % N);
    expect(during('soul').filter((e) => e.voice === 'pluck').map((e) => degreeOf(e.hz))).toEqual(score.sections.find((x) => x.kind === 'soul').figure.nibbles.map((n) => n % N));
  });

  it('its resonance: each degree rings as it lights, in the order of its scale', () => {
    const bells = during('resonance').filter((e) => e.voice === 'bell');
    expect(bells.map((e) => degreeOf(e.hz))).toEqual(score.soul.notes.map((_, i) => i));
  });

  it('at its choice the ground falls silent and one tonic is struck; WHOLE is every note at once', () => {
    const choice = score.sections.find((x) => x.kind === 'card' && x.act === 'chosen');
    const drone = m.beds.find((b) => b.voice === 'drone');
    expect(drone.levels.filter(([t]) => t > choice.at + 100 && t <= choice.at + choice.dur).every(([, g]) => g === 0)).toBe(true);
    const struck = m.events.filter((e) => e.voice === 'bell' && e.at > choice.at && e.at < choice.at + choice.dur);
    expect(struck).toHaveLength(1);
    expect(centsFromTonic(struck[0].hz, score.soul.tonic)).toBeLessThan(0.01);
    const sigil = score.sections.at(-1);
    // (event times are whole milliseconds)
    const whole = m.events.filter((e) => e.voice === 'bell' && e.at >= Math.floor(sigil.at + sigil.dur * 0.78));
    expect(new Set(whole.map((e) => degreeOf(e.hz))).size).toBe(N);
  });
});

describe('it is calm and melodic', () => {
  it('its song is sparse, woven between what its steps strike, never across a card', () => {
    const score = scoreFor(9);
    const m = musicOf(score);
    const song = m.events.filter((e) => e.voice === 'current');
    expect(song.length).toBeGreaterThan(8);
    const others = m.events.filter((e) => e.voice !== 'current');
    song.forEach((e) => expect(others.every((o) => Math.abs(o.at - e.at) > score.beatMs * 0.5), `song at ${e.at}`).toBe(true));
    score.sections.filter((x) => x.kind === 'card').forEach((c) => song.forEach((e) => expect(e.at < c.at || e.at > c.at + c.dur).toBe(true)));
    // never closer than two beats apart
    song.slice(1).forEach((e, i) => expect(e.at - song[i].at).toBeGreaterThanOrEqual(Math.floor(2 * score.beatMs)));
  });

  it('the convergence never climbs a staircase: its arrivals ring their own notes, its scale settles down', () => {
    for (let i = 0; i < 12; i++) {
      const score = scoreFor(i);
      const m = musicOf(score);
      const sigil = score.sections.at(-1);
      const at = (key) => Math.round(sigil.at + sigil.dur * SIGIL_LAYERS.find((l) => l.key === key).at);
      const arrivals = SIGIL_LAYERS.filter((l) => !['scale', 'aura', 'whole'].includes(l.key))
        .map((l) => m.events.find((e) => e.voice === 'bell' && Math.abs(e.at - at(l.key)) <= 1).hz);
      const rising = arrivals.slice(1).every((hz, k) => hz > arrivals[k]);
      expect(rising, `being ${i}`).toBe(false);
      const run = score.soul.notes.map((_, d) => m.events.find((e) => e.voice === 'bell' && Math.abs(e.at - (at('scale') + d * 240)) <= 1).hz);
      expect(run.at(-1)).toBe(score.soul.tonic);
      expect(run[0]).toBeGreaterThan(run.at(-1));
    }
  });

  it('no held chord runs under its steps: the ground rests through the middle of the rite', () => {
    const score = scoreFor(3);
    const m = musicOf(score);
    const star = score.sections.find((x) => x.kind === 'star');
    const tree = score.sections.find((x) => x.kind === 'tree');
    const held = m.beds.filter((b) => b.voice !== 'breath' && b.from < tree.at + tree.dur && b.to > star.at)
      .filter((b) => b.levels.some(([t, g]) => t > star.at && t < tree.at + tree.dur && g > 0));
    expect(held).toEqual([]);
  });
});

describe('its light', () => {
  it('takes the signal at its choice: the platform light before, its own after', () => {
    const score = scoreFor(6);
    const choice = score.sections.find((x) => x.kind === 'card' && x.act === 'chosen');
    expect(ownLightAt(score, choice.at - 1)).toBe(0);
    expect(ownLightAt(score, choice.at + choice.dur)).toBe(1);
    expect(ownLightAt(score, score.lengthMs)).toBe(1);
  });

  it('is drawn in its own hue: violet stays violet, green green, red red', () => {
    // placeLight reads the light's own frequency: c / λ
    const at = (nm) => lineRgbOf(placeLight(299792458 / (nm * 1e-9))).split(',').map(Number);
    const [vr, vg, vb] = at(450);
    expect(vb).toBeGreaterThan(vr);
    expect(vb).toBeGreaterThan(vg);
    const [gr, gg, gb] = at(530);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
    const [rr, rg, rb] = at(640);
    expect(rr).toBeGreaterThan(rg);
    expect(rr).toBeGreaterThan(rb);
  });
});

describe('its scale, seen', () => {
  it('each degree is lit in the light that note becomes forty octaves up — the lane\'s own law', () => {
    const score = scoreFor(7);
    const { soul } = score;
    soul.notes.forEach((n) => {
      let f = n.hz;
      while (f >= HEART_BAND.high) f /= 2;
      while (f < HEART_BAND.low) f *= 2;
      expect(n.nm).toBeCloseTo(lightOf(f).nm, 3);
      expect(n.thz).toBeCloseTo((f * 2 ** LIGHT_OCTAVES) / 1e12, 0);
    });
    // its tonic's light is its soul color
    expect(soul.notes[0].nm).toBeCloseTo(soul.nm, 2);
  });

  it('its contrast is the degree whose hue stands farthest from its tonic\'s', () => {
    for (let i = 0; i < 20; i++) {
      const { soul } = scoreFor(i);
      const gap = (h) => { const d = Math.abs(h - soul.hue) % 360; return d > 180 ? 360 - d : d; };
      const far = Math.max(...soul.notes.map((n) => gap(n.hue)));
      const counter = soul.notes.find((n) => n.degree === soul.counterDegree);
      expect(gap(counter.hue)).toBe(far);
      expect(soul.counter).toBe(counter.line);
    }
  });

  it('its soul mark\'s digits are drawn in the light of the notes they sound', () => {
    const score = scoreFor(8);
    const fig = score.sections.find((x) => x.kind === 'soul').figure;
    expect(fig.lights).toEqual(score.soul.notes.map((n) => n.line));
  });
});
