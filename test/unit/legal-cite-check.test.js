/**
 * The platform's citation check, judged on real page text (cite-check.js's
 * judgeRecord and printsHeading are pure: real inputs, real outputs, no mock
 * — RULE 0). The pages are excerpts the real page reader returned on
 * 2026-10-31 for the sources a citation audit traced; the wired path over the
 * real web is legal-citation-law.test.js.
 */
import { describe, it, expect } from 'vitest';
import { judgeRecord, printsHeading } from '../../backend/services/legal/cite-check.js';

// legislation.gov.uk, FSMA 2000 s. 25 (excerpt, as read).
const FSMA_25 = Object.freeze({
  ok: true, title: 'Financial Services and Markets Act 2000', truncated: false,
  text: 'Sch. 19D inserted by S.I. 2026/480 Sch.\n25 Contravention of section 21. U.K.\nThis section has no associated Explanatory Notes\n(1) A person who contravenes section 21(1) is guilty of an offence and liable—\n(a) on summary conviction, to imprisonment for a term not exceeding six months or a fine not exceeding the statutory maximum, or both;',
});
// law.cornell.edu, 15 U.S.C. § 77b (excerpt, as read — note the spaced quotes and commas).
const USC_77B = Object.freeze({
  ok: true, truncated: false,
  title: '15 U.S. Code &sect; 77b - Definitions; promotion of efficiency, competition, and capital formation | U.S. Code | US Law | LII / Legal Information Institute',
  text: '(a) Definitions When used in this subchapter, unless the context otherwise requires—\n(1)\nThe term “ security ” means any note, stock, treasury stock, security future , security-based swap , bond, debenture, evidence of indebtedness, certificate of interest or participation in any profit-sharing agreement',
});
// sec.gov, Rel. 33-11412: page 24 read alone, and its first page.
const RELEASE_P24 = Object.freeze({
  ok: true, title: 'PDF, 68 pages; showing pages 24-24', truncated: false,
  text: '[Page 24]\na separate security that derives its value from or is otherwise linked to the subject security. \nA security is a security regardless of whether it is issued, or otherwise represented,\noffchain or onchain. All devices and instruments that have the economic characteristics of a\nsecurity are securities regardless of format or label.',
});
const RELEASE_P1 = Object.freeze({
  ok: true, title: 'PDF, 68 pages; showing pages 1-1', truncated: false,
  text: '[Page 1]\nRIN 3038-AF67 \nApplication of the Federal Securities Laws to Certain Types of Crypto Assets and Certain\nTransactions Involving Crypto Assets \nAGENCY:   Securities and Exchange Commission; Commodity Futures Trading Commission \n',
});

const record = (over) => ({
  claim: 'a point', authority: 'an authority', pinCite: 'a pin cite', standing: 'in force',
  sourceUrl: 'https://example.org/law', heading: 'Contravention of section 21', ...over,
});

describe('the heading is the one the source prints, as a heading', () => {
  it('a provision\'s own line carries its heading', () => {
    expect(printsHeading(FSMA_25, 'Contravention of section 21')).toBe(true);
    expect(printsHeading(FSMA_25, 'Dealing in investments as a business')).toBe(false);
  });

  it('the page title carries it too (a section page names its section)', () => {
    expect(printsHeading(USC_77B, 'Definitions; promotion of efficiency, competition, and capital formation')).toBe(true);
  });

  it('a title wrapped over two lines still reads as the heading', () => {
    expect(printsHeading(RELEASE_P1, 'Application of the Federal Securities Laws to Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets')).toBe(true);
  });

  it('a phrase inside a paragraph is not a heading', () => {
    expect(printsHeading(FSMA_25, 'guilty of an offence')).toBe(false);
    expect(printsHeading(USC_77B, 'evidence of indebtedness')).toBe(false);
  });
});

describe('every record judged against its page', () => {
  it('the invented quotation is caught; the release\'s own words pass, its title read from page one', () => {
    const release = record({ heading: 'Application of the Federal Securities Laws to Certain Types of Crypto Assets', pages: '24' });
    const invented = judgeRecord({ ...release, quote: 'Digital securities are tokenized versions of financial instruments that fall within the statutory definition of \'security.\' Tokenization does not alter the analysis.' }, RELEASE_P24, RELEASE_P1);
    expect(invented.verdict).toBe('quote-missing');
    expect(invented.note).toMatch(/^these words are not on the page: "Digital securities/);
    const real = judgeRecord({ ...release, quote: 'A security is a security regardless of whether it is issued, or otherwise represented, offchain or onchain.' }, RELEASE_P24, RELEASE_P1);
    expect(real).toEqual({ verdict: 'verified', note: 'heading and every quoted word found' });
    // Without the first page, page 24 alone does not print the release's title.
    expect(judgeRecord({ ...release, quote: 'A security is a security regardless of whether it is issued' }, RELEASE_P24).verdict).toBe('heading-missing');
  });

  it('words the statute does not say are caught, through its typography (the audit\'s "evidence of ownership")', () => {
    const security = record({ heading: 'Definitions; promotion of efficiency, competition, and capital formation' });
    expect(judgeRecord({ ...security, quote: 'any note, stock, treasury stock, security future, security-based swap, bond' }, USC_77B).verdict).toBe('verified');
    expect(judgeRecord({ ...security, quote: 'any stock and any evidence of ownership' }, USC_77B).verdict).toBe('quote-missing');
  });

  it('the wrong section is caught by its heading; a paraphrase with the right heading passes', () => {
    expect(judgeRecord(record({ heading: 'Dealing in investments as a business' }), FSMA_25)).toMatchObject({ verdict: 'heading-missing' });
    expect(judgeRecord(record({}), FSMA_25)).toEqual({ verdict: 'verified', note: 'heading found (paraphrase — no quote)' });
  });

  it('a source nobody could read carries nothing; a cut page says it was cut', () => {
    expect(judgeRecord(record({}), { ok: false, error: 'the server answered 403' })).toMatchObject({ verdict: 'unread' });
    expect(judgeRecord(record({}), undefined)).toMatchObject({ verdict: 'unread' });
    expect(judgeRecord(record({ quote: 'words past the end of what was read' }), { ...FSMA_25, truncated: true })).toMatchObject({ verdict: 'cut' });
  });
});
