// rgba — making a translucent colour editable with a picker.
//
// `<input type="color">` speaks only #rrggbb. The old panel checked for exactly
// that and, for anything else, drew a dead chip beside a bare text box — so
// roughly a third of Umbrae's palette (every `rgba(247,243,234,0.66)` ink role,
// every hairline) could only be edited by typing the numbers.
//
// Here the two halves are separated: the picker drives the hue, a slider drives
// the alpha, and they are recomposed on the way back.
//
// ⚠️ FORMAT IS PRESERVED. A value that arrived as `rgba(...)` leaves as
// `rgba(...)`; one that arrived as #rrggbbaa leaves as #rrggbbaa. Rewriting
// every translucent colour into one canonical form would show a diff on every
// kit somebody merely opened, and would quietly restyle a file a human wrote.
//
// Pure throughout.

import { parseColor } from './contrast.js';

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Which way this value was written, so it can be written back the same way. */
export const formatOf = (value) => {
  const text = String(value || '').trim();
  if (/^rgba?\(/.test(text)) return 'rgba';
  if (/^#[0-9a-fA-F]{8}$/.test(text)) return 'hex8';
  return 'hex';
};

/** The opaque hue of a colour, as the #rrggbb a picker can hold. Pure.
 *  Returns null when the value is not a colour — the picker is then hidden
 *  rather than shown holding a value nobody chose. */
export const hueOf = (value) => {
  const c = parseColor(value);
  return c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : null;
};

/** Its alpha, 0-1. Pure. */
export const alphaOf = (value) => {
  const c = parseColor(value);
  return c ? c.a : 1;
};

/**
 * Put a hue and an alpha back together, in the shape it came in. Pure.
 *
 * An alpha of exactly 1 collapses to plain #rrggbb when the value was already
 * hex — `#22d3eeff` is the same colour written more noisily, and a kit should
 * read the way a person would write it.
 */
export const recompose = (hue, alpha, format) => {
  const c = parseColor(hue) || { r: 0, g: 0, b: 0 };
  const a = Math.min(1, Math.max(0, Number(alpha)));
  if (format === 'rgba') {
    return a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${Math.round(a * 100) / 100})`;
  }
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return a >= 1 ? base : `${base}${hex2(a * 255)}`;
};
