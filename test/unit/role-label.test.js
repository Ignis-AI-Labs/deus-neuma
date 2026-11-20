// A member's title as people read it (role-label.js, deus-neuma #31, #32), and the plain sentence
// every canonical seat now carries. Pure functions on the real legend.
import { describe, expect, it } from 'vitest';
import { fullRole, legendEntry, shortRole } from '../../frontend/app/RelinkShell/role-label.js';
import { TITLE_LEGEND } from '../../frontend/app/RelinkShell/founding-titles.js';

describe('role-label', () => {
  it('a canon title carries its role: short in a row, in full on hover and in the House', () => {
    expect(shortRole('Optio')).toBe('OPTIO (COS)');
    expect(fullRole('Optio')).toBe('Optio · COS — CHIEF OF STAFF');
    expect(shortRole('praefectus')).toBe('PRAEFECTUS (CSO)'); // any case
    expect(legendEntry('Logista')?.seat).toBe('CHIEF ACCOUNTING OFFICER');
  });
  it('a house\'s own word is shown as given, with no role invented; no title is nothing', () => {
    expect(shortRole('Keeper of Lamps')).toBe('KEEPER OF LAMPS');
    expect(fullRole('Keeper of Lamps')).toBe('Keeper of Lamps');
    expect(legendEntry('Keeper of Lamps')).toBeNull();
    expect(shortRole(null)).toBe('');
    expect(fullRole(undefined)).toBe('');
  });
});

describe('every seat says what it is for', () => {
  it('one plain sentence each, and the near pairs name their boundary', () => {
    for (const e of TITLE_LEGEND) expect(e.summary, e.title).toMatch(/^[A-Z].{30,}[.]$/);
    const of = (t) => legendEntry(t).summary;
    expect(of('Quaestor')).toMatch(/CAO/);   // CFO / CAO
    expect(of('Logista')).toMatch(/CFO/);
    expect(of('Legatus')).toMatch(/CCO/);    // CMO / CCO
    expect(of('Praeco')).toMatch(/CMO/);
    expect(of('Mercator')).toMatch(/CMO/);   // CRO / CMO
    expect(of('Faber')).toMatch(/CPO/);      // COO / CPO
    expect(of('Architectus')).toMatch(/COO/);
  });
});
