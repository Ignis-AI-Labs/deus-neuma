/**
 * MANY SKIES — the 28 xiù 二十八宿, the Chinese lunar lodges, in their two
 * readings, never mixed (docs/architecture/identity/many-skies-east-asia.md §2):
 *
 *   moon — where the Moon truly stood: the mansion whose determinative star
 *          (距星) it had passed in right ascension, of date, and how far in
 *          (入宿度, in Chinese du of 365.25 to the circle). Unequal, star-
 *          anchored, equatorial — a projection nothing else on the record
 *          shows. Geocentric. The modern (1752) determinative stars; the four
 *          contested ones are named in xiu-stars.json.
 *   day  — the almanac's day-duty mansion (值日): a plain 28-day cycle locked to
 *          the week, (JDN + 11) mod 28 from 角, unbroken in published almanacs
 *          from 1201 to today. What a folk almanac reads for a birth day — NOT
 *          the Moon's position.
 *
 * Pure.
 */
import * as Astronomy from 'astronomy-engine';
import XIU from './xiu-stars.json' with { type: 'json' };

const DEG = 180 / Math.PI;
const norm360 = (d) => ((d % 360) + 360) % 360;
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const J2000_MS = Date.UTC(2000, 0, 1, 12);

export const MANSIONS = Object.freeze(XIU.mansions.map(({ hanzi, pinyin, english, star, hip }) => Object.freeze({ hanzi, pinyin, english, star, hip })));

// a J2000 equatorial direction of date: proper motion carried to the instant, then precessed and nutated
const ofDate = (raDeg, decDeg, time) => {
  const v = Astronomy.VectorFromSphere(new Astronomy.Spherical(decDeg, raDeg, 1), time);
  return Astronomy.EquatorFromVector(Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(time), v)).ra * 15;
};

/** The right ascension of date of each determinative star, degrees, 角 first. Pure. */
export const mansionStartsAt = (date) => {
  const time = Astronomy.MakeTime(date);
  const years = (date.getTime() - J2000_MS) / (365.25 * 86400000);
  return XIU.mansions.map((m) => {
    const dec = m.dec + (m.pmdec / 3.6e6) * years;
    const ra = m.ra + (m.pmra / 3.6e6 / Math.cos(m.dec / DEG)) * years;
    return ofDate(ra, dec, time);
  });
};

/** The Moon's mansion at an instant: which lodge it stood in, and how far in (du). Pure. */
export const moonMansion = (date) => {
  const time = Astronomy.MakeTime(date);
  const geo = Astronomy.GeoVector(Astronomy.Body.Moon, time, true);
  const ra = Astronomy.EquatorFromVector(Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(time), geo)).ra * 15;
  const starts = mansionStartsAt(date);
  // the lodge whose start the Moon passed most recently, going east from it
  let index = 0;
  let best = 360;
  starts.forEach((s, i) => {
    const past = norm360(ra - s);
    if (past < best) { best = past; index = i; }
  });
  const width = norm360(starts[(index + 1) % 28] - starts[index]);
  return Object.freeze({ index, ...MANSIONS[index], du: round(best * 365.25 / 360), widthDu: round(width * 365.25 / 360), moonRa: round(ra, 4) });
};

/** The almanac's day-duty mansion of a civil day (its JDN). Pure. */
export const dayMansion = (jdn) => {
  const index = (((jdn + 11) % 28) + 28) % 28;
  return Object.freeze({ index, ...MANSIONS[index] });
};

/** The xiù block of one birth. Pure. */
export const xiu = (instant, jdn) => ({
  provenance: {
    kind: 'ancient-living',
    school: 'modern determinative stars (1752 revision), equatorial of date, geocentric; Chinese du of 365.25',
    note: 'two readings kept apart — the Moon\'s true lodge, and the almanac\'s day-duty lodge (a 28-day count, not the Moon); contested stars: 奎 (classical ζ And), 觜/参 (classical φ¹/δ Ori), 心 (some list α Sco)',
  },
  moon: moonMansion(instant),
  day: dayMansion(jdn),
});
