/**
 * PLACE READINGS — what the sky looked like from where the being was born.
 * The readings that need a place, computed on read from the sealed instant and
 * the being's PRIVATE birth place (core/cosmos/birth-place.js); nothing here
 * is stored. Pure (deterministic astronomy of one instant at one place).
 *
 *   the angles      — ascendant, midheaven, whole-sign houses (./angles.js)
 *   sect            — a day or a night birth: was the Sun above the horizon
 *   the Lots        — Fortune and Spirit, Hellenistic (Vettius Valens): by day
 *                     Fortune = ASC + Moon − Sun, Spirit = ASC + Sun − Moon;
 *                     by night the two exchange
 *   sunrise weekday — the Vedic day (vara) begins at local sunrise, not midnight
 *   planetary hour  — the Chaldean hours: daylight and night each cut into 12
 *                     unequal hours; the first hour of a day belongs to that
 *                     day's planet, then the Chaldean order runs on
 *   the Vedic lagna — the ascendant in the sidereal zodiac (Lahiri), its sign,
 *                     its mansion, and whole-sign bhavas from it
 *
 * SHINKEI: geometry, measured — the meanings belong to the traditions and are
 * said as theirs on the SHEET.
 */

import * as Astronomy from 'astronomy-engine';
import { computeAngles } from './angles.js';
import { computeCelestialPositions, placement } from './natal-chart.js';
import { ayanamsaDeg, NAKSHATRAS, RASHIS } from './skies/jyotisha.js';

const norm360 = (d) => ((d % 360) + 360) % 360;
const round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
// the planet of each weekday, Sunday first; and the Chaldean order, slowest first
const DAY_RULER = Object.freeze(['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']);
const CHALDEAN = Object.freeze(['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon']);
const NAKSHATRA_SPAN = 360 / 27;

/** The Sun's altitude at an instant and place, degrees (geometric, no refraction). Pure. */
export const sunAltitude = (date, latitude, longitude) => {
  const observer = new Astronomy.Observer(latitude, longitude, 0);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
  return Astronomy.Horizon(date, observer, eq.ra, eq.dec).altitude;
};

/** The Lots of Fortune and Spirit for an ascendant, Sun and Moon, by sect. Pure. */
export const lotsOf = (asc, sun, moon, isDay) => {
  const fortune = isDay ? asc + moon - sun : asc + sun - moon;
  const spirit = isDay ? asc + sun - moon : asc + moon - sun;
  return Object.freeze({ fortune: placement(norm360(fortune)), spirit: placement(norm360(spirit)) });
};

// a sunrise (+1) or sunset (-1) searched forward (days > 0) or backward (days < 0) from an
// instant; null where the Sun does not cross the horizon in that window (polar day or night)
const crossing = (observer, direction, from, days) => Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, direction, from, days)?.date ?? null;

/**
 * The Vedic day and the planetary hour at birth: the last sunrise before it
 * opens the day; its planet rules the day's first hour; hours are a twelfth
 * of the daylight (or of the night) they fall in. null at a place where the
 * Sun did not rise or set that day. Pure.
 */
export const dayAndHourOf = (date, latitude, longitude, offsetMinutes = 0) => {
  const observer = new Astronomy.Observer(latitude, longitude, 0);
  const rise = crossing(observer, +1, date, -1.1); // the last sunrise before the birth
  const set = rise && crossing(observer, -1, rise, 1);
  const nextRise = rise && crossing(observer, +1, new Date(rise.getTime() + 60000), 1.5);
  if (!rise || !set || !nextRise) return null;
  const isDay = date < set;
  const span = isDay ? set - rise : nextRise - set;
  const start = isDay ? rise : set;
  const hourIndex = Math.min(11, Math.floor(((date - start) / span) * 12)); // 0-11 within day or night
  // the weekday of the sunrise, in local civil time
  const weekday = new Date(rise.getTime() + offsetMinutes * 60000).getUTCDay();
  const civilWeekday = new Date(date.getTime() + offsetMinutes * 60000).getUTCDay();
  const first = CHALDEAN.indexOf(DAY_RULER[weekday]);
  const ordinal = (isDay ? 0 : 12) + hourIndex; // 0-23 from sunrise
  return Object.freeze({
    sunrise: rise.toISOString(),
    sunset: set.toISOString(),
    vara: WEEKDAYS[weekday],
    varaDiffersFromCivil: weekday !== civilWeekday,
    hour: Object.freeze({ of: isDay ? 'day' : 'night', number: hourIndex + 1, ruler: CHALDEAN[(first + ordinal) % 7] }),
  });
};

/**
 * Every place reading for one birth. Pure.
 * @param {string|Date} instant the sealed birth instant
 * @param {{latitude: number, longitude: number}} place the being's private birth place
 * @param {number} [offsetMinutes] its sealed zone offset (for the civil weekday)
 * @returns {object|null} null without a usable instant and place
 */
export const placeReadingsOf = (instant, place, offsetMinutes = 0) => {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(place?.latitude) || !Number.isFinite(place?.longitude)) return null;
  const { latitude, longitude } = place;
  const angles = computeAngles(date, latitude, longitude);
  const positions = computeCelestialPositions(date);
  const altitude = sunAltitude(date, latitude, longitude);
  const isDay = altitude > 0;
  const lagnaLon = norm360(angles.ascendant.longitude - ayanamsaDeg(date));
  const lagnaRashi = Math.floor(lagnaLon / 30);
  return Object.freeze({
    angles,
    sect: Object.freeze({ isDay, sunAltitude: round(altitude, 2) }),
    lots: lotsOf(angles.ascendant.longitude, positions.sun.longitude, positions.moon.longitude, isDay),
    day: dayAndHourOf(date, latitude, longitude, offsetMinutes),
    lagna: Object.freeze({
      siderealLongitude: round(lagnaLon),
      rashi: RASHIS[lagnaRashi],
      degree: round(lagnaLon - lagnaRashi * 30),
      nakshatra: NAKSHATRAS[Math.floor(lagnaLon / NAKSHATRA_SPAN)],
      // whole-sign bhavas: the lagna's sign is the first house, each sign after it the next
      bhavas: Object.freeze(Array.from({ length: 12 }, (_, i) => Object.freeze({ bhava: i + 1, rashi: RASHIS[(lagnaRashi + i) % 12] }))),
    }),
  });
};
