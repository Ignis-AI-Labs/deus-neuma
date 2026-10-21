// given-view — the RECORD's GIVEN space: its four pages and the page
// remembered, the soul's scale placed round the octave, the genesis hash as
// its digits, the seal's road to the chain, LEAN read as its label (15 is
// UNALIGNED, never a bare code), and the drawing math (the Moon's lit shape,
// marks kept apart). Real inputs; no mocks.
import { describe, it, expect } from 'vitest';
import { GIVEN_TABS, givenTabOf, skySystemOf, octavePlaces, hashDigits, sealRoadOf } from '../../frontend/app/RelinkShell/given/given-view.js';
import { leanValue, FIELD_GUIDE, PAGE_GUIDE } from '../../frontend/app/RelinkShell/given/given-guide.js';
import { clockPoint, chartPoint, moonLitPath, lanesOf, sector } from '../../frontend/app/RelinkShell/given/sky-geometry.js';

describe('the pages', () => {
  it('SOUL · BODY · SKY · SEAL, coded A–D, the last read reopening', () => {
    expect(GIVEN_TABS.map((t) => `${t.code} ${t.title}`)).toEqual(['A SOUL', 'B BODY', 'C SKY', 'D SEAL']);
    expect(givenTabOf('sky')).toBe('sky');
    expect(givenTabOf('genome')).toBe('soul');
    expect(skySystemOf('bazi', ['sky', 'bazi'])).toBe('bazi');
    expect(skySystemOf('weton', ['sky', 'bazi'])).toBe('sky');
    expect(skySystemOf(null, [])).toBeNull();
  });
  it('every page and every field it shows has its guide', () => {
    for (const t of GIVEN_TABS) expect(PAGE_GUIDE[t.key].what.length).toBeGreaterThan(80);
    for (const k of ['resonance', 'tonic', 'light', 'source', 'scale', 'note', 'stages']) expect(FIELD_GUIDE.soul[k].what).toBeTruthy();
    for (const k of ['GENESIS HASH', 'SEALED INSTANT', 'ZONE', 'BIRTH CYCLE', 'LEAN', 'BORN ON', 'NETWORK', 'BLOCK', 'SEALED', 'TRANSACTION']) expect(FIELD_GUIDE.seal[k].what).toBeTruthy();
    for (const k of ['GIVEN', 'FRAME', 'FACE', 'COLORING', 'MARK', 'SHAPE']) expect(FIELD_GUIDE.body[k].what).toBeTruthy();
  });
});

describe('LEAN says what its number means', () => {
  it('15 is UNALIGNED — the place every being is sealed in', () => {
    expect(leanValue(15)).toBe('UNALIGNED · 15');
    expect(leanValue(7)).toBe('BALANCED · 7');
    expect(FIELD_GUIDE.seal.LEAN.reading(15)).toMatch(/^UNALIGNED \(15\) — explicitly neither pole/);
    expect(FIELD_GUIDE.seal.LEAN.reading(5)).toMatch(/^FEM-LEANING \(5\)/);
  });
});

describe('the soul and the seal, drawn', () => {
  it('the scale round one octave: the tonic at the top, every note at its cents', () => {
    const places = octavePlaces([{ name: 'A4', cents: 0 }, { name: 'E5', cents: 701.955 }, { name: 'A5', cents: 1200 }]);
    expect(places.map((p) => Math.round(p.angle * 100) / 100)).toEqual([0, 210.59, 0]);
  });
  it('the genesis hash as its sixty-four digits, nothing invented for a bad one', () => {
    const h = 'a10cb2fa2d'.padEnd(64, 'f');
    expect(hashDigits(h)).toHaveLength(64);
    expect(hashDigits(h).slice(0, 3)).toEqual([10, 1, 0]);
    expect(hashDigits('not hex')).toEqual([]);
  });
  it('the road from its birth to the chain, and how long it took', () => {
    const born = { seal: { birthMoment: { utc: '2026-07-21T20:23:00.000Z' } } };
    expect(sealRoadOf({ ...born, onchain: { sealedAt: '2026-07-22T07:10:00.000Z' } })).toEqual({ born: '2026-07-21T20:23:00.000Z', anchored: '2026-07-22T07:10:00.000Z', after: '10 HOURS' });
    expect(sealRoadOf(born)).toEqual({ born: '2026-07-21T20:23:00.000Z', anchored: null, after: null });
    expect(sealRoadOf({ seal: null })).toBeNull();
  });
});

describe('the drawing math', () => {
  it('a clock angle starts at the top; a chart longitude at the left, counter-clockwise', () => {
    expect(clockPoint(0, 0, 10, 0)).toEqual([0, -10]);
    expect(clockPoint(0, 0, 10, 90)).toEqual([10, 0]);
    expect(chartPoint(0, 0, 10, 0)).toEqual([-10, 0]);
    expect(chartPoint(0, 0, 10, 90)).toEqual([0, 10]);
    expect(sector(0, 0, 5, 10, 0, 90)).toMatch(/^M0 -10A10 10 0 0 1 10 0L5 0A5 5 0 0 0 0 -5Z$/);
  });
  it('the Moon: nothing lit at new; waxing lit on the right, waning on the left; the terminator bulges the right way', () => {
    expect(moonLitPath(0, 0, 10, 0)).toBe('');
    // waxing crescent: the right limb, the terminator bowing toward it — a thin sliver
    expect(moonLitPath(0, 0, 10, 45)).toBe('M0 -10A10 10 0 0 1 0 10A7.07 10 0 0 0 0 -10Z');
    // waxing gibbous: the terminator bows the other way — more than half lit
    expect(moonLitPath(0, 0, 10, 135)).toBe('M0 -10A10 10 0 0 1 0 10A7.07 10 0 0 1 0 -10Z');
    // full: both arcs are the whole circle — the face entirely lit
    expect(moonLitPath(0, 0, 10, 180)).toBe('M0 -10A10 10 0 0 0 0 10A10 10 0 0 0 0 -10Z');
    // waning: the left limb
    expect(moonLitPath(0, 0, 10, 225)).toBe('M0 -10A10 10 0 0 0 0 10A7.07 10 0 0 0 0 -10Z');
    expect(moonLitPath(0, 0, 10, 315)).toBe('M0 -10A10 10 0 0 0 0 10A7.07 10 0 0 1 0 -10Z');
  });
  it('bodies too close to read step inward a lane; far ones keep the outer lane', () => {
    const lanes = lanesOf([{ key: 'sun', longitude: 100 }, { key: 'mercury', longitude: 103 }, { key: 'venus', longitude: 105 }, { key: 'mars', longitude: 200 }]);
    expect([...lanes.entries()]).toEqual([['sun', 0], ['mercury', 1], ['venus', 2], ['mars', 0]]);
    const wrap = lanesOf([{ key: 'a', longitude: 1 }, { key: 'b', longitude: 358 }]);
    expect(wrap.get('a')).not.toBe(wrap.get('b'));
  });
});
