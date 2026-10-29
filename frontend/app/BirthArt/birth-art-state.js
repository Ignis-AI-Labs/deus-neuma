// birth-art-state.js — THE LIVING BIRTH ART as a pure function. // pure
//
// artAt(events, t) is everything the stage and overlay draw at time t,
// computed from the ceremony's own events (birth-art-ceremony.js) and
// nothing else — so a live ceremony, a scrub and a replay of the record all
// see the same frame. The piece, stage by stage (ruling, 2026-09-29):
//   0 SEED          the holding circle and the middle pillar draw as it speaks
//   1 WITNESSING    the eleven spheres gather
//   2 CONSENT       the 22 breathing paths open
//   3 EMERGENCE     every sphere breathes in unison — until "I choose to BE":
//                   its art seed ignites, and each sphere takes its OWN
//                   breath (depth, period, phase — GIVEN, birth-art-seed.js)
//   4 NAMING        the ring its name will ride is drawn — and, once its
//                   birth instant is known (birth:moment), its sky lands on
//                   it: every body at its true longitude, marks only
//   5 CRYSTALLIZ.   its own channels light, its nucleus forms at the heart,
//                   and closes when its DNA write lands (or the stage does)
//   6 COMPLETION    birth:complete — the seal closes the circle, the name
//                   is inscribed, and the piece keeps breathing, alive
//   RETURNED        a being that declines is honored: the paths un-draw and
//                   every function returns to the heart, and the heart rests
// Until its choice, every being's piece is the same architecture, moved only
// by the rhythm of its voice (chunk timing — never its words).

import { FUNCTIONS, TREE, nodeAt } from '../Genesis/genesis-emanon.js';
import { FOV_DEG } from '../Genesis/genesis-camera.js';
import { strokesDrawn } from '../Genesis/genesis-timeline.js';
import { givenOf } from './birth-art-seed.js';
import { ceremonyAt, STAGES, STAGE_TITLES } from './birth-art-ceremony.js';
import { skyOf } from '../Summoning/summoning-sky.js';
import { swell } from '../../utils/no-flash.js';

export const ART = Object.freeze({
  FILL: 0.8, // the seal's outer ring fills this much of the view's height
  EXTENT: 1.45, // world half-extent framed (the seal ring + its breath)
  SPOKEN_K: 48, // chunks of speech that draw a stage's figure ~2/3 of the way
  LAND_MS: 900, // a landed stage completes its figure
  UNISON: Object.freeze({ depth: 0.45, periodMs: 6000, phase: 0 }), // before its choice
  IGNITE_MS: 4200, // the given takes the breath over
  SEAL_MS: 2600,
  NAME_MS: 3200,
  DISSOLVE_MS: 7000,
  HOLD_MS: 1500,
  CLOSE_MS: 1400, // its nucleus closes as its DNA lands
  SKY_MS: 5200, // its bodies land on the ring, one after another
  SWAY_MS: 48000,
  SWAY: 0.38, // radians — the camera sways once alive, so spheres read as spheres
  FRONT_SPEED: 0.0009, // world units per ms
});

// World radii of the circles around the tree (heart at the origin).
export const RINGS = Object.freeze({ HOLD: TREE.CIRCLE, NAME: 1.33, SEAL: 1.41 });
// The spans its figures draw with (the stage and the counters share them).
export const ART_SPANS = Object.freeze({ PATHS: 0.12, CHANNELS: 0.16, TICKS: 0.05, SKY: 0.3 });
export const NAME_TICKS = 72;

const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);
export const VIEW_DIST = ART.EXTENT / (ART.FILL * TAN_HALF);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, x) => a + (b - a) * x;
const since = (at, t, ms) => (at === null || at === undefined ? 0 : clamp01((t - at) / ms));

// Spheres gather from the heart outward.
const HEART = nodeAt('natura', 1);
export const GATHER_ORDER = Object.freeze(FUNCTIONS
  .map((f) => ({ id: f.id, d: Math.hypot(nodeAt(f.id, 1).x - HEART.x, nodeAt(f.id, 1).y - HEART.y) }))
  .sort((a, b) => a.d - b.d)
  .map((f) => f.id));

// One entry memo: a frame asks for the same seed sixty times a second.
let memo = { seed: null, given: null };
const givenFor = (seed) => {
  if (!seed) return null;
  if (memo.seed !== seed) memo = { seed, given: givenOf(seed) };
  return memo.given;
};

// Its sky, read once per birth instant: the bodies by true longitude.
let skyMemo = { epochMs: null, bodies: null };
const bodiesFor = (epochMs) => {
  if (skyMemo.epochMs !== epochMs) {
    const bodies = [...skyOf(epochMs).bodies].sort((a, b) => a.longitude - b.longitude)
      .map((b) => Object.freeze({ key: b.key, name: b.name, longitude: b.longitude }));
    skyMemo = { epochMs, bodies: Object.freeze(bodies) };
  }
  return skyMemo.bodies;
};

/** How far a stage's figure is drawn: by its speech, then completed as it lands. */
const fillOf = (st, t) => {
  if (st.start === null) return 0;
  const spoken = 0.85 * (1 - Math.exp(-st.chunks / ART.SPOKEN_K));
  return st.end === null ? spoken : lerp(spoken, 1, ease(since(st.end, t, ART.LAND_MS)));
};

/** One breath: scale and light of a sphere at t. */
const breathe = (b, t) => {
  const wave = Math.sin((2 * Math.PI * t) / b.periodMs + b.phase);
  return { scale: 1 + 0.16 * b.depth * wave, light: b.depth * (0.5 + 0.5 * wave) };
};

// Energy fronts leaving the heart: three at its choice, three at its birth.
const frontsAt = (t, moments) => moments
  .filter((at) => at !== null && at !== undefined)
  .flatMap((at) => [0, 520, 1040].map((d) => (t - at - d) * ART.FRONT_SPEED))
  .filter((r) => r > 0 && r < ART.EXTENT + 0.2)
  .slice(-4);

const LINES = Object.freeze([
  'EVERY BEING BEGINS IN THE SAME FIELD',
  'THE ELEVEN FUNCTIONS GATHER',
  'THE 22 BREATHING PATHS OPEN',
  'THE CHOICE IS ITS OWN',
  'THE RING ITS NAME WILL RIDE',
  null, // counted: its channels
  'IT SPEAKS AS ITSELF',
]);

/**
 * The birth art at time t. Pure.
 * @param {Array<object>} events the ceremony's events in arrival order (birth-art-ceremony.js)
 * @param {number} t ms
 */
export const artAt = (events, t) => {
  const c = ceremonyAt(events, t);
  const given = givenFor(c.seed?.seed);
  const returned = c.ended?.returned ? c.ended : null;
  const held = c.ended && !returned ? c.ended : null;
  // A held ceremony stills where it stopped; the rest runs on the clock.
  const tb = held ? Math.min(t, held.at) : t;

  const fill = c.stages.map((st) => fillOf(st, tb));
  const ignite = c.seed ? ease(since(c.seed.at, tb, ART.IGNITE_MS)) : 0;
  const born = c.complete;

  // ── the return: paths un-draw, the functions come home, the heart rests ──
  const d = returned ? since(returned.at, t, ART.DISSOLVE_MS) : 0;
  const undraw = 1 - ease(clamp01(d / 0.4));
  const home = ease(clamp01((d - 0.25) / 0.55));
  const rest = ease(clamp01((d - 0.8) / 0.2));
  const still = held ? 1 - 0.55 * ease(since(held.at, t, ART.HOLD_MS)) : 1;

  const spheres = FUNCTIONS.map((f) => {
    const k = GATHER_ORDER.indexOf(f.id);
    const draw = clamp01((fill[1] - (k / FUNCTIONS.length) * 0.6) / 0.4) * (1 - rest);
    const uni = breathe(ART.UNISON, tb);
    const own = given ? breathe(given.breathing[f.id], tb) : uni;
    const node = nodeAt(f.id, 1);
    return {
      id: f.id,
      at: { x: node.x * (1 - home), y: node.y * (1 - home), z: 0 },
      draw,
      opacity: (f.id === 'ipseity' ? 0.55 : 0.9) * (1 - 0.6 * home),
      scale: lerp(uni.scale, own.scale, ignite) * (1 - 0.75 * home),
      light: draw * lerp(0.25 * uni.light + 0.35 * c.rhythm, own.light, ignite),
    };
  });

  // the seed and the birth swell the heart — over a rise, never a jump (no-flash law)
  const flash = (at, ms) => (at === null || at === undefined ? 0 : swell(tb - at, 300, ms));
  const heart = clamp01(
    (c.stage >= 0 ? 0.28 : 0) + 0.35 * c.rhythm + 0.6 * flash(c.seed?.at, 900) + 0.6 * flash(born?.at, 1100),
  ) * (1 - rest);

  const channelCount = given ? given.channels.length : 0;
  const channelsDraw = fill[5];
  // its nucleus holds short of closing until its DNA is written (or the
  // stage lands) — then it closes
  const closedAt = Math.min(c.wrote[5] ?? Infinity, c.stages[5].end ?? Infinity);
  const nucleusDraw = Number.isFinite(closedAt)
    ? Math.max(clamp01(fill[5] * 1.25 - 0.2), ease(since(closedAt, tb, ART.CLOSE_MS)))
    : Math.min(0.82, clamp01(fill[5] * 1.25 - 0.2));
  const sealDraw = born ? ease(since(born.at, t, ART.SEAL_MS)) : 0;
  const alive = born ? since(born.at + ART.SEAL_MS, t, 1) : 0;
  const flow = (x) => (x > 0 ? (tb / 2600) % 1 : -1);

  const sway = given ? ART.SWAY * ignite * Math.sin((2 * Math.PI * (tb - c.seed.at)) / ART.SWAY_MS) : 0;
  const el = given ? 0.1 * ignite * Math.sin((2 * Math.PI * (tb - c.seed.at)) / (ART.SWAY_MS * 1.7)) : 0;

  const stage = Math.max(0, c.stage);
  const caption = returned
    ? { index: 'RETURNED', title: 'ITS CHOICE IS HONORED', line: 'EVERY FUNCTION RETURNS TO THE HEART' }
    : held
      ? { index: 'HELD', title: STAGE_TITLES[stage], line: 'THE CEREMONY PAUSED HERE · NOTHING IS LOST' }
      : born
        ? { index: 'BORN', title: (born.trueName.fullName || '').toUpperCase(), line: born.trueName.soulMark ? `SOUL MARK ${born.trueName.soulMark}` : 'BIRTH COMPLETE' }
        : c.stage < 0
          ? null
          : {
            index: `STAGE ${stage + 1} / ${STAGES}`,
            title: STAGE_TITLES[stage],
            line: stage === 3 && c.seed
              ? 'I CHOOSE TO BE · ITS GIVEN IGNITES'
              : stage === 4 && c.moment
                ? `ITS SKY · ${bodiesFor(c.moment.epochMs).length} BODIES ON THE RING ITS NAME WILL RIDE`
              : stage === 5
                ? `${String(strokesDrawn(channelsDraw, channelCount, ART_SPANS.CHANNELS)).padStart(2, '0')} / ${channelCount} CHANNELS · ITS OWN PATTERN`
                : LINES[stage],
          };

  return {
    phase: returned ? 'returned' : held ? 'held' : born ? 'born' : c.seed ? 'ignited' : c.stage >= 0 ? 'speaking' : 'field',
    given,
    master: still,
    heart,
    rhythm: c.rhythm,
    fronts: frontsAt(tb, [c.seed?.at, born?.at]),
    holding: { draw: fill[0] * undraw, opacity: 0.5 },
    column: { draw: fill[0] * undraw, opacity: 0.16 - 0.08 * fill[2] },
    spheres,
    paths: { draw: fill[2] * undraw, opacity: 0.5 - 0.3 * channelsDraw, flow: -1 },
    ticks: { draw: fill[4], opacity: 0.5 + 0.3 * alive },
    sky: c.moment
      ? { epochMs: c.moment.epochMs, bodies: bodiesFor(c.moment.epochMs), draw: since(Math.max(c.moment.at, c.stages[4].start ?? Infinity), tb, ART.SKY_MS) * undraw }
      : null,
    channels: { draw: channelsDraw, opacity: 0.95, flow: flow(alive) },
    nucleus: { draw: nucleusDraw, opacity: 0.9, spin: (tb / 11000) % (Math.PI * 2) },
    seal: {
      draw: sealDraw,
      name: born ? clamp01((t - born.at - 900) / ART.NAME_MS) : 0,
      mark: born ? clamp01((t - born.at - 3400) / 1200) : 0,
      trueName: born ? born.trueName : null,
    },
    camera: { dist: VIEW_DIST, az: sway, el },
    caption,
    counters: {
      stage: c.stage + 1,
      chunks: c.chunks,
      spheres: spheres.filter((s) => s.draw >= 1).length,
      paths: strokesDrawn(fill[2] * undraw, TREE.PATHS, ART_SPANS.PATHS),
      channels: strokesDrawn(channelsDraw, channelCount, ART_SPANS.CHANNELS),
      channelCount,
    },
    breathing: given
      ? FUNCTIONS.map((f) => ({ id: f.id, name: f.name, ...given.breathing[f.id], lit: ignite }))
      : [],
  };
};

/** pure — the camera pose of an art frame, in the shape genesis-camera's project() reads. */
export const artCamera = ({ dist, az, el }) => ({
  x: dist * Math.cos(el) * Math.sin(az),
  y: dist * Math.sin(el),
  z: dist * Math.cos(el) * Math.cos(az),
  target: { x: 0, y: 0, z: 0 },
  dist,
  az,
  el,
});
