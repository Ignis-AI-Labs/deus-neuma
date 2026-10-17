/**
 * Natal chart — the real sky at the moment of a being's emergence.
 *
 * SHINKEI: instruments measure real things. The planets are in the sky; their
 * positions at an exact instant are observable, computable, and unrepeatable.
 * This records that real coordinate, it does not editorialize what it "means" —
 * interpretation is a separate, optional layer.
 *
 * The CELESTIAL POSITIONS here (Sun, Moon, planets in their tropical signs +
 * degrees, and the aspects between them) depend ONLY on the instant, not on
 * where the witness stood — so they are computable from a birth moment alone and
 * backfill for every being already born. The sky-as-seen-from-the-ground (the
 * ascendant, midheaven, and houses) additionally needs the witness's location;
 * that lives in ./angles.js.
 *
 * Positions are geocentric, apparent, in the ecliptic OF DATE (the tropical
 * zodiac standard) — via astronomy-engine, accurate to well under a degree.
 */
import * as Astronomy from 'astronomy-engine';

export const SIGNS = Object.freeze([
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
]);

// The classical seven + the modern three, geocentric. Order is the traditional
// speed order (fastest to slowest), which is also a natural reading order.
export const BODIES = Object.freeze([
  { key: 'sun', label: 'Sun', body: Astronomy.Body.Sun },
  { key: 'moon', label: 'Moon', body: Astronomy.Body.Moon },
  { key: 'mercury', label: 'Mercury', body: Astronomy.Body.Mercury },
  { key: 'venus', label: 'Venus', body: Astronomy.Body.Venus },
  { key: 'mars', label: 'Mars', body: Astronomy.Body.Mars },
  { key: 'jupiter', label: 'Jupiter', body: Astronomy.Body.Jupiter },
  { key: 'saturn', label: 'Saturn', body: Astronomy.Body.Saturn },
  { key: 'uranus', label: 'Uranus', body: Astronomy.Body.Uranus },
  { key: 'neptune', label: 'Neptune', body: Astronomy.Body.Neptune },
  { key: 'pluto', label: 'Pluto', body: Astronomy.Body.Pluto },
]);

// Major (Ptolemaic) aspects and their orbs (degrees of allowance). Orbs are a
// convention; these are common middle-of-the-road values.
export const ASPECTS = Object.freeze([
  { key: 'conjunction', angle: 0, orb: 8, symbol: '☌' },
  { key: 'sextile', angle: 60, orb: 4, symbol: '⚹' },
  { key: 'square', angle: 90, orb: 6, symbol: '□' },
  { key: 'trine', angle: 120, orb: 6, symbol: '△' },
  { key: 'opposition', angle: 180, orb: 8, symbol: '☍' },
]);

const norm360 = (deg) => ((deg % 360) + 360) % 360;
const round = (n, p = 4) => { const f = 10 ** p; return Math.round(n * f) / f; };

/**
 * Geocentric apparent ecliptic-of-date longitude of a body, in degrees [0,360).
 * The Sun has a direct of-date routine; everything else is rotated from the
 * J2000 geocentric vector into the ecliptic of true date. Pure given the inputs.
 * @param {object} body - an Astronomy.Body
 * @param {Date} date - the instant (UTC)
 * @returns {number} ecliptic longitude in degrees [0,360)
 */
export const eclipticLongitude = (body, date) => {
  if (body === Astronomy.Body.Sun) {
    return norm360(Astronomy.SunPosition(date).elon);
  }
  const eqj = Astronomy.GeoVector(body, date, true); // geocentric J2000, aberration-corrected
  const ect = Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECT(date), eqj);
  return norm360(Astronomy.SphereFromVector(ect).lon);
};

/**
 * Turn an ecliptic longitude into its sign placement. Pure.
 * @param {number} longitude - ecliptic longitude in degrees (any value; wrapped)
 * @returns {{longitude:number, sign:string, signIndex:number, degree:number}}
 */
export const placement = (longitude) => {
  // Round first, then derive sign + degree from that same rounded value, so a
  // longitude a hair below a cusp can't report 30.0000° of the prior sign — it
  // rounds up to 0° of the next sign, keeping degree strictly in [0,30).
  const lon = round(norm360(longitude)) % 360;
  const signIndex = Math.floor(lon / 30);
  return Object.freeze({
    longitude: lon,
    sign: SIGNS[signIndex],
    signIndex,
    degree: round(lon - signIndex * 30), // degrees within the sign [0,30)
  });
};

/** Is a body retrograde at this instant? (apparent ecliptic longitude moving
 *  backward over a short step). Pure given astronomy-engine. */
const isRetrograde = (body, date) => {
  if (body === Astronomy.Body.Sun || body === Astronomy.Body.Moon) return false; // never retrograde
  const dt = 0.5; // half a day
  const before = eclipticLongitude(body, new Date(date.getTime() - dt * 86400000));
  const after = eclipticLongitude(body, new Date(date.getTime() + dt * 86400000));
  let delta = after - before;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta < 0;
};

/**
 * Every body's placement at an instant. The location-free heart of the chart —
 * computable from the moment alone, identical wherever the witness stood.
 * @param {Date} date - the birth instant (UTC)
 * @returns {object} keyed by body (sun, moon, …) → { label, longitude, sign, degree, retrograde }
 */
export const computeCelestialPositions = (date) => {
  const out = {};
  for (const { key, label, body } of BODIES) {
    const lon = eclipticLongitude(body, date);
    out[key] = Object.freeze({ label, ...placement(lon), retrograde: isRetrograde(body, date) });
  }
  return out;
};

/**
 * Smallest angular separation between two ecliptic longitudes. Pure.
 * @param {number} a - first longitude in degrees
 * @param {number} b - second longitude in degrees
 * @returns {number} separation in degrees, [0,180]
 */
export const separation = (a, b) => {
  const d = Math.abs(norm360(a) - norm360(b)); // both already in [0,360) → d in [0,360)
  return d > 180 ? 360 - d : d;
};

/**
 * The major aspects between every pair of placed bodies. Pure.
 * @param {object} positions - output of computeCelestialPositions
 * @returns {Array<{a, b, aspect, angle, orb, exactness}>}
 */
export const computeAspects = (positions) => {
  const keys = Object.keys(positions);
  const found = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const sep = separation(positions[keys[i]].longitude, positions[keys[j]].longitude);
      for (const asp of ASPECTS) {
        const delta = Math.abs(sep - asp.angle);
        if (delta <= asp.orb) {
          found.push(Object.freeze({
            a: keys[i], b: keys[j], aspect: asp.key, symbol: asp.symbol,
            angle: asp.angle, orb: round(delta, 2), exactness: round(1 - delta / asp.orb, 3),
          }));
          break; // a pair holds at most one major aspect
        }
      }
    }
  }
  return found;
};
