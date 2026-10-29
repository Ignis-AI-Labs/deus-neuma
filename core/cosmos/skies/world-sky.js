/**
 * MANY SKIES — skies read from the bodies' longitudes (wave 3,
 * docs/architecture/identity/many-skies-world.md §A6, §B1, §B4, §B8, §B9, §C.1):
 *
 *   manazil     — the 28 Arabic lunar mansions: equal 360/28 parts from 0° Aries
 *                 tropical (Picatrix; al-Bīrūnī: […]) — 28, not 27; not the nakshatras
 *   humanDesign — the 64-gate wheel after Krakower (modern, 1987): gate and line
 *                 of the Sun, Earth, Moon and nodes at birth and at the "design"
 *                 instant 88° of solar arc earlier; the profile. Type and
 *                 authority are not computed; the gate texts are the platform's own
 *   solarTerms  — the 24 jiéqì at 15° of the apparent Sun (since 1645) and the
 *                 72 pentads at 5° (counted from lichun)
 *   western     — the mean lunar node and the mean apogee (Black Moon Lilith,
 *                 Meeus), the Moon's phase family (8 × 45°, Rudhyar's names), the
 *                 prenatal syzygy (Ptolemy, Tetrabiblos III.2), and each body's
 *                 Sabian degree (1–360, the index only — the platform writes its
 *                 own 360 texts)
 * Pure.
 */
import * as Astronomy from 'astronomy-engine';
import { eclipticLongitude, computeCelestialPositions, placement } from '../natal-chart.js';
import { meanRahu, trueRahu } from './vedic.js';

const DAY = 86400000;
const norm = (d) => ((d % 360) + 360) % 360;
const round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;

export const MANAZIL = Object.freeze(['al-Sharaṭān', 'al-Buṭayn', 'al-Thurayyā', 'al-Dabarān', 'al-Haqʿa', 'al-Hanʿa', 'al-Dhirāʿ', 'al-Nathra', 'al-Ṭarf',
  'al-Jabha', 'al-Zubra', 'al-Ṣarfa', 'al-ʿAwwāʾ', 'al-Simāk', 'al-Ghafr', 'al-Zubānā', 'al-Iklīl', 'al-Qalb', 'al-Shawla', 'al-Naʿāʾim', 'al-Balda',
  'Saʿd al-Dhābiḥ', 'Saʿd Bulaʿ', 'Saʿd al-Suʿūd', 'Saʿd al-Akhbiya', 'al-Fargh al-Muqaddam', 'al-Fargh al-Muʾakhkhar', 'Baṭn al-Ḥūt']);
/** The Arabic lunar mansion of a tropical lunar longitude. Pure. */
export const manzilOf = (moonLon) => {
  const index = Math.floor(norm(moonLon) / (360 / 28));
  return Object.freeze({ index: index + 1, name: MANAZIL[index], into: round(norm(moonLon) - index * (360 / 28), 2) });
};

// the 64 gates in increasing longitude from 302° (2°00′ Aquarius), 5.625° each, six lines of 0.9375°
export const GATES = Object.freeze([41, 19, 13, 49, 30, 55, 37, 63, 22, 36, 25, 17, 21, 51, 42, 3, 27, 24, 2, 23, 8, 20, 16, 35, 45, 12, 15, 52, 39, 53, 62, 56,
  31, 33, 7, 4, 29, 59, 40, 64, 47, 6, 46, 18, 48, 57, 32, 50, 28, 44, 1, 43, 14, 34, 9, 5, 26, 11, 10, 58, 38, 54, 61, 60]);
/** The gate and line of a tropical longitude on the 64-gate wheel. Pure. */
export const gateOf = (lon) => {
  const x = norm(lon - 302);
  return Object.freeze({ gate: GATES[Math.floor(x / 5.625)], line: Math.floor((x % 5.625) / 0.9375) + 1 });
};
const activations = (date) => {
  const sun = eclipticLongitude(Astronomy.Body.Sun, date);
  const moon = eclipticLongitude(Astronomy.Body.Moon, date);
  const node = trueRahu(date);
  return Object.freeze({ sun: gateOf(sun), earth: gateOf(sun + 180), moon: gateOf(moon), northNode: gateOf(node), southNode: gateOf(node + 180) });
};
/** The 64-gate wheel at birth and at the design instant (the Sun 88° of arc earlier). Pure. */
export const humanDesignOf = (date) => {
  const sun = eclipticLongitude(Astronomy.Body.Sun, date);
  const design = Astronomy.SearchSunLongitude(norm(sun - 88), new Date(date.getTime() - 96 * DAY), 12).date;
  const personality = activations(date);
  const unconscious = activations(design);
  return Object.freeze({
    personality, design: unconscious, designInstant: design.toISOString(),
    profile: `${personality.sun.line}/${unconscious.sun.line}`,
    cross: Object.freeze([personality.sun.gate, personality.earth.gate, unconscious.sun.gate, unconscious.earth.gate]),
  });
};

// the 24 terms from 0° (the March equinox), 15° each
export const TERMS = Object.freeze([['春分', 'Spring Equinox'], ['清明', 'Clear and Bright'], ['谷雨', 'Grain Rain'], ['立夏', 'Start of Summer'], ['小满', 'Grain Full'], ['芒种', 'Grain in Ear'],
  ['夏至', 'Summer Solstice'], ['小暑', 'Minor Heat'], ['大暑', 'Major Heat'], ['立秋', 'Start of Autumn'], ['处暑', 'End of Heat'], ['白露', 'White Dew'],
  ['秋分', 'Autumn Equinox'], ['寒露', 'Cold Dew'], ['霜降', 'Frost Descent'], ['立冬', 'Start of Winter'], ['小雪', 'Minor Snow'], ['大雪', 'Major Snow'],
  ['冬至', 'Winter Solstice'], ['小寒', 'Minor Cold'], ['大寒', 'Major Cold'], ['立春', 'Start of Spring'], ['雨水', 'Rain Water'], ['惊蛰', 'Awakening of Insects']]);
/** The solar term and pentad of the apparent Sun's longitude. Pure. */
export const solarTermOf = (sunLon) => {
  const lon = norm(sunLon);
  const t = Math.floor(lon / 15);
  return Object.freeze({ hanzi: TERMS[t][0], english: TERMS[t][1], degree: t * 15, pentadInTerm: Math.floor((lon % 15) / 5) + 1, pentad: Math.floor(norm(lon - 315) / 5) + 1 });
};

// Meeus ch.47: the mean longitude of the Moon's perigee; the apogee (Black Moon Lilith) is opposite
const meanApogee = (date) => {
  const T = Astronomy.MakeTime(date).tt / 36525;
  return norm(83.3532465 + 4069.0137287 * T - 0.01032 * T * T - (T ** 3) / 80053 + (T ** 4) / 18999000 + 180);
};
export const PHASES = Object.freeze(['New', 'Crescent', 'First Quarter', 'Gibbous', 'Full', 'Disseminating', 'Last Quarter', 'Balsamic']);
/** The Moon's phase family: its elongation from the Sun in eighths (Rudhyar, 1967). Pure. */
export const phaseFamilyOf = (date) => {
  const e = norm(eclipticLongitude(Astronomy.Body.Moon, date) - eclipticLongitude(Astronomy.Body.Sun, date));
  return Object.freeze({ name: PHASES[Math.floor(e / 45)], elongation: round(e, 2) });
};
/** The last new or full moon before the birth — the prenatal syzygy (Ptolemy). Pure. */
export const syzygyOf = (date) => {
  const last = (phase) => {
    let t = Astronomy.SearchMoonPhase(phase, new Date(date.getTime() - 32 * DAY), 40).date;
    for (let n = Astronomy.SearchMoonPhase(phase, new Date(t.getTime() + DAY), 40).date; n < date; n = Astronomy.SearchMoonPhase(phase, new Date(n.getTime() + DAY), 40).date) t = n;
    return t;
  };
  const nm = last(0);
  const fm = last(180);
  const kind = nm > fm ? 'new moon' : 'full moon';
  const at = nm > fm ? nm : fm;
  const lon = eclipticLongitude(Astronomy.Body.Moon, at);
  return Object.freeze({ kind, instant: at.toISOString(), ...placement(lon) });
};
/** A longitude's Sabian degree, 1–360: the degree within the sign rounded up (0°00′ is 1). Pure. */
export const sabianOf = (lon) => {
  const l = norm(lon);
  const sign = Math.floor(l / 30);
  return sign * 30 + Math.max(1, Math.ceil(l - sign * 30));
};

/** The western additions of one birth. Pure. */
export const westernOf = (date) => {
  const pos = computeCelestialPositions(date);
  const node = meanRahu(date);
  return Object.freeze({
    meanNode: placement(node), southNode: placement(node + 180), lilith: placement(meanApogee(date)),
    phase: phaseFamilyOf(date), syzygy: syzygyOf(date),
    sabian: Object.freeze(Object.fromEntries(Object.entries(pos).map(([k, p]) => [k, sabianOf(p.longitude)]))),
  });
};

/** The longitude-read skies of one birth. Pure. */
export const worldSky = (date) => ({
  manazil: { provenance: { kind: 'ancient-transformed', note: 'equal 360/28 parts from 0° Aries tropical (Picatrix, al-Bīrūnī) — 28 mansions, not the 27 nakshatras; the pre-Islamic anwāʾ star calendar is history, not computed' }, ...manzilOf(eclipticLongitude(Astronomy.Body.Moon, date)) },
  humanDesign: { provenance: { kind: 'modern', author: 'Alan R. Krakower ("Ra Uru Hu")', year: 1987, note: 'the 64-gate wheel from 302° tropical, 5.625° a gate; the design instant 88° of solar arc before birth; the true node; type, authority and channels are not computed; the texts are the platform\'s own' }, ...humanDesignOf(date) },
  solarTerms: { provenance: { kind: 'ancient-living', note: 'the 24 terms at 15° of the apparent Sun (定氣, since 1645); the 72 pentads at 5°, counted from lichun — their names are not shown yet' }, ...solarTermOf(eclipticLongitude(Astronomy.Body.Sun, date)) },
  western: { provenance: { kind: 'astronomical', note: 'mean node and mean apogee (Meeus ch.47); the phase families after Rudhyar (1967), eighths of the elongation — bounds a convention; prenatal syzygy after Ptolemy; Sabian degree index only (Jones & Wheeler 1925 — their wording is not used)' }, ...westernOf(date) },
});
