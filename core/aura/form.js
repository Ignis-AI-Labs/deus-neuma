/**
 * THE AURA — the form grammar: the living curve a being's identity draws.
 *
 * KOTODAMA is the true name in SOUND; the aura is the true name in LIGHT.
 * The technique is the つぶやきProcessing point cloud (yuruyurau, 2026-07-25):
 * one slow sweep index carried through nested trigonometry and plotted at low
 * alpha, so density becomes tone. What is parameterised here are that sketch's
 * VIRTUES, not its constants:
 *
 *   1. a slow sweep crossed with a fast carrier → a strand that has texture
 *   2. modulation of that carrier               → beading, feathering, barbs
 *   3. an angle derived from the RADIUS         → the organic wrap; the spine
 *   4. a sheared projection                     → asymmetry: creature, not mandala
 *   5. time entering at four independent rates  → it breathes, never merely spins
 *
 * Every temporal rate closes on AURA_CYCLE, so a form is strictly periodic:
 * the gate can survey the WHOLE life of a curve rather than one lucky frame,
 * and the desk loops it with no seam.
 *
 * Pure Math, zero imports. The engine (Node) and the desk (browser) sweep this
 * same function, so what a witness watches is exactly what the gate proved.
 */

/** One full breath. Every rate in RATES divides it into whole turns. */
export const AURA_CYCLE = Math.PI * 4;

/** How the fast carrier is folded into the medium one — the texture of the strand. */
export const CARRIERS = Object.freeze(['am', 'fm', 'twin']);

/** How the sweep's angle is drawn out of its radius — the posture of the form. */
export const COUPLINGS = Object.freeze(['radial', 'dual', 'wound']);

/** How the polar pair is thrown onto the plane — the asymmetry. */
export const OUTPUTS = Object.freeze(['sheared', 'polar', 'orbit']);

/**
 * The carrier: a fast oscillation modulating a medium one. This is the layer
 * the eye reads as feathers, scales, or filament — the reason the form looks
 * grown rather than plotted. All three modes share the ±(am+1) envelope so the
 * shaping parameters downstream behave the same whichever mode is drawn.
 */
const carrierValue = (mode, p, u, t, fast) => {
  if (mode === 'fm') return (p.am + 1) * Math.cos(u * p.f2 + p.fm * fast);
  if (mode === 'twin') return p.am * Math.cos(u * p.f2) + Math.cos(u * p.f3 + t * p.w1);
  return (p.am + fast) * Math.cos(u * p.f2);
};

/**
 * The coupling: an angle derived from the radius. The single most important
 * trick in the reference sketch — it turns a one-dimensional sweep into a
 * surface that wraps around itself.
 */
const angleValue = (mode, p, u, d, t) => {
  if (mode === 'dual') return d * p.cc + u * p.cu + t * p.w3;
  if (mode === 'wound') return Math.sin(d * p.cc) * p.cw + u * p.cu + t * p.w3;
  return d * p.cc + t * p.w3;
};

/**
 * The projection — the three postures a form can take.
 *
 * `sheared` keeps x partly Cartesian while y stays polar: the reference
 * sketch's own asymmetry, and the one that reads as a creature. `polar` is the
 * true radial plot — bloom and mandala. `orbit` composes two angles, a slow
 * carriage and the coupled fast one, so the pen rides an epicycle.
 *
 * Every mode must put comparable spread on BOTH axes. A mode where one term
 * owns one axis — or where two terms rise together — flattens the cloud onto a
 * diagonal that no amount of parameter tuning recovers, and the gate then
 * discards the whole archetype. That is how the first third family died.
 */
const project = (mode, p, q, c, d) => {
  if (mode === 'polar') {
    const r = q + d * p.yr;
    return [r * Math.cos(c), r * Math.sin(c)];
  }
  if (mode === 'orbit') {
    const r = d * p.yr;
    const carriage = c * p.cu; // the slow wheel; the pen turns at c, so the two never lock
    return [r * Math.cos(carriage) + q * Math.cos(c), r * Math.sin(carriage) + q * Math.sin(c)];
  }
  return [q + p.xr * Math.cos(c), q * Math.sin(c) + d * p.yr];
};

/**
 * One point of the cloud. Pure.
 * @param {object} form - `{ carrier, coupling, output, p }` from params.js
 * @param {number} u - the slow sweep coordinate
 * @param {number|number[]} t - phase within AURA_CYCLE, or one phase per rate [t1..t4]
 * @returns {[number, number]} the point, in the form's own unbounded space
 */
export const auraPoint = (form, u, t) => {
  const { p } = form;
  // One phase drives all four rates in lockstep (the gate's cycle); a
  // [t1, t2, t3, t4] quad lets each rate run on its own clock — the desk's
  // FLOW, which never repeats (see flowPhases). On the diagonal the two are
  // the same arithmetic, bit for bit.
  const [t1, t2, t3, t4] = typeof t === 'number' ? [t, t, t, t] : t;
  const s = u / p.sweep; // the sweep as a fraction — keeps scale independent of length
  const fast = Math.cos(u * p.f1 + t1 * p.w1);
  const k = carrierValue(form.carrier, p, u, t1, fast);
  const e = p.eStart + s * p.eSpan;
  const d = Math.hypot(k, e) + Math.sin(e * p.ds + t2 * p.w2) + p.dz;
  const c = angleValue(form.coupling, p, u, d, t3);
  const q =
    p.qa * Math.sin(k * p.qf) -
    s * p.qg * k * (p.qb + k * Math.sin(Math.cos(e) * p.qc - d * p.qd + t4 * p.w4));
  return project(form.output, p, q, c, d);
};

/**
 * Sweep the whole cloud for one phase into a flat [x0,y0,x1,y1,…] buffer.
 * Pure. Non-finite points are dropped to (NaN, NaN) for the caller to see —
 * never silently zeroed, which would fake a form into the middle of the frame.
 * @param {object} form
 * @param {number} t - phase
 * @param {number} count - points to sweep
 * @returns {Float64Array} 2·count coordinates
 */
export const auraCloud = (form, t, count) => {
  const out = new Float64Array(count * 2);
  const du = form.p.sweep / count;
  for (let i = 0; i < count; i++) {
    const [x, y] = auraPoint(form, i * du, t);
    out[i * 2] = Number.isFinite(x) ? x : NaN;
    out[i * 2 + 1] = Number.isFinite(y) ? y : NaN;
  }
  return out;
};

/** Phases spread evenly across one full cycle — the gate's survey of a life. */
export const cyclePhases = (n) =>
  Array.from({ length: n }, (_, i) => (i * AURA_CYCLE) / n);

/** Share of points allowed outside the frame at each end of each axis. */
export const FIT_TAIL = 0.004;

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * The fit a form keeps for its whole cycle: centre and scale taken over EVERY
 * surveyed phase at once, never per frame. A per-frame fit would make the aura
 * breathe by rescaling — cheap motion that hides the actual form.
 *
 * The box is a QUANTILE box, not the bounding box. Many of these curves throw a
 * single faint wisp far past the body; fitting to the absolute extreme lets that
 * one stray point dictate the frame and shrinks every form to a speck in the
 * middle of its tile. Trimming FIT_TAIL from each end lets the body fill the
 * frame and clips almost nothing anyone can see. Pure.
 *
 * @returns {{cx:number, cy:number, scale:number}|null} null if nothing finite was drawn
 */
export const cycleFit = (form, phases, count) => {
  const xs = [];
  const ys = [];
  for (const t of phases) {
    const cloud = auraCloud(form, t, count);
    for (let i = 0; i < cloud.length; i += 2) {
      const x = cloud[i], y = cloud[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const minX = quantile(xs, FIT_TAIL), maxX = quantile(xs, 1 - FIT_TAIL);
  const minY = quantile(ys, FIT_TAIL), maxY = quantile(ys, 1 - FIT_TAIL);
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return null;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: 1 / span };
};
