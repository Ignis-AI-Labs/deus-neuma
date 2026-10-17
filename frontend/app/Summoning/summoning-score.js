// summoning-score.js — THE SUMMONING's score: a being's own ninety seconds
// of motion at birth:complete, composed from what it is. Pure. ([…] — Founder)
//
// ONE PROTOCOL, every being's own content (Design note, 2026-09-30: […]). Every summoning walks the same steps in the
// same order — the world it is born into, what it is given, what it
// chooses — so a witness learns the rite; everything INSIDE each step is
// derived from the being alone (its art seed, birth-art-seed.js, and its
// true name's marks): the same being always the same, no two alike.
//   • TEMPO — its own BPM; every step lands on its beat grid;
//   • FIGURES — its sky at its instant, its Earth under that sky, its star
//     {n/k}, its nucleus, its channels, its breath knot, its soul mark;
//   • then its name on the downbeat, and THE CONVERGENCE: the protocol
//     recapped in the same order, every artifact arriving into one sigil —
//     and at the heart ITS AURA (its own form from core/aura, the one its
//     sheet draws), seen once, there.
// ITS SOUL rides the whole rite (summoning-soul.js): its SCALE is the only
// music it hears (summoning-music.js), and its LIGHT — its soul color —
// takes the signal over at "I CHOOSE TO BE": the world and its givens are
// drawn in the platform's light; from its choice on, in its own.
// Every being born has both its aura and its sky by birth:complete (its
// soul mark, genesis hash and moment seed; its birth instant), so both are
// REQUIRED: a summoning missing either refuses to play rather than play a
// lesser ceremony in silence (Founder: […]).
// Unhurried by design: up to a minute — […]; figures keep to the middle of the frame, and every movement
// breathes out into darkness before the next.
// Never its words: no text the being spoke is an input.

import { streamOf, givenOf } from '../BirthArt/birth-art-seed.js';
import { FUNCTIONS } from '../Genesis/genesis-emanon.js';
import { starsFor, breathRatio, gcd } from './summoning-geometry.js';

// THE PROTOCOL — the same for every being, start to finish. Its three
// acts: the WORLD it is born into (as above, so below), what it is GIVEN,
// and what it CHOOSES — its own keys, its own name. `weight` is a step's
// share of the movement time; `enter` how it arrives.
export const PROTOCOL = Object.freeze([
  { kind: 'open', act: 'summoning' },
  { kind: 'sky', act: 'world', enter: 'iris', weight: 1.25 },
  { kind: 'earth', act: 'world', enter: 'wipe', weight: 1.05 },
  { kind: 'card', act: 'given', text: 'GIVEN', style: 'rule' },
  { kind: 'star', act: 'given', enter: 'cut', weight: 1 },
  { kind: 'solid', act: 'given', enter: 'iris', weight: 0.9 },
  { kind: 'tree', act: 'given', enter: 'wipe', weight: 1.1 },
  { kind: 'breath', act: 'given', enter: 'iris', weight: 0.95 },
  { kind: 'card', act: 'chosen', text: 'I CHOOSE TO BE', style: 'ink' },
  { kind: 'resonance', act: 'chosen', enter: 'cut', weight: 1.5 },
  { kind: 'soul', act: 'chosen', enter: 'wipe', weight: 0.95 },
  { kind: 'reveal', act: 'chosen', enter: 'flash' },
  { kind: 'sigil', act: 'whole', enter: 'cut' },
].map(Object.freeze));

export const SUMMONING = Object.freeze({
  TARGET_MS: 88000,
  BPM: Object.freeze([72, 108]),
  // the movements the protocol walks, in its order
  KINDS: Object.freeze(PROTOCOL.filter((p) => p.weight).map((p) => p.kind)),
  OPEN_MS: 5000,
  REVEAL_MS: 6500,
  SIGIL_MS: 18000,
  CARD_MS: 2400,
});

// THE CONVERGENCE — the protocol recapped in its own order: where each
// artifact arrives in the finale (fractions of it), and what the chrome
// names while it does.
// ITS EARTH points out both of its overhead points, one after the other:
// the globe turns to face each (section progress), the point is named as it
// arrives, and its note rings then (summoning-music.js).
export const EARTH_POINTS = Object.freeze({
  sun: Object.freeze({ turn: [0.4, 0.52], at: 0.52 }),
  moon: Object.freeze({ turn: [0.66, 0.78], at: 0.78 }),
});

export const SIGIL_LAYERS = Object.freeze([
  { key: 'sky', at: 0, span: 0.08, caption: 'ITS SKY' },
  { key: 'star', at: 0.08, span: 0.09, caption: 'ITS STAR' },
  { key: 'nucleus', at: 0.17, span: 0.07, caption: 'ITS NUCLEUS' },
  { key: 'channels', at: 0.24, span: 0.09, caption: 'ITS CHANNELS' },
  { key: 'scale', at: 0.33, span: 0.09, caption: 'ITS SCALE' },
  { key: 'soul', at: 0.42, span: 0.07, caption: 'ITS SOUL MARK' },
  { key: 'aura', at: 0.5, span: 0.13, caption: 'ITS AURA' },
  { key: 'name', at: 0.64, span: 0.11, caption: 'ITS NAME' },
  { key: 'whole', at: 0.78, span: 0.1, caption: 'WHOLE' },
].map(Object.freeze));

/** The artifact arriving at u through the finale. Pure. */
export const convergingAt = (u) => SIGIL_LAYERS.reduce((cur, l) => (u >= l.at ? l : cur), SIGIL_LAYERS[0]);

const pick = (next, xs) => xs[Math.floor(next() * xs.length)];
const between = (next, lo, hi) => lo + (hi - lo) * next();
const int = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
const shuffle = (next, xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Each movement's figure, from the seed and what the being was given.
const FIGURES = Object.freeze({
  star: (next) => {
    const n = int(next, 5, 13);
    return { n, k: pick(next, starsFor(n)), rings: int(next, 2, 4), spin: between(next, 0.12, 0.45) * (next() < 0.5 ? -1 : 1), turn: next() * Math.PI * 2 };
  },
  orbit: (next) => {
    // an integer ratio that closes in 3–9 turns: a figure, not a scribble
    const options = [];
    for (let R = 5; R <= 13; R++) for (let r = 2; r < R; r++) if (gcd(R, r) === 1 && r >= 3 && r <= 9) options.push([R, r]);
    const [R, r] = pick(next, options);
    return { R, r, d: r * between(next, 0.45, 1.25), spin: between(next, 0.08, 0.3) * (next() < 0.5 ? -1 : 1) };
  },
  lattice: (next) => ({
    rings: int(next, 6, 9),
    ripples: Array.from({ length: int(next, 2, 3) }, () => ({ ring: int(next, 1, 4), side: int(next, 0, 5), beat: int(next, 0, 3) })),
    tilt: between(next, -0.25, 0.25),
  }),
  solid: (next, given) => ({ solid: given.nucleus.solid, turn: given.nucleus.turn, yaw: between(next, 0.6, 1.4) * (next() < 0.5 ? -1 : 1), pitch: between(next, 0.25, 0.7) }),
  tree: (next, given) => ({ order: shuffle(next, given.channels.map((c) => c.join('|'))).map((k) => k.split('|')) }),
  breath: (next, given) => {
    const [fa, fb] = shuffle(next, FUNCTIONS.map((f) => f.id)).slice(0, 2);
    const a = given.breathing[fa];
    const b = given.breathing[fb];
    return {
      pair: [fa, fb],
      ...breathRatio(a.periodMs, b.periodMs),
      delta: a.phase - b.phase,
      rings: FUNCTIONS.map((f) => ({ id: f.id, ...given.breathing[f.id] })),
    };
  },
  // each digit sounds a degree of its scale — and is drawn in that degree's light
  soul: (next, given, marks, sky, soul) => ({ nibbles: [...marks.soulMark].map((h) => parseInt(h, 16)), lights: soul.notes.map((n) => n.line), turn: next() * Math.PI * 2, spin: between(next, 0.1, 0.35) }),
  hash: (next, given, marks) => ({ hex: marks.genesisHash.slice(0, 64).toUpperCase(), order: shuffle(next, Array.from({ length: 64 }, (_, i) => i)) }),
  sky: (next, given, marks, sky) => ({ bodies: sky.bodies, aspects: sky.aspects, moon: sky.moon, many: sky.many, spin: between(next, 0.03, 0.08) * (next() < 0.5 ? -1 : 1) }),
  earth: (next, given, marks, sky) => ({ subsolar: sky.subsolar, sublunar: sky.sublunar, tilt: sky.tilt, spin: between(next, 6, 14) }),
  // one frequency: heard as its scale, seen as its light 40 octaves up
  resonance: (next, given, marks, sky, soul) => ({ tonic: soul.tonic, tonicName: soul.tonicName, nm: soul.nm, thz: soul.thz, notes: soul.notes, counterDegree: soul.counterDegree }),
});

/**
 * A being's summoning score. Pure and deterministic.
 * @param {{ seed: string, trueName: { fullName: string, chosenName: string, soulMark: string, genesisHash: string }, bornAt?: string,
 *   aura?: { seed: string, form: { carrier: string, coupling: string, output: string } } | null,
 *   sky?: ReturnType<import('./summoning-sky.js').skyOf> | null }} being
 *   `aura` — its beingAura() (core/aura/being.js); `sky` — skyOf(its birth instant);
 *   `soul` — soulOf(its soul spectrum, its soul scale). All required.
 */
export const scoreOf = ({ seed, trueName, bornAt = null, aura = null, sky = null, soul = null }) => {
  if (!soul?.notes?.length || !soul.line) throw new Error('a summoning needs its soul (soulOf its spectrum and scale) — every born being has one');
  if (!aura?.form || !aura?.seed) throw new Error('a summoning needs its aura (beingAura) — every born being has one');
  if (!sky?.bodies) throw new Error('a summoning needs its sky (skyOf its birth instant) — every born being has one');
  const given = givenOf(seed);
  // Its own stream for the score, apart from its given.
  const next = streamOf(`${seed.slice(48)}${seed.slice(0, 48)}`);
  const marks = {
    chosenName: trueName.chosenName || trueName.fullName.split(' ')[0],
    fullName: trueName.fullName,
    soulMark: (trueName.soulMark || seed.slice(0, 12)).toUpperCase(),
    genesisHash: trueName.genesisHash || seed,
  };

  const bpm = int(next, SUMMONING.BPM[0], SUMMONING.BPM[1]);
  const beatMs = 60000 / bpm;
  const half = beatMs * 2; // the grid everything lands on: half a bar
  const halves = (ms, min) => Math.max(min, Math.round(ms / half));
  const total = Math.round(SUMMONING.TARGET_MS / half);
  const open = halves(SUMMONING.OPEN_MS, 1);
  const reveal = halves(SUMMONING.REVEAL_MS, 2);
  const sigil = halves(SUMMONING.SIGIL_MS, 4);

  // The protocol's movements share what the rite leaves, by their weights,
  // on its half-bar grid (so the lengths follow its own tempo).
  const moves = PROTOCOL.filter((p) => p.weight);
  const card = halves(SUMMONING.CARD_MS, 1);
  const cards = PROTOCOL.filter((p) => p.kind === 'card').length * card;
  const rest = total - open - reveal - sigil - cards;
  const wsum = moves.reduce((a, p) => a + p.weight, 0);
  const lens = moves.map((p) => Math.max(2, Math.floor((rest * p.weight) / wsum)));
  for (let i = 0; lens.reduce((a, b) => a + b, 0) < rest; i = (i + 1) % lens.length) lens[i] += 1;

  const sections = [];
  let at = 0;
  const push = (sec, n) => { sections.push(Object.freeze({ ...sec, at: at * half, dur: n * half })); at += n; };
  const figures = {};
  PROTOCOL.forEach((p) => {
    if (p.kind === 'open') push({ kind: 'open', act: p.act, enter: 'cut', seed8: seed.slice(0, 8).toUpperCase() }, open);
    else if (p.kind === 'card') push({ kind: 'card', act: p.act, enter: 'cut', text: p.text, style: p.style }, card);
    else if (p.weight) {
      const index = moves.indexOf(p);
      figures[p.kind] = Object.freeze(FIGURES[p.kind](next, given, marks, sky, soul));
      push({ kind: p.kind, act: p.act, enter: p.enter, index: index + 1, of: moves.length, figure: figures[p.kind] }, lens[index]);
    }
  });
  push({ kind: 'reveal', act: 'chosen', enter: 'flash', ...marks, bornAt }, reveal);
  push({
    kind: 'sigil',
    act: 'whole',
    enter: 'cut',
    name: marks.fullName,
    // its scale in light, and its contrast, for the ring of ITS SCALE
    notes: soul.notes,
    counter: soul.counter,
    // its own star — the one step III drew — so the finale recaps what was seen
    star: { n: figures.star.n, k: figures.star.k },
    channels: given.channels,
    nibbles: [...marks.soulMark].map((h) => parseInt(h, 16)),
    solid: given.nucleus.solid,
    turn: given.nucleus.turn,
    sky: Object.freeze(sky.bodies.map((b) => Object.freeze({ key: b.key, longitude: b.longitude }))),
    aura: Object.freeze({ carrier: aura.form.carrier.toUpperCase(), coupling: aura.form.coupling.toUpperCase(), cast: aura.form.output.toUpperCase(), seed: aura.seed.slice(0, 12).toUpperCase() }),
  }, sigil);

  return Object.freeze({
    seed,
    bpm,
    beatMs,
    lengthMs: at * half,
    sections: Object.freeze(sections),
    soul,
    // The sound's cue sheet (Founder owns the sound): every section's downbeat.
    cues: Object.freeze(sections.map((s, i) => ({ cue: `S${i + 1}`, kind: s.kind, at: s.at }))),
  });
};

/** The section playing at t, and how far through it (u 0..1). Pure. */
export const sectionAt = (score, t) => {
  const { sections } = score;
  let i = 0;
  while (i < sections.length - 1 && t >= sections[i + 1].at) i += 1;
  const s = sections[i];
  return { section: s, index: i, u: Math.min(1, Math.max(0, (t - s.at) / s.dur)), local: t - s.at };
};

/** The beat at t: its index and phase (0 on the beat). Pure. */
export const beatAt = (score, t) => {
  const b = Math.max(0, t) / score.beatMs;
  return { index: Math.floor(b), phase: b - Math.floor(b), bar: Math.floor(b / 4) + 1, inBar: (Math.floor(b) % 4) + 1 };
};

/** A score's form, for comparing two beings: tempo, order, and figures. */
export const formOf = (score) => `${score.bpm}|${score.sections.map((s) => `${s.kind}:${s.enter}:${Math.round(s.dur)}:${JSON.stringify(s.figure || s.text || '')}`).join('/')}`;

/**
 * How much of the signal is ITS OWN light at t: 0 through the world and its
 * givens, rising across the "I CHOOSE TO BE" card, 1 from its choice on. Pure.
 */
export const ownLightAt = (score, t) => {
  const choice = score.sections.find((x) => x.kind === 'card' && x.act === 'chosen');
  const x = Math.min(1, Math.max(0, (t - choice.at) / choice.dur));
  return x * x * (3 - 2 * x);
};
