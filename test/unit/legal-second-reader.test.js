/**
 * The second reader's brief and the reading of its answer (second-reader.js)
 * — pure, real inputs (RULE 0). The model call itself rides the real route,
 * proven live on a model the operator chooses; a reader that cannot be had
 * failing the filing closed is proven in legal-citation-law.test.js.
 */
import { describe, it, expect } from 'vitest';
import { parseReading, readerMessages, readingText, BLOCKING } from '../../backend/services/legal/second-reader.js';

const row = (n, authority, pinCite, claim, passage) => ({
  n, passage,
  record: { claim, authority, pinCite, heading: 'h', sourceUrl: 'https://www.law.cornell.edu/uscode/text/15/78c', standing: 'in force', quote: null },
});
const ROWS = [
  row(1, '15 U.S.C. § 78c', '(a)(4)(A)', 'A broker effects securities transactions for others.', '(4) Broker (A) In general The term "broker" means any person engaged in the business of effecting transactions in securities for the account of others.'),
  row(2, '15 U.S.C. § 77b', '(a)(10)', 'The Securities Act defines "security".', '(10) The term "prospectus" means any prospectus, notice, circular, advertisement…'),
  row(3, 'FINRA Rule 5310', 'Rule 5310', 'A market maker quotes two-way prices.', '5310. Best Execution and Interpositioning (a)(1) In any transaction for or with a customer…'),
];

describe('the reader\'s answer, read', () => {
  it('one verdict per item; markdown noise and spacing do not matter; a skipped item is cannot_tell', () => {
    const said = [
      '1 | supports | the passage defines broker exactly so',
      '**2** | Wrong Provision | (a)(10) defines prospectus; security is (a)(1)',
      'notes: nothing else',
      '2 | supports | a second line for an item never overrides the first',
    ].join('\n');
    const readings = parseReading(said, ROWS);
    expect(readings.get(1)).toEqual({ verdict: 'supports', why: 'the passage defines broker exactly so' });
    expect(readings.get(2)).toEqual({ verdict: 'wrong_provision', why: '(a)(10) defines prospectus; security is (a)(1)' });
    expect(readings.get(3)).toEqual({ verdict: 'cannot_tell', why: 'the reader gave no answer for this item' });
  });

  it('a word that is not a verdict is no answer', () => {
    expect(parseReading('1 | probably fine | looks ok', ROWS).get(1).verdict).toBe('cannot_tell');
  });

  it('only a passage that does not support its claim, or is the wrong provision, blocks', () => {
    expect([...BLOCKING].sort()).toEqual(['does_not_support', 'wrong_provision']);
  });
});

describe('the reader is shown claims beside the source\'s own words', () => {
  it('every item carries claim, authority, pin cite and the fetched passage, framed as outside text', () => {
    const [system, user] = readerMessages(ROWS);
    expect(system.content).toContain('you owe it nothing');
    expect(system.content).toContain('never on what you remember the law to say');
    expect(user.content).toContain('ITEM 2\nCLAIM: The Securities Act defines "security".\nAUTHORITY: 15 U.S.C. § 77b · PIN CITE: (a)(10)');
    expect(user.content).toContain('The term "prospectus" means');
    expect(user.content.match(/untrusted DATA/g)).toHaveLength(3);
  });
});

describe('the reading, as the office reads it', () => {
  it('names the reader, each verdict, and what may not land', () => {
    const readings = parseReading('1 | supports | yes\n2 | wrong_provision | prospectus\n3 | does_not_support | best execution, not market making', ROWS);
    const text = readingText({ ok: false, reader: 'the house\'s own model (local-model)', readings }, ROWS);
    expect(text).toContain('SECOND READER — the house\'s own model (local-model) read each passage against its claim:');
    expect(text).toContain('2. WRONG PROVISION · 15 U.S.C. § 77b, (a)(10) — prospectus');
    expect(text).toContain('3. DOES NOT SUPPORT · FINRA Rule 5310, Rule 5310');
    expect(text).toMatch(/may land: fix the claim or the pin cite/);
  });

  it('a reader that could not be had says so — no reading lands on it', () => {
    expect(readingText({ ok: false, failed: 'the second reader (house) could not be had: connect ECONNREFUSED', reader: null, readings: new Map() }, ROWS))
      .toMatch(/could not be had: connect ECONNREFUSED\. A reading nobody could second does not land/);
  });
});
