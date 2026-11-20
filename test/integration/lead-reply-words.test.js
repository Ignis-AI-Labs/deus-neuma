/**
 * THEIR REPLY, WORD FOR WORD, AND WHAT EACH STAGED EMAIL IS (GET /lead-engine/mail/:uid, lead-thread.js,
 * sales-pipeline-view.js emailKind/answerOf, SalesStagesOut.jsx) — Design note, 2026-11-19: […] And: […] — a
 * staged […] read ALREADY EMAILED […] because they had written last.
 * Then (Design note, 2026-11-19, the same reply): […] — it sat on READING THEIR EMAIL: read once and kept on the lead, found in All
 * Mail when it has left the inbox, an HTML-only email read as words, and a read that fails says so with TRY AGAIN.
 * A real app, a real signed session, a real house, a real IMAP server over TLS on loopback (imap-tls-kit.js) holding
 * their email (RULE 0); the screen rendered for real.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { startTlsImap } from '../helpers/imap-tls-kit.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { recordSent } from '../../backend/services/sales/email-ledger.js';
import { stageDraft } from '../../backend/services/sales/email-outbox.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { emailKind, answerOf, isAutoReply, EMAIL_KINDS } from '../../frontend/app/RelinkShell/company-line/sales-pipeline-view.js';
import { RepliesStage, TheirReply } from '../../frontend/app/RelinkShell/company-line/SalesStagesOut.jsx';
import { Outbox } from '../../frontend/app/RelinkShell/company-line/Outbox.jsx';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();

describe('what a staged email is to its person (pure)', () => {
  test('the first ever, a follow-up when they have not answered since, a reply when they wrote last — and every email before still shows', () => {
    const drafts = [
      { id: 'm-1', to: ['a@x.io'], subject: 'First', state: 'sent', sentAt: '2026-11-17T09:00:00Z' },
      { id: 'm-2', to: ['a@x.io'], subject: 'Checking back', state: 'waiting' },
      { id: 'm-3', to: ['new@y.io'], subject: 'Hello', state: 'waiting' },
      { id: 'm-4', to: ['c@z.io'], subject: 'Re: Umbrae', state: 'waiting' },
    ];
    const leads = [
      { contact: 'a@x.io', thread: [{ at: '2026-11-17T09:00:00Z', way: 'out', note: 'emailed: "First"' }] },
      { contact: 'c@z.io', thread: [{ at: '2026-11-18T18:47:00Z', way: 'out', note: 'emailed: "Umbrae: Multi-Chain DLMM, Live"' }, { at: '2026-11-18T18:51:00Z', way: 'in', note: 'wrote to the house (mail #7232)' }] },
    ];
    expect(drafts.slice(1).map((d) => emailKind(d, drafts, leads).kind)).toEqual(['follow-up', 'first', 'reply']);
    // The "Re:" to the one who wrote last still says when they were emailed (it read "—" before).
    expect(emailKind(drafts[3], drafts, leads)).toMatchObject({ lastOut: { at: '2026-11-18T18:47:00Z', subject: 'Umbrae: Multi-Chain DLMM, Live' }, lastIn: { at: '2026-11-18T18:51:00Z' } });
    expect(Object.values(EMAIL_KINDS)).toEqual(['FIRST EMAIL', 'FOLLOW-UP', 'REPLY']);
    expect([isAutoReply({ subject: 'Automatic reply: Umbrae' }), isAutoReply({ subject: 'Re: Umbrae', text: 'Thank you for contacting Blockchain Capital. We review every email.' }), isAutoReply({ subject: 'Re: Umbrae', text: 'Yes, send it.' })]).toEqual([true, true, false]);
  });

  test('where the answer to someone who wrote stands: staged, sent, or owed', () => {
    const lead = { contact: 'c@z.io', thread: [{ at: '2026-11-18T18:51:00Z', way: 'in', note: 'wrote to the house (mail #7232)' }] };
    expect(answerOf({ outbox: { drafts: [{ id: 'm-4', to: ['c@z.io'], subject: 'Re: Umbrae', state: 'waiting' }] } }, lead)).toEqual({ state: 'staged', subject: 'Re: Umbrae' });
    expect(answerOf({ outbox: { drafts: [] } }, lead)).toEqual({ state: 'owed' });
    expect(answerOf({ outbox: { drafts: [] } }, { ...lead, thread: [...lead.thread, { at: '2026-11-19T08:00:00Z', way: 'out', note: 'emailed: "Re: Umbrae"' }] })).toEqual({ state: 'sent', at: '2026-11-19T08:00:00Z' });
  });
});

describe('their reply, read from the house mailbox', () => {
  let me, app, imap;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-reply-words-test-key';
    useTempRealm();
    const tmp = await createTempDir('lead-reply-words');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    imap = await startTlsImap(tmp);
    await setEmailCredential(me.address, {
      address: 'orrin@house.example', username: 'orrin@house.example', password: 'test-app-password',
      smtpHost: 'localhost', smtpPort: '1', imapHost: 'localhost', imapPort: String(imap.port),
    });
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
  }, 60000);
  afterAll(async () => {
    await imap?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a reply recorded before its words were kept is read again by its number, without the email it quoted; only a message a lead names', async () => {
    const ledger = await leadLedgerFor(me.address);
    const lead = await ledger.add({ name: 'Blockchain Capital Team', contact: 'contact@blockchaincapital.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await recordSent(me.address, { to: ['contact@blockchaincapital.example'], subject: 'Umbrae: Multi-Chain DLMM, Live', by: 'operator', from: 'orrin@house.example' });
    const uid = imap.deliver({ from: 'Blockchain Capital <contact@blockchaincapital.example>', subject: 'Re: Umbrae: Multi-Chain DLMM, Live',
      body: 'Hi Orrin, yes - please send the short summary of Umbrae and the raise.\r\nBart\r\n\r\nOn Tue, Orrin wrote:\r\n> Hello, Blockchain Capital has been a partner' });
    await ledger.touch(lead.id, { status: 'replied', direction: 'in', note: `wrote to the house (mail #${uid})`, by: 'mail-watch' });
    const stranger = imap.deliver({ from: 'Someone <x@else.example>', subject: 'Private', body: 'Not a lead.' });

    const read = await as(request(app).get(`/api/v1/revenue/lead-engine/mail/${uid}`));
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ uid, subject: 'Re: Umbrae: Multi-Chain DLMM, Live', words: 'Hi Orrin, yes - please send the short summary of Umbrae and the raise.\nBart' });
    expect(read.body.text).toContain('> Hello, Blockchain Capital has been a partner');
    expect((await as(request(app).get(`/api/v1/revenue/lead-engine/mail/${stranger}`))).status).toBe(404);
    expect((await request(app).get(`/api/v1/revenue/lead-engine/mail/${uid}`)).status).toBe(401);

    // The engine's thread carries the message's number; a staged "Re:" is a REPLY, with the first email still shown.
    await stageDraft(me.address, { to: ['contact@blockchaincapital.example'], subject: 'Re: Umbrae: Multi-Chain DLMM, Live', text: 'Hello, here is the summary of Umbrae and the raise.', by: 'merc' });
    const engine = (await as(request(app).get('/api/v1/revenue/lead-engine'))).body;
    const onEngine = engine.leads.find((l) => l.id === lead.id);
    expect(onEngine.thread.at(-1)).toMatchObject({ way: 'in', uid });
    const outbox = renderToStaticMarkup(createElement(Outbox, { outbox: engine.outbox, leads: engine.leads, busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {} }));
    expect(outbox).toContain('data-email-kind="reply"');
    expect(outbox).toMatch(/YES · \d{4}-\d{2}-\d{2}/);
    // REPLIES: the row says the answer waits in EMAILS.
    const replies = renderToStaticMarkup(createElement(RepliesStage, { engine: { ...engine, upkeep: engine.upkeep ?? [] }, view: 'all' }));
    expect(replies).toContain('data-answer="staged"');
    expect(replies).toContain('STAGED — IN EMAILS');
  }, 60000);

  test('one archived since it was recorded is found in All Mail by who sent it and when; an HTML-only one reads as words; each is kept on the lead once read', async () => {
    const ledger = await leadLedgerFor(me.address);
    const eric = await ledger.add({ name: 'Eric Ma', contact: 'eric@nba-limited.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    const uid = imap.deliver({ from: 'Eric Ma <eric@nba-limited.example>', subject: 'Re: Umbrae', body: 'Yes, send the deck.\r\nEric\r\n\r\n> Hello, Umbrae is a multi-chain DLMM' });
    await ledger.touch(eric.id, { status: 'replied', direction: 'in', note: `wrote to the house (mail #${uid})`, by: 'mail-watch' });
    imap.archive(uid);

    const read = await as(request(app).get(`/api/v1/revenue/lead-engine/mail/${uid}`));
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ subject: 'Re: Umbrae', words: 'Yes, send the deck.\nEric', folder: '[Gmail]/All Mail' });

    // Kept: the lead's thread now carries their words, so the row opens on them without asking the mailbox again.
    const logins = imap.state.logins;
    const engine = (await as(request(app).get('/api/v1/revenue/lead-engine'))).body;
    const said = engine.leads.find((l) => l.id === eric.id).thread.at(-1);
    expect(said).toMatchObject({ way: 'in', uid, subject: 'Re: Umbrae', text: 'Yes, send the deck.\nEric' });
    expect(imap.state.logins).toBe(logins);
    const opened = renderToStaticMarkup(createElement(TheirReply, { message: said }));
    expect(opened).toContain('data-read="words"');
    expect(opened).toContain('Yes, send the deck.');
    // One not yet kept says it is reading from the mailbox (and, if the read fails, why, with TRY AGAIN).
    expect(renderToStaticMarkup(createElement(TheirReply, { message: { ...said, text: undefined, subject: undefined } }))).toContain('READING THEIR EMAIL FROM THE MAILBOX');

    // An email with no plain part: its words, never its markup.
    const alex = await ledger.add({ name: 'Alexander van der Drift', contact: 'alex@bitnorm.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    const html = imap.deliver({ from: 'Alexander <alex@bitnorm.example>', subject: 'Re: Umbrae', contentType: 'text/html; charset=utf-8',
      body: '<html><body><p>Happy to talk <b>Thursday</b>.</p><p>Alexander</p></body></html>' });
    await ledger.touch(alex.id, { status: 'replied', direction: 'in', note: `wrote to the house (mail #${html})`, by: 'mail-watch' });
    const asWords = await as(request(app).get(`/api/v1/revenue/lead-engine/mail/${html}`));
    expect(asWords.status, JSON.stringify(asWords.body)).toBe(200);
    expect(asWords.body.words).toMatch(/Happy to talk\s+Thursday/);
    expect(asWords.body.words).toContain('Alexander');
    expect(asWords.body.words).not.toMatch(/[<>]/);
    expect(asWords.body.folder).toBe('INBOX');

    // A reply the watch kept as markup before the mailbox read HTML-only email as words (Design note, 2026-11-20: […]) reads as words on the lead's thread too — nothing on the ledger is rewritten for it.
    const katie = await ledger.add({ name: 'Katie Partner', contact: 'katie@kv.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await ledger.touch(katie.id, { status: 'replied', direction: 'in', note: 'wrote to the house (mail #7258)', by: 'mail-watch' });
    expect(await ledger.keepWords(katie.id, 'mail #7258', { subject: 'Re: Deus Neuma: Local AI, Live', text: '<div dir="ltr">Hello, <br><br>Katie has moved on. Write to <a href="mailto:desk@kv.example">desk@kv.example</a></div>' })).toEqual({ ok: true });
    const later = (await as(request(app).get('/api/v1/revenue/lead-engine'))).body;
    expect(later.leads.find((l) => l.id === katie.id).thread.at(-1)).toMatchObject({ way: 'in', text: 'Hello,\nKatie has moved on. Write to desk@kv.example' });
  }, 60000);
});
