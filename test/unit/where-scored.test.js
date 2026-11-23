/**
 * What the first sales bench taught the screen (2026-11-21, a fixed batch of 22 real companies through the real
 * pipeline): a sign that only asks WHERE a company is must never sink a fit whose country is simply not on its site
 * (Hack VC); a required sign is proved from any page read, each quote filed with the page it stands on (Archetype);
 * and a company's legal pages are where its country is looked for last.
 */
import { describe, test, expect } from 'vitest';
import { whereScored, filingOf } from '../../backend/services/sales/lead-run-shape.js';
import { legalUrls, readLegalPages } from '../../backend/services/sales/where-pages.js';
import { writeMessages, readWriting, cardName, personOfLead } from '../../backend/services/sales/lead-run-write-shape.js';

const segment = { name: 'Crypto funds', countries: ['US', 'SG'], positiveCriteria: ['Active crypto fund', 'Operates in an allowed country'], negativeCriteria: [], required: [{ sign: 'It invests in crypto', evidence: ['crypto', 'web3'] }] };
const scores = (second) => [{ criterion: 'Active crypto fund', score: 3, reasoning: 'a venture firm investing in crypto' }, { criterion: 'Operates in an allowed country', score: second, reasoning: 'the page names no country at all' }];

describe('what the sales bench taught the screen', () => {
  test('the country sign is scored by the record: allowed 5, not allowed 0, not known 3 and never counted against it', () => {
    expect(whereScored({ scores: scores(0) }, segment).scores[1]).toEqual({ criterion: 'Operates in an allowed country', score: 3, reasoning: 'its pages do not say where it is: country still to find, not counted against it' });
    expect(whereScored({ country: 'SG', scores: scores(0) }, segment).scores[1]).toMatchObject({ score: 5, reasoning: 'it is in SG, a country this audience writes to' });
    expect(whereScored({ country: 'IL', scores: scores(5) }, segment).scores[1]).toMatchObject({ score: 0, reasoning: 'it is in IL, not a country this audience writes to' });
    expect(whereScored({ scores: scores(0) }, segment).scores[0].score).toBe(3);
    // An audience that names no countries scores nothing by them.
    expect(whereScored({ scores: scores(0) }, { ...segment, countries: [] }).scores[1].score).toBe(0);
  });

  test('a required sign is proved from any page read, and the quote is filed with the page it stands on', () => {
    const answer = { name: 'Arch', what: 'A venture firm.', country: null, scores: { F1: { score: 3, why: 'a venture firm investing in crypto' }, F2: { score: 0, why: 'the page names no country at all' } } };
    const company = { domain: 'arch.example', name: 'Arch' };
    const home = 'Arch\nWe back founders early.';
    const one = filingOf({ segment, company, answer, text: home, url: 'https://arch.example/', funding: false });
    expect(one.company.proofs[0]).toMatchObject({ met: false, reasoning: expect.stringMatching(/^nothing on https:\/\/arch\.example\/ says it/) });
    const two = filingOf({ segment, company, answer, text: home, url: 'https://arch.example/', funding: false, pages: [{ url: 'https://arch.example/', text: home }, { url: 'https://arch.example/about', text: 'About\nWe are an early-stage firm investing in crypto networks and their founders.' }] });
    expect(two.company.proofs[0]).toEqual({ sign: 'It invests in crypto', met: true, quote: 'We are an early-stage firm investing in crypto networks and their founders.', source: 'https://arch.example/about' });
  });

  test('a company\'s legal pages: the ones its home page links to first, then the usual addresses; the first two that answer', async () => {
    const html = '<a href="/important-disclosures">Disclosures</a><a href="https://other.example/privacy">x</a><a href="/terms#top">Terms</a>';
    expect(legalUrls(html, 'fund.example').slice(0, 4)).toEqual(['https://fund.example/important-disclosures', 'https://fund.example/terms', 'https://fund.example/privacy', 'https://fund.example/privacy-policy']);
    const asked = [];
    const fetchPage = async (url) => { asked.push(url); return url.endsWith('/terms') ? { ok: true, html: `<p>${'These terms are governed by the laws of the Cayman Islands. '.repeat(6)}</p>` } : { ok: false, why: 'it answered 404' }; };
    const text = await readLegalPages('fund.example', { fetchPage, homeHtml: html, words: (h) => h.replace(/<[^>]+>/g, '') });
    expect(text).toContain('governed by the laws of the Cayman Islands');
    expect(asked).toHaveLength(6);
  });

  test('the writer is asked with the plan, the only facts it may state and what the campaign already said; its answer is read as the acts take it', () => {
    const plan = { need: 'A live venue', offer: 'A live DLMM', asks: [{ ask: 'Shall I send the deck?', delivers: 'the deck' }] };
    const [system, user] = writeMessages({ campaign: { name: 'Raise', goal: 'Investors' }, plan, ours: 'Umbrae', facts: [{ claim: 'We are raising 500,000 US dollars on a SAFE' }], funding: true, person: { name: 'Fund team', role: 'general address' }, email: 'hello@fund.example',
      company: { name: 'Fund', domain: 'fund.example' }, text: 'We invest in crypto.', url: 'https://fund.example/', refusal: 'the email was refused: 65 is not on the approved facts sheet', others: [{ hook: 'You led a round.', offer: 'LPs keep the fee.' }] });
    expect(system.content).toContain('THE ONLY THINGS YOU MAY SAY ABOUT UMBRAE (a claim or a figure that is not here is refused):\n  1. We are raising 500,000 US dollars on a SAFE');
    expect(system.content).toContain('NO NUMBER ANYWHERE IN THE EMAIL unless the list above states it');
    expect(system.content).toContain('never a "seed round" or a "Series" the list does not state');
    expect(system.content).toContain('the size of the checks they usually write is never a reason for no');
    expect(system.content).toContain('ALREADY WRITTEN TO OTHER PEOPLE IN THIS CAMPAIGN');
    expect(system.content).toContain('  hook: You led a round.\n  offer: LPs keep the fee.');
    expect(user.content).toContain('THE PERSON: Fund team, general address <hello@fund.example> — a general mailbox: write to the team, not to a named person');
    expect(user.content).toMatch(/YOUR LAST ANSWER WAS REFUSED: the email was refused: 65 is not on the approved facts sheet\nAnswer again, whole, with exactly that fixed\.$/);
    expect(readWriting('Sure: {"what": "A fund.", "now": "x", "need": "y", "fit": {"verdict": "NO", "why": ""}, "askIndex": "1"}')).toMatchObject({ fit: { verdict: 'no', why: 'their page does not show who this campaign is for' }, email: { askIndex: 1, hook: '' } });
    expect(readWriting('{"fit": {"verdict": "maybe"}}')).toBeNull();
    expect([cardName({ name: 'Mint Ventures XYZ team', role: 'general address' }, 'Mint Ventures XYZ'), cardName({ name: 'Jock' }, 'Lightning Capital'), cardName({ name: '', role: '' }, 'A Very Long Company Name Indeed Ltd'), cardName({ name: 'Ada Lovelace', role: 'General Partner' }, 'X')]).toEqual(['Mint Ventures XYZ team', 'Jock of Lightning', 'A Very Long Company team', 'Ada Lovelace']);
    expect(personOfLead({ name: 'Ada Lovelace, General Partner at Analytical, Inc.' })).toEqual({ name: 'Ada Lovelace', role: 'General Partner' });
  });
});
