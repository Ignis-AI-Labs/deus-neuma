/**
 * MANY SKIES as lines (core/cosmos/skies/skies-lines.js) — the one list the
 * SHEET and the SUMMONING film both draw. Over the real skies engine: every
 * system it computes is a line, in order, with its tradition named; a record
 * from an older engine shows only what it carries. No mocks (RULE 0).
 */

import { describe, it, expect } from 'vitest';
import { buildSkies } from '../../core/cosmos/skies/index.js';
import { skiesLinesOf } from '../../core/cosmos/skies/skies-lines.js';
import { skyOf } from '../../frontend/app/Summoning/summoning-sky.js';

// Keir's sealed instant (kin 141, the MANY SKIES verification vector).
const INSTANT = { utc: '2026-06-11T18:03:38.075Z', epochMs: Date.parse('2026-06-11T18:03:38.075Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 };

describe('skiesLinesOf — no astrological system left out', () => {
  it('every system the engine computes is a line, in a fixed order', () => {
    const lines = skiesLinesOf(buildSkies(INSTANT).systems);
    expect(lines.map((l) => l.label)).toEqual([
      'MAYA COUNT', 'LONG COUNT', "HAAB'", 'TONALPOHUALLI', 'DREAMSPELL', 'BAZI', 'JYOTISHA', 'PANCHANGA',
      'WETON', 'PAWUKON', 'AKAN', 'MAHABOTE', 'SUN DECAN',
    ]);
    for (const l of lines) {
      expect(l.value.length).toBeGreaterThan(2);
      expect(l.note).toBeTruthy();
      expect(l.value).not.toMatch(/undefined|null|NaN/);
    }
    expect(lines[0].value).toBe('11 Imix · KIN 141/260');
    expect(lines.find((l) => l.label === 'BAZI').value).toMatch(/ YEAR · .+ MONTH · .+ DAY · .+ HOUR$/);
  });

  it('a record sealed by an older engine shows only what it carries', () => {
    expect(skiesLinesOf({ wetonan: { weton: 'Monday Legi', neptu: 9 } }).map((l) => l.label)).toEqual(['WETON']);
    expect(skiesLinesOf({ mesoamerican: { tzolkin: { tone: 1, sign: 'Imix', kin: 1 } } }).map((l) => l.label)).toEqual(['MAYA COUNT']);
    expect(skiesLinesOf(null)).toEqual([]);
  });

  it('the SUMMONING film draws the same full list', () => {
    const sky = skyOf(INSTANT.epochMs, { zone: INSTANT.zone, offsetMinutes: INSTANT.offsetMinutes });
    const lines = skiesLinesOf(buildSkies(INSTANT).systems);
    expect(sky.many.map((m) => m.system)).toEqual(lines.map((l) => l.label));
    expect(sky.many[0].reading).toBe('11 IMIX · KIN 141/260');
  });
});
