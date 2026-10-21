// hud-geometry.js — the SUBSTRATE HUD's instrument math (SHINKEI: an arc
// showing 0.94 sweeps 94%, a trace's top is the number its label states).
//
// pure — every function here maps measured numbers to SVG geometry and nothing
// else; the instruments in hud-instruments.jsx only draw what this returns.

/** The dial's sweep: a 270° arc opening at the bottom, read clockwise. */
export const DIAL_START = 135;
export const DIAL_SWEEP = 270;

/** pure — a ratio held to 0..1; anything unmeasured reads as null, never 0. */
export const ratioOf = (value, max) => (Number.isFinite(value) && Number.isFinite(max) && max > 0
  ? Math.max(0, Math.min(1, value / max))
  : null);

/** pure — the point at `deg` (SVG angle: 0 = east, clockwise) on a circle. */
export const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

const f2 = (n) => Number(n.toFixed(2));

/** pure — the SVG path of an arc from `fromDeg` to `toDeg` (clockwise); '' when it has no length. */
export const arcBetween = (cx, cy, r, fromDeg, toDeg) => {
  const span = toDeg - fromDeg;
  if (!(span > 0)) return '';
  // A full circle cannot be one arc command: stop a hair short of it.
  const end = span >= 360 ? fromDeg + 359.99 : toDeg;
  const [x0, y0] = polar(cx, cy, r, fromDeg);
  const [x1, y1] = polar(cx, cy, r, end);
  return `M ${f2(x0)} ${f2(y0)} A ${r} ${r} 0 ${end - fromDeg > 180 ? 1 : 0} 1 ${f2(x1)} ${f2(y1)}`;
};

/** pure — the dial's filled arc for a 0..1 ratio: it sweeps exactly ratio × 270°. */
export const dialArc = (cx, cy, r, ratio) => (ratio === null ? ''
  : arcBetween(cx, cy, r, DIAL_START, DIAL_START + DIAL_SWEEP * ratio));

/** pure — a radial tick mark on the dial at a 0..1 position (a limit, a peak). */
export const dialTick = (cx, cy, r, ratio, inner = 4, outer = 4) => {
  const deg = DIAL_START + DIAL_SWEEP * ratio;
  const [x0, y0] = polar(cx, cy, r - inner, deg);
  const [x1, y1] = polar(cx, cy, r + outer, deg);
  return `M ${f2(x0)} ${f2(y0)} L ${f2(x1)} ${f2(y1)}`;
};

/**
 * pure — `count` equal ring segments separated by `gapDeg`, starting at 12
 * o'clock: [fromDeg, toDeg] pairs. A discrete count (slots) reads as segments.
 */
export const ringSegments = (count, gapDeg = 6) => {
  if (!Number.isInteger(count) || count < 1) return [];
  const each = 360 / count;
  const gap = count === 1 ? 0 : gapDeg;
  return Array.from({ length: count }, (_, i) => [-90 + i * each + gap / 2, -90 + (i + 1) * each - gap / 2]);
};

/** pure — the nearest 1·2·5 × 10ⁿ at or above v: a trace scale a reader can name. */
export const niceCeil = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((c) => c >= v - 1e-9);
};

/** pure — a trace's scale top: the nice ceiling of what the window holds, never below `floor`. */
export const traceMax = (values, floor = 1) => niceCeil(Math.max(floor, ...values.filter(Number.isFinite)));

/**
 * pure — a sparkline path. The newest sample sits at the right edge and older
 * samples step left at w / (capacity − 1); a missing sample breaks the line
 * rather than drawing a fabricated zero.
 */
export const tracePath = (values, capacity, w, h, max) => {
  if (!(capacity > 1) || !(max > 0)) return '';
  const step = w / (capacity - 1);
  const last = values.length - 1;
  let path = '';
  let pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) { pen = false; return; }
    const x = f2(w - (last - i) * step);
    const y = f2(h - Math.max(0, Math.min(1, v / max)) * h);
    path += `${pen ? ' L' : `${path ? ' ' : ''}M`} ${x} ${y}`;
    pen = true;
  });
  return path;
};
