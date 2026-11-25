/**
 * SAID TWICE (sales/said-twice.js) — Design note, 2026-11-21: […]. The cases are
 * emails the house really staged: each passed every check of its day.
 */
import { describe, test, expect } from 'vitest';
import { saidTwice } from '../../backend/services/sales/said-twice.js';
import { checkFormula, makeEmailPlan, makeResearch } from '../../backend/services/sales/email-formula.js';

describe('said twice', () => {
  test('a figure stated in two sentences is said twice; the ask may name the sum it is about', () => {
    const twice = saidTwice(['You back onchain market infrastructure, where liquidity providers keep 95% of every swap fee.', 'It is live today.', 'Umbrae is a DLMM on Base. LPs keep 95% of swap fees.', 'Shall I send the deck?']);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatch(/^95% is stated twice \("You back onchain .*" and "LPs keep 95% of swap fees\."\) — say it once$/);
    expect(saidTwice(['You led the round for Morpho in June.', 'A live venue matters to that thesis now.', 'We are raising $500,000 via SAFE to deepen liquidity.', 'Shall I send the deck and the $500,000 SAFE terms?'])).toEqual([]);
    expect(saidTwice(['We raised $500K last year.', 'x y z', 'We are raising a $500k SAFE now.', 'Shall I send it?'])[0]).toMatch(/^\$500k is stated twice/);
  });

  test('two sentences that make one point are said twice; two that share a word or two are not', () => {
    const paradigm = saidTwice(['You co-led Morpho to move credit markets onchain. You back the protocols that move real markets onchain.', 'You back onchain market infrastructure, and this is a live DLMM you can check before you commit.', 'Positions are minted as NFTs to the wallet of the provider.', 'Shall I send the deck?']);
    expect(paradigm).toEqual([expect.stringMatching(/^two sentences make the same point \("You back the protocols that move real markets onchain\." and "You back onchain market infrastructure.*"\) — keep the stronger one$/)]);
    expect(saidTwice(['Deus Neuma is a free, open-source local AI harness that runs on your own computer and keeps your work there.', 'Your studio ships tools for creators.', 'Deus Neuma is a free, open-source local AI harness.', 'Shall I send the download?'])).toHaveLength(1);
    // Different points that happen to share a word.
    expect(saidTwice(['You co-founded MPower Partners, the first ESG-integrated global venture fund in Japan.', 'Your global tech mandate is where AI is being put to work first.', 'Deus Neuma runs open models on the computer a team already owns.', 'Shall I send the deck?'])).toEqual([]);
    expect(saidTwice('One plain sentence about one thing only.')).toEqual([]);
  });

  test('the formula refuses an email that says something twice, naming both sentences', () => {
    const plan = makeEmailPlan({ objective: 'customers', need: 'A place to run their own models privately', offer: 'A free local AI harness that runs open models on their own computers', asks: [{ ask: 'Shall I send the download and a setup guide?', delivers: 'the download link and the setup guide' }], signature: 'Merc\nSales, Deus Neuma' });
    const card = makeResearch({ email: 'ada@studio.example', name: 'Ada Lovelace', role: 'Founder', company: 'Studio', what: 'A studio that ships creative tools for filmmakers', now: 'Launched a render pipeline for independent filmmakers in October 2026', need: 'Private compute for the footage of their clients', sources: ['https://studio.example/'] });
    const fields = { subject: 'Local AI for Your Team', hook: 'You launched a render pipeline for independent filmmakers in October.', why: 'Footage of clients should never leave the building.', offer: 'Deus Neuma is a free local harness that runs open models on your own computers. Deus Neuma is a free local harness for open models.', ask: 'Shall I send the download and a setup guide?', askIndex: 0 };
    expect(checkFormula(fields, { card, plan, company: 'Deus Neuma' })).toEqual([expect.stringMatching(/^two sentences make the same point/)]);
    expect(checkFormula({ ...fields, offer: 'Deus Neuma is a free local harness that runs open models on your own computers.' }, { card, plan, company: 'Deus Neuma' })).toEqual([]);
  });
});
