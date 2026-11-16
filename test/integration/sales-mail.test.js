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
import process from 'node:process';
import { setTimeout } from 'node:timers';
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
import { readOutbox, setReview, editDraft, returnDraft, sendDraft, outboxText, foldOutbox } from '../../backend/services/sales/email-outbox.js';
import { salesWaitingItems } from '../../backend/services/sales/sales-waiting.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const LANE = 'mercmail';
// A lead's email as the seat writes it: the words, ONE ask, the disclosure line, its name.
const signed = (words) => `${words} May I send two short written ideas?\n\n${SALES_DISCLOSURE}\nThe Mercator`;
const PROMISE = 'two short written ideas on finishing their field app';
const ENV = ['WORKSPACES_ROOT', 'NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_EMAIL_BINDING_PATH'];
let dir; let position; let smtp; let reader; let priorConfig; let filed = 0;

// The house's model, stood in on loopback (local-provider.js): it answers the claims reader from the email it is shown.
const claimsAnswer = (body) => {
  if (!String(body.messages?.[0]?.content ?? '').startsWith('You are the CLAIMS READER')) return null;
  const shown = String(body.messages[1].content);
  if (shown.includes('yield ladder')) return '1 | one-to-one sessions\nNONE | a Base yield ladder that earns on your balances';
  if (shown.includes('GARBLED')) return 'Looks fine to me.';
  if (shown.includes('250 dollars')) return '2 | a session costs 250 dollars an hour';
  return 'NO CLAIMS';
};
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
  await fsp.writeFile(path.join(intents, `mail-${filed}.json`), JSON.stringify({ type: 'email/send', promise: PROMISE, ...payload }));
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
  reader = await startLocalProvider({ respond: claimsAnswer });
  priorConfig = getConfig();
  setConfig({ provider: 'lm-studio', endpoint: reader.endpoint, model: 'test-model', apiKey: '' });
  await setEmailCredential(POSITION_HOUSE, {
    address: 'sales@tidewater.example', username: 'sales@tidewater.example', password: 'test-app-password', sendAs: 'ignis = hello@ignis.example',
    smtpHost: 'localhost', smtpPort: String(smtp.port), imapHost: 'localhost', imapPort: '1',
  });
  await emailBinding.bind(POSITION_HOUSE, 'email', { neumaId: LANE });
  await addSuppression(POSITION_HOUSE, makeSuppression({ target: 'nope.example', reason: 'asked', by: 'operator', now: new Date().toISOString() }));
  // The cases below prove a SEND and the sales cover; REVIEW FIRST (on by default) is proven in its own block at the end.
  await setReview(POSITION_HOUSE, false);
}, 60000);

afterAll(async () => {
  await smtp?.close();
  if (priorConfig) setConfig(priorConfig);
  await reader?.close();
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
    await ledger.add({ name: 'Fay, Founder at Facts', contact: 'fay@facts.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE });
    const before = smtp.received.length;
    const noSheet = await send({ to: 'fay@facts.example', subject: 'Hello', text: signed('A short note.') });
    expect(noSheet.receipt.status).toBe('error');
    expect(noSheet.receipt.error).toMatch(/has not approved a facts sheet/);
    const sheet = makeSalesSheet({ by: LANE, now: new Date().toISOString(), facts: [
      { company: 'ignis', claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
      { company: 'ignis', claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
      { company: 'ignis', claim: 'A marine electrician built and launched his own product after the sessions', source: 'https://ignislabs.ai/testimonials' },
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
    // The claims reader saw the approved facts and the email, framed as untrusted.
    const asked = reader.turns.at(-1).messages[1].content;
    expect(asked).toContain('2. A session costs 250 US dollars an hour [250 USD]');
    expect(asked).toContain('A 60 minute session is 250 dollars');
  });

  test('a claim no fact states stops the email before any card; an answer that cannot be read, or no reader at all, sends nothing', async () => {
    const before = smtp.received.length;
    const invented = await send({ to: 'fay@facts.example', subject: 'An idea', text: signed('Put your balances in our yield ladder and earn more.') });
    expect(invented.receipt.status).toBe('error');
    expect(invented.receipt.error).toMatch(/claims what the approved facts do not state: "a Base yield ladder that earns on your balances"/);
    expect(invented.cards).toEqual([]);
    const garbled = await send({ to: 'fay@facts.example', subject: 'An idea', text: signed('GARBLED note.') });
    expect(garbled.receipt.error).toMatch(/the claims check could not run: the reader's answer could not be read/);
    setConfig({ endpoint: 'http://127.0.0.1:1' });
    const unreachable = await send({ to: 'fay@facts.example', subject: 'An idea', text: signed('A short note.') });
    setConfig({ endpoint: reader.endpoint });
    expect(unreachable.receipt.error).toMatch(/the claims check could not run \(.+\) — nothing is sent until it can/);
    expect(smtp.received.length).toBe(before);
  });

  test('a FIRST email to a lead is short, plainly titled, asks one thing and names its promise — or it stops before any card', async () => {
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    await ledger.add({ name: 'Zed, Founder at Zeta', contact: 'zed@zeta.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE });
    const before = smtp.received.length;
    const refused = async (payload, why) => {
      const { receipt, cards } = await send({ to: 'zed@zeta.example', subject: 'Your field app', text: signed('A short note.'), ...payload });
      expect(receipt).toMatchObject({ status: 'error', error: expect.stringMatching(why) });
      expect(cards).toEqual([]);
    };
    await refused({ text: signed('A short note. '.repeat(60)) }, /first email to a lead: a first email is at most 130 words and this one is 18\d/);
    await refused({ subject: 'Six plain words are one too many' }, /subject is at most 5 plain words/);
    await refused({ text: signed('Would a call help? Or a demo?') }, /asks ONE thing \(one question\) and this one asks 3/);
    await refused({ text: `A short note.\n\n${SALES_DISCLOSURE}\nThe Mercator` }, /asks ONE thing \(one question\) and this one asks 0/);
    await refused({ promise: '' }, /add promise: one line saying exactly what you will send them when they say yes/);
    expect(smtp.received.length).toBe(before);
    await ledger.remove((await ledger.load()).find((l) => l.contact === 'zed@zeta.example').id);
  });

  test('an email to a lead leaves, and the lead records it itself — contacted, the house wrote last', async () => {
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    const lead = await ledger.add({ name: 'Ann, Founder at Acme', contact: 'ann@acme.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE });
    const { receipt } = await send({ to: 'Ann@Acme.example', subject: 'Building your field app', text: signed('A short note from the Mercator.') }, 'allow');
    expect(receipt.status).toBe('ok');
    expect(smtp.received.at(-1).to).toEqual(['Ann@Acme.example']);
    const [after] = (await ledger.load()).filter((l) => l.id === lead.id);
    expect(after.status).toBe('contacted');
    expect(after.touches.at(-1)).toMatchObject({ status: 'contacted', direction: 'out', promised: PROMISE, note: 'emailed: "Building your field app"', by: LANE });
    // The promise is the house's own record: it never rides the wire.
    expect(JSON.stringify(smtp.received.at(-1))).not.toContain(PROMISE);
    expect(upkeepDue({ leads: [after], now: Date.now() })).toEqual([]);
    expect(upkeepDue({ leads: [after], now: Date.now() + 4 * 86_400_000 })[0]).toMatchObject({ kind: 'follow-up', touches: 1 });
  });

  test('a reply moves the lead to replied; answering it takes the answer off the list but keeps the status', async () => {
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    const [lead] = (await ledger.load()).filter((l) => l.contact === 'ann@acme.example');
    await ledger.touch(lead.id, { status: 'replied', direction: 'in', note: 'wrote to the house (mail #7)', by: 'mail-watch' });
    // The moment they reply, the seat reads what it owes them, and for how many hours.
    expect(upkeepDue({ leads: await ledger.load(), now: Date.now() + 5 * 3_600_000 })[0]).toMatchObject({ kind: 'answer', leadId: lead.id, hours: 5, promised: PROMISE });
    // An answer is not a first email: it may run long, ask twice and promise nothing new.
    const long = `${'Here is the first idea in full. '.repeat(40)} Does Tuesday work? Or Thursday?`;
    expect((await send({ to: 'ann@acme.example', subject: 'Re: Building your field app, the two ideas I promised you', text: signed(long), promise: '' }, 'allow')).receipt.status).toBe('ok');
    await ledger.touch(lead.id, { direction: 'in', note: 'wrote to the house (mail #8)', by: 'mail-watch' });
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
      name: 'Harbour founders', offer: 'One-to-one coaching to build your own product with AI tools', company: 'ignis', customerProblem: 'They cannot build what they know',
      targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Building a software product'], why: 'Raw AI tools leave them stuck', by: LANE, now,
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
    const lead = await ledger.add({ name: 'Rosa, Founder at Quay', contact: 'rosa@quay.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE });
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
    // One mailbox, several addresses: Rosa is a lead of the ignis audience, so it left from ignis's own address.
    expect(smtp.received.at(-1).from).toBe('hello@ignis.example');
    expect(smtp.received.at(-1).data).toContain('From: <hello@ignis.example>');
    expect(first.receipt.content ?? first.receipt.detail ?? JSON.stringify(first.receipt)).toContain('from hello@ignis.example');
    expect((await ledger.load()).find((l) => l.id === lead.id).touches.at(-1)).toMatchObject({ direction: 'out', status: 'contacted' });
    // The sending address's first day writing to leads is noted: its ramp counts from here.
    expect(Object.keys(await readSenders(POSITION_HOUSE)).sort()).toEqual(['hello@ignis.example', 'sales@tidewater.example']);
    // An address the mailbox does not hold is refused before any card, and nothing leaves.
    const stranger = await send({ to: 'friend@elsewhere.example', subject: 'Lunch', text: 'Thursday?', from: 'ceo@bigbank.example' });
    expect(stranger.receipt).toMatchObject({ status: 'error', error: expect.stringMatching(/ceo@bigbank\.example is not an address this mailbox sends as/) });
    expect(stranger.cards).toEqual([]);

    const again = await send({ to: 'rosa@quay.example', subject: 'Following up', text: signed('One more thing.') }, 'deny');
    expect(again.cards).toHaveLength(1);
    expect(again.receipt.status).toBe('denied');
    expect(smtp.received.length).toBe(sentBefore + 1);
  });
});

describe('REVIEW FIRST — the seat stages, the operator reads, and only then does an email leave', () => {
  const stage = async (payload) => {
    filed += 1;
    const intents = path.join(workspace.pathFor(LANE), 'intents');
    await fsp.mkdir(intents, { recursive: true });
    await fsp.writeFile(path.join(intents, `draft-${filed}.json`), JSON.stringify({ type: 'sales/draft-email', promise: PROMISE, ...payload }));
    const r = rig();
    const [receipt] = await sweepIntents(r.connection, { mode: 'ask', lanePolicy: null, emit: () => {} });
    return { receipt, cards: r.sent.filter((m) => m.type === 'tool:approval_request') };
  };
  const GOOD = signed('A 60 minute session is 250 dollars, one to one.');

  test('it is on until the operator turns it off', () => {
    expect(foldOutbox([])).toEqual({ review: true, drafts: [] });
    expect(foldOutbox([{ type: 'review', on: false }]).review).toBe(false);
  });

  test('with it on, an email to a lead cannot be sent directly; staged, it is checked like a send and waits, unsent', async () => {
    await croDesignation.designate(POSITION_HOUSE, LANE);
    await setReview(POSITION_HOUSE, true);
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    await ledger.add({ name: 'Otto, Owner at Outbox', contact: 'otto@outbox.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE });
    const before = smtp.received.length;
    // A direct send is refused before any card, and says where the email goes instead.
    const direct = await send({ to: 'otto@outbox.example', subject: 'Your build', text: GOOD });
    expect(direct.receipt.status).toBe('denied');
    expect(direct.receipt.error).toMatch(/REVIEW FIRST is on\): stage this one with sales\/draft-email/);
    expect(direct.cards).toEqual([]);
    // A draft that fails a send's checks is refused with the reason, and nothing is staged.
    const bad = await stage({ to: 'otto@outbox.example', subject: 'Your build', text: signed('Our 90 minute session doubles output.') });
    expect(bad.receipt.error).toMatch(/90 is not on the approved facts sheet/);
    expect((await readOutbox(POSITION_HOUSE)).drafts).toEqual([]);
    expect((await stage({ to: 'Bob@Nope.example', subject: 'Hello', text: GOOD })).receipt.error).toMatch(/do-not-contact list/);
    // One that passes waits: no card, nothing on the wire, the lead untouched.
    const staged = await stage({ to: 'otto@outbox.example', subject: 'Your build', text: GOOD });
    expect(staged.receipt.status, staged.receipt.error).toBe('ok');
    expect(staged.receipt.content).toMatch(/^Staged for your operator's review \[m-[0-9a-f]{8}\]: to otto@outbox\.example, "Your build"\. It has NOT been sent\./);
    expect(staged.cards).toEqual([]);
    expect(smtp.received.length).toBe(before);
    expect((await ledger.load()).find((l) => l.contact === 'otto@outbox.example').status).toBe('cold');
    const [draft] = (await readOutbox(POSITION_HOUSE)).drafts;
    expect(draft).toMatchObject({ to: ['otto@outbox.example'], subject: 'Your build', text: GOOD, promise: PROMISE, by: LANE, state: 'waiting', edited: false });
    // One email a person at a time.
    expect((await stage({ to: 'otto@outbox.example', subject: 'Again', text: GOOD })).receipt.error).toMatch(/already waits for your operator \("Your build"\)/);
    // It stands where every other decision stands, and the seat is told what waits.
    expect((await salesWaitingItems(POSITION_HOUSE, new Map([[LANE, 'Mercator']]))).filter((i) => i.kind === 'sales-email').map((i) => [i.title, i.where.tab])).toEqual([['1 email to leads waits for your review', 'leads']]);
    expect(outboxText(await readOutbox(POSITION_HOUSE))).toMatch(/^REVIEW FIRST is ON[\s\S]*Staged and waiting for your operator: 1 \(otto@outbox\.example\)/);
  }, 60000);

  test('the operator returns one with what should change; the seat is told and stages it again', async () => {
    const [draft] = (await readOutbox(POSITION_HOUSE)).drafts;
    expect(await returnDraft(POSITION_HOUSE, draft.id, 'Open with his product, not ours.')).toEqual({ ok: true });
    const box = await readOutbox(POSITION_HOUSE);
    expect(box.drafts[0]).toMatchObject({ state: 'returned', note: 'Open with his product, not ours.' });
    expect(outboxText(box)).toContain('RETURNED by your operator — to otto@outbox.example, "Your build": Open with his product, not ours. Rewrite it and stage it again.');
    expect(await sendDraft(POSITION_HOUSE, draft.id)).toMatchObject({ ok: false, reason: 'no such email waits in the outbox' });
    expect((await stage({ to: 'otto@outbox.example', subject: 'Your field app', text: GOOD })).receipt.status).toBe('ok');
  }, 60000);

  test('the operator changes its words, and a send from the outbox is a real send: the mailbox, the lead contacted, once', async () => {
    const draft = (await readOutbox(POSITION_HOUSE)).drafts.find((d) => d.state === 'waiting');
    const before = smtp.received.length;
    // A change that breaks the facts is caught when it is sent, not let through because a person made it.
    expect(await editDraft(POSITION_HOUSE, draft.id, { text: signed('Our 90 minute session doubles output.') })).toEqual({ ok: true });
    const refused = await sendDraft(POSITION_HOUSE, draft.id);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/90 is not on the approved facts sheet/);
    expect(smtp.received.length).toBe(before);
    expect(await editDraft(POSITION_HOUSE, draft.id, { subject: 'Your field app, Otto', text: GOOD })).toEqual({ ok: true });
    const sent = await sendDraft(POSITION_HOUSE, draft.id);
    expect(sent).toMatchObject({ ok: true, to: ['otto@outbox.example'] });
    expect(smtp.received.length).toBe(before + 1);
    expect(smtp.received.at(-1).data).toContain('Subject: Your field app, Otto');
    const lead = (await (await leadLedgerFor(POSITION_HOUSE)).load()).find((l) => l.contact === 'otto@outbox.example');
    expect(lead.status).toBe('contacted');
    expect(lead.touches.at(-1)).toMatchObject({ direction: 'out' });
    expect((await readOutbox(POSITION_HOUSE)).drafts.find((d) => d.id === draft.id)).toMatchObject({ state: 'sent', edited: true });
    // Sent once: a second press finds nothing waiting, and nothing more leaves.
    expect((await sendDraft(POSITION_HOUSE, draft.id)).ok).toBe(false);
    expect(smtp.received.length).toBe(before + 1);
    expect((await salesWaitingItems(POSITION_HOUSE, new Map())).filter((i) => i.kind === 'sales-email')).toEqual([]);
  }, 60000);
});

