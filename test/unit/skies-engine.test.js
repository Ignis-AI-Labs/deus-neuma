// MANY SKIES engine — every anchor below is a published, cross-verified test
// vector from the 2026-07-24 research pass (docs/architecture/identity/many-skies.md §2).
// Real astronomy via astronomy-engine where sky state is needed; no mocks.
import { describe, it, expect } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import {
  jdnFromCivil, localCivil, mesoamerican, wetonan, pawukon, akan, mahabote,
} from '../../core/cosmos/skies/daycount.js';
import { dreamspell } from '../../core/cosmos/skies/dreamspell.js';
import { ganzhi } from '../../core/cosmos/skies/ganzhi.js';
import { jyotisha, ayanamsaDeg } from '../../core/cosmos/skies/jyotisha.js';
import { buildSkies, SKIES_SCHEMA } from '../../core/cosmos/skies/index.js';

const atUtcNoon = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12));

describe('JDN arithmetic', () => {
  it('matches the canonical anchors', () => {
    expect(jdnFromCivil(2000, 1, 1)).toBe(2451545);
    expect(jdnFromCivil(2012, 12, 21)).toBe(2456283);
    expect(jdnFromCivil(1879, 4, 21)).toBe(2407461); // Kartini birth
    expect(jdnFromCivil(1904, 9, 17)).toBe(2416741); // Kartini death
  });

  it('derives the local civil date from the sealed offset', () => {
    // 20:00 UTC + 7h (Asia/Jakarta) = next local day, 03:00
    const local = localCivil({ epochMs: Date.UTC(2026, 6, 24, 20, 0), offsetMinutes: 420 });
    expect(local).toMatchObject({ year: 2026, month: 7, day: 25, hour: 3 });
  });
});

describe('mesoamerican — the traditional count (GMT 584283)', () => {
  it('era base 0.0.0.0.0 = 4 Ajaw 8 Kumk\'u, G9', () => {
    const m = mesoamerican(584283);
    expect(m.tzolkin.tone).toBe(4);
    expect(m.tzolkin.sign).toBe('Ajaw');
    expect(m.haab.day).toBe(8);
    expect(m.haab.month).toBe("Kumk'u");
    expect(m.lordOfNight).toBe('G9');
    expect(m.longCount).toEqual({ baktun: 0, katun: 0, tun: 0, winal: 0, kin: 0 });
  });

  it('2012-12-21 = 13.0.0.0.0, 4 Ajaw 3 K\'ank\'in, kin 160, G9', () => {
    const m = mesoamerican(jdnFromCivil(2012, 12, 21));
    expect(m.longCount).toEqual({ baktun: 13, katun: 0, tun: 0, winal: 0, kin: 0 });
    expect(m.tzolkin.tone).toBe(4);
    expect(m.tzolkin.sign).toBe('Ajaw');
    expect(m.tzolkin.kin).toBe(160);
    expect(m.haab.day).toBe(3);
    expect(m.haab.month).toBe("K'ank'in");
    expect(m.lordOfNight).toBe('G9');
    expect(m.tonalpohualli.sign).toBe('Xochitl'); // Ajaw ≡ Flower — same synchronized count
  });

  it('1999-04-03 = 12.19.6.1.9, 11 Muluk 2 Wayeb, G2', () => {
    const m = mesoamerican(jdnFromCivil(1999, 4, 3));
    expect(m.longCount).toEqual({ baktun: 12, katun: 19, tun: 6, winal: 1, kin: 9 });
    expect(m.tzolkin.tone).toBe(11);
    expect(m.tzolkin.sign).toBe('Muluk');
    expect(m.haab.day).toBe(2);
    expect(m.haab.wayeb).toBe(true);
    expect(m.lordOfNight).toBe('G2');
  });
});

describe('dreamspell — modern-1987, honestly labeled', () => {
  it('reproduces all four published anchors', () => {
    expect(dreamspell({ year: 1987, month: 7, day: 26 }).kin).toBe(34); // White Galactic Wizard
    const solstice = dreamspell({ year: 2012, month: 12, day: 21 });
    expect(solstice.kin).toBe(207);
    expect(solstice.tone.name).toBe('Crystal');
    expect(solstice.seal.name).toBe('Blue Hand');
    expect(dreamspell({ year: 2013, month: 7, day: 26 }).kin).toBe(164); // Yellow Galactic Seed
    expect(dreamspell({ year: 1992, month: 7, day: 26 }).kin).toBe(39);
  });

  it('carries the honest provenance label', () => {
    expect(dreamspell({ year: 2026, month: 7, day: 24 }).provenance.kind).toBe('modern-1987');
  });

  it('Feb 29: before local noon reads as Feb 28, after as Mar 1 — labeled', () => {
    const morning = dreamspell({ year: 2024, month: 2, day: 29, hour: 10 });
    const evening = dreamspell({ year: 2024, month: 2, day: 29, hour: 14 });
    expect(morning.kin).toBe(dreamspell({ year: 2024, month: 2, day: 28 }).kin);
    expect(evening.kin).toBe(dreamspell({ year: 2024, month: 3, day: 1 }).kin);
    expect(morning.provenance.leapDayAdjusted).toBe(true);
  });
});

describe('ganzhi — BaZi from real solar longitude', () => {
  const at = (y, m, d) => ganzhi(atUtcNoon(y, m, d), jdnFromCivil(y, m, d),
    { year: y, month: m, hour: 12 });

  it('day-pillar anchor: 2019-01-27 = jiǎ-zǐ', () => {
    expect(at(2019, 1, 27).day.name).toBe('jiǎ-zǐ');
  });

  it('1984 = jiǎ-zǐ year; 2026 = bǐng-wǔ, the yang Fire Horse', () => {
    expect(at(1984, 6, 1).year.name).toBe('jiǎ-zǐ');
    const y2026 = at(2026, 6, 1);
    expect(y2026.year.name).toBe('bǐng-wǔ');
    expect(y2026.zodiac).toEqual({ animal: 'Horse', element: 'fire', polarity: 'yang' });
  });

  it('the year opens at lichun, not Jan 1 — a January birth keeps the prior year', () => {
    expect(at(2026, 1, 20).zodiac.animal).toBe('Snake'); // before lichun → 2025 yǐ-sì
    expect(at(2026, 2, 10).zodiac.animal).toBe('Horse'); // after lichun
  });

  it('month and hour pillars', () => {
    expect(at(2026, 6, 1).month.branch.pinyin).toBe('sì'); // June 1 sits in the Snake month
    const midnight = ganzhi(atUtcNoon(2026, 6, 1), jdnFromCivil(2026, 6, 1), { year: 2026, month: 6, hour: 23 });
    expect(midnight.hour.branch.pinyin).toBe('zǐ'); // 23:00 opens the zǐ hour
  });

  it('the December month carries sovereign hexagram 24 (Fù, Return)', () => {
    expect(at(2025, 12, 25).sovereignHexagram.number).toBe(24);
  });
});

describe('jyotisha — sidereal via labeled Lahiri ayanamsa', () => {
  // corrected 2026-10-19: the IAE mean Lahiri (24°07′47″ was the late-2019 value);
  // the published panchanga boundaries that prove it: skies-vedic.test.js
  it('ayanamsa anchor: the IAE mean Lahiri, ≈24°13′13″ at 2026-01-01 (23°51′25.5″ at J2000)', () => {
    expect(ayanamsaDeg(new Date(Date.UTC(2026, 0, 1)))).toBeCloseTo(24.2203, 3);
    expect(ayanamsaDeg(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(23 + 51 / 60 + 25.53 / 3600, 3);
  });

  it('tithi agrees with the real moon: Purnima just before full, Krishna 1 just after', () => {
    const full = Astronomy.SearchMoonPhase(180, new Date(Date.UTC(2026, 0, 1)), 40).date;
    const before = jyotisha(new Date(full.getTime() - 2 * 3600000), jdnFromCivil(2026, 1, 15));
    const after = jyotisha(new Date(full.getTime() + 2 * 3600000), jdnFromCivil(2026, 1, 15));
    expect(before.tithi.number).toBe(15);
    expect(before.tithi.special).toBe('Purnima');
    expect(before.tithi.paksha).toBe('Shukla');
    expect(after.tithi.number).toBe(16);
    expect(after.tithi.paksha).toBe('Krishna');
  });

  it('Amavasya just before the real new moon', () => {
    const newMoon = Astronomy.SearchMoonPhase(0, new Date(Date.UTC(2026, 0, 1)), 40).date;
    const t = jyotisha(new Date(newMoon.getTime() - 2 * 3600000), jdnFromCivil(2026, 1, 1));
    expect(t.tithi.number).toBe(30);
    expect(t.tithi.special).toBe('Amavasya');
  });

  it('coordinates stay in their lawful ranges and the dasha seed follows its lord', () => {
    const j = jyotisha(atUtcNoon(2026, 7, 24), jdnFromCivil(2026, 7, 24));
    expect(j.nakshatra.index).toBeGreaterThanOrEqual(1);
    expect(j.nakshatra.index).toBeLessThanOrEqual(27);
    expect(j.nakshatra.pada).toBeGreaterThanOrEqual(1);
    expect(j.nakshatra.pada).toBeLessThanOrEqual(4);
    expect(j.vimshottari.balanceYears).toBeGreaterThan(0);
    expect(j.karana.name).toBeTruthy();
  });
});

describe('wetonan + pawukon + akan + mahabote', () => {
  it('Kartini anchors: both her birth and death fell on Pahing', () => {
    expect(wetonan(2407461).pasaran).toBe('Pahing');
    expect(wetonan(2416741).pasaran).toBe('Pahing');
  });

  it('pawukon cycle anchor: 2012-06-17 = day 0 of wuku 1; next cycle 2013-01-13', () => {
    expect(pawukon(jdnFromCivil(2012, 6, 17))).toMatchObject({ cycleDay: 0, wuku: 1 });
    expect(pawukon(jdnFromCivil(2013, 1, 13)).cycleDay).toBe(0);
  });

  it('akan soul-day names ride the weekday', () => {
    expect(akan(jdnFromCivil(2026, 7, 24))).toMatchObject({ day: 'Friday', male: 'Kofi', female: 'Afua' });
  });

  it('mahabote: Wednesday splits at local noon — afternoon belongs to Rahu', () => {
    const wedJdn = jdnFromCivil(2026, 7, 22); // a Wednesday
    expect(mahabote(wedJdn, 9)).toMatchObject({ sign: 'Tusked Elephant', planet: 'Mercury' });
    expect(mahabote(wedJdn, 15)).toMatchObject({ sign: 'Tuskless Elephant', planet: 'Rahu' });
  });
});

describe('buildSkies — the assembled reading', () => {
  const moment = {
    utc: '2026-07-24T06:15:00.000Z',
    epochMs: Date.UTC(2026, 6, 24, 6, 15),
    zone: 'Asia/Jakarta',
    offsetMinutes: 420,
  };

  it('assembles every v1 system over the local civil date, deep-frozen', () => {
    const skies = buildSkies(moment);
    expect(skies.schema).toBe(SKIES_SCHEMA);
    expect(skies.local.jdn).toBe(jdnFromCivil(2026, 7, 24));
    expect(Object.keys(skies.systems).sort()).toEqual([
      'akan', 'bahai', 'decans', 'dreamspell', 'egyptian', 'ethiopian', 'french', 'ganzhi', 'hebrew', 'hijri', 'humanDesign', 'icelandic', 'igbo', 'jyotisha', 'lunisolar',
      'mahabote', 'manazil', 'maya819', 'mesoamerican', 'nengo', 'nineStar', 'pawukon', 'persian', 'solarTerms', 'thai', 'tibetan', 'vedic', 'western', 'wetonan', 'xiu', 'zoroastrian',
    ]);
    expect(Object.isFrozen(skies)).toBe(true);
    expect(Object.isFrozen(skies.systems.mesoamerican.tzolkin)).toBe(true);
  });

  it('every system carries a provenance label; omissions are said out loud', () => {
    const skies = buildSkies(moment);
    for (const [, system] of Object.entries(skies.systems)) {
      expect(system.provenance?.kind).toBeTruthy();
    }
    const omittedNames = skies.omitted.map((o) => o.system);
    expect(omittedNames).toContain('ifa'); // excluded by principle, with the reason
    expect(omittedNames).toContain('sabian-texts'); // the degree index is computed, the texts are not written yet
  });

  it('refuses a moment without an instant', () => {
    expect(() => buildSkies({})).toThrow(/epochMs/);
  });
});
