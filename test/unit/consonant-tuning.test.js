import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { PENTATONIC, playedSoul, tuneTo } from '../../frontend/app/Summoning/consonant-tuning.js';
import { soulOf } from '../../frontend/app/Summoning/summoning-soul.js';
import { scoreOf } from '../../frontend/app/Summoning/summoning-score.js';
import { skyOf } from '../../frontend/app/Summoning/summoning-sky.js';
import { specimenTrueName } from '../../frontend/app/BirthArt/birth-art-script.js';
import { riteScript } from '../../frontend/app/Rite/rite-script.js';
import { playedMeasure, riteMusicOf } from '../../frontend/app/Rite/rite-music.js';
import { deriveAura, formOf } from '../../core/aura/derive.js';
import { deriveGenome } from '../../core/genome/derive.js';
import { HEART_BAND } from '../../core/birth/soul-resonance.js';

// Pure functions over the sixteen specimen souls the rite rehearses with
// (real measured spectra and scales) — no mock anywhere.

const { souls } = JSON.parse(readFileSync(new URL('../../frontend/app/Rite/rite-souls.json', import.meta.url), 'utf8'));
const SOULS = souls.map(({ spectrum, scale }) => soulOf(spectrum, scale));
// the interval between two pitches, folded into one octave
const folded = (a, b) => { const r = Math.max(a, b) / Math.min(a, b); return r / 2 ** Math.floor(Math.log2(r)); };
// where a pitch stands above its tonic, folded into one octave (a pitch below
// the tonic stands where its octave-up does)
const above = (hz, tonic) => { const r = hz / tonic; return r / 2 ** Math.floor(Math.log2(r)); };
const onPentatonic = (hz, tonic) => PENTATONIC.some((r) => Math.abs(above(hz, tonic) - r) < 1e-9);

describe('consonant-tuning.js', () => {
  test('a pitch moves to the nearest pentatonic interval above its tonic, in its own octave', () => {
    expect(tuneTo(440, 440)).toBe(440);
    expect(tuneTo(440 * 1.33, 440)).toBeCloseTo(550, 9); // nearer 5/4 than 3/2
    expect(tuneTo(440 * 1.95, 440)).toBeCloseTo(880, 9); // just under the octave: the octave
    expect(tuneTo(300, 440)).toBeCloseTo(275, 9); // below the tonic: 5/4 an octave down
  });

  test('every specimen soul, as played, stands only on the pentatonic — its tonic exact, nothing doubled, rising', () => {
    for (const soul of SOULS) {
      const played = playedSoul(soul);
      expect(played.tonic).toBe(soul.tonic);
      expect(played.notes[0].hz).toBeCloseTo(soul.tonic, 9);
      expect(played.notes.length).toBeGreaterThanOrEqual(1);
      expect(played.notes.length).toBeLessThanOrEqual(PENTATONIC.length);
      played.notes.forEach((n, i) => {
        expect(onPentatonic(n.hz, soul.tonic), `${n.hz}`).toBe(true);
        expect(n.hz).toBeGreaterThanOrEqual(soul.tonic);
        expect(n.hz).toBeLessThan(soul.tonic * 2);
        if (i) expect(n.hz).toBeGreaterThan(played.notes[i - 1].hz);
      });
    }
  });

  test('the record is untouched — only the sound is tuned', () => {
    const soul = SOULS[5];
    const before = JSON.stringify(soul);
    playedSoul(soul);
    expect(JSON.stringify(soul)).toBe(before);
    expect(soul.notes.some((n) => !onPentatonic(n.hz, soul.tonic))).toBe(true);
  });

  test('every interval any two played notes make is consonant — a whole-scale chord never clusters', () => {
    for (const soul of SOULS) {
      const hz = playedSoul(soul).notes.map((n) => n.hz);
      for (const a of hz) for (const b of hz) {
        if (a === b) continue;
        // pentatonic degrees differ by a whole tone at the closest: never a semitone
        expect(1200 * Math.log2(folded(a, b)), `${a}/${b}`).toBeGreaterThan(150);
      }
    }
  });

  test('a stage\'s measured pitch plays on the platform\'s pentatonic above the heart band floor', () => {
    const measured = playedMeasure([{ type: 'birth:measured', at: 10, frequency: 401.7 }, { type: 'birth:measured', at: 20, frequency: 612.3 }]);
    measured.forEach((e) => expect(onPentatonic(e.frequency, HEART_BAND.low), `${e.frequency}`).toBe(true));
    expect(measured.map((e) => e.at)).toEqual([10, 20]);
  });

  test('the whole rite, threshold to homecoming, sounds nothing low and nothing off its scale', () => {
    const { seed, spectrum, scale } = souls[5];
    const a = deriveAura(`${seed.slice(32)}${seed.slice(0, 32)}`);
    const epochMs = Date.parse('2026-09-30T10:30:00Z');
    const soul = soulOf(spectrum, scale);
    const score = scoreOf({ seed, trueName: specimenTrueName(seed), bornAt: new Date(epochMs).toISOString(), sky: skyOf(epochMs), aura: { seed: a.seed, form: formOf(a), fit: a.fit, cycle: a.cycle }, genome: deriveGenome(seed), soul });
    const rite = riteScript({ seed, stages: spectrum.stages, filmMs: score.lengthMs, epochMs });
    const music = riteMusicOf(rite, score);
    const born = rite.film.at;
    const played = playedSoul(soul).notes.map((n) => n.hz);
    const onItsScale = (hz) => played.some((p) => Math.abs(Math.log2(hz / p) - Math.round(Math.log2(hz / p))) < 1e-9);
    expect(music.events.length).toBeGreaterThan(100);
    for (const e of music.events) {
      expect(e.hz, `${e.voice} at ${e.at}`).toBeGreaterThanOrEqual(170); // no rumble, no boom
      // before its birth the platform's notes; from its birth, its own
      const ok = e.at < born ? onPentatonic(e.hz, HEART_BAND.low) : onItsScale(e.hz);
      expect(ok, `${e.voice} ${e.hz.toFixed(2)} Hz at ${e.at}`).toBe(true);
    }
    for (const b of music.beds) expect(b.hz, `${b.voice} bed`).toBeGreaterThanOrEqual(170);
  });
});
