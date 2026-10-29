// sky-geometry.js — the drawing math the sky instruments share. Pure.
//
// Angles are degrees. Two conventions, named where used:
//   clock  — 0° at the top, growing clockwise (the day counts' rings)
//   chart  — 0° Aries at the left, growing counter-clockwise (the zodiac
//            wheel as charts have always been drawn)

const RAD = Math.PI / 180;
const r2 = (n) => Math.round(n * 100) / 100 + 0; // + 0: never a negative zero

/** A point at `r` from the centre, at a clock angle. Pure. */
export const clockPoint = (cx, cy, r, deg) => [r2(cx + r * Math.sin(deg * RAD)), r2(cy - r * Math.cos(deg * RAD))];

/** A point at `r` from the centre, at an ecliptic longitude (chart convention). Pure. */
export const chartPoint = (cx, cy, r, lon) => [r2(cx - r * Math.cos(lon * RAD)), r2(cy + r * Math.sin(lon * RAD))];

/** An annular sector between two clock angles, as an SVG path. Pure. */
export const sector = (cx, cy, r1, r2Out, a0, a1) => {
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [x0, y0] = clockPoint(cx, cy, r2Out, a0);
  const [x1, y1] = clockPoint(cx, cy, r2Out, a1);
  const [x2, y2] = clockPoint(cx, cy, r1, a1);
  const [x3, y3] = clockPoint(cx, cy, r1, a0);
  return `M${x0} ${y0}A${r2Out} ${r2Out} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r1} ${r1} 0 ${large} 0 ${x3} ${y3}Z`;
};

/** An arc of one circle between two clock angles, as an SVG path. Pure. */
export const arc = (cx, cy, r, a0, a1) => {
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [x0, y0] = clockPoint(cx, cy, r, a0);
  const [x1, y1] = clockPoint(cx, cy, r, a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
};

/**
 * The lit part of the Moon as a path, for its phase angle (0 new, 90 first
 * quarter, 180 full, 270 last quarter) — waxing lit on the right, as seen
 * from the northern hemisphere. Pure.
 */
export const moonLitPath = (cx, cy, r, angle) => {
  const a = ((angle % 360) + 360) % 360;
  if (a < 0.5 || a > 359.5) return '';
  const waxing = a < 180;
  const k = Math.cos(a * RAD); // 1 new … -1 full
  const rx = r2(Math.abs(k) * r);
  const top = `${r2(cx)} ${r2(cy - r)}`;
  const bottom = `${r2(cx)} ${r2(cy + r)}`;
  // the limb: a half circle on the lit side; the terminator: an ellipse back
  const limbSweep = waxing ? 1 : 0;
  const termSweep = (waxing ? k > 0 : k < 0) ? 0 : 1;
  return `M${top}A${r} ${r} 0 0 ${limbSweep} ${bottom}A${rx} ${r} 0 0 ${termSweep} ${top}Z`;
};

/**
 * Bodies placed round a wheel without their marks colliding: each keeps its
 * true longitude, and one too close to the last steps inward a lane. Pure.
 * @param {Array<{key: string, longitude: number}>} bodies
 * @param {number} [gap=7] degrees under which two marks would touch
 * @returns {Map<string, number>} key → lane (0 outermost)
 */
export const lanesOf = (bodies, gap = 7) => {
  const sorted = [...bodies].sort((x, y) => x.longitude - y.longitude);
  const lanes = new Map();
  let last = null;
  for (const b of sorted) {
    const close = last && b.longitude - last.longitude < gap;
    lanes.set(b.key, close ? (lanes.get(last.key) + 1) % 3 : 0);
    last = b;
  }
  // the wrap at 360°: the first and last may sit side by side across Aries
  if (sorted.length > 1) {
    const first = sorted[0];
    const end = sorted[sorted.length - 1];
    if (first.longitude + 360 - end.longitude < gap && lanes.get(first.key) === lanes.get(end.key)) lanes.set(first.key, (lanes.get(end.key) + 1) % 3);
  }
  return lanes;
};
