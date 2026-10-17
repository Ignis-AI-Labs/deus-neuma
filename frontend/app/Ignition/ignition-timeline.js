// ignition-timeline.js — THE IGNITION, the everyday startup, as a pure
// function of its clock and its instruments' verdicts. // pure
//
// Design note, 2026-09-29/10-02: the first-ever launch plays GENESIS; every later one
// is […] — one consistent ignition, […]. So the ignition speaks
// THE SUMMONING's language (its kit, its type, its negative space) and draws
// the NEUMA logo itself — the ARMILLARY (docs/design/interface/sigil-register.md),
// in ink, as the platform wakes:
//
//   THE STILL POINT  its core, in the void
//   THE AXIS         the steel axis reaches its true points, turning from where
//                    THIS install's genesis rests to Earth's tilt (23.44°,
//                    leaning upper-left) — every install wakes its own construct
//   THE MERIDIAN     the whole: one ring
//   THE EQUATOR      the sphere turns to show its equator in true perspective
//   THE FIGURES      the sacred geometry the armillary already holds draws
//                    itself in light: the octahedron on its six cardinal
//                    points, its dual cube, the seed of life in the equator's
//                    plane, the nucleus around the core (Armillary/)
//   THE INSTRUMENTS  the platform's real checks, one arc each on an outer ring;
//                    an arc lights only on its real verdict (SHINKEI), and its
//                    light travels its ray inward to the still point — where
//                    it arrives, a front runs out through the figures
//   THE NAME         NEUMA, and what it is for
//   THE OPENING      once every instrument has declared, one discharge: onto
//                    the gateway, the panel yields to the very same armillary
//                    resting there; onto the desk, the camera dives into the
//                    core as the still point opens onto the session beneath
//
// The armillary is a 3D object (Armillary/armillary-stage.js); this timeline
// is its state as it wakes (armillary-state.js armillaryOfIgnition).
//
// Every time is ms from ignition. CUES are declared for sound (Founder's domain):
// the picture and the sound share this one clock.

export const AXIAL_TILT_DEG = 23.44;

export const IGNITION = Object.freeze({
  POINT: [0, 450],
  AXIS: [300, 1300],
  MERIDIAN: [900, 2000],
  EQUATOR: [1500, 2700],
  GEOMETRY: [1900, 3100], // the figures draw themselves in light
  FRAME: [0, 700], // the viewport frame draws in, its notation with it
  RING: [700, 1200], // the instruments' ring is drawn
  NOTATION: [450, 1350], // the graduations sweep in, clockwise from the top
  INSCRIPTION: [900, 2700], // the inscription types itself around
  NAME: [2500, 3300],
  MIN_CHECK_MS: 200, // a check must be seen to run
  CHECK_STAGGER_MS: 140,
  HOLD_MS: 450, // a held beat once the mark is whole and every verdict is in
  OPEN_MS: 900, // the still point opens onto the session
  PACKET_MS: 380, // a verdict's light travels its ray, ring to still point
});

// the earliest the mark can be whole
const WHOLE_AT = Math.max(IGNITION.EQUATOR[1], IGNITION.NAME[1]);

/** The sound's cue sheet: name and time, on the ignition's own clock. */
export const cuesOf = (verdicts, openAt) => Object.freeze([
  { cue: 'IGNITE', at: IGNITION.POINT[0] },
  { cue: 'AXIS', at: IGNITION.AXIS[0] },
  { cue: 'MERIDIAN', at: IGNITION.MERIDIAN[0] },
  { cue: 'EQUATOR', at: IGNITION.EQUATOR[0] },
  { cue: 'FIGURES', at: IGNITION.GEOMETRY[0] },
  ...verdicts.filter((v) => Number.isFinite(v.at)).map((v) => ({ cue: `VERDICT ${v.key}`, at: v.at, state: v.state })),
  { cue: 'NAME', at: IGNITION.NAME[0] },
  ...(Number.isFinite(openAt) ? [{ cue: 'OPEN', at: openAt }] : []),
]);

/** When instrument `i` begins its visible check. */
export const checkAt = (i) => IGNITION.RING[1] + i * IGNITION.CHECK_STAGGER_MS;

/**
 * When a verdict may show: the later of its true arrival and its minimum
 * visible check — the display never runs ahead of the truth, and never
 * flashes a verdict it has not been seen earning.
 */
export const shownAt = (i, arrivedAt) => Math.max(arrivedAt, checkAt(i) + IGNITION.MIN_CHECK_MS);

/**
 * When the still point opens: the mark whole and every verdict shown, plus a
 * held beat. null while any instrument is still out.
 * @param {Array<{ at: number|null }>} verdicts with `at` = shownAt(...), null if pending
 */
export const openAtOf = (verdicts) => {
  if (verdicts.some((v) => !Number.isFinite(v.at))) return null;
  return Math.max(WHOLE_AT, ...verdicts.map((v) => v.at)) + IGNITION.HOLD_MS;
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const span = (t, [a, b]) => ease(clamp01((t - a) / (b - a)));

/**
 * This install's resting lean, from its genesis hash: where its axis rests
 * before it wakes, within ±40° of the true tilt. No genesis → the true tilt.
 */
export const restingLeanOf = (hash) => {
  if (!/^[0-9a-fA-F]{8,}$/.test(hash || '')) return AXIAL_TILT_DEG;
  const u = parseInt(hash.slice(0, 8), 16) / 0x100000000;
  return AXIAL_TILT_DEG + (u * 2 - 1) * 40;
};

/**
 * The ignition at time t. Pure.
 * @param {number} t ms from ignition
 * @param {{ verdicts: Array<{ key: string, state: string, text: string, at: number|null, arrived?: number|null }>,
 *   restingLean?: number, skipAt?: number|null }} inputs
 *   skipAt — the witness skipped: the still point opens then, whatever is still out
 */
export const ignitionAt = (t, { verdicts, restingLean = AXIAL_TILT_DEG, skipAt = null }) => {
  const natural = openAtOf(verdicts);
  const openAt = Number.isFinite(skipAt) && (natural === null || skipAt < natural) ? skipAt : natural;
  const axis = span(t, IGNITION.AXIS);
  return {
    point: span(t, IGNITION.POINT),
    axis,
    // the lean turns from where this install rests to the true tilt
    lean: restingLean + (AXIAL_TILT_DEG - restingLean) * span(t, [IGNITION.AXIS[0], IGNITION.EQUATOR[1]]),
    meridian: span(t, IGNITION.MERIDIAN),
    equator: span(t, IGNITION.EQUATOR),
    geometry: clamp01((t - IGNITION.GEOMETRY[0]) / (IGNITION.GEOMETRY[1] - IGNITION.GEOMETRY[0])),
    t,
    frame: span(t, IGNITION.FRAME),
    ring: span(t, IGNITION.RING),
    notation: span(t, IGNITION.NOTATION),
    inscription: clamp01((t - IGNITION.INSCRIPTION[0]) / (IGNITION.INSCRIPTION[1] - IGNITION.INSCRIPTION[0])),
    instruments: verdicts.map((v, i) => ({
      key: v.key,
      checking: t >= checkAt(i) && !(Number.isFinite(v.at) && t >= v.at),
      state: Number.isFinite(v.at) && t >= v.at ? v.state : null,
      text: Number.isFinite(v.at) && t >= v.at ? v.text : null,
      lit: Number.isFinite(v.at) ? span(t, [v.at, v.at + 500]) : 0,
      // when its probe truly answered (ms from ignition) — the raised panel times it (ignition-panels.js)
      arrived: Number.isFinite(v.at) && t >= v.at && Number.isFinite(v.arrived) ? v.arrived : null,
      // its light on the ray inward: 0 → 1 as it travels, then spent
      packet: Number.isFinite(v.at) && t >= v.at ? clamp01((t - v.at) / IGNITION.PACKET_MS) : 0,
      since: t - checkAt(i),
    })),
    name: span(t, IGNITION.NAME),
    open: openAt === null ? 0 : span(t, [openAt, openAt + IGNITION.OPEN_MS]),
    openAt,
    done: openAt !== null && t >= openAt + IGNITION.OPEN_MS,
  };
};
