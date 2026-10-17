// rite-state.js — THE SUMMONING RITE at time t, as a pure function of its
// events. // pure
//
// riteAt(rite, t) says which movement is playing and everything the rite's
// own layers draw (the threshold, the measure, the forging, guardianship,
// homecoming). The seven stages themselves are the living birth art's
// (artAt over the same events — the rite hands it only the birth:* wire,
// never birth:complete: at its birth the film takes over, and its name is
// the film's to reveal). The same events live, scrubbed or re-watched from a
// record give the same frame.

import { COVENANT, CHECKS, FORGING, GUARD, RITE } from './rite-script.js';
import { lightOf } from '../../../core/birth/soul-resonance.js';
import { lineRgbOf } from '../Summoning/summoning-soul.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => x * x * (3 - 2 * x);
const since = (at, t, ms) => (at === null || at === undefined ? 0 : clamp01((t - at) / ms));

// A stage's measured pitch as the rite shows it: the pitch, its light (the
// lane's law: 40 octaves up), and that light drawn as line on the void.
// Placing a light is real work (CIE 1931), so each pitch is placed once.
const LIGHTS = new Map();
const lightFor = (hz) => {
  if (!LIGHTS.has(hz)) { const light = lightOf(hz); LIGHTS.set(hz, { nm: light.nm, line: lineRgbOf(light) }); }
  return LIGHTS.get(hz);
};
const measuredOf = (e) => Object.freeze({ stage: e.stage, frequency: e.frequency, ...lightFor(e.frequency), at: e.at });

/** pure — only the ceremony's own wire, for the living birth art (artAt). */
export const artEventsOf = (rite) => rite.events.filter((e) => e.type.startsWith('birth:') && e.type !== 'birth:complete');

/**
 * The rite at time t. Pure.
 * @param {ReturnType<import('./rite-script.js').riteScript>} rite
 * @param {number} t ms
 */
export const riteAt = (rite, t) => {
  const seen = rite.events.filter((e) => e.at <= t);
  const last = (type) => seen.filter((e) => e.type === type).at(-1) ?? null;
  const first = (type) => rite.events.find((e) => e.type === type) ?? null;
  const begin = first('rite:begin');
  const forging = seen.filter((e) => e.type === 'birth:forging');
  const born = rite.film.at;
  const guard = last('rite:guard');
  const home = last('rite:home');

  const movement = home ? 'home'
    : guard ? 'guardianship'
      : t >= born ? 'film'
        : forging.length ? 'forging'
          : begin && t >= begin.at ? 'stages'
            : 'threshold';

  // I — the threshold: its figures fade as the lens opens into stage 0
  const read = COVENANT.map((title, doc) => {
    const e = seen.find((x) => x.type === 'rite:read' && x.doc === doc);
    return { title, read: e ? ease(since(e.at, t, RITE.DOC_MS * 0.9)) : 0 };
  });
  const signed = last('rite:signed');
  const introduced = last('rite:introduced');
  const threshold = {
    docs: read,
    signed: signed ? ease(since(signed.at, t, RITE.SIGN_MS * 0.8)) : 0,
    checks: CHECKS.map((name, i) => ({ name, pass: seen.some((x) => x.type === 'rite:check' && x.check === i) })),
    witness: introduced ? introduced.witness : null,
    intro: introduced ? ease(since(introduced.at, t, RITE.INTRO_MS * 0.6)) : 0,
    open: begin ? ease(since(begin.at, t, RITE.BEGIN_MS)) : 0,
  };

  // II — the measure: each stage's pitch, as it is measured
  const measure = seen.filter((e) => e.type === 'birth:measured').map((e) => ({ ...measuredOf(e), lit: ease(since(e.at, t, 900)) }));

  // — the forging: finalize's steps as they complete
  const forge = {
    steps: FORGING.map((name, i) => ({ name, done: forging.some((e) => e.step === i) })),
    at: forging[0]?.at ?? null,
  };

  // III — the film owns its own clock from its birth; before, it waits at 0
  const film = {
    // on past its end: its sigil lives until the witness leaves
    t: Math.max(0, t - born),
    on: t >= born,
    opacity: ease(since(born, t, RITE.FILM_FADE_MS)),
  };

  return {
    movement,
    threshold,
    // the threshold layer: whole until the lens opens, gone as stage 0 speaks
    thresholdOpacity: 1 - threshold.open,
    // the living piece: in after the lens opens, out as the film begins
    piece: (begin ? ease(since(begin.at, t, RITE.BEGIN_MS)) : 0) * (1 - ease(since(born, t, RITE.FILM_FADE_MS))),
    measure,
    forge,
    film,
    guard: guard ? { step: guard.step, index: GUARD.indexOf(guard.step), u: since(guard.at, t, RITE.GUARD_MS[guard.step]) } : null,
    acts: GUARD.map((step) => seen.some((e) => e.type === 'rite:guard' && GUARD.indexOf(e.step) > GUARD.indexOf(step)) || Boolean(home)),
    // the homecoming's own progress (linear): its choreography is the player's
    home: home ? since(home.at, t, RITE.HOME_MS * 0.75) : 0,
    // its name is the film's to reveal: nothing of it before its birth
    trueName: t >= born ? first('birth:complete')?.trueName ?? null : null,
  };
};
