/**
 * TOP FIRST (top-first.js) — Design note, 2026-11-16: […] Whom the house writes to at a company, and whom next when they stay silent. Pure, over the
 * record shapes the lookups and the ledger really keep.
 */
import { describe, expect, it } from 'vitest';
import { rankOf, topFirst, peopleByCompany, nextUp, TOP_FIRST_RULE } from '../../backend/services/sales/top-first.js';
import { upkeepDue, UPKEEP_ASK, MAX_TOUCHES } from '../../backend/services/sales/lead-upkeep.js';
import { peopleOfHunter } from '../../backend/services/sales/lead-providers.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-30T12:00:00Z');

describe('the people of a company, top first', () => {
  it('the founder or chief executive, then the chiefs, then the heads of what the house sells into, then other heads', () => {
    const ranked = topFirst([
      { name: 'Eve', role: 'Software Engineer', email: 'eve@x.io' },
      { name: 'Dan', role: 'Head of Engineering', email: 'dan@x.io' },
      { name: 'Cal', role: 'Head of Strategic Partnerships', email: 'cal@x.io' },
      { name: 'Bea', role: 'CTO', email: 'bea@x.io' },
      { name: 'Ari', role: 'Co-Founder & CEO', email: 'ari@x.io' },
      { name: 'Fay', role: 'Analyst', email: 'fay@x.io', decisionMaker: true },
    ]);
    expect(ranked.map((p) => p.name)).toEqual(['Ari', 'Bea', 'Cal', 'Dan', 'Fay', 'Eve']);
    expect(rankOf({ role: 'Managing Director' })).toBe(0);
    expect(rankOf({ role: 'Partnerships Manager' })).toBe(4);
  });

  it('Hunter\'s answer comes back top first, its decision makers marked', () => {
    const people = peopleOfHunter({ data: { emails: [
      { value: 'dev@x.io', first_name: 'Dev', last_name: 'One', position: 'Developer', confidence: 99, verification: { status: 'valid' }, sources: [{ uri: 'https://x.io/team' }] },
      { value: 'ceo@x.io', first_name: 'Chief', last_name: 'Two', position: 'Founder', confidence: 80, decision_maker: true, sources: [{ uri: 'https://x.io/about' }] },
    ] } });
    expect(people.map((p) => [p.name, p.decisionMaker])).toEqual([['Chief Two', true], ['Dev One', false]]);
  });
});

describe('when the top one stays silent, the next one up', () => {
  const held = peopleByCompany([
    { domain: 'x.io', people: [{ name: 'Bea', role: 'CTO', email: 'bea@x.io' }, { name: 'Ari', role: 'Founder', email: 'ari@x.io' }] },
    { domain: 'x.io', people: [{ name: 'Cal', role: 'Head of Partnerships', email: 'cal@x.io' }, { name: 'Ari', role: 'Founder', email: 'ari@x.io' }] },
  ]);
  const silent = (contact) => ({
    id: `l-${contact}`, name: contact, contact, status: 'contacted', kind: 'buyer', createdAt: new Date(NOW - 20 * DAY).toISOString(),
    touches: Array.from({ length: MAX_TOUCHES }, (_, i) => ({ direction: 'out', at: new Date(NOW - (12 - i * 3) * DAY).toISOString() })),
  });

  it('every lookup of a company folds into one list, top first, one row an address', () => {
    expect(held.get('x.io').map((p) => p.name)).toEqual(['Ari', 'Bea', 'Cal']);
    expect(nextUp({ contact: 'ari@x.io' }, held, new Set(['ari@x.io']))).toMatchObject({ name: 'Bea' });
  });

  it('three emails unanswered at the top: the next person up at the company is named, not the company closed', () => {
    const [item] = upkeepDue({ leads: [silent('ari@x.io')], now: NOW, held });
    expect(item).toMatchObject({ kind: 'next-up', domain: 'x.io', next: { name: 'Bea', role: 'CTO', email: 'bea@x.io' } });
    expect(UPKEEP_ASK['next-up']).toMatch(/write to the next person at their company/);
  });

  it('nobody already on the list is named twice; nobody left, or nobody held, closes it out', () => {
    const [both] = upkeepDue({ leads: [silent('ari@x.io'), { ...silent('bea@x.io'), touches: [] , status: 'cold' }], now: NOW, held });
    expect(both).toMatchObject({ kind: 'next-up', next: { name: 'Cal' } });
    const all = ['ari@x.io', 'bea@x.io', 'cal@x.io'].map((c, i) => (i ? { ...silent(c), status: 'cold', touches: [] } : silent(c)));
    expect(upkeepDue({ leads: all, now: NOW, held })[0]).toMatchObject({ kind: 'close-out' });
    expect(upkeepDue({ leads: [silent('ari@x.io')], now: NOW })[0]).toMatchObject({ kind: 'close-out' });
  });

  it('someone on the do-not-contact list is never the next one up', () => {
    const [item] = upkeepDue({ leads: [silent('ari@x.io')], now: NOW, held, suppressed: (c) => c === 'bea@x.io' });
    expect(item).toMatchObject({ kind: 'next-up', next: { name: 'Cal' } });
  });
});

it('the rule the seat reads says top first, whatever the size, and down the team after silence', () => {
  expect(TOP_FIRST_RULE).toMatch(/^Write to the TOP first: the founder or chief executive, whatever the company's size/);
  expect(TOP_FIRST_RULE).toMatch(/write to the next person at the same company, top first/);
});
