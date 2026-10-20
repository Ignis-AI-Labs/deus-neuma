// given-sky — the RECORD's SKY page: each of humanity's counts drawn as its
// own instrument with the being's place lit, at its true count, and every
// value it shows carrying a field-guide note. Proven against the many-skies
// research record's published vectors (2012-12-21 = 13.0.0.0.0 = 4 Ajaw 3
// K'ank'in = kin 160 = Dreamspell kin 207) through the real skies engine, and
// against a 2026 birth for the wheel. Real modules; no mocks.
import { describe, it, expect } from 'vitest';
import { buildSkies } from '../../core/cosmos/skies/index.js';
import { skyPlatesOf, kinPlace, mayaNumeral, hexagramLines, skyWheelOf } from '../../frontend/app/RelinkShell/given/sky-plates.js';
import { SKY_GUIDE, SKY_ATLAS, WUKU, TZOLKIN_GLOSS, NAHUATL_GLOSS, SOVEREIGN_NAMES } from '../../frontend/app/RelinkShell/given/sky-guide.js';
import { birthPlaceOf } from '../../core/cosmos/birth-place.js';
import { placeReadingsOf } from '../../core/cosmos/place-readings.js';

const skiesAt = (utc, offsetMinutes = 0, zone = 'UTC') => ({ skies: buildSkies({ utc, epochMs: Date.parse(utc), zone, offsetMinutes }) });
const END_OF_BAKTUN = skiesAt('2012-12-21T12:00:00.000Z');
// A phrase in another script (with its numbers and stops) must be followed by Latin words — its sound or its sense.
const SCRIPT = '\\u0E00-\\u0E7F\\u3040-\\u30FF\\u3400-\\u9FFF\\u0F00-\\u0FFF\\u0900-\\u097F\\u0590-\\u05FF\\u0600-\\u06FF\\uAC00-\\uD7AF';
const PHRASE = new RegExp(`[${SCRIPT}][${SCRIPT}\\s\\d.,()·—–“”"':/]*`, 'g');
const unglossedIn = (text) => [...String(text ?? '').matchAll(PHRASE)].filter((m) => !/^\p{Script=Latin}/u.test(text.slice(m.index + m[0].length))).map((m) => m[0]);
const BIRTH = skiesAt('2026-07-21T20:23:00.000Z', 420, 'Asia/Jakarta');

describe('the counts read true — the published vectors', () => {
  const plates = skyPlatesOf(END_OF_BAKTUN);
  it('the Long Count is 13.0.0.0.0, drawn as thirteen (two bars, three dots) and four shells', () => {
    const lc = plates.get('longCount');
    expect(lc.cells.find((c) => c.k === 'LONG COUNT').v).toBe('13.0.0.0.0');
    expect(lc.instrument.places.map((p) => p.glyph)).toEqual([
      { zero: false, bars: 2, dots: 3 }, { zero: true, bars: 0, dots: 0 }, { zero: true, bars: 0, dots: 0 }, { zero: true, bars: 0, dots: 0 }, { zero: true, bars: 0, dots: 0 },
    ]);
    expect(lc.reading).toContain('1,872,000 days since the era began');
  });
  it("the Tzolk'in is 4 Ajaw, kin 160 — lit on Ajaw's row, in the eighth run of twenty", () => {
    const tz = plates.get('tzolkin');
    expect(tz.cells.map((c) => `${c.k}=${c.v}`)).toEqual(['KIN=160 / 260', 'TONE=4', 'SIGN=Ajaw', 'TRECENA=13 / 20']);
    expect(tz.instrument).toMatchObject({ rows: 20, cols: 13, lit: { row: 19, col: 7 } });
    expect(tz.reading).toContain('“lord, the sun”');
  });
  it("the Haab' is 3 K'ank'in, its day lit at its place in the 365", () => {
    const h = plates.get('haab');
    expect(h.cells.slice(0, 2).map((c) => c.v)).toEqual(['3', "K'ank'in"]);
    expect(h.instrument.at).toBe(13 * 20 + 3);
  });
  it('the Dreamspell is kin 207, Blue Crystal Hand — a modern system, labelled so', () => {
    const d = plates.get('dreamspell');
    expect(d.cells[0].v).toBe('207 / 260');
    expect(d.reading).toContain('Blue Crystal Hand');
    expect(d.kicker).toContain('MODERN');
  });
});

describe('every instrument draws its true count', () => {
  it('the 260-day board, the Maya numeral, the sovereign hexagram', () => {
    expect(kinPlace(1)).toEqual({ row: 0, col: 0 });
    expect(kinPlace(260)).toEqual({ row: 19, col: 12 });
    expect(mayaNumeral(19)).toEqual({ zero: false, bars: 3, dots: 4 });
    expect(hexagramLines(1)).toEqual([true, true, true, true, true, true]);
    expect(hexagramLines(44)).toEqual([false, true, true, true, true, true]); // yin returns at the bottom
    expect(hexagramLines(24)).toEqual([true, false, false, false, false, false]); // yang returns at the bottom
    expect(hexagramLines(7)).toBeNull(); // not a sovereign hexagram — never drawn
    expect(Object.keys(SOVEREIGN_NAMES).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 11, 12, 19, 20, 23, 24, 33, 34, 43, 44]);
  });
  it('the 108 padas, the 120 dasha years, the 35-day weton, the 210-day pawukon, the 36 decans', () => {
    const p = skyPlatesOf(BIRTH);
    const j = p.get('jyotisha').instrument;
    expect(j.nakshatras).toHaveLength(27);
    expect(j.lit).toBeGreaterThanOrEqual(0);
    expect(j.lit).toBeLessThan(108);
    const dasha = p.get('panchanga').instrument.dasha;
    expect(dasha.reduce((n, d) => n + d.years, 0)).toBe(120);
    expect(dasha.at(-1).start + dasha.at(-1).years).toBe(120);
    expect(p.get('weton').instrument).toMatchObject({ rows: 5, cols: 7 });
    expect(p.get('pawukon').instrument).toMatchObject({ rows: 7, cols: 30 });
    expect(WUKU).toHaveLength(30);
    expect(p.get('decan').instrument.signs).toHaveLength(12);
    expect(TZOLKIN_GLOSS).toHaveLength(20);
    expect(NAHUATL_GLOSS).toHaveLength(20);
  });
  it('the tropical wheel: ten bodies at their true longitudes, the Moon’s phase, real aspects only', () => {
    const w = skyWheelOf(BIRTH.skies.instant);
    expect(w.bodies.map((b) => b.key)).toEqual(['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
    const sun = w.bodies[0];
    expect(sun.sign).toBe('Cancer'); // late July: the Sun in Cancer, tropically
    expect(w.moon.lit).toBeGreaterThanOrEqual(0);
    expect(w.moon.lit).toBeLessThanOrEqual(1);
    for (const a of w.aspects) expect(['conjunction', 'sextile', 'square', 'trine', 'opposition']).toContain(a.aspect);
    expect(skyWheelOf('not a date')).toBeNull();
  });
});

describe('every value explains itself', () => {
  const plates = skyPlatesOf(BIRTH);
  it('the atlas lists every system the record carries, and each has its guide', () => {
    const listed = SKY_ATLAS.flatMap((r) => r.systems);
    expect(new Set(listed).size).toBe(listed.length);
    for (const id of plates.keys()) {
      expect(listed).toContain(id);
      const g = SKY_GUIDE[id];
      expect(g.what.length).toBeGreaterThan(80);
      expect(g.how.length).toBeGreaterThan(60);
    }
    expect([...plates.keys()]).toEqual(['sky', 'tzolkin', 'longCount', 'haab', 'tonalpohualli', 'dreamspell', 'bazi', 'jyotisha', 'panchanga', 'weton', 'pawukon', 'mahabote', 'akan', 'decan', 'lunisolar', 'rokuyo', 'xiu', 'nineStar', 'thaksa', 'thaiDay', 'thaiCalendar', 'tibetan', 'rasi', 'navamsa', 'dasha', 'hinduCalendar',
      'western', 'maya819', 'solarTerms', 'nengo', 'hebrew', 'hijri', 'manazil', 'persian', 'zoroastrian', 'bahai', 'igbo', 'ethiopian', 'egyptian', 'french', 'icelandic', 'humanDesign']);
  });
  it('every plate reads this being in one sentence, from its own record', () => {
    for (const plate of plates.values()) expect(plate.reading, plate.id).toMatch(/\S.{20,}\.$/);
  });
  it('nothing stands in another script without its sound or its meaning right beside it', () => {
    for (const plate of plates.values()) {
      const i = plate.instrument;
      expect(unglossedIn(plate.reading), `${plate.id} reading`).toEqual([]);
      expect(unglossedIn(i.caption), `${plate.id} caption`).toEqual([]);
      expect(unglossedIn([i.big, i.small].filter(Boolean).join(' ')), `${plate.id} centre`).toEqual([]);
      for (const c of plate.cells) expect(unglossedIn([c.note, c.v].filter(Boolean).join(' ')), `${plate.id}:${c.k}`).toEqual([]);
    }
    // the words that were shown bare before this guard
    expect(unglossedIn('A pink day (ชมพู); its Buddha is ปางไสยาสน์')).toHaveLength(2);
    expect(unglossedIn('พ.ศ. 2569')).toHaveLength(1);
  });
  it('a value with a field names a note that exists', () => {
    for (const plate of plates.values()) {
      for (const c of plate.cells) if (c.field) expect(SKY_GUIDE[plate.id].fields?.[c.field], `${plate.id}:${c.k}`).toBeTruthy();
    }
  });
  it('the place plate appears only with the owner’s place leg', () => {
    expect(skyPlatesOf(BIRTH).has('place')).toBe(false);
    const placeLeg = { place: birthPlaceOf({ zone: 'Asia/Jakarta' }), readings: placeReadingsOf(BIRTH.skies.instant, birthPlaceOf({ zone: 'Asia/Jakarta' }), 420) };
    const plate = skyPlatesOf(BIRTH, placeLeg).get('place');
    expect(plate.instrument.kind).toBe('horizon');
    expect(plate.cells.map((c) => c.k)).toEqual(['PLACE', 'ASCENDANT', 'MIDHEAVEN', 'SECT', 'LOT OF FORTUNE', 'LOT OF SPIRIT', 'VEDIC WEEKDAY', 'PLANETARY HOUR', 'LAGNA']);
    for (const c of plate.cells) expect(SKY_GUIDE.place.fields[c.field], c.k).toBeTruthy();
  });
  it('a record from an older engine: what it lacks is read from its own sealed instant, and said so', () => {
    const { decans, ...older } = BIRTH.skies.systems;
    const plates = skyPlatesOf({ skies: { ...BIRTH.skies, systems: older } });
    expect(plates.get('decan').fresh).toBe(true);
    expect(plates.get('decan').reading).toBe(skyPlatesOf(BIRTH).get('decan').reading); // the same sky, from the same instant
    expect(plates.get('tzolkin').fresh).toBe(false); // what the record carries stays the record's
    expect(decans).toBeTruthy();
  });
  it('no record, no plates — never a made-up sky', () => {
    expect(skyPlatesOf(null).size).toBe(0);
    expect(skyPlatesOf({ skies: { systems: {} } }).size).toBe(0);
  });
});
