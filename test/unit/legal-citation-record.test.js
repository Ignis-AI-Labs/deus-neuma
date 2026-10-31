/**
 * The citation law's record and draft discipline (citation-record.js) — pure,
 * so called for real with real inputs (RULE 0). The drafts are the failures a
 * 2026-10-31 citation audit found in a legal office's answer: an invented
 * quotation, a statute paraphrased inside quotation marks, "[verify]" shipped.
 */
import { describe, it, expect } from 'vitest';
import {
  citationRecordsProblem, unresolvedMarks, quotedSpans, unboundQuotes, draftProblem,
  citationLine, squeeze, quoteSegments, holdsInOrder,
} from '../../backend/services/legal/citation-record.js';

// The release's real words (SEC Rel. 33-11412, p. 24), as a record carries them.
const RELEASE = Object.freeze({
  claim: 'Putting a security on a chain does not change whether it is a security.',
  authority: 'SEC/CFTC Rel. No. 33-11412', pinCite: 'p. 24', pages: '24', standing: 'adopted 2026-03-17',
  heading: 'Application of the Federal Securities Laws to Certain Types of Crypto Assets',
  sourceUrl: 'https://www.sec.gov/files/rules/interp/2026/33-11412.pdf',
  quote: 'A security is a security regardless of whether it is issued, or otherwise represented, offchain or onchain.',
});

describe('a citation is a record the platform can check', () => {
  it('a complete record passes; one is required when the reading rests on law', () => {
    expect(citationRecordsProblem([RELEASE], { required: true })).toBeNull();
    expect(citationRecordsProblem([], { required: true })).toMatch(/^cite what the reading rests on/);
    expect(citationRecordsProblem(undefined)).toBeNull(); // a hand-off may cite nothing
  });

  it('refuses a bare string, naming the record it wants', () => {
    expect(citationRecordsProblem(['15 U.S.C. § 77b(a)(10)'])).toMatch(/citation 1 is a string.*\{claim, authority, pinCite, heading, sourceUrl, standing/);
  });

  it('names the missing field and what it means', () => {
    const { heading, ...noHeading } = RELEASE;
    expect(heading).toBeTruthy();
    expect(citationRecordsProblem([RELEASE, noHeading])).toMatch(/citation 2 has no heading — .*AS THE SOURCE PRINTS IT/);
    expect(citationRecordsProblem([{ ...RELEASE, standing: ' ' }])).toMatch(/no standing/);
  });

  it('refuses an address that is not one, a quote too short to prove anything, and a page that is not a page', () => {
    expect(citationRecordsProblem([{ ...RELEASE, sourceUrl: 'sec.gov release' }])).toMatch(/sourceUrl must be/);
    expect(citationRecordsProblem([{ ...RELEASE, quote: 'any stock' }])).toBeNull();
    expect(citationRecordsProblem([{ ...RELEASE, quote: 'stock' }])).toMatch(/proves nothing/);
    expect(citationRecordsProblem([{ ...RELEASE, pages: 'p. 24' }])).toMatch(/pages is a PDF page/);
    expect(citationRecordsProblem([{ ...RELEASE, pages: '20-30' }])).toBeNull();
  });
});

describe('a draft never ships an unresolved mark', () => {
  it('finds the marks the audit found shipped, and not footnotes or bracketed changes', () => {
    const draft = 'decentralization is a fact question. **[verify]** case holdings. Finder line, May 2020 [verify]. Cases [1] say it w[as] not enough. Status: [citation needed] and [TBD].';
    expect(unresolvedMarks(draft)).toEqual(['[verify]', '[citation needed]', '[TBD]']);
    expect(draftProblem(draft, [])).toMatch(/still carries \[verify\].*never ships/);
  });
});

describe('quotation marks wrap only words a record quotes', () => {
  it('a quotation is three words or more; terms and drafted language are not quotations', () => {
    const draft = [
      'A "broker" is in the business "for the account of others" here.',
      '“A security is a security regardless of whether it is issued”',
      '```\n"The tokens are issued by the issuer, not by the house."\n```',
      'Inline `"not a quotation at all"` stays code.',
    ].join('\n');
    expect(quotedSpans(draft)).toEqual(['for the account of others', 'A security is a security regardless of whether it is issued']);
  });

  it('the invented quotation is unbound when the record carries the release\'s real words', () => {
    const invented = 'SEC/CFTC Release 33-11412: "Digital securities are tokenized versions of financial instruments that fall within the statutory definition of \'security.\' Tokenization does not alter the analysis."';
    expect(unboundQuotes(invented, [RELEASE])).toHaveLength(1);
    expect(draftProblem(invented, [RELEASE])).toMatch(/quotation marks around words no citation record quotes: "Digital securities are tokenized/);
  });

  it('a part of a record\'s quote, with an ellipsis, is bound; so is the whole', () => {
    expect(unboundQuotes('The release says "A security is a security ... offchain or onchain."', [RELEASE])).toEqual([]);
    expect(draftProblem(`It says "${RELEASE.quote}"`, [RELEASE])).toBeNull();
  });

  it('a statute paraphrased inside quotation marks is unbound (the dealer definition)', () => {
    const dealer = { ...RELEASE, authority: '15 U.S.C. § 78c', pinCite: '(a)(5)(A)', heading: 'Definitions and application', quote: 'engaged in the business of buying and selling securities' };
    expect(unboundQuotes('A dealer is "engaged in the business of effecting transactions in securities for his own account".', [dealer])).toHaveLength(1);
  });
});

describe('matching is by words, never by typography', () => {
  it('curly quotes, spaced punctuation, entities, line-break hyphens and accents do not decide', () => {
    expect(squeeze('The term “ security ” means any note , stock')).toBe(squeeze('The term "security" means any note, stock'));
    expect(squeeze('15 U.S. Code &sect; 77b')).toBe(squeeze('15 U.S. Code § 77b'));
    expect(squeeze('regard-\nless of format')).toBe(squeeze('regardless of format'));
    expect(squeeze('Règlement général')).toBe('reglementgeneral');
  });

  it('any script keeps its letters, so a quotation in it is still checked', () => {
    expect(squeeze('個人情報の保護に関する法律')).toBe('個人情報の保護に関する法律');
  });

  it('segments between ellipses and bracketed changes must appear in order', () => {
    const page = squeeze('blocking U.S. IP addresses alone were not sufficient to actually block U.S. users');
    expect(holdsInOrder(page, quoteSegments('blocking US IP addresses alone w[as] not sufficient to actually block U.S. users'))).toBe(true);
    expect(holdsInOrder(page, quoteSegments('actually block U.S. users … blocking U.S. IP addresses'))).toBe(false);
    expect(holdsInOrder(page, quoteSegments('…'))).toBe(false);
  });
});

describe('a checked record becomes a ledger line', () => {
  it('names authority, pin cite, heading, source, standing, and the day the platform read it', () => {
    expect(citationLine(RELEASE, '2026-10-31T05:40:00.000Z')).toBe(
      'SEC/CFTC Rel. No. 33-11412, p. 24 — Application of the Federal Securities Laws to Certain Types of Crypto Assets — https://www.sec.gov/files/rules/interp/2026/33-11412.pdf · adopted 2026-03-17 · re-read by the platform 2026-10-31',
    );
    expect(citationLine(RELEASE)).not.toContain('re-read');
  });
});
