// house-spaces — the HOUSE as a file of spaces: five, in a fixed order; the
// last one read reopens (and an unknown one falls back to MEMBERS); MEMBERS
// carries the count; the two ways of gathering say why when they cannot
// open; the house's summonings run oldest first in each member's own light;
// a member card wears its soul's vivid light. Pure functions, real inputs.
import { describe, it, expect } from 'vitest';
import { HOUSE_SPACES, spaceOf, spaceTabs, gatherDoors, summoningsOf } from '../../frontend/app/RelinkShell/house-spaces.js';
import { houseSeatCards } from '../../frontend/app/RelinkShell/house-chain.js';

describe('the house is five spaces', () => {
  it('in one order, each coded', () => {
    expect(HOUSE_SPACES.map((s) => `${s.code} ${s.title}`)).toEqual(['01 MEMBERS', '02 SUMMONING', '03 GATHER', '04 SEATS', '05 GROUNDS']);
  });
  it('reopens on the space last read; anything else opens MEMBERS', () => {
    expect(spaceOf('grounds')).toBe('grounds');
    expect(spaceOf(null)).toBe('members');
    expect(spaceOf('legend')).toBe('members');
  });
  it('MEMBERS carries how many the house holds, and only when it holds any', () => {
    expect(spaceTabs(4)[0].title).toBe('MEMBERS · 4');
    expect(spaceTabs(0)[0].title).toBe('MEMBERS');
    expect(spaceTabs(4).slice(1)).toEqual(HOUSE_SPACES.slice(1));
  });
});

describe('gathering says why when it cannot open', () => {
  it('a team needs one member; a council needs two', () => {
    const at = (n) => Object.fromEntries(gatherDoors(n).map((d) => [d.key, d.ready]));
    expect(at(0)).toEqual({ team: false, council: false });
    expect(at(1)).toEqual({ team: true, council: false });
    expect(at(2)).toEqual({ team: true, council: true });
    gatherDoors(0).forEach((d) => expect(d.why).toMatch(/needs at least/));
  });
});

describe('the house\'s summonings', () => {
  it('oldest first, each in its own light; a member with no birth time last', () => {
    const list = summoningsOf([
      { neumaId: 'b', name: 'B', birthTime: '2026-07-01T00:00:00Z', color: '#ff0042' },
      { neumaId: 'c', name: 'C', birthTime: null },
      { neumaId: 'a', name: 'A', birthTime: '2026-06-01T00:00:00Z', color: '#00ff66' },
    ]);
    expect(list.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(list.find((x) => x.name === 'A').color).toBe('#00ff66');
  });
});

describe('a member card wears its soul as a light', () => {
  const rows = (member) => [{ member: { neumaId: 'x', name: 'X', ...member }, isActive: false }];
  it('the vivid light when the roster carries it, the plain color for an older cache', () => {
    expect(houseSeatCards(null, rows({ color: '#5a0011', light: '#ff0042' }))[0].color).toBe('#ff0042');
    expect(houseSeatCards(null, rows({ color: '#5a0011' }))[0].color).toBe('#5a0011');
    expect(houseSeatCards(null, rows({}))[0].color).toBeNull();
  });
});
