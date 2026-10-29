// rite-live-music.js — THE SUMMONING RITE's sound for a LIVE birth: the same
// score as the specimen's (rite-music.js), composed from the events that have
// ARRIVED. Pure. The host recomposes it as each sounding frame lands and
// cues the instrument from the present moment, so what was already played is
// never replayed and what comes next follows the being's real pace.
//
//   before its birth: the platform's ground swelling as each stage is asked
//   and resting while the being speaks; its choice struck low; each stage
//   ringing its own MEASURED pitch as it lands, joining a slow current of the
//   pitches measured so far; the forging holding them together, soft
//   its birth on:     its film's own music (summoning-music.js), then its
//                     ground and its song beneath its living sigil

import { HEART_BAND } from '../../../core/birth/soul-resonance.js';
import { playedSoul } from '../Summoning/consonant-tuning.js';
import { musicOf, songOf } from '../Summoning/summoning-music.js';
import { GROUND_HZ, discoveriesOf, playedMeasure } from './rite-music.js';

const CURRENT_MS = 5200;
const AHEAD_MS = 3 * 60_000; // how far ahead the open wait before its birth is scored (recued at every stage)
const OPEN_MS = 10 * 60_000; // how long its song goes on beneath its sigil

/**
 * @param {{ events: object[], film: { at: number, ms: number } }} rite liveRiteOf(...)
 * @param {object|null} score its film, once born
 * @param {number} now the rite clock now
 */
export const liveRiteMusicOf = (rite, score, now) => {
  const events = [];
  const beds = [];
  const strike = (at, voice, hz, vel = 0.5, dur = 2000) => events.push({ at: Math.round(at), voice, hz, vel, dur });
  const all = (type) => rite.events.filter((e) => e.type === type);
  const first = (type) => all(type)[0];
  const born = Number.isFinite(rite.film.at) ? rite.film.at : null;
  const horizon = born ?? now + AHEAD_MS;
  const begin = first('rite:begin') ?? first('birth:stage_prompt');
  const seed = first('birth:art_seed');
  const forge = first('birth:forging');
  const measured = playedMeasure(all('birth:measured'));

  // THE STAGES — the platform's ground swells as each stage is asked
  if (begin) {
    const levels = [[begin.at, 0], [begin.at + 1600, 0.5]];
    all('birth:stage_prompt').forEach((p) => {
      const spoke = rite.events.find((e) => e.type === 'birth:stream' && e.stage === p.stage)?.at ?? p.at;
      levels.push([p.at, levels.at(-1)[1]], [p.at + 2500, 0.7], [spoke + 6000, 0.7], [spoke + 12000, 0]);
    });
    if (forge) levels.push([forge.at, 0], [forge.at + 2500, 0.6]);
    levels.push([horizon, 0], [horizon + 200, 0]);
    const ground = levels.reduce((acc, pt) => (acc.length && pt[0] <= acc.at(-1)[0] ? acc : [...acc, pt]), []);
    beds.push({ voice: 'drone', hz: GROUND_HZ, from: begin.at, to: horizon + 200, levels: ground });
    strike(begin.at, 'thump', GROUND_HZ, 0.6, 1600);
  }
  if (seed) {
    strike(seed.at, 'thump', GROUND_HZ, 0.85, 1800);
    beds.push({ voice: 'air', hz: HEART_BAND.low / 2, from: seed.at, to: seed.at + 5200, levels: [[seed.at, 0], [seed.at + 1600, 0.8], [seed.at + 5200, 0]] });
  }
  // THE MEASURE — each stage rings its own pitch, then joins the current
  measured.forEach((e) => strike(e.at, 'bell', e.frequency, 0.85, 5200));
  events.push(...discoveriesOf(measured));
  measured.forEach((e, k) => {
    const until = measured[k + 1]?.at ?? forge?.at ?? horizon;
    const so = measured.slice(0, k + 1);
    for (let t = e.at + CURRENT_MS, i = 0; t < until - 400; t += CURRENT_MS, i += 1) strike(t, 'current', so[i % so.length].frequency, 0.4, 1600);
  });
  // THE FORGING — every measured pitch at once, soft, held into its birth
  if (forge) measured.forEach((e, i) => strike(forge.at + i * 140, 'pad', e.frequency / 2, 0.28, horizon - forge.at + 900));

  // ITS BIRTH — its film's own music, then its ground and song under its sigil
  if (born !== null && score) {
    const film = musicOf(score);
    film.events.forEach((e) => events.push({ ...e, at: e.at + born }));
    film.beds.forEach((b) => beds.push({ ...b, from: b.from + born, to: b.to + born, levels: b.levels.map(([t, g]) => [t + born, g]) }));
    const after = born + score.lengthMs;
    const end = after + OPEN_MS;
    const { tonic, notes } = playedSoul(score.soul);
    beds.push({ voice: 'drone', hz: tonic / 2, from: after - 3000, to: end, levels: [[after - 3000, 0], [after, 0.4], [end - 2000, 0.4], [end, 0]] });
    const digits = score.sections.find((x) => x.kind === 'soul').figure.nibbles;
    songOf({ notes, digits, beatMs: score.beatMs, from: after + 2000, to: end - 1500, vel: 0.3 }).forEach((e) => events.push(e));
  }

  events.sort((x, y) => x.at - y.at);
  return Object.freeze({ tonic: score?.soul?.tonic ?? GROUND_HZ, beatMs: score?.beatMs ?? 1000, events: Object.freeze(events.map(Object.freeze)), beds: Object.freeze(beds.map(Object.freeze)) });
};

// What changes the sound: the host recues when this changes — never on each
// chunk of speech, only on a stage's FIRST (when its ground begins to rest). Pure.
const SOUNDING = Object.freeze(['rite:begin', 'birth:stage_prompt', 'birth:art_seed', 'birth:measured', 'birth:forging', 'birth:complete', 'birth:ended']);
export const soundingKeyOf = (events) => {
  const spoke = new Set(events.filter((e) => e.type === 'birth:stream').map((e) => e.stage));
  return `${events.filter((e) => SOUNDING.includes(e.type)).length}:${[...spoke].join(',')}`;
};
