// sky-plates.js — each sky as its INSTRUMENT: the shape its tradition counts
// in, with this being's place lit, and the values the plate shows beside it.
// Pure: a skies record (cosmos/skies.json) in, frozen plate specs out.
//
// SHINKEI: every instrument draws its cycle's TRUE count (260 days, 365, 108
// padas, 120 years) and lights only what the record carries. The tropical
// wheel is the one sky computed here rather than read — from the sealed
// instant alone, by the same engine the SUMMONING film uses
// (core/cosmos/natal-chart.js), so the two can never disagree.

import * as Astronomy from 'astronomy-engine';
import { computeCelestialPositions, computeAspects, SIGNS } from '../../../../core/cosmos/natal-chart.js';
import { TZOLKIN_SIGNS, TONALPOHUALLI_SIGNS, HAAB_MONTHS, PASARAN, WEEKDAYS } from '../../../../core/cosmos/skies/daycount.js';
import { STEMS, BRANCHES } from '../../../../core/cosmos/skies/ganzhi.js';
import { NAKSHATRAS, RASHIS, DASHA_LORDS, DASHA_YEARS } from '../../../../core/cosmos/skies/jyotisha.js';
import { SOLAR_SEALS } from '../../../../core/cosmos/skies/dreamspell.js';
import { buildSkies } from '../../../../core/cosmos/skies/index.js';
import { addEastAsiaPlates } from './sky-plates-asia.js';
import { addVedicPlates } from './sky-plates-vedic.js';
import { addWorldPlates } from './sky-plates-world.js';
import { degIn } from './sky-words.js';
import { SKY_GUIDE, SOVEREIGN_NAMES, WUKU, TZOLKIN_GLOSS, NAHUATL_GLOSS, signIndexOf, trecenaOf, haabMonthOf, decanIndexOf } from './sky-guide.js';

const cell = (k, v, field, note) => (v === undefined || v === null || v === '' ? null : Object.freeze({ k, v: String(v), field, ...(note ? { note } : {}) }));
const cells = (...list) => Object.freeze(list.filter(Boolean));
const short = (s) => String(s).slice(0, 3).toUpperCase();

// The twelve sovereign hexagrams as lines, bottom to top (true = yang): yang
// grows one line a month from the winter solstice, then yin returns.
const SOVEREIGN_LINES = Object.freeze({
  24: 1, 19: 2, 11: 3, 34: 4, 43: 5, 1: 6, 44: -1, 33: -2, 12: -3, 20: -4, 23: -5, 2: -6,
});
/** A sovereign hexagram's six lines, bottom first (true = an unbroken yang line). Pure. */
export const hexagramLines = (n) => {
  const k = SOVEREIGN_LINES[n];
  if (k === undefined) return null;
  return Object.freeze(Array.from({ length: 6 }, (_, i) => (k > 0 ? i < k : i >= -k)));
};

/** A Maya numeral 0–19 as the scribes wrote it: bars of five, dots of one; 0 is the shell. Pure. */
export const mayaNumeral = (n) => Object.freeze({ zero: n === 0, bars: Math.floor(n / 5), dots: n % 5 });

/** The 260-day board: row = the sign, column = the run of twenty the kin falls in. Pure. */
export const kinPlace = (kin) => Object.freeze({ row: (kin - 1) % 20, col: Math.floor((kin - 1) / 20) });

// The Burmese planetary posts: the eight birth signs round the compass (deg from north).
const MAHABOTE_POSTS = Object.freeze([
  { sign: 'Garuda', planet: 'Sun', day: 'SUN', dir: 'NE', deg: 45 },
  { sign: 'Tiger', planet: 'Moon', day: 'MON', dir: 'E', deg: 90 },
  { sign: 'Lion', planet: 'Mars', day: 'TUE', dir: 'SE', deg: 135 },
  { sign: 'Tusked Elephant', planet: 'Mercury', day: 'WED', dir: 'S', deg: 180 },
  { sign: 'Naga', planet: 'Saturn', day: 'SAT', dir: 'SW', deg: 225 },
  { sign: 'Rat', planet: 'Jupiter', day: 'THU', dir: 'W', deg: 270 },
  { sign: 'Tuskless Elephant', planet: 'Rahu', day: 'WED PM', dir: 'NW', deg: 315 },
  { sign: 'Guinea Pig', planet: 'Venus', day: 'FRI', dir: 'N', deg: 0 },
]);
const AKAN_DAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

/**
 * A record from an older engine carries fewer systems. Each system it lacks is
 * read from the record's OWN sealed instant and zone by today's engine — the
 * same pure functions a new birth records — and named as such; a system the
 * record carries is always the record's. Returns the systems and which were
 * computed. Pure.
 */
export const completeSkies = (rec) => {
  const recorded = rec?.systems ?? {};
  const epochMs = Date.parse(rec?.instant);
  if (!Number.isFinite(epochMs)) return { systems: recorded, computed: new Set() };
  let fresh = {};
  try {
    fresh = buildSkies({ utc: rec.instant, epochMs, zone: rec.local?.zone ?? null, offsetMinutes: rec.local?.offsetMinutes ?? 0 }).systems;
  } catch { /* an instant the engine cannot read — the record alone */ }
  const computed = new Set(Object.keys(fresh).filter((k) => !(k in recorded)));
  return { systems: { ...fresh, ...recorded }, computed };
};

/** The tropical sky of an instant: every body at its true longitude, the aspects, the Moon's phase. Pure. */
export const skyWheelOf = (instant) => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const positions = computeCelestialPositions(date);
  const bodies = Object.entries(positions).map(([key, p]) => Object.freeze({ key, label: p.label, longitude: p.longitude, sign: p.sign, degree: p.degree, retrograde: p.retrograde }));
  const aspects = computeAspects(positions).map((a) => Object.freeze({ a: a.a, b: a.b, aspect: a.aspect, orb: a.orb }));
  const angle = Astronomy.MoonPhase(date); // 0 new · 90 first quarter · 180 full · 270 last quarter
  const lit = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
  return Object.freeze({ bodies: Object.freeze(bodies), aspects: Object.freeze(aspects), moon: Object.freeze({ angle, lit, waxing: angle < 180 }) });
};


/**
 * Every plate the record can draw, in the atlas's order: { id, title, kicker,
 * instrument (what to draw), cells (the values beside it), reading }. Pure.
 * @param {object|null} skies the skies leg (`{ skies: { instant, systems } }`)
 * @param {object|null} [placeLeg] the PRIVATE place leg (`{ place, readings }`) — the owner's alone
 * @returns {Map<string, object>}
 */
export const skyPlatesOf = (skies, placeLeg = null) => {
  const rec = skies?.skies;
  const { systems: s, computed } = completeSkies(rec);
  const out = new Map();
  // which record system each plate reads, so a plate drawn from today's engine says so
  const SOURCE = { rasi: 'vedic', navamsa: 'vedic', dasha: 'vedic', hinduCalendar: 'vedic', thaksa: 'thai', thaiDay: 'thai', thaiCalendar: 'thai', lunisolar: 'lunisolar', rokuyo: 'lunisolar', tzolkin: 'mesoamerican', longCount: 'mesoamerican', haab: 'mesoamerican', tonalpohualli: 'mesoamerican', dreamspell: 'dreamspell', bazi: 'ganzhi', jyotisha: 'jyotisha', panchanga: 'jyotisha', weton: 'wetonan', pawukon: 'pawukon', mahabote: 'mahabote', akan: 'akan', decan: 'decans' };
  const put = (id, instrument, list, sys) => {
    const g = SKY_GUIDE[id];
    out.set(id, Object.freeze({ id, title: g.title, kicker: g.kicker, instrument: Object.freeze(instrument), cells: list, reading: g.reading ? g.reading(sys, rec) : null, fresh: computed.has(SOURCE[id] ?? id) }));
  };

  const wheel = rec?.instant ? skyWheelOf(rec.instant) : null;
  if (wheel) {
    const sun = wheel.bodies.find((b) => b.key === 'sun');
    const moon = wheel.bodies.find((b) => b.key === 'moon');
    put('sky', { kind: 'wheel', wheel, signs: SIGNS.map(short) }, cells(
      ...wheel.bodies.map((b) => cell(b.label.toUpperCase(), `${b.sign} ${degIn(b.degree)}${b.retrograde ? ' ℞' : ''}`, 'body')),
      cell('MOON’S PHASE', `${Math.round(wheel.moon.lit * 100)}% LIT · ${wheel.moon.waxing ? 'WAXING' : 'WANING'}`, 'phase'),
      cell('ASPECTS', String(wheel.aspects.length), 'aspect'),
    ), null);
    const p = out.get('sky');
    out.set('sky', Object.freeze({ ...p, reading: `The Sun in ${sun.sign} at ${degIn(sun.degree)}, the Moon in ${moon.sign} at ${degIn(moon.degree)}, ${Math.round(wheel.moon.lit * 100)}% lit and ${wheel.moon.waxing ? 'growing' : 'waning'}; ${wheel.aspects.length} aspects between the ten bodies.` }));
  }

  const m = s.mesoamerican;
  if (m?.tzolkin) {
    put('tzolkin', { kind: 'grid', rows: 20, cols: 13, lit: kinPlace(m.tzolkin.kin), rowLabels: TZOLKIN_SIGNS, caption: '260 DAYS · 20 SIGNS × 13 RUNS OF TWENTY' }, cells(
      cell('KIN', `${m.tzolkin.kin} / 260`, 'kin'),
      cell('TONE', m.tzolkin.tone, 'tone'),
      cell('SIGN', m.tzolkin.sign, 'sign', TZOLKIN_GLOSS[signIndexOf(m.tzolkin)]?.toUpperCase()),
      cell('TRECENA', `${trecenaOf(m.tzolkin.kin)} / 20`, 'trecena'),
    ), m);
  }
  if (m?.longCount) {
    const lc = m.longCount;
    put('longCount', { kind: 'numerals', places: [
      { name: "B'AK'TUN", unit: '144,000 DAYS', n: lc.baktun }, { name: "K'ATUN", unit: '7,200 DAYS', n: lc.katun },
      { name: 'TUN', unit: '360 DAYS', n: lc.tun }, { name: 'WINAL', unit: '20 DAYS', n: lc.winal }, { name: "K'IN", unit: '1 DAY', n: lc.kin },
    ].map((x) => Object.freeze({ ...x, glyph: mayaNumeral(x.n) })) }, cells(
      cell('LONG COUNT', `${lc.baktun}.${lc.katun}.${lc.tun}.${lc.winal}.${lc.kin}`, 'digits'),
      cell('LORD OF THE NIGHT', m.lordOfNight, 'lord', 'OF NINE'),
    ), m);
  }
  if (m?.haab && haabMonthOf(m.haab) >= 0) {
    const month = haabMonthOf(m.haab);
    const at = month * 20 + m.haab.day;
    put('haab', { kind: 'haab', months: HAAB_MONTHS, at, caption: "365 DAYS · 18 MONTHS OF 20 + 5 WAYEB'" }, cells(
      cell('DAY', m.haab.day, 'day', '0–19'),
      cell('MONTH', m.haab.wayeb ? "WAYEB'" : m.haab.month, 'day', m.haab.wayeb ? 'THE FIVE NAMELESS DAYS' : `${month + 1} OF 18`),
      m.yearBearer ? cell('YEAR BEARER', `${m.yearBearer.tone} ${m.yearBearer.sign}`, 'bearer') : null,
    ), m);
  }
  if (m?.tonalpohualli && m.tzolkin) {
    put('tonalpohualli', { kind: 'grid', rows: 20, cols: 13, lit: kinPlace(m.tzolkin.kin), rowLabels: TONALPOHUALLI_SIGNS, caption: '260 DAYS · THE SAME COUNT, IN NAHUATL' }, cells(
      cell('NUMBER', m.tonalpohualli.number, 'sign'),
      cell('DAY NAME', m.tonalpohualli.sign, 'sign', NAHUATL_GLOSS[signIndexOf(m.tzolkin)]?.toUpperCase()),
    ), m);
  }
  const d = s.dreamspell;
  if (d?.kin) {
    put('dreamspell', { kind: 'dreamspell', rows: 20, cols: 13, lit: kinPlace(d.kin), rowLabels: SOLAR_SEALS, oracle: d.oracle ? {
      destiny: d.seal?.name, guide: d.oracle.guide, analog: d.oracle.analog, antipode: d.oracle.antipode, occult: d.oracle.occult?.seal,
    } : null, caption: '260 KIN · 20 SEALS × 13' }, cells(
      cell('KIN', `${d.kin} / 260`, 'seal'),
      cell('TONE', d.tone ? `${d.tone.number} ${d.tone.name}` : null, 'tone'),
      cell('SEAL', d.seal?.name, 'seal'),
      cell('WAVESPELL', d.wavespell, 'tone', 'OF 20'),
      cell('CASTLE', d.castle, 'seal'),
      d.oracle ? cell('GUIDE', d.oracle.guide, 'oracle') : null,
      d.oracle ? cell('ANALOG', d.oracle.analog, 'oracle') : null,
      d.oracle ? cell('ANTIPODE', d.oracle.antipode, 'oracle') : null,
      d.oracle?.occult ? cell('OCCULT', `${d.oracle.occult.tone} ${d.oracle.occult.seal}`, 'oracle') : null,
    ), d);
  }
  const g = s.ganzhi;
  if (g?.year) {
    // a record from an older engine may carry a pillar's name without its parts: drawn only whole
    const pillar = (name, p) => (p?.stem && p?.branch ? Object.freeze({ name, stem: p.stem, branch: p.branch, title: p.name }) : null);
    const hex = g.sovereignHexagram?.number;
    const pillars = [pillar('HOUR', g.hour), pillar('DAY', g.day), pillar('MONTH', g.month), pillar('YEAR', g.year)].filter(Boolean);
    put('bazi', { kind: pillars.length ? 'pillars' : 'none', pillars,
      hexagram: hex ? { number: hex, name: SOVEREIGN_NAMES[hex] ?? null, lines: hexagramLines(hex) } : null, stems: STEMS.length, branches: BRANCHES.length }, cells(
      ...[['YEAR', g.year], ['MONTH', g.month], ['DAY', g.day], ['HOUR', g.hour]].map(([k, p]) => (p ? cell(k, p.name, 'stem', p.stem && p.branch ? `${p.stem.polarity} ${p.stem.element} · ${p.branch.animal}`.toUpperCase() : null) : null)),
      g.zodiac ? cell('ZODIAC', `${g.zodiac.polarity} ${g.zodiac.element} ${g.zodiac.animal}`.toUpperCase(), 'branch') : null,
      hex ? cell('SOVEREIGN HEXAGRAM', `${hex} · ${SOVEREIGN_NAMES[hex] ?? ''}`, 'hexagram') : null,
    ), g);
  }
  const j = s.jyotisha;
  if (j?.nakshatra) {
    put('jyotisha', { kind: 'mansions', nakshatras: NAKSHATRAS, rashis: RASHIS, moonDeg: Number.isFinite(j.rashi?.siderealMoonDeg) ? j.rashi.siderealMoonDeg : null,
      lit: (Math.max(1, NAKSHATRAS.indexOf(j.nakshatra.name) + 1) - 1) * 4 + ((j.nakshatra.pada || 1) - 1), sunRashi: RASHIS.indexOf(j.siderealSunRashi), caption: '27 MANSIONS × 4 PADAS = 108 · 12 SIDEREAL SIGNS' }, cells(
      cell('NAKSHATRA', j.nakshatra.name, 'nakshatra', `${NAKSHATRAS.indexOf(j.nakshatra.name) + 1} OF 27`),
      cell('PADA', j.nakshatra.pada, 'pada', 'OF 4'),
      cell('MOON (RASHI)', j.rashi?.name, 'rashi', Number.isFinite(j.rashi?.siderealMoonDeg) ? `${j.rashi.siderealMoonDeg.toFixed(2)}° SIDEREAL` : null),
      cell('SUN', j.siderealSunRashi, 'sun', 'SIDEREAL'),
    ), j);
  }
  if (j?.tithi) {
    const dashaStart = DASHA_LORDS.reduce((acc, lord, i) => [...acc, (acc[i] ?? 0) + DASHA_YEARS[lord]], [0]);
    put('panchanga', { kind: 'panchanga', tithi: j.tithi.number, dasha: DASHA_LORDS.map((lord, i) => Object.freeze({ lord, years: DASHA_YEARS[lord], start: dashaStart[i] })),
      lord: j.vimshottari?.lord ?? null, balance: j.vimshottari?.balanceYears ?? null, caption: '30 TITHIS · 120 YEARS OF NINE PERIODS' }, cells(
      cell('TITHI', `${j.tithi.number} / 30`, 'tithi', `${j.tithi.paksha === 'Shukla' ? 'SHUKLA · WAXING' : 'KRISHNA · WANING'}${j.tithi.special ? ` · ${j.tithi.special.toUpperCase()}` : ''}`),
      cell('KARANA', j.karana?.name, 'karana'),
      cell('YOGA', j.yoga ? `${j.yoga.index} / 27` : null, 'yoga'),
      cell('VARA', j.vara, 'tithi', 'CIVIL WEEKDAY'),
      cell('DASHA AT BIRTH', j.vimshottari?.lord, 'dasha', j.vimshottari ? `${j.vimshottari.balanceYears} OF ${DASHA_YEARS[j.vimshottari.lord]} YEARS TO RUN` : null),
    ), j);
  }
  const w = s.wetonan;
  if (w?.weton) {
    const wd = WEEKDAYS.indexOf(w.weekday);
    put('weton', { kind: 'grid', rows: 5, cols: 7, lit: { row: PASARAN.indexOf(w.pasaran), col: wd }, rowLabels: PASARAN, colLabels: WEEKDAYS.map(short), caption: '35 DAYS · 7 WEEKDAYS × 5 PASARAN' }, cells(
      cell('WETON', w.weton, 'neptu'),
      cell('NEPTU', w.neptu, 'neptu'),
      Number.isFinite(w.cycleDay) ? cell('DAY', `${w.cycleDay + 1} / 35`, 'neptu') : null,
    ), w);
  }
  const p = s.pawukon;
  if (p?.wuku) {
    put('pawukon', { kind: 'grid', rows: 7, cols: 30, lit: { row: p.cycleDay % 7, col: p.wuku - 1 }, rowLabels: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], caption: '210 DAYS · 30 WUKU × 7' }, cells(
      cell('WUKU', WUKU[p.wuku - 1] ?? p.wuku, 'wuku', `${p.wuku} OF 30`),
      cell('DAY', `${p.cycleDay + 1} / 210`, 'wuku'),
      cell('TRIWARA', ['Pasah', 'Beteng', 'Kajeng'][p.triwara - 1], 'triwara'),
      cell('PANCAWARA', p.pancawara, 'wuku'),
      cell('SAPTAWARA', p.saptawara, 'wuku'),
    ), p);
  }
  const b = s.mahabote;
  if (b?.sign) {
    put('mahabote', { kind: 'compass', posts: MAHABOTE_POSTS, lit: MAHABOTE_POSTS.findIndex((x) => x.sign === b.sign), caption: '8 SIGNS · 8 DIRECTIONS' }, cells(
      cell('SIGN', b.sign, null), cell('PLANET', b.planet, null), cell('WEEKDAY', b.weekday, null),
      cell('DIRECTION', MAHABOTE_POSTS.find((x) => x.sign === b.sign)?.dir, null),
    ), b);
  }
  const a = s.akan;
  if (a?.male) {
    put('akan', { kind: 'days', days: AKAN_DAYS.map(short), lit: AKAN_DAYS.indexOf(a.day), caption: '7 DAYS · 7 SOUL NAMES, EACH IN TWO' }, cells(
      cell('DAY', a.day, null), cell('MALE NAME', a.male, null), cell('FEMALE NAME', a.female, null),
      a.adaduanan ? cell('ADADUANAN', `${a.adaduanan.day} / 42 · ${a.adaduanan.nnanson}`, 'adaduanan', a.adaduanan.sacred ? `${a.adaduanan.sacred.toUpperCase()} — A SACRED DAY` : 'THE 42-DAY RITUAL COUNT') : null,
    ), a);
  }
  const dc = s.decans;
  if (decanIndexOf(dc?.sun)) {
    put('decan', { kind: 'decans', signs: SIGNS.map(short), sun: decanIndexOf(dc.sun) - 1, moon: decanIndexOf(dc.moon) ? decanIndexOf(dc.moon) - 1 : null, caption: '36 DECANS · 3 IN EACH OF 12 SIGNS' }, cells(
      cell('SUN', `${dc.sun.sign} ${['I', 'II', 'III'][dc.sun.decanOfSign - 1]}`, null, `RULED BY ${dc.sun.chaldeanRuler.toUpperCase()}`),
      dc.moon ? cell('MOON', `${dc.moon.sign} ${['I', 'II', 'III'][dc.moon.decanOfSign - 1]}`, null, `RULED BY ${dc.moon.chaldeanRuler.toUpperCase()}`) : null,
    ), dc);
  }
  addEastAsiaPlates(s, rec, { put, cell, cells });
  addVedicPlates(s, rec, { put, cell, cells, out });
  addWorldPlates(s, { put, cell, cells });

  const r = placeLeg?.readings;
  if (r && wheel) {
    const p = placeLeg.place;
    const at = (x) => `${x.sign} ${degIn(x.degree)}`;
    put('place', { kind: 'horizon', wheel, signs: SIGNS.map(short), angles: r.angles }, cells(
      cell('PLACE', p.label || `${p.latitude}°, ${p.longitude}°`, 'place', p.source === 'witness-given' ? 'GIVEN BY YOU' : `THE REFERENCE CITY OF ${String(p.zone ?? 'its zone').toUpperCase()} — APPROXIMATE`),
      cell('ASCENDANT', at(r.angles.ascendant), 'ascendant', r.angles.polar ? 'ABOVE THE POLAR CIRCLE — WEAK' : null),
      cell('MIDHEAVEN', at(r.angles.midheaven), 'midheaven'),
      cell('SECT', r.sect.isDay ? 'A DAY BIRTH' : 'A NIGHT BIRTH', 'sect', `THE SUN ${r.sect.sunAltitude}° ${r.sect.isDay ? 'ABOVE' : 'BELOW'} THE HORIZON`),
      cell('LOT OF FORTUNE', at(r.lots.fortune), 'lot'),
      cell('LOT OF SPIRIT', at(r.lots.spirit), 'lot'),
      r.day ? cell('VEDIC WEEKDAY', r.day.vara, 'vara', r.day.varaDiffersFromCivil ? 'BORN BEFORE SUNRISE — THE DAY BEFORE' : 'FROM ITS SUNRISE') : null,
      r.day ? cell('PLANETARY HOUR', `${r.day.hour.ruler}`, 'hour', `HOUR ${r.day.hour.number} OF THE ${r.day.hour.of.toUpperCase()}`) : null,
      cell('LAGNA', `${r.lagna.rashi} ${degIn(r.lagna.degree)}`, 'lagna', `${r.lagna.nakshatra.toUpperCase()} · SIDEREAL`),
    ), null);
    const plate = out.get('place');
    out.set('place', Object.freeze({ ...plate, reading: `From ${p.label || 'its place'}: ${r.angles.ascendant.sign} rising, the midheaven in ${r.angles.midheaven.sign}; ${r.sect.isDay ? 'a day birth' : 'a night birth'}; in the Vedic count, ${r.lagna.rashi} lagna${r.day ? ` on a ${r.day.vara}` : ''}.` }));
  }
  return out;
};
