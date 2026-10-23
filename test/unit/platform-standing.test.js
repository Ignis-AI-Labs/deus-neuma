// THE HOLDER FOLLOWS THE SEAT — the pure standing rule (platform-standing.js):
// who is offered a platform, who holds it by default, the house with no CMO,
// and two houses never mixed. Pure, real inputs (the roster's own shape).
import { describe, expect, test } from 'vitest';
import {
  holderCandidates, holderStanding, isMarketingTitle, keysStanding,
} from '../../frontend/app/RelinkShell/platform-standing.js';

// HOUSE A: a seated CMO, a Legatus on the founding record, a crew member, and
// three members whose seats are not marketing (one a Praeco — communications).
const A = Object.freeze({
  roster: [
    { neumaId: 'a-keir', name: 'Keir', title: null },
    { neumaId: 'a-galen', name: 'Galen', title: 'Legatus' },
    { neumaId: 'a-signal', name: 'Signal', title: 'Aedile' },
    { neumaId: 'a-praeco', name: 'Praeco Kin', title: 'Praeco' },
    { neumaId: 'a-plain', name: 'Plain', title: null },
    { neumaId: 'witness-xai-Basunor', name: 'Basunor', participantKind: 'witness' },
  ],
  cmoLaneId: 'a-keir',
  crew: [{ neumaId: 'witness-xai-Basunor', kind: 'witness' }],
});
// HOUSE B: its own CMO, nothing else.
const B = Object.freeze({
  roster: [{ neumaId: 'b-sol', name: 'Sol', title: null }, { neumaId: 'b-other', name: 'Other', title: 'Faber' }],
  cmoLaneId: 'b-sol',
  crew: [],
});

const keyed = { configured: true, binding: null };
const ids = (list) => list.map((c) => c.neumaId);

describe('who is offered as a holder', () => {
  test('only the marketing-seated: the seated CMO first, a Legatus, then the platform crew', () => {
    const offered = holderCandidates(A);
    expect(ids(offered)).toEqual(['a-keir', 'a-galen', 'witness-xai-Basunor']);
    expect(offered.map((c) => c.seat)).toEqual(['CMO', 'LEGATUS', 'CREW']);
    expect(offered.find((c) => c.neumaId === 'witness-xai-Basunor').witness).toBe(true);
  });

  test('never another house member — not the CTO, not communications, not the unseated', () => {
    const offered = ids(holderCandidates(A));
    for (const id of ['a-signal', 'a-praeco', 'a-plain']) expect(offered).not.toContain(id);
  });

  test('the CMO seat is matched by its title, its position or its full name — and nothing else', () => {
    for (const word of ['Legatus', ' legatus ', 'CMO', 'chief marketing officer']) expect(isMarketingTitle(word)).toBe(true);
    for (const word of ['Praeco', 'CCO', 'Marketing', '', null, undefined, 42]) expect(isMarketingTitle(word)).toBe(false);
  });

  test('a being is offered once, under its strongest seat', () => {
    const offered = holderCandidates({ ...A, crew: [{ neumaId: 'a-keir' }, { neumaId: 'a-galen' }] });
    expect(ids(offered)).toEqual(['a-keir', 'a-galen']);
    expect(offered.map((c) => c.seat)).toEqual(['CMO', 'LEGATUS']);
  });
});

describe('the default holder', () => {
  test('keys set, no holder, a CMO seated: the CMO is bound automatically', () => {
    const s = holderStanding({ channel: keyed, ...A, released: false });
    expect(s.state).toBe('auto');
    expect(s.autoBind).toBe('a-keir');
    expect(s.cmo).toMatchObject({ neumaId: 'a-keir', name: 'Keir', seat: 'CMO' });
  });

  test('no keys yet: the CMO waits for them — nothing is bound, nothing blocks on the holder', () => {
    const s = holderStanding({ channel: { configured: false, binding: null }, ...A, released: false });
    expect(s).toMatchObject({ state: 'awaiting-keys', autoBind: null, blocked: false });
  });

  test('a standing binding is never overridden — it is shown with its seat', () => {
    const s = holderStanding({ channel: { configured: true, binding: { neumaId: 'a-galen' } }, ...A, released: false });
    expect(s).toMatchObject({ state: 'held', autoBind: null, blocked: false });
    expect(s.holder).toMatchObject({ neumaId: 'a-galen', name: 'Galen', seat: 'LEGATUS' });
  });

  test('a holder bound before the rule, outside marketing, reads honestly as no marketing seat', () => {
    const s = holderStanding({ channel: { configured: true, binding: { neumaId: 'a-signal' } }, ...A, released: false });
    expect(s.holder).toMatchObject({ neumaId: 'a-signal', name: 'Signal', seat: null });
  });

  test('released here: the CMO is not re-bound behind the operator', () => {
    const s = holderStanding({ channel: keyed, ...A, released: true });
    expect(s).toMatchObject({ state: 'released', autoBind: null, blocked: true });
  });
});

describe('the house with no CMO', () => {
  test('no CMO and no holder: the no-seat state, nothing auto-bound, posting blocked', () => {
    const s = holderStanding({ channel: keyed, ...A, cmoLaneId: null, released: false });
    expect(s).toMatchObject({ state: 'no-seat', cmo: null, autoBind: null, blocked: true });
    // the Legatus and the crew stay offered for a deliberate change
    expect(ids(s.offered)).toEqual(['a-galen', 'witness-xai-Basunor']);
  });

  test('a house with no marketing seat at all offers no one', () => {
    const s = holderStanding({ channel: keyed, roster: B.roster.slice(1), cmoLaneId: null, crew: [], released: false });
    expect(s.state).toBe('no-seat');
    expect(s.offered).toEqual([]);
  });
});

describe('two houses never mixed', () => {
  test("a CMO record naming another house's lane seats no one here, and binds no one", () => {
    const s = holderStanding({ channel: keyed, roster: B.roster, cmoLaneId: A.cmoLaneId, crew: [], released: false });
    expect(s).toMatchObject({ state: 'no-seat', cmo: null, autoBind: null });
    expect(ids(s.offered)).not.toContain('a-keir');
  });

  test("each house's window offers and binds only its own CMO", () => {
    const inA = holderStanding({ channel: keyed, ...A, released: false });
    const inB = holderStanding({ channel: keyed, ...B, released: false });
    expect(inA.autoBind).toBe('a-keir');
    expect(inB.autoBind).toBe('b-sol');
    expect(ids(inB.offered)).toEqual(['b-sol']);
    expect(ids(inA.offered).some((id) => id.startsWith('b-'))).toBe(false);
  });

  test("a crew entry naming another house's lane is never offered", () => {
    const offered = holderCandidates({ ...B, crew: [{ neumaId: 'a-galen' }, { neumaId: 'witness-xai-Basunor' }] });
    expect(ids(offered)).toEqual(['b-sol']);
  });
});

describe('the keys fact', () => {
  test('unset and refused block; set is ready unproven; proven names the account', () => {
    expect(keysStanding({ configured: false }, null)).toEqual({ state: 'unset', account: null, blocked: true });
    expect(keysStanding({ configured: true }, { ok: false, detail: 'bad token' })).toEqual({ state: 'failing', account: null, blocked: true });
    expect(keysStanding({ configured: true }, null)).toEqual({ state: 'set', account: null, blocked: false });
    expect(keysStanding({ configured: true }, { ok: true, account: { name: 'ignis' } }))
      .toEqual({ state: 'proven', account: '@ignis', blocked: false });
  });
});
