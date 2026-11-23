// THE LEAD RUN, its pure parts (sales/lead-run-shape.js). Design note, 2026-11-21: […] Each rule here was set by a trial
// of the run on the house's own gathered companies. The run itself, end to end, is in lead-providers-pipeline.test.js.
import { describe, it, expect } from 'vitest';
import { sound, whereMessages, TEXT_MAX, pageWords, sentencesOf, sentenceWith, investingSentence, countryOn, screenMessages, readAnswer, filingOf, definingFit, belongsElsewhere, firstToWrite, runWords } from '../../backend/services/sales/lead-run-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';

const segment = {
  id: 's-fund', name: 'Crypto funds', offer: 'A DLMM for the tokens they back', customerProblem: 'Thin liquidity',
  positiveCriteria: ['Active crypto fund with a portfolio of token projects', 'Has a public portfolio or thesis page'],
  negativeCriteria: ['Token project or community (goes to User Acquisition)'], required: [], countries: ['US'], targetRole: 'Fund partner or general partner',
};
const HTML = '<html><head><title>Fund Alpha</title><script>var x = "we invest in nothing";</script></head><body><h1>Fund Alpha</h1><p>We invest in early crypto networks and the teams building them.</p><p>Our portfolio spans forty token projects on Base.</p><p>1 Market St, San Francisco, CA 94105</p></body></html>';
const text = pageWords(HTML);
const answer = { name: 'Fund Alpha', what: 'A venture fund for early crypto networks.', country: null, scores: { F1: { score: 5, why: 'the page says it invests in crypto networks' }, F2: { score: 4, why: 'the page lists a portfolio of forty projects' }, D1: { score: 0, why: 'it is a fund, not a token project' } }, type: 'vc-fund', typeQuote: 'We invest in early crypto networks and the teams building them.' };

describe('a page as its own words', () => {
  it('scripts are not words; a sentence is quoted whole; the company\'s name is never the evidence', () => {
    expect(text).not.toContain('we invest in nothing');
    expect(sentencesOf(text)).toContain('We invest in early crypto networks and the teams building them.');
    expect(sentenceWith(text, ['base'], 'Fund Alpha')).toBe('Our portfolio spans forty token projects on Base.');
    expect(sentenceWith('Base Labs builds wallets for everyday users. Nothing else is said here.', ['base'], 'Base Labs')).toBeNull();
    expect(sentenceWith('A database of markets, based on community votes.', ['base'], 'X')).toBeNull();
    expect(investingSentence('Techstars is a network of founders. We invest in founders at the earliest stage.', 'Techstars')).toBe('We invest in founders at the earliest stage.');
    expect(investingSentence('Seed Labs builds wallets for everyday users.', 'Seed Labs')).toBeNull(); // "seed" in its name proves nothing
  });

  it('where it is: the one country its pages name; a firm listing offices around the world has not said', () => {
    expect([countryOn(text), countryOn('Zug, Switzerland'), countryOn('Offices in London, Singapore, Tokyo and New York'), countryOn('We build things.')]).toEqual(['US', 'CH', null, null]);
  });
});

describe('the screener\'s question and its answer', () => {
  it('asks from the page alone, signs by number, and what the company IS only for a funding audience', () => {
    const [system, user] = screenMessages({ segment, company: { name: 'Fund Alpha', domain: 'fundalpha.example' }, text, funding: true });
    expect(system.content).toContain('Use ONLY the page text given');
    expect(user.content).toContain('F1. Active crypto fund with a portfolio of token projects');
    expect(user.content).toContain('D1. Token project or community (goes to User Acquisition)');
    expect(user.content).toContain('"typeQuote"');
    expect(screenMessages({ segment, company: { name: 'X', domain: 'x.example' }, text, funding: false })[1].content).not.toContain('"typeQuote"');
  });

  it('the JSON is read out of whatever stands around it; what is not JSON is nothing', () => {
    expect(readAnswer(`Sure, here it is:\n${JSON.stringify(answer)}\nDone.`)).toEqual(answer);
    expect([readAnswer('I could not decide.'), readAnswer('{broken'), readAnswer('[1, 2]')]).toEqual([null, null, null]);
  });

  it('becomes the very filing sales/prospect takes: every sign scored with why, the country read off the page, what it is proved by the page\'s own investing words', () => {
    const made = filingOf({ segment, company: { domain: 'fundalpha.example', name: 'Fund Alpha' }, answer, text, url: 'https://fundalpha.example/', funding: true });
    expect(made).toEqual({ ok: true, company: {
      domain: 'fundalpha.example', name: 'Fund Alpha', description: 'A venture fund for early crypto networks.', country: 'US', source: 'https://fundalpha.example/',
      scores: [{ criterion: segment.positiveCriteria[0], score: 5, reasoning: 'the page says it invests in crypto networks' }, { criterion: segment.positiveCriteria[1], score: 4, reasoning: 'the page lists a portfolio of forty projects' }, { criterion: segment.negativeCriteria[0], score: 0, reasoning: 'it is a fund, not a token project' }],
      entityType: 'vc-fund', entityEvidence: { quote: 'We invest in early crypto networks and the teams building them.', source: 'https://fundalpha.example/' },
    } });
    // The shape law takes it as it is.
    expect(makeProspect({ ...made.company, segment, by: 'merc', now: '2026-11-21T00:00:00Z' })).toMatchObject({ match: 3, country: 'US' });
  });

  it('a quote the screener made up is not used: the page\'s own sentence is; a sign left without a reason is no filing', () => {
    const lied = filingOf({ segment, company: { domain: 'fundalpha.example', name: 'Fund Alpha' }, answer: { ...answer, typeQuote: 'We are the largest crypto fund in the world by far.' }, text, url: 'https://fundalpha.example/', funding: true });
    expect(lied.company.entityEvidence.quote).toBe('We invest in early crypto networks and the teams building them.');
    expect(filingOf({ segment, company: { domain: 'x.example', name: 'X' }, answer: { ...answer, scores: { F1: { score: 5, why: 'yes' } } }, text, url: 'https://x.example/', funding: false })).toEqual({ ok: false, why: 'the screener left a sign of fit without a score and a reason' });
    expect(filingOf({ segment, company: { domain: 'x.example', name: 'X' }, answer: {}, text, url: 'https://x.example/', funding: false }).ok).toBe(false);
  });

  it('what the audience REQUIRES is proved from the page, never by the screener: its sentence holding an evidence word, or not met', () => {
    const must = { ...segment, required: [{ sign: 'its token or project is on Base or Robinhood Chain', evidence: ['base', 'robinhood'], otherwise: null }] };
    const on = filingOf({ segment: must, company: { domain: 'fundalpha.example', name: 'Fund Alpha' }, answer, text, url: 'https://fundalpha.example/', funding: false });
    expect(on.company.proofs).toEqual([{ sign: must.required[0].sign, met: true, quote: 'Our portfolio spans forty token projects on Base.', source: 'https://fundalpha.example/' }]);
    const off = filingOf({ segment: must, company: { domain: 'x.example', name: 'X' }, answer, text: 'We run a staking service on Solana for institutions.', url: 'https://x.example/', funding: false });
    expect(off.company.proofs[0]).toMatchObject({ met: false, reasoning: expect.stringContaining('none of its sentences holds "base" or "robinhood"') });
  });
});

describe('who a run pursues, and where the others go', () => {
  it('the audience\'s first sign is what the company IS: under 3 on it, a company is never pursued, whatever the rest averages to', () => {
    expect(definingFit({ match: 2, fit: [{ score: 0 }, { score: 5 }, { score: 5 }] })).toBe(false); // a private-equity firm with a portfolio page
    expect(definingFit({ match: 2, fit: [{ score: 3 }, { score: 2 }] })).toBe(true);
    expect(definingFit({ match: 1, fit: [{ score: 5 }] })).toBe(false);
    expect(definingFit(null)).toBe(false);
  });

  it('a no-fit goes where the audience itself says such a company goes', () => {
    const others = [{ id: 's-ua', name: 'Token Projects on Base & Robinhood', campaignName: 'Umbrae — User Acquisition' }, { id: 's-lp', name: 'LPs & Market Makers', campaignName: 'Umbrae — Liquidity Provision' }];
    expect(belongsElsewhere({ misfit: [{ criterion: 'Token project or community (goes to User Acquisition)', score: 5 }] }, others)?.id).toBe('s-ua');
    expect(belongsElsewhere({ misfit: [{ criterion: 'Token project or community (goes to User Acquisition)', score: 2 }] }, others)).toBeNull();
    expect(belongsElsewhere({ misfit: [{ criterion: 'Too small to matter', score: 5 }] }, others)).toBeNull();
  });

  it('who is written to first: a confirmed address, then the role the audience is aimed at, then seniority; a named person before a general mailbox', () => {
    const people = [
      { name: 'Team', role: 'general address', email: 'hello@f.example', general: true }, { name: 'Ana', role: 'Analyst', email: 'ana@f.example' },
      { name: 'Bo', role: 'General Partner', email: 'bo@f.example' }, { name: 'Cy', role: 'Associate', email: 'cy@f.example', checked: 'valid' }, { name: 'No Address', role: 'Founder' },
    ];
    expect(firstToWrite(people, segment.targetRole).map((p) => p.name)).toEqual(['Cy', 'Bo', 'Ana', 'Team']);
  });

  it('says where a run stands in one line', () => {
    expect(runWords({ looked: 169, dead: 26, screened: 139, fit: 25, weak: 73, nofit: 41, moved: 2, unclear: 4, leads: 14, noAddress: 11 }))
      .toBe('169 looked at · 26 dead or unreadable · 139 screened (25 a fit, 73 a fit only on the side signs, 41 no fit, 2 moved to the audience they belong to) · 4 could not be screened · 14 lead(s) with a confirmed address · 11 a fit with no confirmed address yet');
  });
});

describe('a page cut in the middle of a character can still be sent', () => {
  it('half an emoji left by the cut is replaced, so the request is always readable JSON', () => {
    const half = `${'x'.repeat(10)}\u{1F680}`.slice(0, 11); // the cut lands inside the rocket
    expect(/[\uD800-\uDBFF]$/.test(half)).toBe(true);
    expect(sound(half)).toBe(`${'x'.repeat(10)}\uFFFD`);
    expect(sound('whole \u{1F680} text')).toBe('whole \u{1F680} text');
    const segment = { name: 'A', positiveCriteria: ['invests'], negativeCriteria: [] };
    // The page is longer than the screener reads, with an emoji exactly where it is cut.
    const text = `${'a'.repeat(TEXT_MAX - 1)}\u{1F680}${'word '.repeat(2000)}`;
    expect(text.slice(0, TEXT_MAX).isWellFormed()).toBe(false);
    for (const messages of [screenMessages({ segment, company: { name: 'X', domain: 'x.example' }, text, funding: false }), whereMessages({ company: { name: 'X', domain: 'x.example' }, text })]) {
      for (const m of messages) expect(m.content.isWellFormed()).toBe(true);
      expect(() => JSON.parse(JSON.stringify({ messages }))).not.toThrow();
    }
  });
});
