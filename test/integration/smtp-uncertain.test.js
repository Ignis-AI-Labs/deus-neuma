// A lost SMTP acknowledgement crosses the REAL raise store and REAL TLS socket:
// a normal send lands as sent, an accepted-DATA disconnect lands as maybe-sent,
// and the next reach is judged against that persisted thread before another
// message can leave. No network/model double and no fabricated auth/receipt.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { startTlsSmtp } from '../helpers/smtp-tls-kit.js';
import { applyRaise, reachUnderChain, readRaise } from '../../backend/services/raise/raise-store.js';
import { makeMandate, judgeSign, makeFactsSheet, judgeReview, makeInvestor, judgeClear } from '../../backend/services/raise/raise-shape.js';
import { sendThrough } from '../../backend/services/raise/raise-mailbox.js';

const WALLET = `0x${'ab'.repeat(20)}`;
const COMPANY = 'c-uncertain-abc123';
const NOW = '2026-11-17T12:00:00.000Z';
const address = `0x${'7e'.repeat(20)}`;

const seed = async () => {
  const mandate = makeMandate({
    amount: 250000, currency: 'USD', instrument: 'safe',
    valuation: { low: 2000000, high: 3000000, basis: 'three real harbour-software comparables documented in the company data room' },
    useOfFunds: 'Twelve months of serving and two harbour pilots.', route: { kind: '506c', jurisdiction: 'US' },
    limits: { perDay: 3, followUps: 0 }, minCheck: 5000, by: 'quae', now: NOW,
  });
  await applyRaise(WALLET, COMPANY, () => ({ ok: true, event: { type: 'mandate', mandate, at: NOW } }));
  await applyRaise(WALLET, COMPANY, (state) => judgeSign(state, {
    mandateId: mandate.id, counselChoseRoute: true, account: { kind: 'wallet', address }, now: NOW,
  }));
  const facts = makeFactsSheet({ facts: [
    { claim: 'Three harbours pay for the weekly sheet', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater 2026' },
    { claim: 'Monthly revenue from the sheet', figure: { value: 360, unit: 'USD' }, source: 'ledger: money-in, November' },
    { claim: 'Thirty harbours within a year', figure: { value: 30, unit: 'harbours' }, source: 'repos/tidewater/plan.md', forwardLooking: true },
  ], dataRoom: ['repos/tidewater/data-room/'], by: 'numer', now: NOW });
  await applyRaise(WALLET, COMPANY, () => ({ ok: true, event: { type: 'facts', sheet: facts, at: NOW } }));
  await applyRaise(WALLET, COMPANY, (state) => judgeReview(state, { sheetId: facts.id, verdict: 'approved', now: NOW }));
  for (const [id, name, email] of [['i-ok', 'Ann Fund', 'ann@fund.example'], ['i-maybe', 'Uma Fund', 'uma@fund.example']]) {
    const investor = { ...makeInvestor({ name, email, thesis: 'Maritime software at seed', why: 'Backed port-tech before', by: 'spec', now: NOW }), id };
    await applyRaise(WALLET, COMPANY, () => ({ ok: true, event: { type: 'investor', investor, at: NOW } }));
    await applyRaise(WALLET, COMPANY, (state) => judgeClear(state, { investorId: investor.id, verdict: 'cleared', now: NOW }));
  }
};

describe('raise store after an uncertain SMTP outcome', () => {
  let smtp;
  let credentials;

  beforeAll(async () => {
    useTempRealm();
    smtp = await startTlsSmtp(await createTempDir('raise-smtp-uncertain'));
    credentials = {
      address: 'raise@tidewater.example', username: 'raise@tidewater.example', password: 'test-app-password',
      smtpHost: 'localhost', smtpPort: String(smtp.port), imapHost: 'localhost', imapPort: '1',
    };
    await seed();
  }, 60000);

  afterAll(async () => smtp?.close());

  test('success is sent, accepted-DATA loss is maybe-sent, and its retry is refused before another send', async () => {
    const send = (investor, account) => sendThrough(credentials, { to: investor.email, subject: 'Tidewater', text: 'A true note about the three paying harbours.' });
    const sent = await reachUnderChain(WALLET, COMPANY, { investorId: 'i-ok', subject: 'Tidewater', body: 'A true note.', by: 'merc', now: NOW }, send);
    expect(sent.ok).toBe(true);
    expect((await readRaise(WALLET, COMPANY)).investors.find((i) => i.id === 'i-ok').thread[0].delivery).toBe('sent');

    smtp.control.dropAfterData = true;
    const uncertain = await reachUnderChain(WALLET, COMPANY, { investorId: 'i-maybe', subject: 'Tidewater', body: 'A true note.', by: 'merc', now: NOW }, send);
    smtp.control.dropAfterData = false;
    expect(uncertain).toMatchObject({ ok: false, uncertain: true, reason: expect.stringMatching(/may have been sent/) });
    expect((await readRaise(WALLET, COMPANY)).investors.find((i) => i.id === 'i-maybe').thread[0]).toMatchObject({ delivery: 'maybe-sent', to: 'uma@fund.example' });
    expect(smtp.received).toHaveLength(2);

    const retry = await reachUnderChain(WALLET, COMPANY, { investorId: 'i-maybe', subject: 'Tidewater', body: 'A true note.', by: 'merc', now: NOW }, send);
    expect(retry.ok).toBe(false);
    expect(retry.reason).toMatch(/allows 0 follow-ups/);
    expect(smtp.received).toHaveLength(2);
  }, 60000);
});
