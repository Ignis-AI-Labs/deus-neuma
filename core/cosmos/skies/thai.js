/**
 * MANY SKIES — Thai astrology (โหราศาสตร์ไทย), from the instant and its sealed
 * zone offset (docs/architecture/identity/many-skies-thai.md):
 *
 *   thaksa   — ทักษา: the eight planets round the eight directions; the birth
 *              group's planet is บริวาร and the rest take their roles clockwise
 *              (wheel 1 2 3 4 7 5 8 6). The Thai astrological day runs from
 *              06:00; Wednesday 18:00–05:59 is Rahu (Wednesday night). NOT the
 *              Burmese Mahabote (noon split, midnight day, other animals).
 *   colour, buddha — the birth day's colour and Buddha image, same 8 groups.
 *   eras     — the Buddhist Era (CE + 543 since 1941) and the Chula Sakarat
 *              year, which turns at the exact thaloengsok instant (Suriyayatra
 *              arithmetic, Thai local mean time at 100°31′E), with its ศก name.
 *   animal   — the Thai name of the year animal under the two Thai boundaries:
 *              astrology (ขึ้น 1 ค่ำ เดือน 5) and the official calendar
 *              (ขึ้น 1 ค่ำ เดือนอ้าย) — the same cycle as China's, its Thai
 *              names (กุน is the elephant in Lanna).
 *   lunar    — the Thai lunar date (./thai-lunar.js).
 *
 * The 06:00/18:00 clock is the written authority (โสฬสเวท); a sunrise or local-
 * mean-time reckoning would need the birth place and is not used here.
 * Pure.
 */
import { thaiLunarOfJdn, thaiLunarStanding } from './thai-lunar.js';

const DAY = 86400000;
const CYCLE = Object.freeze([1, 2, 3, 4, 7, 5, 8, 6]);
const PLANET = Object.freeze({
  1: { name: 'Sun', thai: 'อาทิตย์', direction: 'NE', animal: 'Garuda' },
  2: { name: 'Moon', thai: 'จันทร์', direction: 'E', animal: 'Tiger' },
  3: { name: 'Mars', thai: 'อังคาร', direction: 'SE', animal: 'Lion' },
  4: { name: 'Mercury', thai: 'พุธ', direction: 'S', animal: 'Dog' },
  5: { name: 'Jupiter', thai: 'พฤหัสบดี', direction: 'W', animal: 'Rat' },
  6: { name: 'Venus', thai: 'ศุกร์', direction: 'N', animal: 'Goat' },
  7: { name: 'Saturn', thai: 'เสาร์', direction: 'SW', animal: 'Naga' },
  8: { name: 'Rahu', thai: 'ราหู', direction: 'NW', animal: 'Elephant' },
});
export const THAKSA_ROLES = Object.freeze(['บริวาร', 'อายุ', 'เดช', 'ศรี', 'มูละ', 'อุตสาหะ', 'มนตรี', 'กาลกิณี']);
const ROLE_ENGLISH = Object.freeze(['dependants', 'life', 'power', 'fortune', 'roots', 'effort', 'patrons', 'misfortune']);
// birth groups keyed by planet number (Wednesday day = 4, Wednesday night = 8)
const GROUP = Object.freeze({
  1: { day: 'Sunday', colour: 'red', colourThai: 'แดง', buddha: 'ถวายเนตร', posture: 'standing, gazing at the Bodhi tree' },
  2: { day: 'Monday', colour: 'yellow', colourThai: 'เหลือง', buddha: 'ห้ามสมุทร', posture: 'calming the ocean (also ห้ามญาติ)' },
  3: { day: 'Tuesday', colour: 'pink', colourThai: 'ชมพู', buddha: 'ไสยาสน์', posture: 'reclining' },
  4: { day: 'Wednesday (day)', colour: 'green', colourThai: 'เขียว', buddha: 'อุ้มบาตร', posture: 'holding the alms bowl' },
  8: { day: 'Wednesday (night)', colour: 'grey or black', colourThai: 'เทา / ดำ', buddha: 'ป่าเลไลยก์', posture: 'in the forest, with the elephant and the monkey' },
  5: { day: 'Thursday', colour: 'orange', colourThai: 'ส้ม', buddha: 'สมาธิ', posture: 'meditation' },
  6: { day: 'Friday', colour: 'light blue', colourThai: 'ฟ้า', buddha: 'รำพึง', posture: 'contemplation' },
  7: { day: 'Saturday', colour: 'purple', colourThai: 'ม่วง', buddha: 'นาคปรก', posture: 'sheltered by the naga' },
});
const NAKSATR = Object.freeze(['ชวด', 'ฉลู', 'ขาล', 'เถาะ', 'มะโรง', 'มะเส็ง', 'มะเมีย', 'มะแม', 'วอก', 'ระกา', 'จอ', 'กุน']);
const NAKSATR_EN = Object.freeze(['Rat', 'Ox', 'Tiger', 'Rabbit', 'Naga', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig']);
const SOK = Object.freeze(['สัมฤทธิศก', 'เอกศก', 'โทศก', 'ตรีศก', 'จัตวาศก', 'เบญจศก', 'ฉศก', 'สัปตศก', 'อัฐศก', 'นพศก']);
const BANGKOK_LMT_MIN = 6 * 60 + 42; // Thai local mean time (100°31′E) as the Songkran announcements give it (UTC+06:42)

/** The Thai birth group of a local clock: the planet number (Wednesday night = 8). Pure. */
export const thaiBirthGroup = (epochMs, offsetMinutes) => {
  const astro = new Date(epochMs + offsetMinutes * 60000 - 6 * 3600000); // the day runs 06:00 → 05:59
  const weekday = astro.getUTCDay();
  const night = astro.getUTCHours() >= 12; // 18:00 … 05:59
  return weekday === 3 && night ? 8 : [1, 2, 3, 4, 5, 6, 7][weekday];
};

/** The Thaksa wheel from a birth planet: each role's planet, clockwise. Pure. */
export const thaksaOf = (planet) => {
  const at = CYCLE.indexOf(planet);
  return Object.freeze(THAKSA_ROLES.map((role, k) => {
    const p = CYCLE[(at + k) % 8];
    return Object.freeze({ role, roleEnglish: ROLE_ENGLISH[k], planet: p, ...PLANET[p] });
  }));
};

/** The thaloengsok instant of a Chula Sakarat year (UTC ms) — the year's turn, exact. Pure. */
export const thaloengsokMs = (cs) => {
  const a = cs * 292207 + 373;
  const horakhun = Math.floor(a / 800) + 1;
  const jdn = horakhun + 1954167; // the civil day (Thai LMT)
  return (jdn - 2440588) * DAY + ((a % 800) / 800) * DAY - BANGKOK_LMT_MIN * 60000;
};

/** The Buddhist Era and Chula Sakarat years of an instant. Pure. */
export const thaiErasOf = (epochMs, offsetMinutes) => {
  const local = new Date(epochMs + offsetMinutes * 60000);
  const ce = local.getUTCFullYear();
  // BE: CE + 543 since 1 Jan 1941; 1889–1940 the year began 1 April
  const be = ce >= 1941 || ce < 1889 || local.getUTCMonth() >= 3 ? ce + 543 : ce + 542;
  const cs = epochMs >= thaloengsokMs(ce - 638) ? ce - 638 : ce - 639;
  return Object.freeze({ be, cs, sok: SOK[cs % 10], thaloengsok: new Date(thaloengsokMs(ce - 638)).toISOString() });
};

const animalOf = (gregorianYear) => {
  const i = ((gregorianYear - 4) % 12 + 12) % 12;
  return Object.freeze({ thai: `ปี${NAKSATR[i]}`, english: NAKSATR_EN[i] });
};
// the civil JDN of a Thai lunar date within a Gregorian window — the first day matching
const findDay = (fromJdn, days, test) => {
  for (let j = fromJdn; j < fromJdn + days; j += 1) if (test(thaiLunarOfJdn(j))) return j;
  return null;
};
const jdnOfUtc = (y, m, d) => Date.UTC(y, m - 1, d) / DAY + 2440588;

/** The Thai block of one birth. Pure. */
export const thai = (instant, offsetMinutes = 0) => {
  const epochMs = instant.getTime();
  const group = thaiBirthGroup(epochMs, offsetMinutes);
  const jdn = Math.floor((epochMs + offsetMinutes * 60000 - 6 * 3600000) / DAY) + 2440588; // the Thai civil day (from 06:00)
  const local = new Date(epochMs + offsetMinutes * 60000);
  const y = local.getUTCFullYear();
  // the year animal under both Thai boundaries
  const month5 = findDay(jdnOfUtc(y, 2, 20), 70, (r) => r.month === 5 && !r.second8 && r.phase === 'waxing' && r.phaseDay === 1);
  const month1 = findDay(jdnOfUtc(y, 11, 1), 61, (r) => r.month === 1 && r.phase === 'waxing' && r.phaseDay === 1);
  const lunar = thaiLunarOfJdn(jdn);
  return {
    provenance: {
      kind: 'ancient-living',
      note: 'the Thai astrological day runs 06:00 → 05:59 and Wednesday 18:00–05:59 is Rahu (โสฬสเวท); lunar date by the Suriyayatra rule (Eade 2000; pythaidate) — the official calendar can differ by a day in some years; thaloengsok in Thai local mean time (100°31′E)',
    },
    group: { planet: group, ...PLANET[group], ...GROUP[group] },
    thaksa: thaksaOf(group),
    eras: thaiErasOf(epochMs, offsetMinutes),
    animal: {
      astrology: month5 !== null && jdn >= month5 ? animalOf(y) : animalOf(y - 1),
      official: month1 !== null && jdn >= month1 ? animalOf(y + 1) : animalOf(y),
    },
    lunar: { ...lunar, standing: thaiLunarStanding(y) },
  };
};
