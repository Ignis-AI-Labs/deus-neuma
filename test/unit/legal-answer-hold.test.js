/**
 * THE HOLD's judgement (legal/answer-hold.js) — pure, called with real inputs
 * (RULE 0). The answer text is excerpted from the CLO answer a 2026-10-31
 * citation audit traced, so the hold is judged on the failure that taught it.
 * The wired path (seat, chips, the platform's follow-up, the tray card) is
 * test/integration/legal-citation-law.test.js.
 */
import { describe, it, expect } from 'vitest';
import { citationMentions, holdProblems, holdThought, HOLD_HEAD } from '../../backend/services/legal/answer-hold.js';

// Excerpts of the audited answer, as it was written.
const AUDITED = [
  '"Security" (Securities Act § 2(a)(10), 15 U.S.C. § 77b(a)(10); Exchange Act § 3(a)(10), 15 U.S.C. § 78c(a)(10)) expressly includes "any stock" and "any evidence of ownership."',
  'SEC/CFTC Release 33-11412 / 34-105020 (Mar 17, 2026): *"Digital securities are tokenized versions of financial instruments that fall within the statutory definition of \'security.\' Tokenization does not alter the analysis."*',
  'Rule 3b-16 (17 CFR 240.3b-16); SEC Release No. 33-10905 (May 14, 2020) **[verify]**; FINRA Rule 5310; *SEC v. Coinbase* (S.D.N.Y. 2023).',
  'MiFID II Art. 4(1)(15) as amended by Reg. (EU) 2022/858; SI 2001/2959 (RAO 2001) Sch. 1; 91 FR 13714.',
].join('\n');

const record = (authority, pinCite, quote = null) => ({
  claim: 'c', authority, pinCite, heading: 'h', sourceUrl: 'https://example.org', standing: 'in force', quote,
});

describe('the citations an answer makes, keyed the way a record confirms them', () => {
  it('reads every shape the audited answer used', () => {
    expect(citationMentions(AUDITED).map((m) => m.key)).toEqual([
      '15usc77b', '15usc78c', '17cfr2403b16', '3311412', '3310905', '91fr13714', 'finrarule5310', '2022858', '20012959', 'secvcoinbase',
    ]);
  });

  it('a plain sentence makes none', () => {
    expect(citationMentions('Good morning — the watch ran and nothing new reached the house.')).toEqual([]);
  });
});

describe('what the hold finds unconfirmed', () => {
  it('the audited answer, nothing checked: a mark, no check, every cite uncovered, the invented quotation', () => {
    const problems = holdProblems(AUDITED, []);
    expect(problems[0]).toBe('it still carries [verify]');
    expect(problems[1]).toBe('no citation check passed this turn, yet it cites law');
    expect(problems[2]).toMatch(/^it cites what no confirmed record covers: 15 U\.S\.C\. § 77b; 15 U\.S\.C\. § 78c; 17 CFR 240\.3b-16/);
    // Both quotations the audit found invented: row 7's "evidence of ownership" and row 9's release sentence.
    expect(problems[3]).toMatch(/^quotation marks around words no confirmed record quotes: "any evidence of ownership\."; "Digital securities are tokenized/);
  });

  it('a cite is covered by the confirmed record that names it; one left out is named', () => {
    const answer = 'A broker is defined at 15 U.S.C. § 78c(a)(4); the exchange test is 17 CFR 240.3b-16.';
    expect(holdProblems(answer, [record('15 U.S.C. § 78c', '(a)(4)(A)'), record('17 CFR 240.3b-16', '(a)')])).toEqual([]);
    expect(holdProblems(answer, [record('15 U.S.C. § 78c', '(a)(4)(A)')])).toEqual(['it cites what no confirmed record covers: 17 CFR 240.3b-16']);
  });

  it('a quotation a confirmed record carries passes; the same words unconfirmed do not', () => {
    const answer = 'A broker is a person "engaged in the business of effecting transactions in securities for the account of others" (15 U.S.C. § 78c).';
    const broker = record('15 U.S.C. § 78c', '(a)(4)(A)', 'engaged in the business of effecting transactions in securities for the account of others');
    expect(holdProblems(answer, [broker])).toEqual([]);
    expect(holdProblems(answer, [{ ...broker, quote: null }])[0]).toMatch(/^quotation marks around words no confirmed record quotes/);
  });

  it('an answer that cites no law is not held, whatever it quotes', () => {
    expect(holdProblems('You said "run the watch tonight please" — it will run at nine.', [])).toEqual([]);
  });
});

describe('what the CLO is sent back with', () => {
  it('names itself the platform\'s, lists the problems, and says what to do', () => {
    const thought = holdThought(['no citation check passed this turn, yet it cites law']);
    expect(thought.startsWith(HOLD_HEAD)).toBe(true);
    expect(thought).toContain('- no citation check passed this turn, yet it cites law');
    expect(thought).toContain('Run legal_cite_check');
  });
});
