/**
 * THE AURA — how a being's form answers its own life.
 *
 * The base form is fixed at birth and never redrawn: it IS the being, and a
 * signature that reinvents itself is not a signature. What life is allowed to
 * do is BEND it, inside bounds small enough that the being stays recognisably
 * itself. The invariant the sweep exists to prove:
 *
 *     max drift of ONE being across its whole life
 *   < min distance between any TWO beings
 *
 * Below that line, growth reads as growth. Above it, an old being would drift
 * into a stranger's form — an identity system that forgets who it is.
 *
 * Three inputs move geometry, and they are the three a being earns rather than
 * performs: how long it has lived, how much it has crystallised, how many times
 * it has been refined. Emotion moves NOTHING here — `renderHints` is a separate
 * function precisely so a passing mood cannot reach the geometry even by
 * mistake. What a being feels changes how its aura MOVES, never what it is.
 *
 * Pure Math, no Node imports.
 */

/**
 * Life bends AMPLITUDES ONLY. Never a frequency.
 *
 * This is measured, not stylistic. Bending `f1` by two percent re-phases the
 * entire fine texture and moves the form 0.17 in descriptor distance — and the
 * drift does NOT grow with the size of the bend, because what a frequency shift
 * does is scramble the moiré rather than deform it. `am` behaves the same way,
 * multiplying as it does straight into a frequency-sensitive product. The
 * amplitudes are docile by comparison: `qa` bends ten percent for 0.02.
 *
 * So the whole geometric budget is spent on `qa`, `qb`, `yr`, one per life
 * input, and the frequencies are untouchable. Everything a witness should
 * plainly SEE change — density, heat, tempo — lives in `renderHints`, where it
 * can be dramatic without threatening what the being is.
 */
export const LIFE_BOUNDS = Object.freeze({
  yr: 0.03, // age: the form opens, settles into its own extent
  qa: 0.12, // crystallised memory puts more structure in the stroke
  qb: 0.04, // each refinement gives the body more of itself to draw with
});

/**
 * The furthest life this system can bend a form to — old, deeply remembered,
 * fully refined. Derivation surveys every candidate HERE as well as at rest, so
 * a being's aura is proven beautiful for its whole life on the day it is born,
 * not merely on that day. Each reach below saturates at 1.
 */
export const LIFE_EXTREME = Object.freeze({ ageDays: 4000, memories: 50000, refinements: 8 });

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * Saturating reach of each life input, in [0, 1]. Saturating rather than linear
 * so a being with ten thousand memories is not ten times bent — growth slows,
 * as growth does. Pure.
 * @param {{ageDays?:number, memories?:number, refinements?:number}} life
 */
export const lifeReach = (life = {}) => Object.freeze({
  age: clamp01(1 - Math.exp(-(life.ageDays ?? 0) / 540)),
  memory: clamp01(Math.log1p(life.memories ?? 0) / Math.log1p(2000)),
  refinement: clamp01((life.refinements ?? 0) / 8),
});

/**
 * Bend a base form by a being's life. Pure — returns a new form.
 * @param {{carrier:string, coupling:string, output:string, p:object}} form
 * @param {{ageDays?:number, memories?:number, refinements?:number}} life
 * @returns {{carrier:string, coupling:string, output:string, p:object}}
 */
export const modulateForm = (form, life = {}) => {
  const { age, memory, refinement } = lifeReach(life);
  return {
    ...form,
    p: Object.freeze({
      ...form.p,
      yr: form.p.yr * (1 + LIFE_BOUNDS.yr * age),
      qa: form.p.qa * (1 + LIFE_BOUNDS.qa * memory),
      qb: form.p.qb * (1 + LIFE_BOUNDS.qb * refinement),
    }),
  };
};

/**
 * Point count at rest, and the most a well-remembered being may add. This is
 * where "it evolves" is meant to be VISIBLE: a newborn's aura is a sparse,
 * clean sketch, an elder's is dense and luminous — the same form, more lived.
 * Density carries the change that geometry is too fragile to carry.
 */
const POINTS = Object.freeze({ base: 6000, fromMemory: 9000 });

/**
 * How the aura is DRAWN, as opposed to what it is. This is the only place a
 * being's present state reaches, and it reaches nothing structural: density,
 * tempo, and heat. Pure.
 * @param {{ageDays?:number, memories?:number, refinements?:number}} life
 * @param {{arousal?:number}} [feeling] - 0…1, transient; resets to rest
 * @returns {{points:number, speed:number, exposure:number}}
 */
export const renderHints = (life = {}, feeling = {}) => {
  const { memory } = lifeReach(life);
  const arousal = clamp01(feeling.arousal ?? 0);
  return Object.freeze({
    points: Math.round(POINTS.base + POINTS.fromMemory * memory),
    speed: 1 + 0.35 * arousal,
    exposure: 0.55 + 0.15 * arousal,
  });
};
