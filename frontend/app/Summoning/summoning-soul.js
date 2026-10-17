// summoning-soul.js — the being's SOUL as THE SUMMONING carries it: its
// light (soul color) and its scale of notes. Pure.
//
// Both are READ from the being's own records, never chosen here
// (core/birth/soul-spectrum.js → identity/soul-spectrum.json;
// core/birth/soul-scale.js → identity/soul-scale.json): its light is its
// resonance placed as a wavelength (CIE 1931, OKLCH hue to 0.001°); its scale
// is its tonic and the pitches its ceremony stages measured.
//
// To DRAW its light as line on the void, the hue is kept exactly and only
// the lightness is lifted (and chroma eased back into the screen's gamut):
// the eye gives a 457 nm violet very little brightness, and a hairline of
// it on black would vanish. Its hue is its identity; its lightness is ours.
//
// ITS SCALE IN LIGHT: the lane defines a being's color as the same note 40
// octaves up — its heart band [348, 696) Hz lands exactly on the visible
// octave (core/birth/soul-resonance.js). So every degree of its scale has a
// true color too: folded into the heart band by whole octaves, lifted 40.
// That is its palette — up to seven hues, all its own — and its CONTRAST is
// the degree whose hue stands farthest from its tonic's.

import { lightOf, HEART_BAND } from '../../../core/birth/soul-resonance.js';

const LINE_L = 0.8; // OKLab lightness a hairline reads at on the void

// OKLCH → linear sRGB (Ottosson, 2020).
const linearOf = (L, C, h) => {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
};
const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
const encode = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));

/**
 * Its light as a drawable "r,g,b" at line lightness: the hue exact, the
 * chroma as high as the screen allows at that lightness. Pure.
 * @param {{ oklch: { h: number, c: number } }} soul the spectrum's `soul` placement
 */
export const lineRgbOf = (soul) => {
  const h = soul.oklch.h;
  let lo = 0;
  let hi = Math.max(0.05, soul.oklch.c * 1.6);
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(linearOf(LINE_L, mid, h))) lo = mid; else hi = mid;
  }
  return linearOf(LINE_L, lo, h).map(encode).join(',');
};

/** A frequency folded into the heart band by whole octaves (the lane's own band). Pure. */
const intoBand = (hz) => {
  const f = hz / 2 ** Math.floor(Math.log2(hz / HEART_BAND.low));
  return f >= HEART_BAND.high ? f / 2 : f;
};
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * The soul a summoning carries: its light and its scale, checked. Pure;
 * throws when either record is missing — every born being has both.
 * @param {{ frequency: number, soul: object, source: string }} spectrum identity/soul-spectrum.json
 * @param {{ tonic: { hz: number }, notes: Array<{ degree: number, hz: number, cents: number, nearestRatio: string }> }} scale identity/soul-scale.json
 */
export const soulOf = (spectrum, scale) => {
  if (!(spectrum?.frequency > 0) || !spectrum.soul?.oklch) throw new Error('a summoning needs its soul color (identity/soul-spectrum.json) — every born being has one');
  if (!(scale?.tonic?.hz > 0) || !scale.notes?.length) throw new Error('a summoning needs its scale (identity/soul-scale.json) — every born being has one');
  const notes = scale.notes.map((n) => {
    const light = lightOf(intoBand(n.hz));
    // a degree just under the octave is recorded nearest the tonic an octave
    // up (the lane's "1/1"); shown, that interval is truly 2/1
    const ratio = n.nearestRatio === '1/1' && n.cents > 600 ? '2/1' : n.nearestRatio;
    return Object.freeze({ degree: n.degree, hz: n.hz, cents: n.cents, ratio, name: n.name, nm: light.nm, thz: light.thz, hue: light.oklch.h, line: lineRgbOf(light) });
  });
  const hue = spectrum.soul.oklch.h;
  const counter = notes.reduce((far, n) => (hueGap(n.hue, hue) > hueGap(far.hue, hue) ? n : far), notes[0]);
  return Object.freeze({
    source: spectrum.source,
    nm: spectrum.soul.nm,
    thz: spectrum.soul.thz,
    hue,
    line: lineRgbOf(spectrum.soul),
    // its contrast: the degree of its own scale whose light stands farthest from its tonic's
    counter: counter.line,
    counterDegree: counter.degree,
    tonic: scale.tonic.hz,
    tonicName: scale.tonic.name,
    notes: Object.freeze(notes),
  });
};
