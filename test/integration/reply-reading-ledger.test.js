/**
 * REPLIES ORGANISE THEMSELVES — Design note, 2026-11-20: […]
 *
 * Real mail watch step (settleMail) reading real messages from a real TLS IMAP box, the real lead ledger and
 * do-not-contact list on a temp realm, the real upkeep, the real desk routes with real auth, and the real REPLIES
 * stage rendered. No mocks (RULE 0).
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
import { setEmailCredential, resolveEmailCredential } from '../../backend/services/email/email-credentials.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { recordSent } from '../../backend/services/sales/email-ledger.js';
import { settleMail, readStandingReplies } from '../../backend/services/sales/mail-upkeep.js';
import { readSuppressions } from '../../backend/services/sales/sales-store.js';
import { upkeepDue } from '../../backend/services/sales/lead-upkeep.js';
import { saidOf } from '../../backend/services/sales/reply-said.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { RepliesStage, Replied } from '../../frontend/app/RelinkShell/company-line/SalesStagesOut.jsx';
import { replyRows, closedRows, sentRows, saidLabel } from '../../frontend/app/RelinkShell/company-line/sales-pipeline-view.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const PEOPLE = {
  deck: ['Dana Reyes', 'dana@fundone.example', 'Thanks Orrin, this looks interesting. Can you send the deck over?\r\nDana'],
  no: ['Noel Park', 'noel@fundtwo.example', 'Thanks for reaching out. This is not a fit for us at this time. Best of luck.\r\nNoel'],
  gone: ['Katie Mishra', 'katie@fundthree.example', 'Hello,\r\nKatie Mishra has transitioned out of Fund Three. If you would like to speak with someone please email team@fundthree.example .\r\nFund Three'],
  away: ['Avery Lund', 'avery@fundfour.example', 'I am out of the office until Monday with limited access to email.'],
  plain: ['Piet Vos', 'piet@fundfive.example', 'Got it, thanks.\r\nPiet'],
};

describe('a reply is read, and the lead moves by what it says', () => {
  let me; let app; let imap; let credentials; let ledger; const ids = {};
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const lead = async (key) => (await ledger.load()).find((l) => l.id === ids[key]);
  const board = async () => (await as(request(app).get('/api/v1/revenue/lead-engine'))).body;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'reply-reading-ledger-test-key';
    useTempRealm();
    const tmp = await createTempDir('reply-reading-ledger');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    imap = await startTlsImap(tmp);
    await setEmailCredential(me.address, {
      address: 'orrin@house.example', username: 'orrin@house.example', password: 'test-app-password',
      smtpHost: 'localhost', smtpPort: '1', imapHost: 'localhost', imapPort: String(imap.port),
    });
    credentials = await resolveEmailCredential(me.address);
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    ledger = await leadLedgerFor(me.address);
    for (const [key, [name, contact]] of Object.entries(PEOPLE)) {
      ids[key] = (await ledger.add({ name, contact, channelId: 'email', kind: 'investor', status: 'cold', addedBy: 'merc' })).id;
      await recordSent(me.address, { to: [contact], subject: 'Deus Neuma: Local AI, Live', by: 'operator', from: 'orrin@house.example', promise: 'the deck at deusneuma.example/deck' });
    }
  }, 60000);
  afterAll(async () => {
    await imap?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  // One message arrives and the mail watch settles it, exactly as the watch does.
  const arrives = async (key, subject = 'Re: Deus Neuma: Local AI, Live') => {
    const [name, contact, body] = PEOPLE[key];
    const uid = imap.deliver({ from: `${name} <${contact}>`, subject, body });
    return settleMail(me.address, { credentials, message: { uid, from: `${name} <${contact}>`, subject }, sender: contact, isLead: true, leads: await ledger.load() });
  };

  test('someone asks for the deck: marked as wanting it, owed an answer first, and the member is told what was asked', async () => {
    expect(await arrives('deck')).toEqual({ kind: 'reply', said: 'wants' });
    const dana = await lead('deck');
    expect(dana.status).toBe('replied');
    expect(saidOf(dana)).toEqual({ says: 'wants', want: 'deck', why: 'Can you send the deck over?', by: 'mail-watch' });
    expect(dana.touches.at(-1).note).toMatch(/^wrote to the house \(mail #\d+\) — they asked for the deck$/);
    const due = upkeepDue({ leads: await ledger.load(), now: Date.now() }).find((d) => d.leadId === dana.id);
    expect(due).toMatchObject({ kind: 'answer', said: 'wants', want: 'deck', promised: 'the deck at deusneuma.example/deck' });
  }, 30000);

  test('someone says no: the lead closes by itself, nothing more is due on it, and the contact is kept — not on the do-not-contact list', async () => {
    expect(await arrives('no')).toEqual({ kind: 'reply', said: 'no' });
    const noel = await lead('no');
    expect(noel.status).toBe('lost');
    expect(saidOf(noel)).toMatchObject({ says: 'no', why: 'This is not a fit for us at this time.' });
    expect(noel.contact).toBe('noel@fundtwo.example'); // still a contact on the ledger
    expect(upkeepDue({ leads: await ledger.load(), now: Date.now() + 40 * 86_400_000 }).some((d) => d.leadId === noel.id)).toBe(false); // never chased, however long it sits
    expect(await readSuppressions(me.address)).toEqual([]);
  }, 30000);

  test('the person has left: closed, with where their office pointed', async () => {
    expect(await arrives('gone')).toEqual({ kind: 'reply', said: 'gone' });
    const katie = await lead('gone');
    expect(katie.status).toBe('lost');
    expect(saidOf(katie)).toMatchObject({ says: 'gone', forward: ['team@fundthree.example'] });
  }, 30000);

  test('an out-of-office moves nothing: no answer is owed, and the follow-up still comes due', async () => {
    expect(await arrives('away', 'Automatic reply: Deus Neuma: Local AI, Live')).toEqual({ kind: 'reply', said: 'auto' });
    const avery = await lead('away');
    expect(avery.status).toBe('contacted');
    const leads = (await ledger.load()).map((l) => (l.id === avery.id ? { ...l, kind: 'buyer' } : l));
    expect(upkeepDue({ leads, now: Date.now() }).some((d) => d.leadId === avery.id)).toBe(false);
    expect(upkeepDue({ leads, now: Date.now() + 6 * 86_400_000 }).find((d) => d.leadId === avery.id)).toMatchObject({ kind: 'follow-up' });
  }, 30000);

  test('a reply no rule can call stays in REPLIES to be read', async () => {
    expect(await arrives('plain')).toEqual({ kind: 'reply', said: 'open' });
    expect((await lead('plain')).status).toBe('replied');
    expect(saidOf(await lead('plain'))).toEqual({ says: 'open', by: 'mail-watch' });
  }, 30000);

  test('the desk: REPLIES leads with who asked for something; SAID NO and HAVE LEFT are their own lists; SENT holds neither', async () => {
    const engine = await board();
    expect(engine.leads.find((l) => l.id === ids.deck).said).toMatchObject({ says: 'wants', want: 'deck' });
    const replies = replyRows(engine, 'all');
    expect(replies.map((l) => [l.name, saidLabel(l.said)])).toEqual([['Dana Reyes', 'WANTS THE DECK'], ['Piet Vos', 'READ IT'], ['Avery Lund', 'AUTOMATIC REPLY']]);
    expect(closedRows(engine, 'all', 'no').map((l) => l.name)).toEqual(['Noel Park']);
    expect(closedRows(engine, 'all', 'gone').map((l) => l.name)).toEqual(['Katie Mishra']);
    expect(sentRows(engine, 'all').map((l) => l.name)).toEqual(['Avery Lund']); // an automatic reply is not an answer

    const html = renderToStaticMarkup(createElement(RepliesStage, { engine, view: 'all', onSaid: () => {} }));
    expect(html.indexOf('Dana Reyes')).toBeLessThan(html.indexOf('Piet Vos'));
    expect(html).toContain('WANTS THE DECK');
    expect(html).toContain('NONE OWED');
    expect(html).toContain('data-fold="replies-no"');
    expect(html).toContain('This is not a fit for us at this time.');
    expect(html).toContain('team@fundthree.example');
    expect(html).toContain('IS NOT ON THE DO-NOT-CONTACT LIST');

    const opened = renderToStaticMarkup(createElement(Replied, { engine, lead: closedRows(engine, 'all', 'no')[0], onSaid: () => {} }));
    expect(opened).toContain('READ AS <b>SAID NO</b> · BY THE FIXED RULES');
    expect(opened).toContain('Because they wrote: “This is not a fit for us at this time.”');
    expect(opened).toContain('data-said-set="wants"');
    expect(opened).not.toContain('data-said-set="no"'); // the press for what it already says is not offered
  }, 30000);

  test('you have the last word: a no that was not one goes back to REPLIES; one the rules missed is closed by a press', async () => {
    const back = await as(request(app).post(`/api/v1/revenue/lead-engine/leads/${ids.no}/said`).send({ says: 'wants', want: 'call' }));
    expect(back.status).toBe(200);
    expect(back.body.lead).toMatchObject({ status: 'replied', said: { says: 'wants', want: 'call', by: 'operator' } });
    const closed = await as(request(app).post(`/api/v1/revenue/lead-engine/leads/${ids.plain}/said`).send({ says: 'no' }));
    expect(closed.body.lead).toMatchObject({ status: 'lost', said: { says: 'no', by: 'operator' } });
    expect((await lead('plain')).touches.at(-1).note).toBe('the operator read their reply: they said no');
    const engine = await board();
    expect(replyRows(engine, 'all').map((l) => l.name)).toEqual(['Dana Reyes', 'Noel Park', 'Avery Lund']);
    expect(closedRows(engine, 'all', 'no').map((l) => l.name)).toEqual(['Piet Vos']);
    expect(renderToStaticMarkup(createElement(Replied, { engine, lead: closedRows(engine, 'all', 'no')[0], onSaid: () => {} }))).toContain('READ AS <b>SAID NO</b> · SAID BY YOU');
    expect((await as(request(app).post(`/api/v1/revenue/lead-engine/leads/${ids.no}/said`).send({ says: 'perhaps' }))).status).toBe(400);
    expect((await as(request(app).post('/api/v1/revenue/lead-engine/leads/nope/said').send({ says: 'no' }))).status).toBe(404);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/leads/${ids.no}/said`).send({ says: 'no' })).status).toBe(401);
  }, 30000);

  test('a reply recorded before replies were read is read the next time the desk looks, once', async () => {
    const old = await ledger.add({ name: 'Old Reply', contact: 'old@fundsix.example', channelId: 'email', kind: 'investor', status: 'cold', addedBy: 'merc' });
    await ledger.touch(old.id, { status: 'replied', direction: 'in', note: 'wrote to the house (mail #9001)', subject: 'Re: Deus Neuma', text: 'We are not currently investing in new companies.', by: 'mail-watch' });
    const wordless = await ledger.add({ name: 'No Words', contact: 'nowords@fundseven.example', channelId: 'email', kind: 'investor', status: 'cold', addedBy: 'merc' });
    await ledger.touch(wordless.id, { status: 'replied', direction: 'in', note: 'wrote to the house (mail #9002)', by: 'mail-watch' });
    const engine = await board(); // the desk's own read does it
    expect(engine.leads.find((l) => l.id === old.id)).toMatchObject({ status: 'lost', said: { says: 'no' } });
    expect(engine.leads.find((l) => l.id === wordless.id)).toMatchObject({ status: 'replied', said: null }); // no words kept: nothing to read, left for a person
    expect(await readStandingReplies(me.address)).toBe(0); // and nothing is read twice
    expect((await ledger.load()).find((l) => l.id === old.id).touches.at(-1).note).toBe('their reply was read: they said no');
  }, 30000);
});
