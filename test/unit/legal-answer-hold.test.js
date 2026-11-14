/**
 * THE HOLD's judgement (legal/answer-hold.js) — pure, called with real inputs
 * (RULE 0). The answer text is excerpted from the CLO answer a 2026-10-31
 * citation audit traced, so the hold is judged on the failure that taught it.
 * The wired path (seat, chips, the platform's follow-up, the tray card) is
 * test/integration/legal-citation-law.test.js.
 */
import { describe, it, expect } from 'vitest';
import { citationMentions, holdProblems, holdThought, wordsSaidInChat, speaksAsLaw, HOLD_HEAD } from '../../backend/services/legal/answer-hold.js';

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
    expect(problems[1]).toBe('no citation check has passed in this chat, yet it cites law');
    expect(problems[2]).toMatch(/^it cites what no confirmed record covers: 15 U\.S\.C\. § 77b; 15 U\.S\.C\. § 78c; 17 CFR 240\.3b-16/);
    // Both quotations the audit found invented: row 7's "evidence of ownership" and row 9's release sentence.
    expect(problems[3]).toMatch(/^quotation marks around words of law no confirmed record quotes: "any evidence of ownership\."; "Digital securities are tokenized/);
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
    expect(holdProblems(answer, [{ ...broker, quote: null }])[0]).toMatch(/^quotation marks around words of law no confirmed record quotes/);
  });

  it('an answer that cites no law is not held, whatever it quotes', () => {
    expect(holdProblems('You said "run the watch tonight please" — it will run at nine.', [])).toEqual([]);
  });

  it('a record for a CFR Part covers the Part however it is written, and its section pin covers that section', () => {
    const part = record('16 CFR Part 255', '§ 255.5');
    expect(holdProblems('The endorsement guides (16 CFR 255; 16 C.F.R. Part 255) apply.', [part])).toEqual([]);
    expect(holdProblems('Material connections must be disclosed (16 CFR 255.5).', [part])).toEqual([]);
    expect(holdProblems('See 16 CFR 256.', [part])).toEqual(['it cites what no confirmed record covers: 16 CFR 256']);
  });
});

// The answer that taught this (2026-11-04): the CLO, mid-work, quoting its
// operator's own words beside the law it had confirmed earlier in the chat.
describe('the words said to the CLO in the chat are theirs to quote', () => {
  const WORKING = [
    'You said "I don\'t have to go through all this stuff", so the terms stay short: commission "locked for life", and we "screen before every payout".',
    'The FTC endorsement guides (16 CFR 255) I have confirmed. Backup withholding is 26 U.S.C. §3406; e-signatures are 15 U.S.C. §7001.',
  ].join('\n');
  const CONFIRMED = [record('16 CFR Part 255', '§ 255.5'), record('26 U.S.C. § 3406', '(a)(1)'), record('15 U.S.C. § 7001', '(a)')];
  const ASKED = 'Make the referral program simple, I don\'t have to go through all this stuff. Commission is locked for life and we screen before every payout.';

  it('quotation marks around the operator\'s words, beside confirmed law: nothing held', () => {
    expect(holdProblems(WORKING, CONFIRMED, [ASKED])).toEqual([]);
  });

  it('quotations on a line that speaks as law, which nobody said and no record quotes, are still held', () => {
    const asLaw = `${WORKING}\nThe FTC guides require that the connection be "clear and conspicuous in every single post".`;
    expect(holdProblems(asLaw, CONFIRMED, ['Draft the referral terms.'])).toEqual([
      'quotation marks around words of law no confirmed record quotes: "clear and conspicuous in every single post"',
    ]);
  });

  it('the operator\'s turns are the words said — never a row the platform wrote, the being\'s own, or a compaction', () => {
    const rows = [
      { role: 'user', content: ASKED },
      { role: 'user', content: 'a watch reported', origin: 'watch' },
      { role: 'assistant', content: 'the being\'s own words' },
      { role: 'user', content: 'a summary', compacted: true },
    ];
    expect(wordsSaidInChat(rows, 'and this turn', null)).toEqual([ASKED, 'and this turn']);
    expect(wordsSaidInChat(rows, 'a hold\'s words', 'hold')).toEqual([ASKED]);
  });

  it('the hold\'s own send-back, quoting the spans it held, never binds them', () => {
    const asLaw = 'The FTC guides require that the connection be "clear and conspicuous in every single post" (16 CFR 255.5).';
    const thought = holdThought(holdProblems(asLaw, CONFIRMED, []));
    const said = wordsSaidInChat([{ role: 'user', content: thought, origin: 'hold' }], thought, 'hold');
    expect(holdProblems(asLaw, CONFIRMED, said)[0]).toMatch(/^quotation marks around words of law no confirmed record quotes/);
  });
});

// The answer that taught the balance (Design note, 2026-11-12, […]):
// the CLO walking its operator through a grant form, quoting the form.
describe('only what is presented AS LAW is held', () => {
  const FORM = [
    'Under "Project Summary" write two plain sentences about what the grant pays for.',
    'In § 3 the form asks "How will you measure the outcome of the project?" — answer with the numbers you already track.',
    'Scroll down and send me the next section — the project proposal questions — and I\'ll walk it with you.',
  ].join('\n');

  it('quoting a form, with a section sign that names no law, is ordinary writing: nothing held', () => {
    expect(holdProblems(FORM, [])).toEqual([]);
  });

  it('a section sign beside a named authority still cites law', () => {
    expect(holdProblems('Under § 5 of the Securities Act the offering must be registered.', [])).toEqual(['no citation check has passed in this chat, yet it cites law']);
  });

  it('a real citation in the same answer is held; the form\'s quotations beside it are not', () => {
    expect(holdProblems(`${FORM}\nAllowable costs follow 2 CFR 200.403.`, [])).toEqual([
      'no citation check has passed in this chat, yet it cites law',
      'it cites what no confirmed record covers: 2 CFR 200.403',
    ]);
  });

  it('what speaks as law: a citation, a regulator, a named Act, a numbered Rule, the law\'s own nouns — not a form\'s section', () => {
    for (const line of ['15 U.S.C. § 78c', 'the SEC said', 'the Securities Act', 'Rule 506(c)', 'the statute reads', 'the court held']) expect(speaksAsLaw(line)).toBe(true);
    for (const line of ['In § 3 the form asks', 'the next section', 'Project Summary']) expect(speaksAsLaw(line)).toBe(false);
  });
});

describe('what the CLO is sent back with', () => {
  it('names itself the platform\'s, lists the problems, and says what to do', () => {
    const thought = holdThought(['no citation check has passed in this chat, yet it cites law']);
    expect(thought.startsWith(HOLD_HEAD)).toBe(true);
    expect(thought).toContain('- no citation check has passed in this chat, yet it cites law');
    expect(thought).toContain('Run legal_cite_check');
  });
});
