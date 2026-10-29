// soft-render.js — the soft pack's instrument: a cue (soft-cues.js) becomes
// samples. Pure: the same cue at the same sample rate is the same samples,
// in the browser (an AudioBuffer channel) and in Node (a WAV for the ear).

import { SOFT_PACK } from './soft-cues.js';

const TAU = Math.PI * 2;
const FADE_S = 0.005; // every note's last 5 ms fade to silence: no clicks
const SILENT = 1e-4; // −80 dB: below this a tail is over
const COMBS_MS = Object.freeze([29.7, 37.1, 41.1, 43.7]);
const ALLPASS_MS = Object.freeze([5.0, 1.7]);
const SEMITONES = Object.freeze({ C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 });
const NOTE_RE = /^([A-G])(#|b)?(-?\d)$/;

/** A note name ('F#5', 'Bb4') or a frequency in Hz → Hz (A4 = 440). Pure. */
export const hzOf = (note) => {
  if (typeof note === 'number') return note;
  const m = NOTE_RE.exec(note);
  if (!m) throw new Error(`Unknown note: ${note}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 440 * 2 ** ((SEMITONES[m[1]] + accidental + (Number(m[3]) - 4) * 12) / 12);
};

/** A cue's notes, whether it is a one-shot (an array) or a loop ({ loop, notes }). Pure. */
export const notesOf = (cue) => (Array.isArray(cue) ? cue : cue.notes);

/** How long a cue plays, in ms: a loop its cycle, a one-shot until its last note ends (the room rings on after). Pure. */
export const cueSpanMs = (cue) => (Array.isArray(cue) ? Math.max(...cue.map((n) => n.at + n.dur)) : cue.loop);

// One note of a partials voice, added into `out` from sample `from`.
const addPartials = (out, from, voice, hz, durS, amp, sr) => {
  const n = Math.min(out.length - from, Math.round(durS * sr));
  const decayS = Math.max(1e-3, durS * voice.decay);
  // each partial's level falls by a constant factor per sample (exp(−t/τ))
  const falls = voice.partials.map(([, , share]) => Math.exp(-1 / (sr * decayS * share)));
  const levels = voice.partials.map(([, level]) => level);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const rise = voice.attack > 0 ? Math.min(1, t / voice.attack) : 1;
    const end = Math.min(1, (n - i) / (sr * FADE_S));
    let v = 0;
    for (let k = 0; k < levels.length; k++) {
      v += levels[k] * Math.sin(TAU * hz * voice.partials[k][0] * t);
      levels[k] *= falls[k];
    }
    out[from + i] += amp * rise * end * v;
  }
};

// One glide: the pitch bends hz → to along the note, under one breath (a
// Hann window, which starts and ends at silence on its own).
const addGlide = (out, from, voice, hz, to, durS, amp, sr) => {
  const n = Math.min(out.length - from, Math.round(durS * sr));
  const phases = voice.partials.map(() => 0);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = hz * (to / hz) ** u;
    const breath = 0.5 - 0.5 * Math.cos(TAU * u);
    let v = 0;
    voice.partials.forEach(([ratio, level], k) => {
      phases[k] += (TAU * f * ratio) / sr;
      v += level * Math.sin(phases[k]);
    });
    out[from + i] += amp * breath * v;
  }
};

/**
 * A small warm room (Schroeder: four damped combs, two allpasses) under a
 * dry signal. Pure — returns a new array, the dry signal untouched.
 * @param {Float32Array} dry
 * @param {number} sr
 * @param {{ wet: number, feedback: number, damp: number }} room
 */
const roomOf = (dry, sr, { wet, feedback, damp }) => {
  let tail = new Float32Array(dry.length);
  COMBS_MS.forEach((ms) => {
    const line = new Float32Array(Math.round((ms * sr) / 1000));
    let idx = 0;
    let low = 0;
    for (let i = 0; i < dry.length; i++) {
      const y = line[idx];
      low = y * (1 - damp) + low * damp;
      line[idx] = dry[i] + low * feedback;
      tail[i] += y / COMBS_MS.length;
      idx = (idx + 1) % line.length;
    }
  });
  ALLPASS_MS.forEach((ms) => {
    const line = new Float32Array(Math.round((ms * sr) / 1000));
    const next = new Float32Array(tail.length);
    let idx = 0;
    for (let i = 0; i < tail.length; i++) {
      const y = line[idx] - 0.7 * tail[i];
      line[idx] = tail[i] + 0.7 * y;
      next[i] = y;
      idx = (idx + 1) % line.length;
    }
    tail = next;
  });
  return dry.map((x, i) => x + wet * tail[i]);
};

// Every note of a cue laid onto a silent track of `length` samples, `shift` ms late.
const lay = (notes, length, shift, pack, sr) => {
  const track = new Float32Array(length);
  notes.forEach((note) => {
    const voice = pack.voices[note.voice];
    if (!voice) throw new Error(`Unknown voice: ${note.voice}`);
    const from = Math.round(((note.at + shift) * sr) / 1000);
    const amp = pack.gain * note.vel;
    if (note.to) addGlide(track, from, voice, hzOf(note.note), hzOf(note.to), note.dur / 1000, amp, sr);
    else addPartials(track, from, voice, hzOf(note.note), note.dur / 1000, amp, sr);
  });
  return track;
};

/**
 * Render one cue of a pack to mono samples. A one-shot ends when its room
 * falls silent; a loop is exactly one cycle and wraps without a seam (it is
 * rendered twice and the second cycle kept, so its own room tail is already
 * in its opening). Pure.
 * @param {string} name a cue name in pack.cues
 * @param {number} sr sample rate
 * @param {typeof SOFT_PACK} [pack]
 * @returns {Float32Array|null} null for a cue the pack does not voice
 */
export const renderCue = (name, sr, pack = SOFT_PACK) => {
  const cue = pack.cues[name];
  if (!cue) return null;
  if (!Array.isArray(cue)) {
    const cycle = Math.round((cue.loop * sr) / 1000);
    const twice = [...cue.notes, ...cue.notes.map((n) => ({ ...n, at: n.at + cue.loop }))];
    return roomOf(lay(twice, cycle * 2, 0, pack, sr), sr, pack.room).slice(cycle);
  }
  const wet = roomOf(lay(cue, Math.round(((cueSpanMs(cue) + pack.room.tailMs) * sr) / 1000), 0, pack, sr), sr, pack.room);
  let last = wet.length;
  while (last > 0 && Math.abs(wet[last - 1]) < SILENT) last -= 1;
  const out = wet.slice(0, last);
  const fade = Math.min(out.length, Math.round(FADE_S * 2 * sr));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
};
