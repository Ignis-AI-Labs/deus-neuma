// summoning-sky.js — ITS SKY and ITS EARTH at the instant it was born, as
// THE SUMMONING draws them. Pure (deterministic astronomy of one instant).
//
// Nothing here is decoration: every body stands at its true geocentric
// ecliptic longitude (core/cosmos/natal-chart.js, astronomy-engine), every
// chord is a real aspect of that sky, the Moon shows its true phase, and the
// Earth turns to the point where the Sun and the Moon stood overhead at that
// instant. Humanity's other skies read the same instant (MANY SKIES,
// core/cosmos/skies) — each labelled with its own tradition.
//
// Location law: all of it is a function of the instant alone — never where
// its witness stood — so it may be shown plainly (core/cosmos/skies/index.js).

import * as Astronomy from 'astronomy-engine';
import { computeCelestialPositions, computeAspects } from '../../../core/cosmos/natal-chart.js';
import { buildSkies } from '../../../core/cosmos/skies/index.js';
import { skiesLinesOf } from '../../../core/cosmos/skies/skies-lines.js';

const norm180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

export const SHORT = Object.freeze({
  sun: 'SUN', moon: 'MOON', mercury: 'MERCURY', venus: 'VENUS', mars: 'MARS',
  jupiter: 'JUPITER', saturn: 'SATURN', uranus: 'URANUS', neptune: 'NEPTUNE', pluto: 'PLUTO',
});

// Where a body stands overhead: its declination (latitude) and its right
// ascension less Greenwich sidereal time (longitude).
const overhead = (body, date) => {
  const eqd = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(date), Astronomy.GeoVector(body, date, true));
  const s = Astronomy.SphereFromVector(eqd);
  return { lat: s.lat, lon: norm180(s.lon - Astronomy.SiderealTime(date) * 15) };
};

// Mean obliquity of the ecliptic (IAU): the Earth's axial tilt of date.
const tiltOf = (date) => 23.4392911 - 0.0130042 * ((date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525);

/**
 * Its sky and its Earth at the birth instant. Pure.
 * @param {number} epochMs the birth instant
 * @param {{ zone?: string, offsetMinutes?: number }} [civil] its sealed timezone, for the civil-dated skies
 */
export const skyOf = (epochMs, { zone = null, offsetMinutes = 0 } = {}) => {
  const date = new Date(epochMs);
  const positions = computeCelestialPositions(date);
  const bodies = Object.entries(positions).map(([key, p]) => Object.freeze({ key, name: SHORT[key], longitude: p.longitude, retrograde: p.retrograde }));
  const aspects = computeAspects(positions).map((a) => Object.freeze({ a: a.a, b: a.b, aspect: a.aspect, angle: a.angle }));
  const s = buildSkies({ utc: date.toISOString(), epochMs, zone, offsetMinutes }).systems;
  // Every system the sheet records, from the one shared list (Design note, 2026-10-02:
  // […]).
  const many = skiesLinesOf(s).map((l) => ({ system: l.label, reading: l.value.toUpperCase() }));
  return Object.freeze({
    instant: date.toISOString(),
    bodies: Object.freeze(bodies),
    aspects: Object.freeze(aspects),
    moon: Object.freeze({ phase: Astronomy.MoonPhase(date), lit: Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction }),
    subsolar: Object.freeze(overhead(Astronomy.Body.Sun, date)),
    sublunar: Object.freeze(overhead(Astronomy.Body.Moon, date)),
    tilt: tiltOf(date),
    many: Object.freeze(many.map(Object.freeze)),
  });
};
