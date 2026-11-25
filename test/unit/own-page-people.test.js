// The people a company's own page names (backend/services/sales/own-page-people.js). RULE 0: the real module; no mocks.
import { describe, expect, it } from 'vitest';
import { peopleMessages, readPeople, reachWords } from '../../backend/services/sales/own-page-people.js';

const PAGE = `Alder Finance is a lending market on Base.
Team. Dana Reyes, Co-Founder and CEO. Otto Brandt — Head of Engineering. Advised by Noel Park of Birch Capital.
"The best market we have used", says Ivo Lindqvist, a customer.`;

describe('who a company\'s own page names as leading it', () => {
  it('keeps only a name the page itself carries, the most senior first, and never the company\'s own name', () => {
    const answer = 'Otto Brandt | Head of Engineering\n1. Dana Reyes | Co-Founder and CEO\nSatoshi Nakamoto | Founder\nAlder Finance | company\n- dana reyes | CEO again\nMadonna | singer\nIvo Lindqvist';
    expect(readPeople(answer, PAGE, { name: 'Alder Finance' })).toEqual([
      { name: 'Otto Brandt', role: 'Head of Engineering' }, // "head of" and "ceo" are both top roles: the answer's order stands among them
      { name: 'Dana Reyes', role: 'Co-Founder and CEO' },
      { name: 'Ivo Lindqvist', role: 'role not stated' },   // on the page, with no role: last
    ]);
  });

  it('an answer of NONE, an empty answer, or a failed one names nobody', () => {
    for (const none of ['NONE', '', null, 'The page names no such person.']) expect(readPeople(none, PAGE)).toEqual([]);
  });

  it('the question carries the page and says to copy, never to guess', () => {
    const [system, user] = peopleMessages({ company: { name: 'Alder Finance', domain: 'alder.example' }, text: PAGE });
    expect(system.content).toMatch(/never guess/);
    expect(user.content).toContain('Dana Reyes, Co-Founder and CEO');
    expect(user.content).toMatch(/single word NONE/);
  });

  it('says where a company with no address can be reached by hand, Telegram first', () => {
    expect(reachWords({ x: 'https://x.com/alderfi', telegram: 'https://t.me/alderfi', github: 'https://github.com/alder' })).toBe('Telegram https://t.me/alderfi · X https://x.com/alderfi · Github https://github.com/alder');
    expect(reachWords({})).toBe('');
    expect(reachWords(undefined)).toBe('');
  });
});
