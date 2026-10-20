/**
 * MANY SKIES — the Thai lunar date (ปฏิทินจันทรคติ) by the Suriyayatra rule.
 *
 * NOT the astronomical Moon: the Thai calendar is arithmetic (mean motions at
 * fixed hours, Eade 2000), so real new moons would not reproduce it. This is
 * the published rule as implemented in pythaidate 0.2.0 (MIT, © its authors —
 * csdate.py / lsyear.py, ported line for line): each Chula Sakarat year's
 * new-year quantities decide a normal year (354 days), a leap-day year (355,
 * month 7 gains แรม 15) or a leap-month year (384, a second month 8 — 8 หลัง);
 * a five-year window keeps the new year's weekdays continuous when a leap day
 * and a leap month would fall together.
 *
 * Measured against the published (Bank of Thailand / myhora) calendar
 * (docs/architecture/identity/many-skies-thai.md §5.4): leap months 13/13
 * 1992–2027; every holy day 2017–2027; but the official calendar placed the
 * leap DAY elsewhere in 1994–2000 and 2014–2016 (one day off in those years),
 * and 2005/06 is disputed between sources — so each date says where it stands.
 * The lunar day turns at 06:00 local (the Thai astrological day), labelled.
 * Pure.
 */

const DAYS_IN_800_YEARS = 292207;
const UNITS = 800;
const EPOCH_OFFSET = 373;
const CS_JD_OFFSET = 1954167;
const fdiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

// LSYear — one Chula Sakarat year on its new year's day
const lsYear = (year) => {
  const y = { offset: false, year };
  y.horakhun = fdiv(year * DAYS_IN_800_YEARS + EPOCH_OFFSET, UNITS) + 1;
  y.kammacapon = UNITS - mod(year * DAYS_IN_800_YEARS + EPOCH_OFFSET, UNITS);
  const quot = fdiv(y.horakhun * 11 + 650, 692);
  y.avoman = mod(y.horakhun * 11 + 650, 692);
  if (y.avoman === 0) y.avoman = 692;
  y.tithi = mod(quot + y.horakhun, 30);
  if (y.avoman === 692) y.tithi -= 1;
  y.weekday = mod(y.horakhun, 7);
  const h1 = fdiv((year + 1) * DAYS_IN_800_YEARS + EPOCH_OFFSET, UNITS) + 1;
  const tithi1 = mod(fdiv(h1 * 11 + 650, 692) + h1, 30);
  y.langsak = Math.max(1, y.tithi);
  y.nyd = y.langsak < 6 ? y.langsak + 29 : y.langsak;
  y.nyd = mod(y.weekday - y.nyd + 1 + 35, 7);
  y.leapday = y.kammacapon <= 207;
  y.calType = 'A';
  if (y.tithi > 24 || y.tithi < 6) y.calType = 'C';
  if (y.tithi === 25 && tithi1 === 5) y.calType = 'A';
  if ((y.leapday && y.avoman <= 126) || (!y.leapday && y.avoman <= 137)) y.calType = y.calType !== 'C' ? 'B' : 'c';
  y.nextNyd = mod(y.nyd + ({ A: 4, B: 5 }[y.calType] ?? 6), 7);
  return y;
};

// calculate_year0 — settle a year's type against its neighbours
const year0 = (year) => {
  const y = [-2, -1, 0, 1, 2].map((d) => lsYear(year + d));
  if (y[2].tithi === 24 && y[3].tithi === 6) {
    for (const v of y) { v.calType = 'C'; v.nextNyd = mod(v.nextNyd + 2, 7); }
  }
  for (const i of [1, 2, 3]) {
    if (y[i].calType === 'c') {
      const j = y[i].nyd === y[i - 1].nextNyd ? 1 : -1;
      y[i + j].calType = 'B';
      y[i + j].nextNyd = mod(y[i + j].nextNyd + 1, 7);
    }
  }
  for (const i of [1, 2, 3]) {
    if (y[i - 1].nextNyd !== y[i].nyd && y[i].nextNyd !== y[i + 1].nyd) {
      y[i].offset = true;
      y[i].langsak += 1;
      y[i].nyd = mod(y[i].nyd + 6, 7);
      y[i].nextNyd = mod(y[i].nextNyd + 6, 7);
    }
  }
  for (const v of y) if (v.calType === 'c') v.calType = 'C';
  const t = y[2];
  t.offsetDays = t.langsak;
  if (t.offsetDays < 6 + Number(t.offset)) t.offsetDays += 29;
  return t;
};

// LUNAR_MONTHS[b] — 88 is the second month 8; 15/16 are months 5/6 closing the year
const LUNAR_MONTHS = Object.freeze([0, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 8, 88, 15, 16]);
const FIND = Object.freeze({
  A: [[383, 16], [354, 15], [324, 12], [295, 11], [265, 10], [236, 9], [206, 8], [177, 7], [147, 6], [118, 5], [88, 4], [59, 3], [29, 2]],
  B: [[384, 16], [355, 15], [325, 12], [296, 11], [266, 10], [237, 9], [207, 8], [178, 7], [148, 6], [119, 5], [89, 4], [59, 3], [29, 2]],
  C: [[384, 15], [354, 12], [325, 11], [295, 10], [266, 9], [236, 8], [207, 7], [177, 6], [148, 5], [118, 14], [88, 13], [59, 3], [29, 2]],
});
const findDate = (cal, days) => {
  for (const [a, b] of FIND[cal]) if (days > a) return { month: LUNAR_MONTHS[b], day: days - a };
  return { month: LUNAR_MONTHS[1], day: days };
};

/** The Thai lunar date of a civil Julian Day Number, by the Suriyayatra rule. Pure. */
export const thaiLunarOfJdn = (jd) => {
  const hk = jd - CS_JD_OFFSET;
  let year = fdiv(hk * 800 - 373, DAYS_IN_800_YEARS);
  let days;
  let y0;
  if (mod(hk, DAYS_IN_800_YEARS) === 95333) { year -= 1; days = 365; y0 = year0(year); } else { y0 = year0(year); days = hk - y0.horakhun; }
  let inYear = 365 + Number(y0.leapday);
  while (days > inYear) { year += 1; days -= inYear; y0 = year0(year); inYear = 365 + Number(y0.leapday); }
  const { month: raw, day } = findDate(y0.calType, y0.offsetDays + days);
  const month = raw === 15 || raw === 16 ? raw - 10 : raw;
  const waxing = day <= 15;
  return Object.freeze({
    csYear: year,
    yearType: { A: 'normal', B: 'leap-day', C: 'leap-month' }[y0.calType],
    month: month === 88 ? 8 : month,
    second8: month === 88,
    phase: waxing ? 'waxing' : 'waning',
    phaseDay: waxing ? day : day - 15,
  });
};

/** Where the rule stands against the published calendar for a Gregorian year (§5.4). Pure. */
export const thaiLunarStanding = (gregorianYear) => {
  if (gregorianYear >= 2017 && gregorianYear <= 2027) return 'matches the published calendar (2017–2027)';
  if ((gregorianYear >= 1994 && gregorianYear <= 2000) || (gregorianYear >= 2014 && gregorianYear <= 2016)) return 'the official calendar placed the leap day elsewhere this year — may differ by one day';
  if (gregorianYear === 2005 || gregorianYear === 2006) return 'published sources disagree this year (2005/06) — may differ by one day';
  return 'rule-computed; the official placement may differ by one day';
};
