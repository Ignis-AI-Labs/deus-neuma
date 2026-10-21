/**
 * MANY SKIES — the world's day-count calendars (wave 3,
 * docs/architecture/identity/many-skies-world.md §A). Each is integer
 * arithmetic on the civil day (its JDN), after Reingold & Dershowitz,
 * Calendrical Calculations (R&D) unless noted:
 *
 *   hebrew       — the fixed Hebrew calendar (molad + the four postponements)
 *   hijri        — Umm al-Qura (Saudi civil; its post-1423 AH rule computed at
 *                  Mecca, a fixed reference place) with the tabular type II
 *                  count beside it; the day begins at sunset — civil date used
 *   alexandrian  — Ethiopian, and the Coptic line (same month and day)
 *   wandering    — the 365-day year (12 × 30 + 5): Egyptian (Nabonassar),
 *                  Zoroastrian Shahanshahi and Kadmi (+ Fasli). (The Armenian
 *                  year is held: R&D's epoch, 11 Jul 552, and the published
 *                  year starts disagree by two days.)
 *   igbo, adaduanan — the Igbo market day; the Akan 42-day cycle
 *
 * Every day-boundary edge (sunset, sunrise) is labelled; the civil-date
 * reading is what plaintext skies carry. Pure.
 */
import * as Astronomy from 'astronomy-engine';

const fdiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;
const RD = (jdn) => jdn - 1721425; // R&D fixed date of a JDN
const DAY = 86400000;

// ── Hebrew (R&D) ──────────────────────────────────────────────────────────
const HEBREW_EPOCH = -1373427; // RD of 1 Tishri AM 1
const hLeap = (y) => mod(7 * y + 1, 19) < 7;
const hElapsed = (y) => {
  const months = fdiv(235 * y - 234, 19);
  const parts = 12084 + 13753 * months;
  const days = 29 * months + fdiv(parts, 25920);
  return mod(3 * (days + 1), 7) < 3 ? days + 1 : days;
};
const hCorrection = (y) => {
  const ny0 = hElapsed(y - 1); const ny1 = hElapsed(y); const ny2 = hElapsed(y + 1);
  if (ny2 - ny1 === 356) return 2;
  if (ny1 - ny0 === 382) return 1;
  return 0;
};
const hNewYear = (y) => HEBREW_EPOCH + hElapsed(y) + hCorrection(y);
const hDays = (y) => hNewYear(y + 1) - hNewYear(y);
const hLastDay = (m, y) => {
  const len = hDays(y);
  if ([2, 4, 6, 10, 13].includes(m) || (m === 12 && !hLeap(y)) || (m === 8 && ![355, 385].includes(len)) || (m === 9 && [353, 383].includes(len))) return 29;
  return 30;
};
const hFixed = (y, m, d) => {
  const last = hLeap(y) ? 13 : 12;
  let days = hNewYear(y) + d - 1;
  if (m < 7) { for (let k = 7; k <= last; k += 1) days += hLastDay(k, y); for (let k = 1; k < m; k += 1) days += hLastDay(k, y); } else { for (let k = 7; k < m; k += 1) days += hLastDay(k, y); }
  return days;
};
export const HEBREW_MONTHS = Object.freeze(['Nisan', 'Iyyar', 'Sivan', 'Tammuz', 'Av', 'Elul', 'Tishri', 'Heshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Adar II']);
/** The Hebrew date of a civil day (the day whose daylight falls on it). Pure. */
export const hebrewOf = (jdn) => {
  const date = RD(jdn);
  let year = fdiv(date - HEBREW_EPOCH, 35975351 / 98496) - 1;
  while (hNewYear(year + 1) <= date) year += 1;
  let month = date < hFixed(year, 1, 1) ? 7 : 1;
  while (date > hFixed(year, month, hLastDay(month, year))) month += 1;
  const day = date - hFixed(year, month, 1) + 1;
  const leap = hLeap(year);
  return Object.freeze({ year, month, day, leap, name: month === 12 && leap ? 'Adar I' : HEBREW_MONTHS[month - 1], weekday: mod(jdn + 1, 7) + 1 }); // weekday 1 = the first day (Sunday)
};

// ── Hijri ─────────────────────────────────────────────────────────────────
const ISLAMIC_EPOCH = 227015; // RD, 16 Jul 622 Julian (the civil "Friday" epoch)
const iFixed = (y, m, d) => d + 29 * (m - 1) + fdiv(6 * m - 1, 11) + (y - 1) * 354 + fdiv(3 + 11 * y, 30) + ISLAMIC_EPOCH - 1;
/** The tabular (type II, Friday epoch) Hijri date. Pure. */
export const tabularHijriOf = (jdn) => {
  const date = RD(jdn);
  const year = fdiv(30 * (date - ISLAMIC_EPOCH) + 10646, 10631);
  const month = fdiv(11 * (date - iFixed(year, 1, 1)) + 330, 325);
  return Object.freeze({ year, month, day: date - iFixed(year, month, 1) + 1 });
};
export const HIJRI_MONTHS = Object.freeze(['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhira', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qada', 'Dhu al-Hijja']);
const MECCA = new Astronomy.Observer(21.4225, 39.8262, 277);
const MECCA_OFFSET = 3 * 3600000;
const SYNODIC = 29.530588853;
// a month's first day (as a JDN) by the Umm al-Qura rule: the day after the evening of the conjunction
// day at Mecca if the conjunction precedes sunset and the Moon sets after the Sun; else the day after that
const ummAlQuraStart = (conj) => {
  const dayStart = new Date(Math.floor((conj.getTime() + MECCA_OFFSET) / DAY) * DAY - MECCA_OFFSET);
  const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, MECCA, -1, dayStart, 1).date;
  const moonset = Astronomy.SearchRiseSet(Astronomy.Body.Moon, MECCA, -1, new Date(sunset.getTime() - 6 * 3600000), 1).date;
  const ok = conj < sunset && moonset > sunset;
  return Math.floor((dayStart.getTime() + MECCA_OFFSET) / DAY) + 2440588 + (ok ? 1 : 2);
};
// the anchor: the conjunction that opened Ramadan 1445 (1 Ramadan 1445 = 11 Mar 2024)
const ANCHOR_CONJ = Date.UTC(2024, 2, 10, 9, 0);
const ANCHOR_INDEX = 1445 * 12 + 8; // year × 12 + (month − 1)
/** The Umm al-Qura date of a civil day — computed by its post-1423 AH rule. Pure. */
export const ummAlQuraOf = (jdn) => {
  const noon = new Date((jdn - 2440588) * DAY + 12 * 3600000);
  let conj = Astronomy.SearchMoonPhase(0, new Date(noon.getTime() - 32 * DAY), 40).date;
  for (let next = Astronomy.SearchMoonPhase(0, new Date(conj.getTime() + DAY), 40).date; ummAlQuraStart(next) <= jdn; next = Astronomy.SearchMoonPhase(0, new Date(next.getTime() + DAY), 40).date) conj = next;
  const index = ANCHOR_INDEX + Math.round((conj.getTime() - ANCHOR_CONJ) / (SYNODIC * DAY));
  return Object.freeze({ year: fdiv(index, 12), month: mod(index, 12) + 1, day: jdn - ummAlQuraStart(conj) + 1 });
};

// ── Ethiopian and Coptic (R&D) ────────────────────────────────────────────
const COPTIC_EPOCH = 103605;
const ETHIOPIC_EPOCH = 2796;
const alexandrian = (jdn, epoch) => {
  const date = RD(jdn);
  const year = fdiv(4 * (date - epoch) + 1463, 1461);
  const start = (y, m) => epoch - 1 + 365 * (y - 1) + fdiv(y, 4) + 30 * (m - 1) + 1;
  const month = fdiv(date - start(year, 1), 30) + 1;
  return { year, month, day: date + 1 - start(year, month) };
};
export const ETHIOPIAN_MONTHS = Object.freeze(['Mäskäräm', 'Ṭəqəmt', 'Ḫədar', 'Taḫśaś', 'Ṭərr', 'Yäkatit', 'Mägabit', 'Miyazya', 'Gənbot', 'Säne', 'Ḥamle', 'Nähase', 'Ṗagume']);
export const COPTIC_MONTHS = Object.freeze(['Thout', 'Paopi', 'Hathor', 'Koiak', 'Tobi', 'Meshir', 'Paremhat', 'Parmouti', 'Pashons', 'Paoni', 'Epip', 'Mesori', 'Pi Kogi Enavot']);
/** The Ethiopian date, with the Coptic line. Pure. */
export const ethiopianOf = (jdn) => {
  const e = alexandrian(jdn, ETHIOPIC_EPOCH);
  const c = alexandrian(jdn, COPTIC_EPOCH);
  return Object.freeze({ ...e, name: ETHIOPIAN_MONTHS[e.month - 1], coptic: Object.freeze({ ...c, name: COPTIC_MONTHS[c.month - 1] }) });
};

// ── the wandering year (12 × 30 + 5, no leap) ─────────────────────────────
/** Year, month (13 = the five extra days) and day of a 365-day count from an epoch JDN. Pure. */
export const wanderingYear = (jdn, epoch) => {
  const n = jdn - epoch;
  const d = mod(n, 365);
  return Object.freeze({ year: fdiv(n, 365) + 1, month: d < 360 ? fdiv(d, 30) + 1 : 13, day: d < 360 ? mod(d, 30) + 1 : d - 359 });
};
const EGYPTIAN_EPOCH = 1448638; // 26 Feb 747 BCE, Ptolemy's Nabonassar era
export const EGYPTIAN_MONTHS = Object.freeze(['Thoth (I Akhet)', 'Phaophi (II Akhet)', 'Athyr (III Akhet)', 'Choiak (IV Akhet)', 'Tybi (I Peret)', 'Mechir (II Peret)', 'Phamenoth (III Peret)', 'Pharmuthi (IV Peret)', 'Pachon (I Shemu)', 'Payni (II Shemu)', 'Epiphi (III Shemu)', 'Mesore (IV Shemu)']);
const EPAGOMENAL_GODS = Object.freeze(['Osiris', 'Horus', 'Set', 'Isis', 'Nephthys']);
/** The Egyptian civil (wandering) year, proleptic from Ptolemy's era. Pure. */
export const egyptianOf = (jdn) => {
  const w = wanderingYear(jdn, EGYPTIAN_EPOCH);
  return Object.freeze({ ...w, name: w.month === 13 ? `epagomenal day — the birthday of ${EPAGOMENAL_GODS[w.day - 1]}` : EGYPTIAN_MONTHS[w.month - 1] });
};
const ZOROASTRIAN_MONTHS = Object.freeze(['Farvardin', 'Ardibehesht', 'Khordad', 'Tir', 'Amardad', 'Shahrevar', 'Meher', 'Avan', 'Adar', 'Dae', 'Bahman', 'Spendarmad']);
export const ROZ = Object.freeze([
  ['Hormazd', 'Ahura Mazda'], ['Bahman', 'Vohu Manah'], ['Ardibehesht', 'Asha Vahishta'], ['Shahrevar', 'Khshathra Vairya'], ['Spendarmad', 'Spenta Armaiti'],
  ['Khordad', 'Haurvatat'], ['Amardad', 'Ameretat'], ['Dae-pa-Adar', 'Dadvah, the Creator'], ['Adar', 'Atar'], ['Avan', 'Apo'],
  ['Khorshed', 'Hvar Khshaeta'], ['Mohor', 'Mah'], ['Tir', 'Tishtrya'], ['Gosh', 'Geush Urvan'], ['Dae-pa-Meher', 'Dadvah, the Creator'],
  ['Meher', 'Mithra'], ['Srosh', 'Sraosha'], ['Rashne', 'Rashnu'], ['Fravardin', 'the Fravashis'], ['Behram', 'Verethraghna'],
  ['Ram', 'Raman'], ['Govad', 'Vata'], ['Dae-pa-Din', 'Dadvah, the Creator'], ['Din', 'Daena'], ['Ashishvangh', 'Ashi'],
  ['Ashtad', 'Arshtat'], ['Asman', 'Asman'], ['Zamyad', 'Zam'], ['Mareshpand', 'Manthra Spenta'], ['Aneran', 'Anaghra Raocha'],
].map(([roz, yazata]) => Object.freeze({ roz, yazata })));
const GATHAS = Object.freeze(['Ahunavad', 'Ushtavad', 'Spentomad', 'Vohukhshathra', 'Vahishtoisht']);
const zDay = (w) => (w.month === 13 ? { gatha: w.day <= 5 ? GATHAS[w.day - 1] : 'Avardad-sal-gah' } : { month: ZOROASTRIAN_MONTHS[w.month - 1], ...ROZ[w.day - 1], jashan: ROZ[w.day - 1].roz === ZOROASTRIAN_MONTHS[w.month - 1] });
/** The Zoroastrian day — Shahanshahi first, Kadmi and Fasli beside it. Pure. */
export const zoroastrianOf = (jdn, gregorian) => {
  const shahanshahi = wanderingYear(jdn, 1952093);
  const kadmi = wanderingYear(jdn, 1952063);
  // Fasli: Navroz fixed on 21 March; Avardad-sal-gah closes a year ending in a Gregorian leap year
  const navroz = (y) => Date.UTC(y, 2, 21) / DAY + 2440588;
  const fy = jdn >= navroz(gregorian.year) ? gregorian.year : gregorian.year - 1;
  const fd = jdn - navroz(fy);
  const fasli = { year: fy - 630, month: fd < 360 ? fdiv(fd, 30) + 1 : 13, day: fd < 360 ? mod(fd, 30) + 1 : fd - 359 };
  return Object.freeze({
    shahanshahi: Object.freeze({ year: shahanshahi.year, ...zDay(shahanshahi) }),
    kadmi: Object.freeze({ year: kadmi.year, ...zDay(kadmi) }),
    fasli: Object.freeze({ year: fasli.year, ...zDay(fasli) }),
  });
};
// ── Africa ────────────────────────────────────────────────────────────────
const IGBO = Object.freeze(['Nkwọ', 'Eke', 'Orie', 'Afọ']); // JDN mod 4 = 0, 1, 2, 3
/** The Igbo market day (izu). Pure. */
export const igboOf = (jdn) => IGBO[mod(jdn, 4)];
const NNANSON = Object.freeze(['Fo', 'Nwuna', 'Nkyi', 'Kuru', 'Kwa', 'Mono']);
const SACRED = Object.freeze({ 0: 'Fɔdwo', 9: 'Awukudae', 18: 'Fofie', 27: 'Akwasidae' });
/** The Akan 42-day adaduanan: the six-day nnanson, the place in 42, a sacred day if it is one. Pure. */
export const adaduananOf = (jdn) => {
  const i = mod(jdn - 14, 42);
  return Object.freeze({ nnanson: NNANSON[mod(jdn - 2, 6)], day: i + 1, sacred: SACRED[i] ?? null });
};
