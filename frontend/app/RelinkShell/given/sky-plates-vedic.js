// sky-plates-vedic.js — the whole Vedic chart as its instruments (wave 1b,
// docs/work/many-skies-complete.md): the rashi chart (D1) and the navamsa
// (D9) in the South Indian square, the Vimshottari timeline, the Hindu
// calendar's month ring; and the Moon's nakshatra tables and the named
// tithi/yoga folded into the v1 Jyotisha and Panchanga plates. Pure.

import { MASAS } from '../../../../core/cosmos/skies/vedic-tables.js';
import { degIn } from './sky-words.js';

const RASHIS = Object.freeze(['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena']);
const MARK = Object.freeze({ sun: 'Su', moon: 'Mo', mars: 'Ma', mercury: 'Me', jupiter: 'Ju', venus: 'Ve', saturn: 'Sa', rahu: 'Ra', ketu: 'Ke' });
const fmtDate = (iso) => iso.slice(0, 10);

// the twelve signs, each with the grahas standing in it (by D1 or by D9)
const signsOf = (grahas, field) => RASHIS.map((r) => grahas.filter((g) => g[field] === r).map((g) => ({ key: g.key, mark: MARK[g.key], retro: g.retrograde && g.key !== 'rahu' && g.key !== 'ketu' })));

/**
 * Add the Vedic plates to a plate map; enrich the v1 Jyotisha and Panchanga cells. Pure.
 * @param {object} s the systems (record, completed)
 * @param {object} rec the skies record (its instant)
 * @param {{put: Function, cell: Function, cells: Function, out: Map}} k the plate-building kit
 */
export const addVedicPlates = (s, rec, { put, cell, cells, out }) => {
  const v = s.vedic;
  if (!v?.grahas) return;
  const moon = v.grahas.find((g) => g.key === 'moon');
  const janma = RASHIS.indexOf(moon.rashi);
  put('rasi', { kind: 'south-chart', signs: signsOf(v.grahas, 'rashi'), lit: janma, title: 'RASHI', small: 'D1 · SIDEREAL', caption: '12 SIGNS · 9 GRAHAS · THE MOON’S SIGN LIT' }, cells(
    ...v.grahas.map((g) => cell(`${g.name.toUpperCase()} · ${g.key.toUpperCase()}`, `${g.rashi} ${degIn(g.degree)}${g.retrograde && g.key !== 'rahu' && g.key !== 'ketu' ? ' ℞' : ''}`, 'graha', `${g.nakshatra.toUpperCase()} ${g.pada}`)),
    v.trueRahu ? cell('TRUE RAHU', `${v.trueRahu.rashi} · ${v.trueRahu.nakshatra}`, 'node', 'THE OSCULATING NODE — MEAN ABOVE') : null,
  ), v);
  const vargottama = v.grahas.filter((g) => g.vargottama).map((g) => g.name);
  put('navamsa', { kind: 'south-chart', signs: signsOf(v.grahas, 'navamsa'), lit: RASHIS.indexOf(moon.navamsa), title: 'NAVAMSA', small: 'D9 · EACH SIGN IN NINE', caption: '108 PADAS = 12 SIGNS × 9 · VARGOTTAMA WHERE D1 = D9' }, cells(
    ...v.grahas.map((g) => cell(g.name.toUpperCase(), g.navamsa, 'navamsa', g.vargottama ? 'VARGOTTAMA — THE SAME SIGN IN D1 AND D9' : `D1 ${g.rashi.toUpperCase()}`)),
    cell('VARGOTTAMA', vargottama.length ? vargottama.join(', ') : 'none', 'vargottama'),
  ), v);
  const d = v.dasha;
  if (d?.mahadashas?.length) {
    put('dasha', { kind: 'dasha', periods: d.mahadashas, birthMs: Date.parse(rec.instant), caption: `120 YEARS · 9 PERIODS · YEARS OF ${d.yearDays} DAYS` }, cells(
      ...d.mahadashas.map((m) => cell(`${m.lord.toUpperCase()} · ${m.years} YEARS`, `${fmtDate(m.start)} → ${fmtDate(m.end)}`, 'mahadasha')),
      d.atBirth ? cell('BHUKTI AT BIRTH', `${d.mahadashas[0].lord} / ${d.atBirth}`, 'bhukti', 'THE SUB-PERIOD IN FORCE') : null,
    ), v);
  }
  const c = v.calendar;
  if (c) {
    put('hinduCalendar', { kind: 'cycle', count: 12, labels: MASAS.map((m) => m.slice(0, 4).toUpperCase()), lit: MASAS.indexOf(c.masa.amanta), big: `${c.masa.adhika ? 'ADHIKA ' : ''}${c.masa.amanta.toUpperCase()}`, small: `VS ${c.years.vikram} · ${c.samvatsara.northern.toUpperCase()}`, caption: '12 LUNAR MONTHS · AN ADHIKA MONTH IN SOME YEARS' }, cells(
      cell('MASA (AMĀNTA)', `${c.masa.adhika ? 'Adhika ' : ''}${c.masa.amanta}`, 'masa', 'NEW MOON TO NEW MOON — THE SOUTH AND WEST'),
      cell('MASA (PŪRṆIMĀNTA)', `${c.masa.adhika ? 'Adhika ' : ''}${c.masa.purnimanta}`, 'masa', 'FULL MOON TO FULL MOON — THE NORTH'),
      cell('VIKRAM SAMVAT', c.years.vikram, 'year', `SAMVATSARA ${c.samvatsara.northern.toUpperCase()} (NORTH)`),
      cell('SHAKA', c.years.shaka, 'year', `SAMVATSARA ${c.samvatsara.southern.toUpperCase()} (SOUTH)`),
      cell('GUJARATI · KALI', `${c.years.gujarati} · ${c.years.kali}`, 'year'),
      cell('JOVIAN YEAR NOW', c.samvatsara.northernNow, 'samvatsara', 'THE BĀRHASPATYA YEAR AT THE INSTANT'),
      cell('RITU', c.ritu.vedic === c.ritu.drik ? c.ritu.vedic : `${c.ritu.vedic} · ${c.ritu.drik}`, 'ritu', c.ritu.vedic === c.ritu.drik ? 'BY MONTH AND BY THE SUN AGREE' : 'BY LUNAR MONTH · BY THE TROPICAL SUN'),
      cell('AYANA', c.ayana.tropical === c.ayana.sidereal ? c.ayana.tropical : `${c.ayana.tropical} · ${c.ayana.sidereal}`, 'ayana', c.ayana.tropical === c.ayana.sidereal ? 'TROPICAL AND SIDEREAL AGREE' : 'TROPICAL · SIDEREAL'),
    ), v);
  }
  // fold the nakshatra's tables into the v1 Jyotisha plate, the names into the Panchanga plate
  const jy = out.get('jyotisha');
  if (jy && v.moon) {
    const m = v.moon;
    out.set('jyotisha', Object.freeze({ ...jy, cells: Object.freeze([...jy.cells,
      cell('LORD', m.lord, 'lord', 'VIMSHOTTARI'), cell('DEITY', m.deity, 'deity'), cell('GANA', m.gana, 'gana'),
      cell('YONI', `${m.yoni} (${m.yoniGender})`, 'yoni'), cell('NADI', m.nadi, 'nadi'),
      cell('SYMBOL', m.symbol, 'symbol', m.alternates ? `ALSO: ${m.alternates.toUpperCase()}` : null),
      cell('NAME SYLLABLE', m.syllable, 'syllable', 'NĀMAKARAṆA — FROM ITS PADA'),
    ].filter(Boolean)) }));
  }
  const pa = out.get('panchanga');
  if (pa && v.panchanga) {
    out.set('panchanga', Object.freeze({ ...pa, cells: Object.freeze([...pa.cells,
      v.panchanga.tithi ? cell('TITHI NAME', v.panchanga.tithi, 'tithi') : null,
      v.panchanga.yoga ? cell('YOGA NAME', v.panchanga.yoga, 'yoga') : null,
    ].filter(Boolean)) }));
  }
};
