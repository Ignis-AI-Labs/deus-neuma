/**
 * THE EMAIL FORMULA (backend/services/sales/email-formula.js) — Design note, 2026-11-19: […] Locked in the same day. Pure: the campaign's variables, the research card, the equation
 * and every check it is held to.
 */
import { describe, test, expect } from 'vitest';
import { makeEmailPlan, makeResearch, checkFormula, assembleEmail, researchFresh, subjectLine, titleCase, BODY_WORDS_MAX, FIELD_MAX } from '../../backend/services/sales/email-formula.js';
import { emailPlanLine } from '../../backend/services/sales/campaign-shape.js';
import { checkFirstEmail } from '../../backend/services/sales/first-email.js';

const PLAN = makeEmailPlan({
  objective: 'funding', need: 'Seed funds backing local AI want a team already shipping to users.',
  offer: 'Deus Neuma runs AI on the user\'s own machine, live today, raising a seed round.',
  asks: [{ ask: 'Shall I send the deck and the round\'s terms?', delivers: 'the deck and the round\'s terms' }, { ask: 'Open to 20 minutes on Thursday?', delivers: 'a 20 minute call on Thursday' }],
  signature: 'the founder\nFounder & CEO, Ignis AI Labs',
});
const CARD = { ...makeResearch({
  email: 'bart@fund.example', name: 'Bart Stephens', role: 'Managing Partner', company: 'Fund Capital', what: 'Fund Capital backs early crypto and AI infrastructure.',
  now: 'Fund Capital led a seed round in an on-device inference startup last month.', when: '2026-10', where: 'San Francisco',
  need: 'More on-device AI teams with users, as that thesis grows.', sources: ['https://fund.example/news/seed'],
}), at: new Date().toISOString() };
const GOOD = { subject: 'Local AI, after your seed', hook: 'You led the seed in an on-device inference startup last month.', why: 'We are building the same thesis one layer up, for the people using it.',
  offer: 'Deus Neuma runs AI on the user\'s own machine, and it is live today.', askIndex: 0, ask: 'Shall I send you the deck and the round\'s terms?' };

describe('the campaign\'s variables and the research card', () => {
  test('a plan names what it is for, what they need, the offer, real asks and a sign-off — never "a few ideas"', () => {
    expect(PLAN.asks).toHaveLength(2);
    expect(() => makeEmailPlan({ objective: 'growth', need: 'x', offer: 'y', asks: [{ ask: 'May I send a few ideas?', delivers: 'ideas' }], signature: '' }))
      .toThrow(/objective: one of funding, customers, partner, other.*need:.*offer:.*asks\[0\]\.ask: name the actual thing — never "a few ideas".*signature:/);
    expect(emailPlanLine({ id: 'k-1', emailPlan: { approved: PLAN, proposed: null } })).toContain('[0] Shall I send the deck and the round\'s terms? (on a yes: the deck and the round\'s terms)');
    expect(emailPlanLine({ id: 'k-1' })).toContain('none — file it with sales/email-plan {campaign: "k-1"');
  });

  test('a card is who, what, now, where and why, with the pages it was read on; it goes stale', () => {
    expect(() => makeResearch({ email: 'a@b.example', name: 'Bart', role: '', company: 'F', what: 'short', now: 'news', need: '', sources: ['http://b.example'] }))
      .toThrow(/name: WHO.*role: WHO.*company:.*what: WHAT.*now: WHAT they are doing NOW.*need: WHY.*sources:/);
    expect(researchFresh(CARD)).toBe(true);
    expect(researchFresh({ ...CARD, at: '2025-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('the subject: the company first, then why we write, a capital on each major word', () => {
  // Design note, 2026-11-20: […]
  test('the platform writes it from the reason the seat gives', () => {
    expect(subjectLine('Umbrae', 'raising our seed round')).toBe('Umbrae: Raising Our Seed Round');
    expect(subjectLine('Deus Neuma', 'local AI for your team')).toBe('Deus Neuma: Local AI for Your Team');
    expect(subjectLine('Ignis AI Labs', 'a security review of your on-chain contracts')).toBe('Ignis AI Labs: A Security Review of Your On-Chain Contracts');
    // A word with its own capitals is kept; the name the seat put in front itself is not doubled.
    expect(subjectLine('Umbrae', 'LP tools in the iOS app')).toBe('Umbrae: LP Tools in the iOS App');
    expect(subjectLine('Umbrae', 'Umbrae: liquidity for your DeFi vaults')).toBe('Umbrae: Liquidity for Your DeFi Vaults');
    expect(subjectLine('Deus Neuma', 'deus neuma — seed raise')).toBe('Deus Neuma: Seed Raise');
    expect(titleCase('the round: terms and the deck')).toBe('The Round: Terms and the Deck');
  });

  test('the reason is 2 to 6 words; a funding campaign\'s says we are raising; the name does not count against it', () => {
    const subjectProblems = (subject) => checkFormula({ ...GOOD, subject }, { card: CARD, plan: PLAN, company: 'Deus Neuma' }).filter((p) => p.startsWith('subject:'));
    expect(subjectProblems('Raising our seed round')).toEqual([]);
    expect(subjectProblems('Deus Neuma: raising our seed round')).toEqual([]);
    expect(subjectProblems('Local AI on your laptop')).toEqual(['subject: a funding campaign\'s subject says we are raising, so they see it at once ("Deus Neuma: Raising Our Seed Round") — "Local AI on your laptop" does not']);
    expect(subjectProblems('Raise').join(' ')).toMatch(/^subject: why we are writing, in 2 to 6 words — "Deus Neuma:" goes in front of it for you/);
    // A customers campaign is not held to the raise.
    const customers = { ...PLAN, objective: 'customers' };
    expect(checkFormula({ ...GOOD, subject: 'Local AI on your laptop' }, { card: CARD, plan: customers, company: 'Deus Neuma' }).filter((p) => p.startsWith('subject:'))).toEqual([]);
    // The send's own shape check counts the words after the company's name.
    const text = assembleEmail({ card: CARD, plan: PLAN, ...GOOD });
    expect(checkFirstEmail({ subject: 'Ignis AI Labs: A Security Review of Your Contracts', text, promise: PLAN.asks[0].delivers })).toEqual([]);
    expect(checkFirstEmail({ subject: 'Ignis AI Labs: A Long Security Review of All Your Contracts', text, promise: PLAN.asks[0].delivers })).toEqual(['a first email\'s subject is at most 6 plain words after the company\'s name']);
  });
});

describe('the equation', () => {
  test('a good one passes and is assembled in order: greeting, hook and why, offer, ask, sign-off', () => {
    expect(checkFormula(GOOD, { card: CARD, plan: PLAN })).toEqual([]);
    const text = assembleEmail({ card: CARD, plan: PLAN, ...GOOD });
    expect(text).toBe(`Hi Bart,\n\n${GOOD.hook} ${GOOD.why}\n\n${GOOD.offer}\n\n${GOOD.ask}\n\n${PLAN.signature}`);
    // The send's own shape check reads the words above the sign-off.
    expect(checkFirstEmail({ subject: GOOD.subject, text, promise: PLAN.asks[0].delivers })).toEqual([]);
  });

  test('each part is held: a hook not about them, an ask the campaign does not make, a second question, the template lines, the length', () => {
    const problems = (f) => checkFormula({ ...GOOD, ...f }, { card: CARD, plan: PLAN }).join(' | ');
    expect(problems({ hook: 'We have been building something we think you will really like.' })).toMatch(/hook: say what THEY are doing, from your research card/);
    expect(problems({ ask: 'Can I send over a few ideas?' })).toMatch(/ask: name the campaign's ask[\s\S]*never "a few ideas"/);
    expect(problems({ askIndex: 5 })).toMatch(/askIndex: which of the campaign's asks this is \(0 to 1\)/);
    expect(problems({ why: 'Would this matter to you right now at all?' })).toMatch(/the ask is the only question/);
    expect(problems({ hook: 'I hope this finds you well after the on-device inference seed last month.' })).toMatch(/never "hope this finds you"/);
    expect(problems({ subject: 'Hello' })).toMatch(/subject: why we are writing, in 2 to 6 words/);
    expect(problems({ offer: `${'Deus Neuma runs AI locally for users on their own machines. '.repeat(14)}` })).toMatch(new RegExp(`at most ${BODY_WORDS_MAX} words from hook to ask`));
  });

  test('every person different: one that opens or offers the way another email of the campaign did is refused', () => {
    const other = { to: ['ana@other.example'], hook: 'You led the seed in an on-device inference startup in October.', offer: 'Something else entirely for them.' };
    expect(checkFormula(GOOD, { card: CARD, plan: PLAN, others: [other] }).join(' ')).toMatch(/another email of this campaign \(to ana@other\.example\) opens or offers the same way/);
    expect(checkFormula(GOOD, { card: CARD, plan: PLAN, others: [{ to: ['x@y.example'], hook: 'Your team shipped a new wallet this week for traders.', offer: 'A different offer.' }] })).toEqual([]);
  });
});

// NOTHING IS CUT TO FIT (Design note, 2026-11-20: […] — a plan's offer ended
// […], sliced at 600 characters without a word, and that was what got approved).
describe('a field is kept whole or refused, never cut', () => {
  const base = { objective: 'funding', need: 'A fund needs an AI product that is live and checkable.', asks: [{ ask: 'Shall I send the deck?', delivers: 'the deck and the terms' }], signature: 'the founder\nFounder & CEO' };
  const sentence = 'Deus Neuma is a free, open-source local AI harness that runs on your own computer and the open model you choose. ';

  test('a long offer is kept to its last word', () => {
    const offer = `${sentence.repeat(8)}Deus Neuma is raising $500,000 via SAFE to build out the platform and ecosystem.`;
    expect(offer.length).toBeGreaterThan(600); // what used to be sliced
    const plan = makeEmailPlan({ ...base, offer });
    expect(plan.offer).toBe(offer);
    expect(plan.offer.endsWith('to build out the platform and ecosystem.')).toBe(true);
  });

  test('one too long is refused with its length said, and nothing of it is kept', () => {
    const offer = sentence.repeat(20);
    expect(() => makeEmailPlan({ ...base, offer })).toThrow(`offer: ${offer.trim().length} characters, and the most it may be is ${FIELD_MAX.offer} — shorten it; nothing is cut for you`);
    expect(() => makeEmailPlan({ ...base, offer: 'A real offer in their own terms.', signature: 'x'.repeat(700) })).toThrow(/signature: 700 characters/);
    expect(() => makeEmailPlan({ ...base, offer: 'A real offer in their own terms.', asks: Array.from({ length: 9 }, () => base.asks[0]) })).toThrow(/asks: 9 were given and a campaign has at most/);
  });
});
