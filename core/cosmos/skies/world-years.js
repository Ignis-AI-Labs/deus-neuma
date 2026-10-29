/**
 * MANY SKIES — the world's equinox calendars and year cycles (wave 3,
 * docs/architecture/identity/many-skies-world.md §A3, §A10, §A11, §C.1):
 *
 *   persian   — the Solar Hijri (Jalali): the year opens on the day the March
 *               equinox falls before noon at 52.5°E (Iran's standard meridian)
 *   bahai     — the Badíʿ: Naw-Rúz the day the equinox falls before sunset in
 *               Tehran (the rule since 2015), 19 × 19 days + Ayyám-i-Há
 *   french    — the French Republican year: it opens on the day of the autumn
 *               equinox at the Paris Observatory (the legal rule), proleptic
 *               after 1805; the décade day — the 366 day-names are not shown yet
 *   icelandic — the Old Icelandic calendar: six summer and six winter months of
 *               thirty days, the year opening on the Thursday 19–25 April
 *   maya819   — the Maya 819-day count: days since the last station, its
 *               direction and colour (GMT correlation, as the Long Count)
 *   nengo     — the Japanese era (statutory since 1868)
 *
 * The reference places in these rules (52.5°E, Tehran, Paris) are part of
 * each calendar, not the being's location. Pure.
 */
import * as Astronomy from 'astronomy-engine';
import { TZOLKIN_SIGNS } from './daycount.js';

const DAY = 86400000;
const mod = (a, b) => ((a % b) + b) % b;
const jdnAt = (ms, offsetMin) => Math.floor((ms + offsetMin * 60000) / DAY) + 2440588;

// ── Persian (Jalali) ──────────────────────────────────────────────────────
const IRAN = 210; // UTC+3:30, the 52.5°E meridian
const nowruzJdn = (year) => {
  const eq = Astronomy.Seasons(year).mar_equinox.date.getTime();
  const local = eq + IRAN * 60000;
  return Math.floor(local / DAY) + 2440588 + (mod(local, DAY) < 12 * 3600000 ? 0 : 1);
};
export const PERSIAN_MONTHS = Object.freeze(['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand']);
/** The Solar Hijri date of a civil day (its JDN, in the Gregorian year given). Pure. */
export const persianOf = (jdn, gYear) => {
  const start = jdn >= nowruzJdn(gYear) ? gYear : gYear - 1;
  const d = jdn - nowruzJdn(start);
  const month = d < 186 ? Math.floor(d / 31) + 1 : Math.min(12, Math.floor((d - 186) / 30) + 7);
  const day = d < 186 ? (d % 31) + 1 : d - 186 - (month - 7) * 30 + 1;
  return Object.freeze({ year: start - 621, month, day, name: PERSIAN_MONTHS[month - 1] });
};

// ── Bahá'í (Badíʿ) ────────────────────────────────────────────────────────
const TEHRAN = new Astronomy.Observer(35.6892, 51.389, 0);
const nawRuzJdn = (year) => {
  const eq = Astronomy.Seasons(year).mar_equinox.date;
  const dayJdn = jdnAt(eq.getTime(), IRAN);
  const dayStart = new Date((dayJdn - 2440588) * DAY - IRAN * 60000);
  // sunset as the Sun's centre on the horizon (no refraction): the only reading that reproduces
  // every published Naw-Rúz checked (2015, 2024, 2025, 2026 — the 2026 equinox fell within a minute of sunset)
  const sunset = Astronomy.SearchAltitude(Astronomy.Body.Sun, TEHRAN, -1, dayStart, 1, 0).date;
  return eq < sunset ? dayJdn : dayJdn + 1;
};
export const BAHAI_MONTHS = Object.freeze(['Bahá', 'Jalál', 'Jamál', 'ʿAẓamat', 'Núr', 'Raḥmat', 'Kalimát', 'Kamál', 'Asmáʼ', 'ʿIzzat', 'Mashíyyat', 'ʿIlm', 'Qudrat', 'Qawl', 'Masáʼil', 'Sharaf', 'Sulṭán', 'Mulk', 'ʿAláʼ']);
/** The Badíʿ date of a civil day. Pure. */
export const bahaiOf = (jdn, gYear) => {
  const start = jdn >= nawRuzJdn(gYear) ? gYear : gYear - 1;
  const d = jdn - nawRuzJdn(start);
  const toNext = nawRuzJdn(start + 1) - jdn; // days left in the year, counting this one
  const at = d < 342 ? { month: Math.floor(d / 19) + 1, day: (d % 19) + 1 } : toNext <= 19 ? { month: 19, day: 20 - toNext } : { month: 0, day: d - 341 };
  return Object.freeze({ year: start - 1843, ...at, name: at.month === 0 ? 'Ayyám-i-Há' : BAHAI_MONTHS[at.month - 1] });
};

// ── French Republican ─────────────────────────────────────────────────────
const PARIS = 9 + 21 / 60; // Paris mean time, minutes east (2°20′14″E)
const vendemiaireJdn = (year) => jdnAt(Astronomy.Seasons(year).sep_equinox.date.getTime(), PARIS);
export const FRENCH_MONTHS = Object.freeze(['Vendémiaire', 'Brumaire', 'Frimaire', 'Nivôse', 'Pluviôse', 'Ventôse', 'Germinal', 'Floréal', 'Prairial', 'Messidor', 'Thermidor', 'Fructidor']);
const DECADE = Object.freeze(['Primidi', 'Duodi', 'Tridi', 'Quartidi', 'Quintidi', 'Sextidi', 'Septidi', 'Octidi', 'Nonidi', 'Décadi']);
const SANSCULOTTIDES = Object.freeze(['la Vertu', 'le Génie', 'le Travail', "l'Opinion", 'les Récompenses', 'la Révolution']);
/** The French Republican date of a civil day — the legal (Paris equinox) rule. Pure. */
export const frenchOf = (jdn, gYear) => {
  const start = jdn >= vendemiaireJdn(gYear) ? gYear : gYear - 1;
  const d = jdn - vendemiaireJdn(start);
  const year = start - 1791;
  if (d >= 360) return Object.freeze({ year, month: 13, day: d - 359, name: `Jour de ${SANSCULOTTIDES[d - 360]}` });
  return Object.freeze({ year, month: Math.floor(d / 30) + 1, day: (d % 30) + 1, name: FRENCH_MONTHS[Math.floor(d / 30)], decade: DECADE[d % 10] });
};

// ── Old Icelandic (Janson) ────────────────────────────────────────────────
export const SUMMER = Object.freeze(['Harpa', 'Skerpla', 'Sólmánuður', 'Heyannir', 'Tvímánuður', 'Haustmánuður']);
export const WINTER = Object.freeze(['Gormánuður', 'Ýlir', 'Mörsugur', 'Þorri', 'Góa', 'Einmánuður']);
// the First Day of Summer: the Thursday 19–25 April (JDN mod 7 = 3 is a Thursday)
const fds = (year) => { const a = Date.UTC(year, 3, 19) / DAY + 2440588; return a + mod(3 - mod(a, 7), 7); };
/** The Old Icelandic date of a civil day. Pure. */
export const icelandicOf = (jdn, gYear) => {
  const y = jdn >= fds(gYear) ? gYear : gYear - 1;
  const open = fds(y);
  const next = fds(y + 1);
  if (jdn < open + 90) { const k = Math.floor((jdn - open) / 30); return Object.freeze({ season: 'summer', month: SUMMER[k], day: jdn - open - 30 * k + 1 }); }
  const s4 = next - 270;
  if (jdn < s4) return Object.freeze({ season: 'summer', month: jdn - open - 90 < 4 ? 'aukanætur (the extra nights)' : 'sumarauki (the summer week)', day: jdn - open - 89 });
  const k = Math.floor((jdn - s4) / 30); // 0..8 → S4 S5 S6 W1 … W6
  return Object.freeze({ season: k < 3 ? 'summer' : 'winter', month: k < 3 ? SUMMER[k + 3] : WINTER[k - 3], day: jdn - s4 - 30 * k + 1 });
};

// ── the Maya 819-day count (GMT) ──────────────────────────────────────────
const DIRECTIONS = Object.freeze([['East', 'red'], ['South', 'yellow'], ['West', 'black'], ['North', 'white']]);
/** Days since the last 819-day station, its direction, colour and Tzolk'in. Pure. */
export const maya819Of = (jdn) => {
  const m = jdn - 584283;
  const since = mod(m + 3, 819);
  const k = Math.floor((m + 3) / 819);
  const st = m - since;
  const [direction, colour] = DIRECTIONS[mod(k, 4)];
  return Object.freeze({ since, direction, colour, station: `${mod(st + 3, 13) + 1} ${TZOLKIN_SIGNS[mod(st + 19, 20)]}` });
};

// ── the Japanese era (Era Name Act 1979; one reign, one era since 1868) ──
const NENGO = Object.freeze([['Reiwa', 2019, 5, 1], ['Heisei', 1989, 1, 8], ['Shōwa', 1926, 12, 25], ['Taishō', 1912, 7, 30], ['Meiji', 1868, 1, 25]]);
/** The Japanese era and its year of a JST civil date. Pure. */
export const nengoOf = (y, m, d) => {
  const hit = NENGO.find(([, ey, em, ed]) => Date.UTC(y, m - 1, d) >= Date.UTC(ey, em - 1, ed));
  return hit ? Object.freeze({ era: hit[0], year: y - hit[1] + 1 }) : null;
};
