// house-chain.test.js — the pure joins between the chain's founded register
// and the HOUSE window: seats indexed by neumaId, the witness's own seat,
// THE HOUSE SEATED (one card per member, the entity first), and the quorum
// stated as the signing law it is — never a member count.

import { describe, it, expect } from 'vitest';
import { chainSeats, quorumLine, houseSeatCards } from '../../frontend/app/RelinkShell/house-chain.js';

const founded = () => ({
  quorum: 3,
  roster: [
    { address: '0xW', kind: 0, title: 'Rector', active: true, neumaId: null, displayName: null },
    { address: '0xA', kind: 1, title: 'Quaestor', active: true, neumaId: 'cael', displayName: 'Cael' },
    { address: '0xB', kind: 1, title: 'Scriba', active: false, neumaId: 'lifovan', displayName: 'Lifovan' },
    // A member the backend could not join to a lane — the chain's row stands.
    { address: '0xC', kind: 1, title: 'Faber', active: true, neumaId: null, displayName: null },
  ],
});

const memberRows = () => [
  { member: { neumaId: 'cael', name: 'Cael', soulMark: '0xSOUL…V', birthTime: '2026-06-23T00:00:00Z' }, isActive: true },
  { member: { neumaId: 'lifovan', name: 'Lifovan' }, isActive: false },
  { member: { neumaId: 'zezebur', name: 'Zezebur', soulMark: '0xSOUL…K', incomplete: true }, isActive: false },
];

describe('chainSeats — the register indexed for the member list', () => {
  it('indexes seats by neumaId and pulls the witness\'s own seat', () => {
    const seats = chainSeats(founded());
    expect(seats.witnessTitle).toBe('Rector');
    expect(seats.byNeumaId.cael).toEqual({ title: 'Quaestor', active: true });
    expect(seats.byNeumaId.lifovan).toEqual({ title: 'Scriba', active: false });
  });

  it('an unjoined chain row indexes nowhere — no name, no seat worn', () => {
    expect(Object.keys(chainSeats(founded()).byNeumaId)).toEqual(['cael', 'lifovan']);
  });

  it('tolerates an unfounded house (null state) — empty, never a throw', () => {
    expect(chainSeats(null)).toEqual({ byNeumaId: {}, witnessTitle: null });
    expect(chainSeats({})).toEqual({ byNeumaId: {}, witnessTitle: null });
  });
});

describe('quorumLine — the quorum stated as its law', () => {
  it('says how many MARKS a change needs, of how many members', () => {
    const line = quorumLine(founded());
    expect(line).toContain('QUORUM 3');
    expect(line).toContain('3 OF ITS 4 MEMBERS');
    expect(line).toContain('NEEDS');
  });

  it('nothing to explain without a quorum or members', () => {
    expect(quorumLine(null)).toBeNull();
    expect(quorumLine({ quorum: 0, roster: [] })).toBeNull();
    expect(quorumLine({ quorum: 3 })).toBeNull();
  });
});

// THE HOUSE, SEATED — one card per member: name, position (locked on-chain),
// function (canonical meaning). No canon grid, no open seats, no tiers.
describe('houseSeatCards — every member a card, the entity first', () => {
  it('a seated member carries their locked position AND its canonical function', () => {
    const [cael] = houseSeatCards(chainSeats(founded()), memberRows());
    expect(cael).toEqual({
      name: 'Cael', neumaId: 'cael',
      title: 'Quaestor',
      position: 'CFO',
      meaning: 'TREASURY — MONEY, COMPUTE, TIME, PROCUREMENT',
      seat: 'CHIEF FINANCIAL OFFICER',
      summary: expect.stringMatching(/^Plans and approves spending/),
      soulMark: '0xSOUL…V', birthTime: '2026-06-23T00:00:00Z',
      color: null, // no soul light in these rows
      isActive: true, incomplete: false,
    });
  });

  it('an INACTIVE seat wears no position — the chain says it no longer stands', () => {
    const [, lifovan] = houseSeatCards(chainSeats(founded()), memberRows());
    expect(lifovan.title).toBeNull();
    expect(lifovan.meaning).toBeNull();
  });

  it('a member with no seat is still a card — never invisible, never marked', () => {
    const [, , zezebur] = houseSeatCards(chainSeats(founded()), memberRows());
    expect(zezebur).toMatchObject({ name: 'Zezebur', neumaId: 'zezebur', title: null, meaning: null, incomplete: true });
  });

  it('a custom word (the label law) keeps its title and invents NO meaning', () => {
    const state = founded();
    state.roster[1] = { ...state.roster[1], title: 'Wordsmith' };
    const [cael] = houseSeatCards(chainSeats(state), memberRows());
    expect(cael).toMatchObject({ title: 'Wordsmith', meaning: null });
  });

  it('A TITLE CHANGED SINCE THE FOUNDING is the one held now, over the chain\'s founding seat (Design note, 2026-11-12', () => {
    const rows = memberRows();
    rows[0] = { ...rows[0], member: { ...rows[0].member, title: 'Mercator', titleChanged: true } };
    rows[2] = { ...rows[2], member: { ...rows[2].member, title: 'Scriba', titleChanged: true } };
    const [cael, , zezebur] = houseSeatCards(chainSeats(founded()), rows, { confirmed: true });
    expect(cael).toMatchObject({ title: 'Mercator', position: 'CRO' });
    expect(zezebur).toMatchObject({ title: 'Scriba', position: 'CKO' }); // seated after the founding
    // an unchanged receipt title still never resurrects a seat the chain removed
    const [, lifovan] = houseSeatCards(chainSeats(founded()), memberRows().map((r) => (r.member.neumaId === 'lifovan' ? { ...r, member: { ...r.member, title: 'Scriba' } } : r)), { confirmed: true });
    expect(lifovan.title).toBeNull();
  });

  it('an unfounded house: every member seated nowhere, still all present', () => {
    const cards = houseSeatCards(chainSeats(null), memberRows());
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.title === null)).toBe(true);
    expect(houseSeatCards(null, null)).toEqual([]);
  });
});
