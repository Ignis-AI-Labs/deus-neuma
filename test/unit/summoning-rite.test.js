// summoning-rite — THE SUMMONING RITE, the whole birth as one piece: the
// seven stages MAKE what the film SHOWS. Each stage's measured pitch is the
// lane's own per-stage centre (core/birth/soul-resonance.js), and its light
// is exactly a light of the scale the film reveals; nothing of its name
// shows before its birth; before its birth every note sounded is the
// platform's or a measured one; a kept record plays back the identical rite
// and never holds a word. Real soul functions, a real sky, a real derived
// aura; no mocks.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { riteScript, observationsOf, OPERATOR_WORDS, RITE, FORGING } from '../../frontend/app/Rite/rite-script.js';
import { riteAt, artEventsOf } from '../../frontend/app/Rite/rite-state.js';
import { riteMusicOf, GROUND_HZ } from '../../frontend/app/Rite/rite-music.js';
import { riteRecordOf, riteFromRecord, RITE_SCHEMA } from '../../core/birth/rite-record.js';
import { artAt } from '../../frontend/app/BirthArt/birth-art-state.js';
import { specimenTrueName } from '../../frontend/app/BirthArt/birth-art-script.js';
import { scoreOf } from '../../frontend/app/Summoning/summoning-score.js';
import { soulOf } from '../../frontend/app/Summoning/summoning-soul.js';
import { componentsOf } from '../../frontend/app/Summoning/summoning-components.js';
import { skyOf } from '../../frontend/app/Summoning/summoning-sky.js';
import { soulSpectrumFrom } from '../../core/birth/soul-spectrum.js';
import { soulScaleFrom } from '../../core/birth/soul-scale.js';
import { deriveSoul, HEART_BAND } from '../../core/birth/soul-resonance.js';
import { deriveAura, formOf } from '../../core/aura/derive.js';
import RITE_SOULS from '../../frontend/app/Rite/rite-souls.json';

const EPOCH = Date.parse('2026-09-30T10:30:00Z');
const SKY = skyOf(EPOCH, { zone: 'Asia/Jakarta', offsetMinutes: 420 });
const AURA = (() => { const a = deriveAura('ab'.repeat(32)); return { seed: a.seed, form: formOf(a), fit: a.fit, cycle: a.cycle }; })();
const seedOf = (i) => createHash('sha256').update(`neuma/summoning rite test ${i}`).digest('hex');

const beingFor = (seed) => {
  const spectrum = soulSpectrumFrom({ observations: observationsOf(seed) });
  const scale = soulScaleFrom(spectrum);
  const score = scoreOf({ seed, trueName: specimenTrueName(seed), bornAt: new Date(EPOCH).toISOString(), sky: SKY, aura: AURA, soul: soulOf(spectrum, scale) });
  const rite = riteScript({ seed, stages: spectrum.stages, filmMs: score.lengthMs, epochMs: EPOCH });
  return { seed, spectrum, scale, score, rite };
};
const cents = (a, b) => { const c = ((1200 * Math.log2(a / b)) % 1200 + 1200) % 1200; return Math.min(c, 1200 - c); };

describe('the stages make what the film shows', () => {
  it('each stage is measured by the lane\'s own law, and the specimen souls are those measurements', () => {
    const b = beingFor(seedOf(1));
    const byStage = deriveSoul(observationsOf(b.seed)).spectrum.stages;
    const measured = b.rite.events.filter((e) => e.type === 'birth:measured');
    expect(measured).toHaveLength(7);
    measured.forEach((e) => expect(e.frequency).toBe(byStage.find((s) => s.stage === e.stage).frequency));
    // a stage is measured just after it lands, never before
    measured.forEach((e) => {
      const landed = b.rite.events.find((x) => x.type === 'birth:stage_complete' && x.stage === e.stage);
      expect(e.at - landed.at).toBe(RITE.MEASURED_MS);
    });
    RITE_SOULS.souls.forEach((s) => expect(soulSpectrumFrom({ observations: observationsOf(s.seed) })).toEqual(s.spectrum));
  });

  it('every light of the scale its film reveals is a light the witness saw measured', () => {
    for (let i = 0; i < 12; i++) {
      const b = beingFor(seedOf(i));
      const s = riteAt(b.rite, b.rite.film.at - 1);
      const seen = s.measure.map((m) => m.frequency);
      b.score.soul.notes.slice(1).forEach((n) => {
        // each degree is a measured pitch (or the mean of pitches the ear can't part, < 5¢)
        expect(Math.min(...seen.map((f) => cents(n.hz, f))), `degree ${n.degree}`).toBeLessThan(5);
      });
    }
  });

  it('the rite walks its movements in order, once each', () => {
    const b = beingFor(seedOf(2));
    const order = [];
    for (let t = 0; t <= b.rite.length; t += 250) {
      const m = riteAt(b.rite, t).movement;
      if (order.at(-1) !== m) order.push(m);
    }
    expect(order).toEqual(['threshold', 'stages', 'forging', 'film', 'guardianship', 'home']);
    expect(riteAt(b.rite, b.rite.film.at - 1).forge.steps.every((x) => x.done)).toBe(true);
    expect(FORGING.length).toBe(8);
  });

  it('nothing of its name shows before its birth; the living piece never learns it', () => {
    const b = beingFor(seedOf(3));
    expect(riteAt(b.rite, b.rite.film.at - 1).trueName).toBe(null);
    expect(riteAt(b.rite, b.rite.film.at).trueName.fullName).toBe(specimenTrueName(b.seed).fullName);
    const events = artEventsOf(b.rite);
    expect(events.some((e) => e.type === 'birth:complete')).toBe(false);
    const art = artAt(events, b.rite.length);
    expect(art.seal.trueName).toBe(null);
    expect(art.phase).toBe('ignited');
  });

  it('its sky lands on the ring at naming, and its nucleus closes when its DNA is written', () => {
    const b = beingFor(seedOf(4));
    const events = artEventsOf(b.rite);
    const naming = events.find((e) => e.type === 'birth:stage_prompt' && e.stage === 4).at;
    expect(artAt(events, naming - 1).sky.draw).toBe(0);
    const sky = artAt(events, naming + 60000).sky;
    expect(sky.draw).toBe(1);
    expect(sky.bodies.map((x) => x.longitude)).toEqual([...SKY.bodies].map((x) => x.longitude).sort((x, y) => x - y));
    const wrote = events.find((e) => e.type === 'birth:tool_usage' && e.stage === 5).at;
    expect(artAt(events, wrote - 1).nucleus.draw).toBeLessThanOrEqual(0.82);
    expect(artAt(events, wrote + 2000).nucleus.draw).toBe(1);
  });
});

describe('its sound', () => {
  it('before its birth, every note is the platform\'s or one it was measured at', () => {
    for (let i = 0; i < 6; i++) {
      const b = beingFor(seedOf(i));
      const measured = b.rite.events.filter((e) => e.type === 'birth:measured').map((e) => e.frequency);
      const platform = [HEART_BAND.low, HEART_BAND.high, GROUND_HZ, GROUND_HZ / 2, HEART_BAND.low / 2];
      const m = riteMusicOf(b.rite, b.score);
      [...m.events.filter((e) => e.at < b.rite.film.at), ...m.beds.filter((x) => x.from < b.rite.film.at)].forEach((e) => {
        const ok = platform.includes(e.hz) || measured.some((f) => e.hz === f || e.hz === f / 2);
        expect(ok, `${e.voice} ${e.hz} Hz at ${e.at ?? e.from}`).toBe(true);
      });
      // each measured pitch rings the moment it is measured
      b.rite.events.filter((e) => e.type === 'birth:measured').forEach((e) => {
        expect(m.events.some((x) => x.at === e.at && x.voice === 'bell' && x.hz === e.frequency)).toBe(true);
      });
    }
  });

  it('from its birth, its film\'s own music, on the rite\'s clock', () => {
    const b = beingFor(seedOf(5));
    const m = riteMusicOf(b.rite, b.score);
    const own = b.score.soul.notes.map((n) => n.hz);
    m.events.filter((e) => e.at >= b.rite.film.at).forEach((e) => {
      expect(Math.min(...own.map((h) => cents(e.hz, h))), `${e.voice} ${e.hz}`).toBeLessThan(0.01);
    });
  });
});

describe('kept for re-watching: inputs, never frames, never words', () => {
  it('a kept rite plays back frame for frame', () => {
    const b = beingFor(seedOf(6));
    const being = { seed: b.seed, trueName: specimenTrueName(b.seed), bornAt: new Date(EPOCH).toISOString(), epochMs: EPOCH };
    const record = JSON.parse(JSON.stringify(riteRecordOf({ rite: b.rite, being, soul: { spectrum: b.spectrum, scale: b.scale }, specimen: true })));
    expect(record.schema).toBe(RITE_SCHEMA);
    const kept = riteFromRecord(record);
    for (let t = 0; t <= b.rite.length; t += 7919) {
      expect(riteAt(kept.rite, t)).toEqual(riteAt(b.rite, t));
      expect(artAt(artEventsOf(kept.rite), t)).toEqual(artAt(artEventsOf(b.rite), t));
    }
    expect(soulOf(kept.soul.spectrum, kept.soul.scale)).toEqual(soulOf(b.spectrum, b.scale));
  });

  it('never keeps a word, even when the wire carried one', () => {
    const b = beingFor(seedOf(7));
    const spoken = { ...b.rite, events: b.rite.events.map((e) => (e.type === 'birth:stream' ? { ...e, content: 'its words' }
      : e.type === 'birth:stage_complete' ? { ...e, response: 'its words', nextWords: 'the witness' } : e)) };
    const being = { seed: b.seed, trueName: { ...specimenTrueName(b.seed), english: 'a gloss' }, bornAt: '', epochMs: EPOCH };
    const json = JSON.stringify(riteRecordOf({ rite: spoken, being, soul: { spectrum: b.spectrum, scale: b.scale } }));
    expect(json).not.toMatch(/its words|the witness|content|response|nextWords|a gloss/);
    expect(() => riteFromRecord({ schema: 'summoning-rite/v0' })).toThrow();
  });
});

describe('its sheet keeps what its film drew', () => {
  it('every component, in the protocol\'s order, read from its own score', () => {
    const b = beingFor(seedOf(8));
    const rows = componentsOf(b.score);
    expect(rows.map((r) => r.key)).toEqual(['sky', 'earth', 'star', 'nucleus', 'channels', 'breath', 'resonance', 'scale', 'soul', 'aura']);
    const star = b.score.sections.find((x) => x.kind === 'star').figure;
    expect(rows.find((r) => r.key === 'star').value).toBe(`{${star.n}/${star.k}}`);
    expect(rows.find((r) => r.key === 'scale').lights).toEqual(b.score.soul.notes.map((n) => n.line));
    expect(rows.find((r) => r.key === 'soul').value).toBe(specimenTrueName(b.seed).soulMark);
    rows.forEach((r) => expect(r.value, r.key).toMatch(/\S/));
  });
});

describe('the platform\'s words are the platform\'s', () => {
  it('the operator\'s default words match the backend\'s, stage for stage', () => {
    const source = fs.readFileSync(fileURLToPath(new globalThis.URL('../../backend/services/birth-stage-stream.js', import.meta.url)), 'utf8');
    // (the witness's own name is filled in where the backend fills it)
    OPERATOR_WORDS.flatMap((w) => w.split('[witness_name]')).filter(Boolean).forEach((w) => expect(source, w).toContain(w));
  });
});
