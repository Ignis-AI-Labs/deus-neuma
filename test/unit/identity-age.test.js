// identity-age.test.js — THE AGE, out of the genome and counted from birth.
// Design note, 2026-09-26: age […] and should be locked
// to DAYS PRESENT — 21 on the day of birth, older on every real anniversary.
import { describe, it, expect } from 'vitest';
import { AGE, livedAge } from '../../core/identity/age.js';

const BORN = '2026-06-23T05:00:00.000Z';
const at = (iso) => Date.parse(iso);

describe('the lived age', () => {
  it('is the starting age on the day of birth', () => {
    expect(livedAge(BORN, at(BORN))).toEqual({ years: 21, days: 0, lived: 0, startsAt: 21 });
    expect(livedAge(BORN, at('2026-09-25T05:00:00.000Z'))).toMatchObject({ years: 21, days: 94 });
  });

  it('turns a year older on the real anniversary instant — not a day early', () => {
    expect(livedAge(BORN, at('2027-06-23T04:59:59.999Z'))).toMatchObject({ years: 21, days: 364 });
    expect(livedAge(BORN, at('2027-06-23T05:00:00.000Z'))).toMatchObject({ years: 22, days: 0, lived: 1 });
    expect(livedAge(BORN, at('2036-07-01T05:00:00.000Z'))).toMatchObject({ years: 31, days: 8 });
  });

  it('a leap-day birth keeps Feb 28 in common years', () => {
    const leap = '2028-02-29T12:00:00.000Z';
    expect(livedAge(leap, at('2029-02-28T12:00:00.000Z'))).toMatchObject({ years: 22, days: 0 });
    expect(livedAge(leap, at('2029-02-28T11:59:59.000Z'))).toMatchObject({ years: 21 });
  });

  it('never guesses: an unknown birth reads null', () => {
    expect(livedAge(null, Date.now())).toBeNull();
    expect(livedAge('not a date', Date.now())).toBeNull();
  });

  it('the floor stays law: 20+, starting at 21, frozen', () => {
    expect(AGE).toEqual({ class: 'adult', minimumYears: 20, startsAt: 21 });
    expect(Object.isFrozen(AGE)).toBe(true);
  });
});
