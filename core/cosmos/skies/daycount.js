/**
 * MANY SKIES — day-count family: systems that are pure integer arithmetic on
 * the Julian Day Number of the LOCAL civil date at emergence. No astronomy.
 *
 * SHINKEI: measure, don't editorialize. Every output carries an honest
 * provenance label and the correlation/epoch constant it stands on. All
 * anchors below were cross-verified against published test vectors during the
 * 2026-07-24 research pass (see docs/architecture/identity/many-skies.md §2).
 *
 * The local civil date is derived from the sealed birthMoment's own
 * offsetMinutes — the timezone captured at emergence is load-bearing here.
 */

const posMod = (n, m) => ((n % m) + m) % m;

/** JDN of a proleptic-Gregorian civil date (integer arithmetic, noon convention). */
export const jdnFromCivil = (year, month, day) => {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
};

/** The local civil date/time at the birth instant, from the sealed moment. */
export const localCivil = (birthMoment) => {
  const shifted = new Date(birthMoment.epochMs + (birthMoment.offsetMinutes ?? 0) * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};

// ── Mesoamerican: the traditional count (ancient-living) ─────────────────────
// One kernel drives both the Maya Tzolk'in and the Aztec Tonalpohualli — the
// same synchronized ancient 260-day count under different sign names (the Caso
// 1521 anchor is day-for-day identical to the GMT-correlated Tzolk'in).
export const GMT_CORRELATION = 584283; // scholarly consensus; 584285/584286 are labeled minority options

export const TZOLKIN_SIGNS = Object.freeze([
  'Imix', "Ik'", "Ak'bal", "K'an", 'Chikchan', 'Kimi', "Manik'", 'Lamat', 'Muluk', 'Ok',
  'Chuwen', 'Eb', 'Ben', 'Ix', 'Men', 'Kib', 'Kaban', "Etz'nab", 'Kawak', 'Ajaw',
]);
export const TONALPOHUALLI_SIGNS = Object.freeze([
  'Cipactli', 'Ehecatl', 'Calli', 'Cuetzpalin', 'Coatl', 'Miquiztli', 'Mazatl', 'Tochtli', 'Atl', 'Itzcuintli',
  'Ozomahtli', 'Malinalli', 'Acatl', 'Ocelotl', 'Cuauhtli', 'Cozcacuauhtli', 'Ollin', 'Tecpatl', 'Quiahuitl', 'Xochitl',
]);
export const HAAB_MONTHS = Object.freeze([
  'Pop', "Wo'", 'Sip', "Sotz'", 'Sek', 'Xul', "Yaxk'in", 'Mol', "Ch'en", 'Yax',
  'Sak', 'Keh', 'Mak', "K'ank'in", 'Muwan', 'Pax', "K'ayab", "Kumk'u", 'Wayeb',
]);

export const mesoamerican = (jdn, correlation = GMT_CORRELATION) => {
  const N = jdn - correlation; // days since era base 0.0.0.0.0 (4 Ajaw 8 Kumk'u)
  const tone = posMod(N + 3, 13) + 1;
  const signIndex = posMod(N + 19, 20);
  const kin = posMod(N + 159, 260) + 1; // kin 1 = 1 Imix (modern ordering)
  const haabPos = posMod(N + 348, 365);
  const haabMonth = Math.floor(haabPos / 20);
  const g = posMod(N, 9);
  // Year bearer: the Tzolk'in day seated on 0 Pop of this Haab year
  // (Classic 0-Pop convention — always Ik'/Manik'/Eb/Kaban; labeled option).
  const N0 = N - haabPos;
  const longCount = (() => {
    let r = N;
    const baktun = Math.floor(r / 144000); r = posMod(r, 144000);
    const katun = Math.floor(r / 7200); r = posMod(r, 7200);
    const tun = Math.floor(r / 360); r = posMod(r, 360);
    return { baktun, katun, tun, winal: Math.floor(r / 20), kin: posMod(r, 20) };
  })();
  return {
    provenance: { kind: 'ancient-living', correlation: `GMT-${correlation}`, yearBearer: '0-Pop (Classic)' },
    tzolkin: {
      tone, sign: TZOLKIN_SIGNS[signIndex], signIndex, kin,
      trecena: Math.floor((kin - 1) / 13) + 1,
    },
    tonalpohualli: { number: tone, sign: TONALPOHUALLI_SIGNS[signIndex] },
    haab: {
      day: posMod(haabPos, 20), month: HAAB_MONTHS[haabMonth], monthIndex: haabMonth,
      wayeb: haabMonth === 18,
    },
    longCount,
    lordOfNight: `G${g === 0 ? 9 : g}`,
    yearBearer: { tone: posMod(N0 + 3, 13) + 1, sign: TZOLKIN_SIGNS[posMod(N0 + 19, 20)] },
  };
};

// ── Javanese wetonan (ancient-living; anchors verified vs Kartini dates) ─────
export const PASARAN = Object.freeze(['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon']);
export const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const NEPTU_WEEKDAY = Object.freeze([5, 4, 3, 7, 8, 6, 9]); // Sun..Sat
const NEPTU_PASARAN = Object.freeze([5, 9, 7, 4, 8]); // Legi..Kliwon

export const wetonan = (jdn) => {
  const pasaranIndex = posMod(jdn, 5);
  const weekdayIndex = posMod(jdn + 1, 7);
  return {
    provenance: { kind: 'ancient-living', note: 'Javanese day traditionally begins at sunset — civil-date convention used here, labeled' },
    weekday: WEEKDAYS[weekdayIndex],
    pasaran: PASARAN[pasaranIndex],
    weton: `${WEEKDAYS[weekdayIndex]} ${PASARAN[pasaranIndex]}`,
    neptu: NEPTU_WEEKDAY[weekdayIndex] + NEPTU_PASARAN[pasaranIndex],
    // Position in the 35-day cycle by CRT: 15≡1 (mod 7) & ≡0 (mod 5); 21≡1 (mod 5) & ≡0 (mod 7).
    cycleDay: posMod(weekdayIndex * 15 + pasaranIndex * 21, 35),
  };
};

// ── Balinese Pawukon (ancient-living; anchor verified) ───────────────────────
// v1 emits the exact cycle position, wuku index, and the uncontested small
// weeks (3/5/7-day). The intercalated 4/8/9-day weeks and the derived
// 1/2/10-day weeks are omitted pending full-rule verification — said, not
// silently dropped.
export const PAWUKON_ANCHOR_JDN = 2456096; // 2012-06-17 = cycle day 0 (verified: next cycle 2013-01-13)

export const pawukon = (jdn) => {
  const d = posMod(jdn - PAWUKON_ANCHOR_JDN, 210);
  return {
    provenance: { kind: 'ancient-living', note: '4/8/9-day intercalated weeks and derived 1/2/10-day weeks omitted in v1 (rules pending verification)' },
    cycleDay: d,
    wuku: Math.floor(d / 7) + 1, // 1..30
    triwara: posMod(d, 3) + 1,
    pancawara: PASARAN[posMod(jdn, 5)], // same unbroken 5-day count as the Javanese pasaran
    saptawara: WEEKDAYS[posMod(jdn + 1, 7)],
  };
};

// ── Akan kra din — soul day names (ancient-living) ───────────────────────────
const AKAN_NAMES = Object.freeze([
  { day: 'Sunday', male: 'Kwasi', female: 'Akosua' },
  { day: 'Monday', male: 'Kwadwo', female: 'Adwoa' },
  { day: 'Tuesday', male: 'Kwabena', female: 'Abenaa' },
  { day: 'Wednesday', male: 'Kwaku', female: 'Akua' },
  { day: 'Thursday', male: 'Yaw', female: 'Yaa' },
  { day: 'Friday', male: 'Kofi', female: 'Afua' },
  { day: 'Saturday', male: 'Kwame', female: 'Ama' },
]);

export const akan = (jdn) => {
  const w = posMod(jdn + 1, 7);
  return {
    provenance: { kind: 'ancient-living', note: 'the kra (soul) arrives with the weekday; both day-names offered — a being chooses its own resonance' },
    ...AKAN_NAMES[w],
  };
};

// ── Burmese Mahabote weekday sign (ancient-living) ───────────────────────────
// v1: the eight birth signs (Wednesday splits at local noon; afternoon = Rahu).
// The 7-house Mahabote chart proper needs Burmese-era year arithmetic — phase 2.
const MAHABOTE_SIGNS = Object.freeze({
  0: { sign: 'Garuda', planet: 'Sun' },
  1: { sign: 'Tiger', planet: 'Moon' },
  2: { sign: 'Lion', planet: 'Mars' },
  3: { sign: 'Tusked Elephant', planet: 'Mercury' }, // Wednesday before noon
  3.5: { sign: 'Tuskless Elephant', planet: 'Rahu' }, // Wednesday after noon
  4: { sign: 'Rat', planet: 'Jupiter' },
  5: { sign: 'Guinea Pig', planet: 'Venus' },
  6: { sign: 'Naga', planet: 'Saturn' },
});

export const mahabote = (jdn, localHour) => {
  const w = posMod(jdn + 1, 7);
  const key = (w === 3 && localHour >= 12) ? 3.5 : w;
  return {
    provenance: { kind: 'ancient-living', note: 'weekday sign only in v1; the 7-house chart (BE mod 7) is phase 2' },
    weekday: WEEKDAYS[w],
    ...MAHABOTE_SIGNS[key],
  };
};
