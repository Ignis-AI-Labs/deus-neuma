/**
 * A BATCH OF EMAILS ON ITS WAY (company-line/outbox-send.js, outbox-view.js sendingView, Outbox.jsx) — Founder,
 * 2026-11-19, after 15 checked emails sat unchanged on the screen while the WAITING ON YOU count crept down: […] The desk sends them one after another through the real route, says after each where
 * the batch stands, and STOP ends it after the email in flight, leaving the rest unsent in the outbox. A real app, a
 * real signed session, a real outbox on temp disk (RULE 0); the screen rendered for real (react-dom/server).
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
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { stageDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';
import { addSuppression } from '../../backend/services/sales/sales-store.js';
import { makeSuppression } from '../../backend/services/sales/suppress-shape.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { runSendBatch } from '../../frontend/app/RelinkShell/company-line/outbox-send.js';
import { sendingView } from '../../frontend/app/RelinkShell/company-line/outbox-view.js';
import { Outbox } from '../../frontend/app/RelinkShell/company-line/Outbox.jsx';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();

describe('where a batch stands, said in one line', () => {
  test('running, done, and stopped with some still waiting', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(sendingView({ ids, results: { a: { state: 'sent' } }, current: 'b' })).toMatchObject({ words: 'SENDING 2 OF 4 · 1 SENT · 2 WAITING', running: true, share: 0.25 });
    const done = sendingView({ ids, results: { a: { state: 'sent' }, b: { state: 'sent' }, c: { state: 'refused', reason: 'x' }, d: { state: 'sent' } }, current: null, done: true });
    expect(done.words).toBe('DONE · 3 OF 4 SENT · 1 NOT SENT');
    expect(sendingView({ ids, results: { a: { state: 'sent' } }, current: null, done: true, stopped: true }).words).toBe('STOPPED · 1 OF 4 SENT · 3 STILL WAIT IN THE OUTBOX');
    expect(['a', 'b', 'c'].map(sendingView({ ids, results: { a: { state: 'sent' } }, current: 'b' }).stateOf)).toEqual(['sent', 'sending', 'queued']);
    expect(sendingView(null)).toBe(null);
  });
});

describe('the batch through the real route', () => {
  let me, app;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'outbox-batch-test-key';
    useTempRealm();
    setWorkspacesRoot(path.join(await createTempDir('outbox-batch'), 'workspaces'));
    me = await fullAuth();
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
  }, 60000);
  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('one after another, each with where it stands, the screen following every step; STOP leaves the rest unsent', async () => {
    const drafts = [];
    for (const to of ['ana@one.example', 'ben@two.example', 'cy@three.example', 'di@four.example']) {
      const staged = await stageDraft(me.address, { to: [to], subject: 'A pool', text: `Hello, the words of a staged email to ${to}.`, by: 'merc' });
      drafts.push((await readOutbox(me.address)).drafts.find((d) => d.id === staged.id));
    }
    await addSuppression(me.address, makeSuppression({ target: 'ben@two.example', reason: 'asked', by: 'operator' }));
    const send = async (ids) => (await request(app).post('/api/v1/revenue/lead-engine/outbox/send').set('Authorization', `Bearer ${me.token}`).send({ ids })).body;
    const ids = drafts.map((d) => d.id);
    const steps = [];
    let sends = 0;
    const end = await runSendBatch({ ids, send: (one) => { sends += 1; return send(one); }, onStep: (s) => steps.push(sendingView({ ...s })), stopped: () => sends >= 3 });

    // One email a request, and the screen told after every change: queued, then each SENDING… and each answer.
    expect(sends).toBe(3);
    expect(steps.map((s) => s.words)).toEqual([
      'SENDING 1 OF 4 · 0 SENT · 4 WAITING',
      'SENDING 1 OF 4 · 0 SENT · 3 WAITING',
      'SENDING 2 OF 4 · 0 SENT · 3 WAITING · 1 NOT SENT',
      'SENDING 2 OF 4 · 0 SENT · 2 WAITING · 1 NOT SENT',
      'SENDING 3 OF 4 · 0 SENT · 2 WAITING · 2 NOT SENT',
      'SENDING 3 OF 4 · 0 SENT · 1 WAITING · 2 NOT SENT',
      'SENDING 4 OF 4 · 0 SENT · 1 WAITING · 3 NOT SENT',
      'STOPPED · 0 OF 4 SENT · 3 NOT SENT · 1 STILL WAIT IN THE OUTBOX',
    ]);
    // Each one not sent says why, in the route's own words; the one STOP never reached was never asked.
    expect(end.results[ids[1]]).toEqual({ state: 'refused', reason: 'ben@two.example is on the do-not-contact list — never written to again' });
    expect(end.results[ids[3]]).toBeUndefined();
    expect((await readOutbox(me.address)).drafts.find((d) => d.id === ids[3]).state).toBe('waiting');

    // ON THE SCREEN while it runs: the line, STOP, each email of the batch with its state; the rest of the outbox below, locked.
    const running = { ids, rows: drafts, results: { [ids[0]]: { state: 'sent' } }, current: ids[1], done: false };
    const markup = renderToStaticMarkup(createElement(Outbox, { outbox: { review: true, drafts }, leads: [], busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {}, sending: running }));
    expect(markup).toContain('data-outbox-sending="running"');
    expect(markup).toContain('SENDING 2 OF 4 · 1 SENT · 2 WAITING');
    expect(markup).toContain('>STOP</button>');
    expect(markup).toContain(`data-send-state="sent"`);
    expect(markup).toContain(`data-send-state="sending"`);
    expect(markup).toContain('SENDING…');
    expect(markup).toContain('aria-valuenow="1"');
    // The batch's emails stand in the batch, not again in the list below; nothing else can be pressed while it runs.
    expect(markup).not.toContain('data-outbox-bar=""');
    // Done: the line says how it went, DONE puts it away.
    const doneMarkup = renderToStaticMarkup(createElement(Outbox, { outbox: { review: true, drafts }, leads: [], busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {}, sending: { ...end, rows: drafts } }));
    expect(doneMarkup).toContain('data-outbox-sending="done"');
    expect(doneMarkup).toContain('>DONE</button>');
    expect(doneMarkup).toContain('on the do-not-contact list');
  }, 60000);
});
