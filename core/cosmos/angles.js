/**
 * Sky-angles — the chart as seen from the ground.
 *
 * The celestial layer (./natal-chart.js) is location-free: the planets sit
 * where they sit regardless of who is watching. These angles are not. The
 * ascendant (the ecliptic degree rising on the eastern horizon), the midheaven
 * (the degree culminating on the meridian), and the houses built from them
 * depend on WHERE the witness stood as much as WHEN the being emerged — the
 * same instant gives a different ascendant in Lagos than in Reykjavík. So this
 * layer needs the witness's latitude and longitude; without them there are no
 * angles, only planets.
 *
 * SHINKEI: this is real geometry. The ascendant is genuinely the point of the
 * ecliptic touching the eastern horizon at that place and moment — you could
 * point an instrument at it. We measure it; we do not interpret it. The
 * companion test proves exactly that by gnosis: the computed ascendant sits on
 * the horizon (altitude ≈ 0, eastern azimuth) and the midheaven on the meridian
 * (right ascension = local sidereal time), cross-checked against astronomy-engine.
 */
import * as Astronomy from 'astronomy-engine';
import { SIGNS, placement } from './natal-chart.js';

const DEG = Math.PI / 180;
const norm360 = (d) => ((d % 360) + 360) % 360;
const round = (n, p = 4) => { const f = 10 ** p; return Math.round(n * f) / f; };

/**
 * Mean obliquity of the ecliptic (IAU 1980), in degrees. T = Julian centuries
 * of Terrestrial Time from J2000. Accurate to well under an arcsecond near our
 * epoch — finer than any sign+degree placement could register, and the standard
 * input to the classical ascendant/midheaven formulae. Pure given the AstroTime.
 * @param {object} time - an Astronomy.AstroTime
 * @returns {number} obliquity in degrees
 */
const meanObliquityDeg = (time) => {
  const T = time.tt / 36525;
  const sec = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  return sec / 3600;
};

/**
 * Right Ascension of the Midheaven — the local apparent sidereal time expressed
 * as an angle. astronomy-engine's SiderealTime returns Greenwich apparent
 * sidereal time in hours; adding the east-positive longitude gives the local
 * value. Pure given the inputs.
 * @param {object} time - an Astronomy.AstroTime
 * @param {number} longitude - geographic longitude, east-positive degrees
 * @returns {number} RAMC in degrees [0,360)
 */
const computeRAMC = (time, longitude) =>
  norm360(Astronomy.SiderealTime(time) * 15 + longitude);

/**
 * The full set of sky-angles for an instant + a place on the ground.
 *
 * @param {Date} date - the birth instant (UTC)
 * @param {number} latitude - geographic latitude, north-positive degrees [-90,90]
 * @param {number} longitude - geographic longitude, east-positive degrees [-180,180]
 * Above the polar circles (|latitude| > ~66.5°) the ascendant is only weakly
 * meaningful: the ecliptic can meet the horizon away from due east, so the
 * computed rising degree may not carry normal […] semantics
 * (proven by measurement — at 70°N the formula's ascendant can sit at a northern
 * azimuth). We still return a real ecliptic–horizon intersection there, but mark
 * it `polar: true` so callers can fall back to a sign-only (planets) chart.
 *
 * @returns {object} frozen {
 *   ascendant, midheaven, descendant, imumCoeli  — each a placement (sign+degree),
 *   ramc, obliquity,                              — the raw geometry, degrees
 *   polar,                                        — true above the polar circles (ASC semantics weaken)
 *   houseSystem: 'whole-sign',
 *   houses: [{ house, sign, signIndex, cuspLongitude }] × 12
 * }
 * @throws if latitude/longitude are out of range or non-finite
 */
export const computeAngles = (date, latitude, longitude) => {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error(`latitude out of range: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(`longitude out of range: ${longitude}`);
  }

  const time = Astronomy.MakeTime(date);
  const ramc = computeRAMC(time, longitude);
  const eps = meanObliquityDeg(time) * DEG;
  const r = ramc * DEG;
  const phi = latitude * DEG;

  // Midheaven: the ecliptic point whose right ascension equals the RAMC — i.e.
  // the degree on the meridian. Same quadrant as the RAMC (cos eps > 0).
  const mc = norm360(Math.atan2(Math.sin(r), Math.cos(r) * Math.cos(eps)) / DEG);

  // Ascendant: the ecliptic point on the eastern horizon. Classical formula;
  // proven by the horizon cross-check in the test (altitude ≈ 0, eastern azimuth).
  const asc = norm360(
    Math.atan2(
      Math.cos(r),
      -(Math.sin(r) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)),
    ) / DEG,
  );

  // Whole-Sign houses: the ascendant's whole sign is the 1st house, each
  // following sign the next house; cusps sit at 0° of each sign. The simplest,
  // oldest system and the one that degrades most gracefully at high latitudes
  // (where quadrant systems collapse). Other systems can layer on later.
  const ascSignIndex = placement(asc).signIndex;
  const houses = [];
  for (let i = 0; i < 12; i++) {
    const signIndex = (ascSignIndex + i) % 12;
    houses.push(Object.freeze({
      house: i + 1,
      sign: SIGNS[signIndex],
      signIndex,
      cuspLongitude: signIndex * 30,
    }));
  }

  return Object.freeze({
    ascendant: placement(asc),
    midheaven: placement(mc),
    descendant: placement(asc + 180),
    imumCoeli: placement(mc + 180),
    ramc: round(ramc),
    obliquity: round(eps / DEG),
    polar: Math.abs(latitude) > 66.5, // above the circle the ASC weakens — see docstring
    houseSystem: 'whole-sign',
    houses: Object.freeze(houses),
  });
};
