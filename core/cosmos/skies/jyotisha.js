/**
 * MANY SKIES — Vedic Jyotisha (ancient-living; Surya Siddhanta lineage).
 *
 * Sidereal longitudes = tropical − ayanamsa. The ayanamsa CHOICE is the one
 * genuinely contested element; we use Lahiri/Chitrapaksha — the Government of
 * India standard — as a labeled constant: anchor 24°07′47″ at 2026-01-01
 * (Swiss-Ephemeris-verified figure from the 2026-07-24 research pass) with the
 * general-precession linear drift 50.29″/yr. Sub-arcminute for decades around
 * now — far inside every nakshatra/pada boundary.
 *
 * v1 scope: janma nakshatra + pada, rashi, tithi/paksha, yoga index, karana,
 * civil vara, vimshottari dasha seed. Sunrise-based vara and anything needing
 * the operator's location wait for the located pass (they must then ride the
 * ENCRYPTED natal path, never plaintext skies.json).
 */

import * as Astronomy from 'astronomy-engine';
import { eclipticLongitude } from '../natal-chart.js';
import { WEEKDAYS } from './daycount.js';

const posMod = (n, m) => ((n % m) + m) % m;
const round = (n, p = 4) => { const f = 10 ** p; return Math.round(n * f) / f; };

// Lahiri anchor: 24°07′47″ on 2026-01-01T00:00Z, drifting +50.29″/yr.
const LAHIRI_ANCHOR_DEG = 24 + 7 / 60 + 47 / 3600;
const LAHIRI_ANCHOR_MS = Date.UTC(2026, 0, 1);
const DRIFT_DEG_PER_YEAR = 50.29 / 3600;
const TROPICAL_YEAR_MS = 365.2422 * 86400000;

export const ayanamsaDeg = (date) =>
  LAHIRI_ANCHOR_DEG + DRIFT_DEG_PER_YEAR * ((date.getTime() - LAHIRI_ANCHOR_MS) / TROPICAL_YEAR_MS);

export const NAKSHATRAS = Object.freeze([
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
]);
export const RASHIS = Object.freeze([
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
]);

// Vimshottari: nakshatra lords repeat this 9-lord cycle 3× across the 27.
const DASHA_LORDS = Object.freeze(['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']);
const DASHA_YEARS = Object.freeze({ Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17 });

const MOVABLE_KARANAS = Object.freeze(['Bava', 'Balava', 'Kaulava', 'Taitila', 'Gara', 'Vanija', 'Vishti']);
const karanaName = (k) => {
  if (k === 0) return 'Kimstughna';
  if (k <= 56) return MOVABLE_KARANAS[(k - 1) % 7];
  return ['Shakuni', 'Chatushpada', 'Naga'][k - 57];
};

const NAKSHATRA_SPAN = 360 / 27; // 13°20′

/**
 * The Jyotisha birth coordinates at an instant.
 * @param {Date} instant - the UTC instant
 * @param {number} jdn - JDN of the LOCAL civil date (for civil vara)
 */
export const jyotisha = (instant, jdn) => {
  const ayanamsa = ayanamsaDeg(instant);
  const tropicalSun = eclipticLongitude(Astronomy.Body.Sun, instant);
  const tropicalMoon = eclipticLongitude(Astronomy.Body.Moon, instant);
  const sidSun = posMod(tropicalSun - ayanamsa, 360);
  const sidMoon = posMod(tropicalMoon - ayanamsa, 360);

  const n = Math.floor(sidMoon / NAKSHATRA_SPAN);
  const withinNakshatra = posMod(sidMoon, NAKSHATRA_SPAN);
  const elongation = posMod(tropicalMoon - tropicalSun, 360); // ayanamsa cancels in the difference
  const tithi = Math.floor(elongation / 12) + 1;
  const karanaSlot = Math.floor(elongation / 6);
  const lord = DASHA_LORDS[n % 9];

  return {
    provenance: {
      kind: 'ancient-living',
      ayanamsa: `Lahiri/Chitrapaksha (24°07′47″ @2026-01-01, +50.29″/yr linear) = ${round(ayanamsa)}°`,
      note: 'vara is the civil weekday in v1 — sunrise-based vara needs the operator location (encrypted natal path)',
    },
    nakshatra: {
      name: NAKSHATRAS[n], index: n + 1,
      pada: Math.floor(withinNakshatra / (NAKSHATRA_SPAN / 4)) + 1,
    },
    rashi: { name: RASHIS[Math.floor(sidMoon / 30)], siderealMoonDeg: round(sidMoon) },
    siderealSunRashi: RASHIS[Math.floor(sidSun / 30)],
    tithi: {
      number: tithi,
      paksha: tithi <= 15 ? 'Shukla' : 'Krishna',
      ...(tithi === 15 ? { special: 'Purnima' } : {}),
      ...(tithi === 30 ? { special: 'Amavasya' } : {}),
    },
    // The yoga uses the SUM of sidereal longitudes — the ayanamsa does NOT
    // cancel here (a known implementation trap). Index only in v1.
    yoga: { index: Math.floor(posMod(sidSun + sidMoon, 360) / NAKSHATRA_SPAN) + 1 },
    karana: { slot: karanaSlot, name: karanaName(karanaSlot) },
    vara: WEEKDAYS[posMod(jdn + 1, 7)],
    vimshottari: {
      lord,
      balanceYears: round((1 - withinNakshatra / NAKSHATRA_SPAN) * DASHA_YEARS[lord], 2),
    },
  };
};
