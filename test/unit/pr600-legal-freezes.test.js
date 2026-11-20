/**
 * PR600 audit P6-125, the citation-law leg: a CLO filing has no length cap and is read on the backend's
 * one thread. `draftProblem` took 3.2 s on 64 KB and 12.9 s on 128 KB (the audit's run) and the
 * case-name reader 3.4 s on 64 KB — and the filing stayed on disk to do it again at the next sweep.
 * The real readers, hostile drafts at 128 KB and 512 KB, and what they caught they still catch. No mocks.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';
import { draftProblem, quotedSpans, quoteSegments, unboundQuotes, unresolvedMarks } from '../../backend/services/legal/citation-record.js';
import { citationMentions, holdProblems, speaksAsLaw } from '../../backend/services/legal/answer-hold.js';

const SIZES = [128_000, 512_000];
const LIMIT_MS = 1000;
const fill = (unit, size) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
const ms = (run) => { const started = performance.now(); run(); return performance.now() - started; };
const RECORD = { authority: '15 U.S.C. § 78c', pinCite: '(a)(10)', quote: 'The term security means any note, stock, treasury stock' };
const UNITS = ['“', '“a ', '"a ', '"a b c d" ', '"a b 1"\n', '``` ', '`', '[verify ', '[ ', '[to ', '[', 'A.', "A&'", 'A v. ', 'A.A v.', '1 U', '12 U.S.C. ', 'Rel. No. ', 'Aa Bb ', '. . ', '“a `x` b c” '];

describe('P6-125 — a hostile filing is read in one pass', () => {
  test.each(SIZES)('every reader, on every shape, at %i characters', (size) => {
    for (const unit of UNITS) {
      const draft = fill(unit, size);
      expect(ms(() => draftProblem(draft, [RECORD])), `draftProblem ${unit}`).toBeLessThan(LIMIT_MS);
      expect(ms(() => holdProblems(draft, [RECORD], ['what the operator said'])), `holdProblems ${unit}`).toBeLessThan(LIMIT_MS);
      expect(ms(() => citationMentions(draft)), `citationMentions ${unit}`).toBeLessThan(LIMIT_MS);
      expect(ms(() => speaksAsLaw(draft)), `speaksAsLaw ${unit}`).toBeLessThan(LIMIT_MS);
      expect(ms(() => quoteSegments(draft)), `quoteSegments ${unit}`).toBeLessThan(LIMIT_MS);
    }
  });

  test('a mark or an unbound quotation at the far end of a hostile draft is still caught', () => {
    const padding = fill('[verify “ A.', 128_000);
    expect(draftProblem(`${padding}\nThis is settled [citation needed].`, [RECORD])).toContain('[citation needed]');
    expect(draftProblem(`${padding}\nThe statute says "an issuer may never sell at all".`, [RECORD])).toContain('an issuer may never sell at all');
    expect(holdProblems(`${padding}\nSee Smith v. Jones and 17 CFR 240.10b-5.`, [RECORD]).join(' ')).toMatch(/Smith v\. Jones.*17 CFR 240\.10b-5|17 CFR 240\.10b-5.*Smith v\. Jones/);
  });

  test('marks read as they did: opener to the next closing bracket, each once', () => {
    expect(unresolvedMarks('Fine [verify] and [ to verify this one ], [TBD: later] [TBD: later], not [verification] nor [a note].'))
      .toEqual(['[verify]', '[ to verify this one ]', '[TBD: later]']);
    expect(unresolvedMarks('an opener with no closer [verify this')).toEqual([]);
    expect(unresolvedMarks(`[check ${'x'.repeat(5000)}]`)).toHaveLength(1);
  });

  test('quotations read as they did: straight or curly, three words or more, never across a line or inside code', () => {
    expect(quotedSpans('He said "one two three" and “four five six”, a "term", and "split\nacross lines here".')).toEqual(['one two three', 'four five six']);
    expect(quotedSpans('Proposed: `"draft language right here"` and\n```\n"more drafted words here"\n```\nthen "a real quotation here".')).toEqual(['a real quotation here']);
    expect(quotedSpans('“” “a b c” and "d e f" ""')).toEqual(['a b c', 'd e f']);
    expect(unboundQuotes('It says "the term security means any note" and "stock, treasury stock".', [RECORD])).toEqual([]);
    expect(unboundQuotes('It says "the term security means [a] note … treasury stock".', [RECORD])).toEqual([]);
    expect(unboundQuotes('It says "the term security never means a note".', [RECORD])).toEqual(['the term security never means a note']);
    expect(quoteSegments('The term … means [any] note. . .stock')).toEqual(['theterm', 'means', 'note', 'stock']);
  });

  test('a quotation is judged on the line it sits on, however many the line carries', () => {
    const law = 'Under 15 U.S.C. § 78c the text is "no person shall sell ever".';
    const talk = 'You told me "ship it this week".';
    expect(holdProblems(`${talk}\n${law}`, [RECORD]).join(' ')).toContain('no person shall sell ever');
    expect(holdProblems(`${talk}\n${law}`, [RECORD]).join(' ')).not.toContain('ship it this week');
    // the same words earlier, on a line that is not law, no longer hide the quotation from the hold
    expect(holdProblems(`Remember: no person shall sell ever.\n${law}`, [RECORD]).join(' ')).toContain('quotation marks around words of law');
  });

  test('case names key as they did', () => {
    expect(citationMentions('See Smith v. Jones, SEC v. W.J. Howey Co. and Marbury  v.  Madison.').map((m) => m.key)).toEqual(['smithvjones', 'secvwj', 'marburyvmadison']);
  });
});
