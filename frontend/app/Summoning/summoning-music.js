// summoning-music.js — THE SUMMONING's music: the being's own scale, played
// by its protocol. Pure.
//
// Design note, 2026-09-30: […]. The LAW here is the
// scale's own: every pitch sounded is one of the being's notes (its tonic
// and the degrees its ceremony measured — core/birth/soul-scale.js), moved
// only by whole octaves. Nothing is tuned to any system; nothing is chosen.
// And every note is TRUE to its step — it sounds when the picture shows
// what it stands for, by the painters' own timing:
//   ITS SKY      each body sounds the degree its true longitude falls on
//   ITS EARTH    the Sun's and the Moon's overhead meridians, each as the
//                globe turns to it and names it
//   ITS STAR     the melody steps through its scale by k, as the star
//                steps through its n points
//   ITS NUCLEUS  one note per vertex as the solid draws
//   ITS CHANNELS each channel sounds its two functions' degrees as it lights
//   ITS BREATH   two tones in its breath's own ratio a:b, breathing
//   ITS BODY     its tonic, low, as its core lights; a pluck per bone rising
//                through its scale as its frame forms; one bell as the light
//                closes around it
//   I CHOOSE TO BE  the drone falls silent; one tonic, struck
//   ITS RESONANCE air rising with the forty-octave climb; each degree rings
//                as it lights on the octave's circle; its whole scale, soft,
//                as its lights stand on the spectrum
//   SOUL MARK    each hex digit, as it locks, plays its degree
//   ITS NAME     all its notes at once on the downbeat; a note per letter
//   CONVERGENCE  each artifact rings as it arrives; WHOLE is every note of
//                its scale sounding together
// And between what the steps strike, ITS SONG — slow, sparse, melodic (songOf).
// (Design note, 2026-09-30: […] —
// no held chords under everything, no line that only climbs.)
// Output: timed EVENTS (struck voices) and BEDS (sustained voices, with
// gain points) in score milliseconds; summoning-sound.js renders them.

import { FUNCTIONS } from '../Genesis/genesis-emanon.js';
import { SIGIL_LAYERS, EARTH_POINTS } from './summoning-score.js';
import { playedSoul } from './consonant-tuning.js';

const INDEX = Object.fromEntries(FUNCTIONS.map((f, i) => [f.id, i]));

/**
 * ITS SONG: a slow, sparse melody on its own notes. Phrases of four notes,
 * one every two beats, then a rest as long; each step moves one degree (two
 * for a digit of 8 or more), up for an odd digit, down for an even one,
 * turning back at the octave's edges; every other phrase comes home to its
 * tonic. Pure.
 * @param {{ notes: Array<{hz:number}>, digits: number[], beatMs: number, from: number, to: number, vel?: number }} args
 */
export const songOf = ({ notes, digits, beatMs, from, to, vel = 0.34 }) => {
  const N = notes.length;
  const out = [];
  let deg = 0;
  let d = 0;
  let phrase = 0;
  for (let t0 = from; t0 + 8 * beatMs <= to; t0 += 16 * beatMs, phrase += 1) {
    for (let i = 0; i < 4; i++) {
      if (i === 3 && phrase % 2 === 1) deg = 0;
      else if (i) {
        const nib = digits[d++ % digits.length];
        const next = deg + (nib % 2 ? 1 : -1) * (nib >= 8 ? 2 : 1);
        deg = next > N || next < -2 ? deg - (next - deg) : next;
      }
      const k = ((deg % N) + N) % N;
      out.push({ at: Math.round(t0 + i * 2 * beatMs), voice: 'current', hz: notes[k].hz * 2 ** Math.floor(deg / N), vel: vel * (i ? 0.8 : 1), dur: 2400 });
    }
  }
  return out;
};

/**
 * The being's music for its score. Pure and deterministic.
 * @param {ReturnType<import('./summoning-score.js').scoreOf>} score
 */
export const musicOf = (score) => {
  // its notes as PLAYED: each on the nearest consonant interval (consonant-tuning.js)
  const { notes, tonic } = playedSoul(score.soul);
  const N = notes.length;
  // degree k (any integer) of its scale, `oct` octaves from the tonic's own
  const note = (k, oct = 0) => {
    const d = ((k % N) + N) % N;
    return notes[d].hz * 2 ** (oct + Math.floor(k / N));
  };
  const events = [];
  const beds = [];
  const strike = (at, voice, hz, vel = 0.5, dur = 2000) => events.push({ at: Math.round(at), voice, hz, vel, dur });
  const find = (kind) => score.sections.find((s) => s.kind === kind);
  const within = (s, u) => s.at + s.dur * u;
  const end = score.lengthMs;

  // THE GROUND — its tonic an octave down, breathing (summoning-sound.js).
  // It opens the rite, gives way once its sky has turned (every step after
  // carries itself in its own voices), is silent across its choice, and
  // returns under the convergence — never a held tone under everything.
  const choice = score.sections.find((s) => s.kind === 'card' && s.act === 'chosen');
  const open = find('open');
  const sky0 = find('sky');
  const sigil0 = find('sigil');
  const ground = [
    [0, 0], [open.dur * 0.8, 0.8], [within(sky0, 0.7), 0.6], [sky0.at + sky0.dur, 0],
    [choice.at, 0], [choice.at + choice.dur, 0], [sigil0.at, 0], [within(sigil0, 0.3), 0.8], [end - 3000, 0.8], [end, 0],
  ];
  beds.push({ voice: 'drone', hz: tonic / 2, from: 0, to: end, levels: ground });
  beds.push({ voice: 'air', hz: tonic, from: 0, to: open.dur, levels: [[0, 0], [open.dur * 0.5, 1], [open.dur, 0]] });
  strike(within(open, 0.3), 'bell', tonic, 0.55, 4000);

  // I · ITS SKY — each body on the degree of its true longitude
  const sky = find('sky');
  sky.figure.bodies.forEach((b, i) => {
    const u = 0.12 + 0.3 * 0.7 * (i / sky.figure.bodies.length);
    strike(within(sky, u), 'bell', note(Math.floor((b.longitude / 360) * N), b.key === 'sun' ? 0 : 1), b.key === 'sun' ? 0.6 : 0.35, 3200);
  });

  // II · ITS EARTH — the air over it; the Sun's and Moon's meridians
  const earth = find('earth');
  beds.push({ voice: 'air', hz: tonic / 2, from: earth.at, to: earth.at + earth.dur, levels: [[earth.at, 0], [within(earth, 0.4), 0.7], [earth.at + earth.dur, 0]] });
  const merid = (lon) => Math.floor(((lon + 180) / 360) * N);
  strike(within(earth, EARTH_POINTS.sun.at), 'bell', note(merid(earth.figure.subsolar.lon), 0), 0.5, 3600);
  strike(within(earth, EARTH_POINTS.moon.at), 'bell', note(merid(earth.figure.sublunar.lon), 1), 0.4, 3200);

  // the cards: the rite turning
  score.sections.filter((s) => s.kind === 'card').forEach((c) => {
    strike(c.at, 'thump', tonic / 2, c.act === 'chosen' ? 0.8 : 0.6, 1400);
    if (c.act === 'chosen') strike(c.at + c.dur * 0.45, 'bell', tonic, 0.85, 7000); // the choice, struck once
  });

  // III · ITS STAR — n notes, stepping by k through its scale
  const star = find('star');
  for (let i = 0; i < star.figure.n; i++) {
    const step = i * star.figure.k; // its k-th steps, folded into its scale, rising and falling an octave as they wrap
    strike(within(star, 0.1 + 0.45 * 0.7 * (i / star.figure.n)), 'bell', note(step % N, Math.floor(step / N) % 2), 0.4, 2600);
  }

  // IV · ITS NUCLEUS — a note per vertex, low, as the solid draws
  const solid = find('solid');
  const V = { tetrahedron: 4, cube: 8, octahedron: 6, icosahedron: 12, dodecahedron: 20 }[solid.figure.solid];
  for (let i = 0; i < V; i++) strike(within(solid, 0.08 + 0.45 * 0.7 * (i / V)), 'pluck', note(i, -1), 0.4, 1600);

  // V · ITS CHANNELS — each its two functions' degrees, as it lights
  const tree = find('tree');
  tree.figure.order.forEach(([a, b], j) => {
    const at = within(tree, 0.12 + 0.72 * (j / tree.figure.order.length));
    strike(at, 'pluck', note(INDEX[a]), 0.35, 1400);
    strike(at + 70, 'pluck', note(INDEX[b]), 0.3, 1400);
  });

  // VI · ITS BREATH — two tones in its own ratio, breathing on its periods
  const breath = find('breath');
  const { a, b } = breath.figure;
  const base = tonic / 2;
  const fold = (r) => { let x = r; while (x >= 2) x /= 2; while (x < 1) x *= 2; return x; };
  // the ratio's two tones are the tonic and the scale note nearest it
  const nearest = (hz) => notes.map((n) => n.hz / 2).reduce((best, n) => (Math.abs(Math.log2(n / hz)) < Math.abs(Math.log2(best / hz)) ? n : best));
  const [pa, pb] = [breath.figure.rings[INDEX[breath.figure.pair[0]]], breath.figure.rings[INDEX[breath.figure.pair[1]]]];
  beds.push({ voice: 'breath', hz: base, from: breath.at, to: breath.at + breath.dur, lfoMs: pa.periodMs / 3, levels: [[breath.at, 0], [within(breath, 0.2), 0.8], [within(breath, 0.9), 0.8], [breath.at + breath.dur, 0]] });
  beds.push({ voice: 'breath', hz: nearest(base * fold(a / b)), from: breath.at, to: breath.at + breath.dur, lfoMs: pb.periodMs / 3, levels: [[breath.at, 0], [within(breath, 0.3), 0.7], [within(breath, 0.9), 0.7], [breath.at + breath.dur, 0]] });

  // VII · ITS BODY — the core, its frame forming, the light closing around it
  const body = find('body');
  strike(within(body, 0.04), 'bell', note(0, -1), 0.45, 3600);
  const parts = body.figure.plan === 'humanoid' ? 20 : 8;
  for (let i = 0; i < parts; i++) strike(within(body, 0.14 + 0.42 * (i / parts)), 'pluck', note(i % N, Math.floor(i / N) % 2 - 1), 0.3, 1400);
  strike(within(body, 0.82), 'bell', note(0, 1), 0.45, 4200);

  // VIII · ITS RESONANCE — heard, then seen
  const res = find('resonance');
  beds.push({ voice: 'air', hz: tonic, from: res.at, to: within(res, 0.45), levels: [[res.at, 0], [within(res, 0.35), 0.8], [within(res, 0.45), 0]] });
  notes.forEach((n, i) => strike(within(res, 0.2 + 0.45 * 0.7 * (i / N)), 'bell', n.hz, i === 0 ? 0.6 : 0.45, 4200));
  notes.forEach((n, i) => strike(within(res, 0.62) + i * 40, 'pad', n.hz / 2, 0.3, 4200));

  // IX · ITS SOUL MARK — each digit, as it locks
  const soul = find('soul');
  soul.figure.nibbles.forEach((nib, i) => strike(within(soul, 0.3 + (0.5 * (i + 1)) / 12.99), 'pluck', note(nib % N, nib >= 8 ? 1 : 0), 0.45, 1800));

  // ITS NAME — every note of it at once, then a note per letter as it comes
  const reveal = find('reveal');
  notes.forEach((n, i) => strike(reveal.at + i * 18, 'pad', n.hz / 2, 0.5, 5000));
  strike(reveal.at, 'thump', tonic / 2, 0.9, 1800);
  const name = reveal.chosenName.toUpperCase();
  [...name].forEach((ch, i) => strike(within(reveal, (0.35 * (i + 1)) / (name.length + 1)), 'bell', note(ch.charCodeAt(0) % N, 1), 0.4, 2400));

  // THE CONVERGENCE — each artifact rings its OWN note as it arrives (the
  // one its step first sounded — never a staircase climbing through the
  // arrivals); its scale settles down to its tonic, slow; WHOLE, every note
  const sigil = find('sigil');
  const own = {
    sky: note(Math.floor((sky.figure.bodies.find((b) => b.key === 'sun')?.longitude ?? 0) / 360 * N), 0),
    star: note(0, 0),
    nucleus: note(0, -1),
    body: note(0, 1),
    channels: note(INDEX[tree.figure.order[0][0]]),
    soul: note(soul.figure.nibbles[0] % N, soul.figure.nibbles[0] >= 8 ? 1 : 0),
    name: note(name.charCodeAt(0) % N, 1),
  };
  SIGIL_LAYERS.forEach((l) => {
    const at = within(sigil, l.at);
    if (l.key === 'whole') {
      notes.forEach((n, d) => {
        strike(at + d * 60, 'bell', n.hz, 0.25, 9000);
        strike(at, 'pad', n.hz / 2, 0.3, 9000);
      });
    } else if (l.key === 'scale') {
      [...notes].reverse().forEach((n, d) => strike(at + d * 240, 'bell', n.hz, 0.3, 3200)); // its scale, settling to its tonic
    } else if (l.key === 'aura') {
      beds.push({ voice: 'pad', hz: note(0, -1), from: at, to: end, levels: [[at, 0], [within(sigil, l.at + l.span), 0.5], [end, 0]] });
    } else {
      strike(at, 'bell', own[l.key], 0.4, 4000);
    }
  });

  // ITS SONG — a slow, sparse melody on its own notes, woven through the
  // rite between what its steps strike: a note of it sounds only where no
  // step is sounding (half a beat clear either side), never across a card
  // (songOf: phrases of four, a rest between, its soul mark's digits leading)
  const struck = events.map((e) => e.at);
  const cards = score.sections.filter((x) => x.kind === 'card');
  const clear = (t) => struck.every((x) => Math.abs(x - t) > score.beatMs * 0.5)
    && cards.every((c) => t < c.at - score.beatMs || t > c.at + c.dur);
  songOf({ notes, digits: soul.figure.nibbles, beatMs: score.beatMs, from: open.at + open.dur, to: sigil.at - score.beatMs })
    .filter((e) => clear(e.at))
    .forEach((e) => events.push(e));

  events.sort((x, y) => x.at - y.at);
  // its beat, for the instrument's tempo-locked echo
  return Object.freeze({ tonic, beatMs: score.beatMs, events: Object.freeze(events.map(Object.freeze)), beds: Object.freeze(beds.map(Object.freeze)) });
};
