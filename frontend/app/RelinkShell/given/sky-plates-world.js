// sky-plates-world.js — the world's calendars and the longitude-read skies as
// their instruments (wave 3, docs/work/many-skies-complete.md): every month
// and day count drawn at its true length with this birth's place lit. Pure —
// every value from the record (or from the record's own instant by today's
// engine, sky-plates.js).

import { HEBREW_MONTHS, HIJRI_MONTHS, ETHIOPIAN_MONTHS, ROZ } from '../../../../core/cosmos/skies/world-days.js';
import { PERSIAN_MONTHS, SUMMER, WINTER } from '../../../../core/cosmos/skies/world-years.js';
import { GATES, TERMS, PHASES } from '../../../../core/cosmos/skies/world-sky.js';
import { SIGNS } from '../../../../core/cosmos/natal-chart.js';
import { degIn } from './sky-words.js';

const abbr = (s) => String(s).replace(/^[ʿʾ']/, '').slice(0, 3).toUpperCase();
const nums = (n) => Array.from({ length: n }, (_, i) => String(i + 1));
const at = (p) => (p ? `${p.sign} ${degIn(p.degree)}` : null);
const gl = (a) => (a ? `${a.gate}.${a.line}` : null);
const sabian = (n) => (Number.isInteger(n) ? `${SIGNS[Math.floor((n - 1) / 30)]} ${((n - 1) % 30) + 1}` : null);

const EGYPT_LABELS = Object.freeze(['THOT', 'PHAO', 'ATHY', 'CHOI', 'TYBI', 'MECH', 'PHAM', 'PHAR', 'PACH', 'PAYN', 'EPIP', 'MESO', 'EPAG']);
const FRENCH_LABELS = Object.freeze(['VEND', 'BRUM', 'FRIM', 'NIVÔ', 'PLUV', 'VENT', 'GERM', 'FLOR', 'PRAI', 'MESS', 'THER', 'FRUC', 'SANS']);
const PHASE_LABELS = Object.freeze(['NEW', 'CRES', 'FQ', 'GIBB', 'FULL', 'DISS', 'LQ', 'BALS']);
const ERAS = Object.freeze(['Meiji', 'Taishō', 'Shōwa', 'Heisei', 'Reiwa']);
const IGBO_DAYS = Object.freeze(['Eke', 'Orie', 'Afọ', 'Nkwọ']);
const DIRECTIONS = Object.freeze(['East', 'South', 'West', 'North']);
const WEEKDAY_HE = Object.freeze(['Yom Rishon', 'Yom Sheni', 'Yom Shlishi', 'Yom Revi’i', 'Yom Chamishi', 'Yom Shishi', 'Shabbat']);
const dated = (d, era) => `${d.day} ${d.name} ${d.year}${era ? ` ${era}` : ''}`;

/**
 * Add the wave-3 plates to a plate map. Pure.
 * @param {object} s the systems (record, completed)
 * @param {{put: Function, cell: Function, cells: Function}} k the plate-building kit (sky-plates.js)
 */
export const addWorldPlates = (s, { put, cell, cells }) => {
  const w = s.western;
  if (w?.phase) {
    put('western', { kind: 'cycle', count: 8, labels: PHASE_LABELS, lit: PHASES.indexOf(w.phase.name), big: w.phase.name.toUpperCase(), small: `${w.phase.elongation}° FROM THE SUN`, caption: '8 PHASES · THE MOON’S ANGLE FROM THE SUN IN EIGHTHS' }, cells(
      cell('LUNAR PHASE', w.phase.name, 'phase', `${w.phase.elongation}° AHEAD OF THE SUN`),
      cell('PRENATAL SYZYGY', w.syzygy ? `${w.syzygy.kind} · ${at(w.syzygy)}` : null, 'syzygy', w.syzygy ? w.syzygy.instant.slice(0, 10) : null),
      cell('NORTH NODE (MEAN)', at(w.meanNode), 'node'),
      cell('SOUTH NODE (MEAN)', at(w.southNode), 'node'),
      cell('BLACK MOON LILITH', at(w.lilith), 'lilith', 'THE MEAN APOGEE'),
      cell('SABIAN SUN', sabian(w.sabian?.sun), 'sabian', w.sabian?.sun ? `DEGREE ${w.sabian.sun} OF 360` : null),
      cell('SABIAN MOON', sabian(w.sabian?.moon), 'sabian', w.sabian?.moon ? `DEGREE ${w.sabian.moon} OF 360` : null),
    ), w);
  }
  const m8 = s.maya819;
  if (Number.isInteger(m8?.since)) {
    put('maya819', { kind: 'cycle', count: 4, labels: DIRECTIONS.map((d) => d.toUpperCase()), lit: DIRECTIONS.indexOf(m8.direction), big: `${m8.since + 1} / 819`, small: `${m8.colour.toUpperCase()} · ${m8.direction.toUpperCase()}`, caption: '819 DAYS · 7 × 9 × 13 · FOUR STATIONS, FOUR QUARTERS' }, cells(
      cell('DAY OF THE COUNT', `${m8.since + 1} / 819`, 'count', `${m8.since} DAYS AFTER THE STATION`),
      cell('STATION', m8.station, 'station', 'THE TZOLK’IN DAY IT FELL ON'),
      cell('QUARTER', `${m8.direction} · ${m8.colour}`, 'quarter'),
    ), m8);
  }
  const st = s.solarTerms;
  if (st?.hanzi) {
    const fromLichun = [...TERMS.slice(21), ...TERMS.slice(0, 21)];
    put('solarTerms', { kind: 'cycle', count: 24, labels: fromLichun.map((t) => t[0]), lit: fromLichun.findIndex((t) => t[0] === st.hanzi), big: st.hanzi, small: st.english.toUpperCase(), caption: '24 TERMS · 15° OF THE SUN EACH · FROM 立春 LÌCHŪN, THE START OF SPRING' }, cells(
      cell('SOLAR TERM', `${st.hanzi} ${st.english}`, 'term', `FROM ${st.degree}° OF THE SUN`),
      cell('PENTAD', `${st.pentad} / 72`, 'pentad', `${st.pentadInTerm} OF 3 IN THIS TERM`),
    ), st);
  }
  const ng = s.nengo;
  if (ng?.era) {
    put('nengo', { kind: 'cycle', count: 5, labels: ERAS.map((e) => e.toUpperCase()), lit: ERAS.indexOf(ng.era), big: `${ng.era.toUpperCase()} ${ng.year}`, small: 'YEAR OF THE ERA', caption: '5 ERAS SINCE 1868 · ONE TO A REIGN' }, cells(
      cell('ERA', `${ng.era} ${ng.year}`, 'era'),
    ), ng);
  }
  const h = s.hebrew;
  if (h?.month) {
    const labels = h.leap ? [...HEBREW_MONTHS.slice(0, 11).map(abbr), 'AD I', 'AD II'] : HEBREW_MONTHS.slice(0, 12).map(abbr);
    put('hebrew', { kind: 'cycle', count: labels.length, labels, lit: h.month - 1, big: `${h.day} ${h.name.toUpperCase()}`, small: `${h.year} AM`, caption: `${labels.length} MONTHS FROM NISAN · 7 LEAP YEARS IN 19` }, cells(
      cell('DATE', dated(h, 'AM'), 'date', 'THE DAY BEGINS AT NIGHTFALL — THE CIVIL DATE IS READ'),
      cell('YEAR', h.leap ? 'A leap year — 13 months' : 'A common year — 12 months', 'leap', `YEAR ${((h.year - 1) % 19) + 1} OF THE 19-YEAR CYCLE`),
      cell('DAY OF THE WEEK', WEEKDAY_HE[h.weekday - 1], 'weekday'),
    ), h);
  }
  const hj = s.hijri;
  if (hj?.month) {
    put('hijri', { kind: 'cycle', count: 12, labels: HIJRI_MONTHS.map(abbr), lit: hj.month - 1, big: `${hj.day} ${hj.name.toUpperCase()}`, small: `${hj.year} AH`, caption: '12 LUNAR MONTHS · 354 OR 355 DAYS' }, cells(
      cell('UMM AL-QURA', dated(hj, 'AH'), 'ummAlQura', 'THE SAUDI CIVIL CALENDAR'),
      cell('TABULAR', hj.tabular ? dated(hj.tabular, 'AH') : null, 'tabular', 'THE 30-YEAR ARITHMETIC CYCLE'),
    ), hj);
  }
  const mz = s.manazil;
  if (mz?.index) {
    put('manazil', { kind: 'cycle', count: 28, labels: nums(28), lit: mz.index - 1, big: mz.name, small: `MANSION ${mz.index} OF 28`, caption: '28 MANSIONS · 12°51′ EACH · FROM 0° ARIES' }, cells(
      cell('MANSION', `${mz.index} · ${mz.name}`, 'mansion'),
      cell('INTO IT', `${mz.into}° of 12.86°`, 'mansion', 'HOW FAR THE MOON HAD TRAVELLED THROUGH IT'),
    ), mz);
  }
  const pe = s.persian;
  if (pe?.month) {
    put('persian', { kind: 'cycle', count: 12, labels: PERSIAN_MONTHS.map(abbr), lit: pe.month - 1, big: `${pe.day} ${pe.name.toUpperCase()}`, small: `${pe.year} SH`, caption: '12 MONTHS · SIX OF 31, FIVE OF 30, ESFAND 29 OR 30' }, cells(
      cell('DATE', dated(pe, 'SH'), 'date', 'SOLAR HIJRI'),
    ), pe);
  }
  const z = s.zoroastrian;
  if (z?.shahanshahi) {
    const sh = z.shahanshahi;
    const zline = (d) => (d.gatha ? `${d.gatha} Gatha day · ${d.year} YZ` : `Roz ${d.roz} · Mah ${d.month} · ${d.year} YZ`);
    put('zoroastrian', { kind: 'cycle', count: 30, labels: nums(30), lit: sh.roz ? ROZ.findIndex((r) => r.roz === sh.roz) : -1, big: (sh.roz ?? sh.gatha).toUpperCase(), small: sh.month ? `MAH ${sh.month.toUpperCase()}` : 'THE GATHA DAYS', caption: '30 NAMED DAYS · 12 MONTHS · 5 GATHA DAYS' }, cells(
      cell('SHAHANSHAHI', zline(sh), 'reckoning'),
      cell('KADMI', zline(z.kadmi), 'reckoning'),
      cell('FASLI', zline(z.fasli), 'reckoning'),
      sh.yazata ? cell('YAZATA OF THE DAY', sh.yazata, 'yazata', sh.jashan ? 'A JASHAN — THE DAY AND THE MONTH SHARE A NAME' : null) : null,
    ), z);
  }
  const b = s.bahai;
  if (Number.isInteger(b?.month)) {
    const lit = b.month === 0 ? 18 : b.month === 19 ? 19 : b.month - 1;
    put('bahai', { kind: 'cycle', count: 20, labels: [...nums(18), 'AYY', '19'], lit, big: `${b.day} ${b.name.toUpperCase()}`, small: `${b.year} BE`, caption: '19 MONTHS OF 19 DAYS · AYYÁM-I-HÁ BEFORE THE LAST' }, cells(
      cell('DATE', dated(b, 'BE'), 'date', 'BADÍʿ'),
    ), b);
  }
  const ig = s.igbo;
  if (ig?.day) {
    put('igbo', { kind: 'cycle', count: 4, labels: IGBO_DAYS.map((d) => d.toUpperCase()), lit: IGBO_DAYS.indexOf(ig.day), big: ig.day.toUpperCase(), small: 'MARKET DAY', caption: '4 DAYS · THE IZU · 7 IZU MAKE A MARKET MONTH' }, cells(
      cell('MARKET DAY', ig.day, null),
    ), ig);
  }
  const et = s.ethiopian;
  if (et?.month) {
    put('ethiopian', { kind: 'cycle', count: 13, labels: ETHIOPIAN_MONTHS.map(abbr), lit: et.month - 1, big: `${et.day} ${et.name.toUpperCase()}`, small: `${et.year} EC`, caption: '12 MONTHS OF 30 + 5 OR 6 DAYS' }, cells(
      cell('ETHIOPIAN', dated(et, 'EC'), 'date'),
      et.coptic ? cell('COPTIC', `${et.coptic.day} ${et.coptic.name} ${et.coptic.year}`, 'coptic', 'THE SAME MONTH AND DAY · ERA OF THE MARTYRS') : null,
    ), et);
  }
  const eg = s.egyptian;
  if (eg?.month) {
    put('egyptian', { kind: 'cycle', count: 13, labels: EGYPT_LABELS, lit: eg.month - 1, big: eg.month === 13 ? `EPAGOMENAL ${eg.day}` : `${eg.day} ${eg.name.split(' ')[0].toUpperCase()}`, small: `NABONASSAR ${eg.year}`, caption: '365 DAYS · 3 SEASONS OF 4 MONTHS + 5' }, cells(
      cell('DATE', eg.month === 13 ? eg.name : `${eg.day} ${eg.name}`, 'date', `YEAR ${eg.year} OF NABONASSAR`),
    ), eg);
  }
  const fr = s.french;
  if (fr?.month) {
    put('french', { kind: 'cycle', count: 13, labels: FRENCH_LABELS, lit: fr.month - 1, big: fr.month === 13 ? fr.name.toUpperCase() : `${fr.day} ${fr.name.toUpperCase()}`, small: `YEAR ${fr.year}`, caption: '12 MONTHS OF 3 DÉCADES + THE SANSCULOTTIDES' }, cells(
      cell('DATE', fr.month === 13 ? fr.name : `${fr.day} ${fr.name} an ${fr.year}`, 'date'),
      fr.decade ? cell('DAY OF THE DÉCADE', fr.decade, 'decade') : null,
    ), fr);
  }
  const ic = s.icelandic;
  if (ic?.month) {
    const months = [...SUMMER, ...WINTER];
    put('icelandic', { kind: 'cycle', count: 12, labels: months.map(abbr), lit: months.indexOf(ic.month), big: ic.month.split(' ')[0].toUpperCase(), small: `DAY ${ic.day} · ${ic.season.toUpperCase()}`, caption: '2 SEASONS · 12 MONTHS OF 30 + THE EXTRA NIGHTS' }, cells(
      cell('MONTH', ic.month, 'month', `DAY ${ic.day}`),
      cell('SEASON', ic.season === 'summer' ? 'Summer (sumar)' : 'Winter (vetur)', 'season'),
    ), ic);
  }
  const hd = s.humanDesign;
  if (hd?.personality) {
    const p = hd.personality;
    const d = hd.design;
    put('humanDesign', { kind: 'cycle', count: 64, labels: GATES.map(String), lit: GATES.indexOf(p.sun.gate), big: gl(p.sun), small: `PROFILE ${hd.profile}`, caption: '64 GATES · 6 LINES EACH · FROM 2° AQUARIUS' }, cells(
      cell('SUN · AT BIRTH', gl(p.sun), 'personality'),
      cell('EARTH · AT BIRTH', gl(p.earth), 'personality'),
      cell('MOON · AT BIRTH', gl(p.moon), 'personality'),
      cell('NODES · AT BIRTH', `${gl(p.northNode)} · ${gl(p.southNode)}`, 'personality'),
      cell('SUN · DESIGN', gl(d.sun), 'design', hd.designInstant.slice(0, 10)),
      cell('EARTH · DESIGN', gl(d.earth), 'design'),
      cell('PROFILE', hd.profile, 'profile', 'THE TWO SUNS’ LINES'),
      cell('CROSS', hd.cross.join(' / '), 'cross', 'THE FOUR SUN AND EARTH GATES'),
    ), hd);
  }
};
