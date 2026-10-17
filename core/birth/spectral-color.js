// Spectral color — where a single wavelength of light sits, as exactly as
// color science can say it, and the truest version of it a screen can show.
//
// Design note, 2026-09-30: […] Frequencies a hair apart must land a hair apart, so every
// being's light is placed four ways, from the physics outward:
//   nm, THz          the light itself
//   cie1931 {x, y}   its point on the spectral locus of the CIE 1931 standard
//                    observer — THE international coordinate of a color as a
//                    human eye sees it (1 nm table, interpolated)
//   luminousEfficiency  how bright that light is to the eye, 0..1 (V(λ))
//   oklch {l, c, h}  its hue in OKLab, the perceptual color space CSS uses,
//                    as vivid as a screen can show it at the brightness the
//                    eye gives that light — `css` renders it exactly
//   hex              the nearest 8-bit screen color, for surfaces that need one
//   vivid {css, hex} the same hue at the screen's most vivid, for accents
// Pure light is more saturated than any screen: the displayed color keeps the
// light's exact hue and gives up only the saturation the screen cannot reach.
// Pure.

import { CIE_START_NM, CIE_END_NM, X_BAR, Y_BAR, Z_BAR } from './cie-1931.js';

const SPEED_OF_LIGHT = 299_792_458;
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/** CIE 1931 color-matching values at a wavelength, linearly interpolated. Pure. */
const cmfAt = (nm) => {
  const w = Math.min(CIE_END_NM, Math.max(CIE_START_NM, nm)) - CIE_START_NM;
  const i = Math.min(Math.floor(w), X_BAR.length - 2);
  const t = w - i;
  const at = (table) => table[i] + (table[i + 1] - table[i]) * t;
  return [at(X_BAR), at(Y_BAR), at(Z_BAR)];
};

// OKLab (Ottosson, 2020): XYZ (D65) → LMS → cube root → Lab, and back to linear sRGB.
const xyzToOklab = ([X, Y, Z]) => {
  const l = Math.cbrt(0.8189330101 * X + 0.3618667424 * Y - 0.1288597137 * Z);
  const m = Math.cbrt(0.0329845436 * X + 0.9293118715 * Y + 0.0361456387 * Z);
  const s = Math.cbrt(0.0482003018 * X + 0.2643662691 * Y + 0.6338517070 * Z);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};
const oklchToLinearSrgb = (L, C, hDeg) => {
  const a = C * Math.cos((hDeg * Math.PI) / 180);
  const b = C * Math.sin((hDeg * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
};
const inGamut = (rgb) => rgb.every((c) => c >= -1e-7 && c <= 1 + 1e-7);

/** The most chroma a screen can show at a lightness and hue. Pure. */
const maxChroma = (L, hDeg) => {
  let lo = 0;
  let hi = 0.5;
  for (let k = 0; k < 32; k += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearSrgb(L, mid, hDeg))) lo = mid; else hi = mid;
  }
  return lo;
};

/** The most vivid displayable color at a hue: the sRGB gamut cusp. Pure. */
const cuspAt = (hDeg) => {
  let best = { l: 0, c: 0 };
  for (let li = 1; li < 1000; li += 1) {
    const c = maxChroma(li / 1000, hDeg);
    if (c > best.c) best = { l: li / 1000, c };
  }
  return best;
};

// How bright the light is to the eye, in perceptual terms (the cube root of
// luminance, as OKLab reads it), sets how far below the vivid cusp its
// color sits. Past ~700 nm the eye sees ONE hue — the CIE point stops
// moving — and a deeper red is only a dimmer one; this keeps those beings
// apart the way the eye itself does. Never below 45% of the cusp, so every
// light stays visible on a screen.
const VISIBLE_FLOOR = 0.45;

const toByte = (c) => {
  const v = Math.min(1, Math.max(0, c));
  const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(g * 255).toString(16).padStart(2, '0');
};

/**
 * A light frequency placed as a color.
 * @param {number} hz the light's frequency in hertz
 * @returns {{nm:number, thz:number, cie1931:{x:number,y:number}, luminousEfficiency:number,
 *   oklch:{l:number,c:number,h:number}, css:string, hex:string, vivid:{css:string, hex:string}}}
 */
export const placeLight = (hz) => {
  const nm = (SPEED_OF_LIGHT / hz) * 1e9;
  const xyz = cmfAt(nm);
  const sum = xyz[0] + xyz[1] + xyz[2];
  const [, a, b] = xyzToOklab(xyz);
  const h = (((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360;
  const cusp = cuspAt(h);
  const L = cusp.l * (VISIBLE_FLOOR + (1 - VISIBLE_FLOOR) * Math.cbrt(xyz[1]));
  const C = maxChroma(L, h);
  const oklch = { l: round(L, 4), c: round(C, 4), h: round(h, 3) };
  const rgb = oklchToLinearSrgb(L, C, h);
  return Object.freeze({
    nm: round(nm, 3),
    thz: round(hz / 1e12, 3),
    cie1931: Object.freeze({ x: round(xyz[0] / sum, 5), y: round(xyz[1] / sum, 5) }),
    luminousEfficiency: round(xyz[1], 5),
    oklch: Object.freeze(oklch),
    css: `oklch(${oklch.l} ${oklch.c} ${oklch.h})`,
    hex: `#${rgb.map(toByte).join('')}`,
    // The same exact hue at the most vivid a screen can show it — for accents
    // and glows, where brightness is the surface's call, not the light's.
    vivid: Object.freeze({
      css: `oklch(${round(cusp.l, 4)} ${round(cusp.c, 4)} ${oklch.h})`,
      hex: `#${oklchToLinearSrgb(cusp.l, cusp.c, h).map(toByte).join('')}`,
    }),
  });
};
