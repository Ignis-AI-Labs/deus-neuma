/**
 * THE MAILBOX MEETS THE LEAD ENGINE — RULE 0, no double anywhere: the REAL
 * intent sweep over REAL intent files, the operator's REAL card answered, the
 * REAL SMTP sender over real TLS to a real mail server (smtp-tls-kit.js), the
 * house's real do-not-contact list and lead ledger on tmp disk.
 *
 * Under proof: an email to anyone on the do-not-contact list is refused
 * before any card and never leaves; an email to a lead leaves, and the lead
 * records it itself — contacted, direction out — so upkeep knows the house
 * wrote last; an email to a lead must pass the facts check (an approved
 * sheet, only its numbers, the disclosure line, no false urgency); an email to a stranger leaves and touches no lead; and under
 * an approved list (D5) a listed lead's email leaves with no card, while a
 * second one inside three days asks again.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { emailBinding } from '../../backend/services/email/email-binding.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { addSuppression, fileSegment, setSegmentState, addProspects, approveList, settleProspect, readSenders, fileSalesFacts, reviewSalesFacts } from '../../backend/services/sales/sales-store.js';
import { makeSalesSheet, SALES_DISCLOSURE } from '../../backend/services/sales/sales-facts.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { makeSuppression } from '../../backend/services/sales/suppress-shape.js';
import { upkeepDue } from '../../backend/services/sales/lead-upkeep.js';
import { startTlsSmtp } from '../helpers/smtp-tls-kit.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const LANE = 'mercmail';
const signed = (words) => `${words}\n\n${SALES_DISCLOSURE}\nThe Mercator`;
const ENV = ['WORKSPACES_ROOT', 'NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_EMAIL_BINDING_PATH'];
let dir; let position; let smtp; let filed = 0;
const saved = {};

const rig = () => {
  const sent = [];
  const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
  return { sent, connection: { ws, companion: { name: 'Mercator', neumaId: LANE }, walletAddress: POSITION_HOUSE, activeTurn: null } };
};
const send = async (payload, decision) => {
  filed += 1;
  const intents = path.join(workspace.pathFor(LANE), 'intents');
  await fsp.mkdir(intents, { recursive: true });
  await fsp.writeFile(path.join(intents, `mail-${filed}.json`), JSON.stringify({ type: 'email/send', ...payload }));
  const r = rig();
  const settled = sweepIntents(r.connection, { mode: 'ask', lanePolicy: null, emit: () => {} });
  if (decision) {
    let card;
    for (let i = 0; i < 100 && !card; i += 1) {
      card = r.sent.find((m) => m.type === 'tool:approval_request');
      if (!card) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(card?.tool).toBe('intents/email.send');
    resolveToolApproval(r.connection, card.id, decision);
  }
  return { receipt: (await settled)[0], cards: r.sent.filter((m) => m.type === 'tool:approval_request') };
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-mail-'));
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.WORKSPACES_ROOT = dir;
  process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(dir, 'email-credentials.json');
  process.env.NEUMA_EMAIL_BINDING_PATH = path.join(dir, 'email-binding.json');
  position = usePositionHouse(dir);
  await workspace.create(LANE);
  await ownLane(LANE);
  smtp = await startTlsSmtp(dir);
  await setEmailCredential(POSITION_HOUSE, {
    address: 'sales@tidewater.example', username: 'sales@tidewater.example', password: 'test-app-password',
    smtpHost: 'localhost', smtpPort: String(smtp.port), imapHost: 'localhost', imapPort: '1',
  });
  await emailBinding.bind(POSITION_HOUSE, 'email', { neumaId: LANE });
  await addSuppression(POSITION_HOUSE, makeSuppression({ target: 'nope.example', reason: 'asked', by: 'operator', now: new Date().toISOString() }));
}, 60000);

afterAll(async () => {
  await smtp?.close();
  position?.restore();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the mailbox and the lead engine', () => {
  test('anyone on the do-not-contact list is refused before any card, and nothing leaves', async () => {
    const { receipt, cards } = await send({ to: ['ann@acme.example', 'Bob@Nope.example'], subject: 'Hello', text: 'A short note.' });
    expect(receipt.status).toBe('denied');
    expect(receipt.error).toMatch(/Bob@Nope\.example is on the house's do-not-contact list/);
    expect(cards).toEqual([]);
    expect(smtp.received).toEqual([]);
  });

  test('an email to a lead passes the facts check first: an approved sheet, only its numbers, the disclosure line, no false urgency', async () => {
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    await ledger.add({ name: 'Fay, Founder at Facts', contact: 'fay@facts.example', channelId: 'email', status: 'cold', addedBy: LANE });
    const before = smtp.received.length;
    const noSheet = await send({ to: 'fay@facts.example', subject: 'Hello', text: signed('A short note.') });
    expect(noSheet.receipt.status).toBe('error');
    expect(noSheet.receipt.error).toMatch(/has not approved a facts sheet/);
    const sheet = makeSalesSheet({ by: LANE, now: new Date().toISOString(), facts: [
      { claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
      { claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
      { claim: 'A marine electrician built and launched his own product after the sessions', source: 'https://ignislabs.ai/testimonials' },
    ] });
    await fileSalesFacts(POSITION_HOUSE, sheet);
    expect((await send({ to: 'fay@facts.example', subject: 'Hello', text: signed('A short note.') })).receipt.error).toMatch(/has not approved a facts sheet/);
    expect(await reviewSalesFacts(POSITION_HOUSE, { sheetId: sheet.id, verdict: 'approved' })).toEqual({ ok: true });
    const bad = await send({ to: 'fay@facts.example', subject: 'Act now', text: 'Our 90 minute session doubles output by 300.' });
    expect(bad.receipt.status).toBe('error');
    expect(bad.receipt.error).toMatch(/90 is not on the approved facts sheet[\s\S]*300 is not on the approved facts sheet/);
    expect(bad.receipt.error).toMatch(/carry the disclosure line, word for word/);
    expect(bad.receipt.error).toMatch(/no false urgency/);
    expect(bad.cards).toEqual([]);
    expect(smtp.received.length).toBe(before);
    expect((await send({ to: 'fay@facts.example', subject: 'Your build', text: signed('A 60 minute session is 250 dollars, one to one.') }, 'allow')).receipt.status).toBe('ok');
    expect(smtp.received.length).toBe(before + 1);
  });

  test('an email to a lead leaves, and the lead records it itself — contacted, the house wrote last', async () => {
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    const lead = await ledger.add({ name: 'Ann, Founder at Acme', contact: 'ann@acme.example', channelId: 'email', status: 'cold', addedBy: LANE });
    const { receipt } = await send({ to: 'Ann@Acme.example', subject: 'Building your field app', text: signed('A short note from the Mercator.') }, 'allow');
    expect(receipt.status).toBe('ok');
    expect(smtp.received.at(-1).to).toEqual(['Ann@Acme.example']);
    const [after] = (await ledger.load()).filter((l) => l.id === lead.id);
    expect(after.status).toBe('contacted');
    expect(after.touches.at(-1)).toMatchObject({ status: 'contacted', direction: 'out', note: 'emailed: "Building your field app"', by: LANE });
    expect(upkeepDue({ leads: [after], now: Date.now() })).toEqual([]);
    expect(upkeepDue({ leads: [after], now: Date.now() + 4 * 86_400_000 })[0]).toMatchObject({ kind: 'follow-up', touches: 1 });
  });

  test('a reply moves the lead to replied; answering it takes the answer off the list but keeps the status', async () => {
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    const [lead] = (await ledger.load()).filter((l) => l.contact === 'ann@acme.example');
    await ledger.touch(lead.id, { status: 'replied', direction: 'in', note: 'wrote to the house (mail #7)', by: 'mail-watch' });
    expect(upkeepDue({ leads: await ledger.load(), now: Date.now() })[0]).toMatchObject({ kind: 'answer', leadId: lead.id });
    expect((await send({ to: 'ann@acme.example', subject: 'Re: Building your field app', text: signed('Tuesday works.') }, 'allow')).receipt.status).toBe('ok');
    const [after] = (await ledger.load()).filter((l) => l.id === lead.id);
    expect(after.status).toBe('replied');
    expect(after.touches.at(-1)).toMatchObject({ direction: 'out' });
    expect(upkeepDue({ leads: [after], now: Date.now() })).toEqual([]);
    expect(await ledger.touch(lead.id, { direction: 'sideways', by: 'x' })).toEqual({ ok: false, error: 'direction is one of in, out' });
  });

  test('an email to a stranger leaves and touches no lead', async () => {
    const before = JSON.stringify(await (await leadLedgerFor(POSITION_HOUSE)).load());
    const { receipt } = await send({ to: 'friend@elsewhere.example', subject: 'Lunch', text: 'Thursday?' }, 'allow');
    expect(receipt.status).toBe('ok');
    expect(receipt.detail ?? '').not.toMatch(/Recorded on/);
    expect(JSON.stringify(await (await leadLedgerFor(POSITION_HOUSE)).load())).toBe(before);
  });
});

describe('the sales cover through the real sweep — the operator approved the list once', () => {
  test('a listed lead\'s first email leaves with no card; a second inside three days asks again', async () => {
    await croDesignation.designate(POSITION_HOUSE, LANE);
    const now = new Date().toISOString();
    const segment = makeSegment({
      name: 'Harbour founders', offer: 'One-to-one coaching to build your own product with AI tools', customerProblem: 'They cannot build what they know',
      targetRole: 'Founder', targetGeography: 'United Kingdom', positiveCriteria: ['Building a software product'], why: 'Raw AI tools leave them stuck', by: LANE, now,
    });
    await fileSegment(POSITION_HOUSE, segment);
    await setSegmentState(POSITION_HOUSE, segment.id, 'approved', 'operator');
    const prospect = makeProspect({
      segment, domain: 'quay.example', name: 'Quay', source: 'https://quay.example/', by: LANE, now,
      scores: [{ criterion: 'Building a software product', score: 5, reasoning: 'their site says a field app is in beta' }],
      people: [{ name: 'Rosa', role: 'Founder', sourceUrl: 'https://quay.example/team' }],
    });
    await addProspects(POSITION_HOUSE, [prospect]);
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    const lead = await ledger.add({ name: 'Rosa, Founder at Quay', contact: 'rosa@quay.example', channelId: 'email', status: 'cold', addedBy: LANE });
    await settleProspect(POSITION_HOUSE, prospect.id, { type: 'promoted', leadId: lead.id, by: LANE });

    // Before the list is approved: it asks.
    const unlisted = await send({ to: 'rosa@quay.example', subject: 'Your field app', text: signed('A short note.') }, 'deny');
    expect(unlisted.receipt.status).toBe('denied');
    expect(await approveList(POSITION_HOUSE, segment.id, 'operator')).toEqual({ ok: true, count: 1 });

    const sentBefore = smtp.received.length;
    const first = await send({ to: 'rosa@quay.example', subject: 'Your field app', text: signed('A short note from the Mercator.') });
    expect(first.receipt.status).toBe('ok');
    expect(first.cards).toEqual([]);
    expect(smtp.received.slice(sentBefore).map((m) => m.to)).toEqual([['rosa@quay.example']]);
    expect((await ledger.load()).find((l) => l.id === lead.id).touches.at(-1)).toMatchObject({ direction: 'out', status: 'contacted' });
    // The sending address's first day writing to leads is noted: its ramp counts from here.
    expect(Object.keys(await readSenders(POSITION_HOUSE))).toEqual(['sales@tidewater.example']);

    const again = await send({ to: 'rosa@quay.example', subject: 'Following up', text: signed('One more thing.') }, 'deny');
    expect(again.cards).toHaveLength(1);
    expect(again.receipt.status).toBe('denied');
    expect(smtp.received.length).toBe(sentBefore + 1);
  });
});
