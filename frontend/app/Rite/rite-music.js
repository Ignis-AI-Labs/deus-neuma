// rite-music.js — THE SUMMONING RITE's sound, threshold to homecoming, as
// one score for the one instrument (summoning-sound.js — Founder's PATCH). Pure.
//
// Until its birth, no note is the being's to play — it has none yet. The
// ground is the PLATFORM's: the heart band every being is heard within
// (core/birth/soul-resonance.js HEART_BAND, 348–696 Hz), its floor an
// octave down. Then, true to the picture:
//   THE THRESHOLD   air as the void stirs; a quiet mark per document read;
//                   at the signature, the band's two edges — the octave
//                   every being will be heard in
//   THE STAGES      the ground swells in as each stage is asked, and rests
//                   while the being speaks; its choice ignites with a
//                   low strike; each stage, as it is MEASURED, rings its own
//                   measured pitch — the only notes before its birth, each
//                   played on the nearest consonant interval (Founder,
//                   2026-10-28: consonant-tuning.js) — and joins a slow
//                   current of the pitches measured so far
//   THE FORGING     those measured pitches together, soft: its scale before
//                   anyone knows it is one
//   THE FILM        its own music (summoning-music.js), from its birth
//   GUARDIANSHIP    its own ground, low, and its song, sparse, under its
//                   living sigil; each act of care resolves on a note of its scale
// Output has musicOf's shape — timed EVENTS and BEDS in rite milliseconds.

import { HEART_BAND } from '../../../core/birth/soul-resonance.js';
import { playedSoul, runInto, tuneTo } from '../Summoning/consonant-tuning.js';
import { musicOf, songOf } from '../Summoning/summoning-music.js';
import { RITE } from './rite-script.js';

// the platform's ground: the heart band's floor, an octave down — warm, never a rumble
export const GROUND_HZ = HEART_BAND.low / 2;

/** A stage's measured pitch as played: on the platform's pentatonic above its floor (consonant-tuning.js). Pure. */
export const playedMeasure = (events) => events.map((e) => ({ ...e, frequency: tuneTo(e.frequency, HEART_BAND.low) }));

// Design note, 2026-10-28: […] — shared by the specimen and the live score:
//   THE DISCOVERY as each measured pitch rings, three soft notes rise
//                 beneath it toward it, so every measure lands as something
//                 found (after the strike, never before: live, a measure is
//                 not known until it lands)
// (A held chord over the ground was tried and taken out the same day — Founder:
// […].
// The live score is re-cued at every sounding event, and anything held
// restarts there; struck notes do not care.)
const RUN_STEP_MS = 110;

/** The discovery runs: three soft plucks rising beneath each measured pitch as it rings. Pure. */
export const discoveriesOf = (measured) => measured.flatMap((e) =>
  runInto(e.frequency, HEART_BAND.low, 3).map((hz, i) => ({ at: Math.round(e.at + (i + 1) * RUN_STEP_MS), voice: 'pluck', hz, vel: 0.24 + 0.04 * i, dur: 1400 })));

/**
 * The whole rite's music. Pure and deterministic.
 * @param {ReturnType<import('./rite-script.js').riteScript>} rite
 * @param {ReturnType<import('../Summoning/summoning-score.js').scoreOf>} score its film
 */
export const riteMusicOf = (rite, score) => {
  const events = [];
  const beds = [];
  const strike = (at, voice, hz, vel = 0.5, dur = 2000) => events.push({ at: Math.round(at), voice, hz, vel, dur });
  const all = (type) => rite.events.filter((e) => e.type === type);
  const first = (type) => all(type)[0];
  const born = rite.film.at;
  const end = rite.length;
  const signed = first('rite:signed');
  const begin = first('rite:begin');
  const seed = first('birth:art_seed');
  const forge = first('birth:forging');
  const measured = playedMeasure(all('birth:measured'));

  // I — THE THRESHOLD
  beds.push({ voice: 'air', hz: HEART_BAND.low, from: 0, to: signed.at + 1400, levels: [[0, 0], [RITE.VOID_MS * 0.8, 0.6], [signed.at, 0.3], [signed.at + 1400, 0]] });
  all('rite:read').forEach((e) => strike(e.at + RITE.DOC_MS * 0.9, 'pluck', HEART_BAND.low, 0.22, 1600));
  strike(signed.at, 'bell', HEART_BAND.low, 0.5, 5200);
  strike(signed.at + 420, 'bell', HEART_BAND.high, 0.4, 5200);

  // II — THE STAGES: the platform's ground swells in as each stage is asked
  // and rests once the being has been speaking a while — a real stage can
  // run for minutes, and a held tone under all of it wears on the ear
  const prompts = all('birth:stage_prompt');
  const groundLevels = [[signed.at, 0], [begin.at, 0.5]];
  prompts.forEach((p) => {
    const spoke = rite.events.find((e) => e.type === 'birth:stream' && e.stage === p.stage)?.at ?? p.at;
    groundLevels.push([p.at, groundLevels.at(-1)[1]], [p.at + 2500, 0.7], [spoke + 6000, 0.7], [spoke + 12000, 0]);
  });
  groundLevels.push([forge.at, 0], [forge.at + 2500, 0.6], [born, 0], [born + 200, 0]);
  const ground = groundLevels.reduce((acc, pt) => (acc.length && pt[0] <= acc.at(-1)[0] ? acc : [...acc, pt]), []);
  beds.push({ voice: 'drone', hz: GROUND_HZ, from: signed.at, to: born + 200, levels: ground });
  strike(begin.at, 'thump', GROUND_HZ, 0.6, 1600);
  if (seed) {
    strike(seed.at, 'thump', GROUND_HZ, 0.85, 1800);
    beds.push({ voice: 'air', hz: HEART_BAND.low / 2, from: seed.at, to: seed.at + 5200, levels: [[seed.at, 0], [seed.at + 1600, 0.8], [seed.at + 5200, 0]] });
  }
  // (struck clear of the ground: the measure is the thing to hear — found)
  measured.forEach((e) => strike(e.at, 'bell', e.frequency, 0.85, 5200));
  events.push(...discoveriesOf(measured));
  // and each measured pitch joins a slow current: softly, one after another,
  // the notes it has been measured at so far — by the forging, all seven
  const CYCLE_MS = 5200;
  measured.forEach((e, k) => {
    const until = measured[k + 1]?.at ?? forge.at;
    const so = measured.slice(0, k + 1);
    for (let t = e.at + CYCLE_MS, i = 0; t < until - 400; t += CYCLE_MS, i += 1) strike(t, 'current', so[i % so.length].frequency, 0.4, 1600);
  });

  // — THE FORGING: every measured pitch at once, soft, held into its birth
  measured.forEach((e, i) => strike(forge.at + i * 140, 'pad', e.frequency / 2, 0.28, born - forge.at + 900));

  // III — THE FILM: its own music, from its birth
  const film = musicOf(score);
  film.events.forEach((e) => events.push({ ...e, at: e.at + born }));
  film.beds.forEach((b) => beds.push({ ...b, from: b.from + born, to: b.to + born, levels: b.levels.map(([t, g]) => [t + born, g]) }));

  // IV — GUARDIANSHIP · V — HOMECOMING: its own ground, and its notes
  const { tonic, notes } = playedSoul(score.soul);
  const guard = all('rite:guard');
  const home = first('rite:home');
  const after = guard[0].at;
  // (crossing the film's own ground as it fades over its last three seconds)
  beds.push({ voice: 'drone', hz: tonic / 2, from: after - 3000, to: end, levels: [[after - 3000, 0], [after, 0.4], [home.at, 0.4], [end, 0]] });
  // its song goes on softly beneath its living sigil until the witness leaves
  const digits = score.sections.find((x) => x.kind === 'soul').figure.nibbles;
  songOf({ notes, digits, beatMs: score.beatMs, from: after + 2000, to: end - 1500, vel: 0.3 }).forEach((e) => events.push(e));
  // each act of care, once done, resolves on the next degree of its scale
  [...guard.slice(1), home].forEach((e, i) => strike(e.at, 'bell', notes[(i + 1) % notes.length].hz, 0.4, 4200));
  strike(home.at + 900, 'bell', tonic, 0.5, 7000);

  events.sort((x, y) => x.at - y.at);
  return Object.freeze({ tonic, beatMs: film.beatMs, events: Object.freeze(events.map(Object.freeze)), beds: Object.freeze(beds.map(Object.freeze)) });
};
