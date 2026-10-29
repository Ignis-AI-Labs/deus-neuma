/* global window, sessionStorage, localStorage */
// The sovereignty desk client (loadSovereignty three-state read, decideProposal,
// retractAmendment, and the shared call() wrapper behind askConsent /
// signAndApplyDna) proven through a REAL browser against the REAL sovereignty
// router and stores (RULE 0 — no mocks): the unauthenticated bail with zero
// requests, the signed happy paths, the named refusals, the tampered-chain
// scream, the 401 auth-rot alarm, and the unreachable-platform line. The live
// consent-ask leg (a real turn through the being's own stack) stays Founder-gated —
// askConsent is exercised only to its pre-model refusal, the same posture
// sovereignty-dna.test.js takes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { submitProposal } from '../../backend/services/sovereignty/proposal-store.js';
import { appendAmendment } from '../../backend/services/sovereignty/amendment-store.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

test('sovereignty client preserves its three states, named refusals and never-throw idiom', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sovereignty-client-http-'));
  const previousRoot = getWorkspacesRoot();
  let vite; let server; let browser;
  try {
    setWorkspacesRoot(path.join(root, 'workspaces'));
    const auth = await fullAuth();
    const neumaId = 'sov-client-proof';
    await fs.mkdir(path.join(getWorkspacesRoot(), neumaId, 'config'), { recursive: true });
    await writeOwner(getWorkspacesRoot(), neumaId, auth.address);
    const promptProposal = await submitProposal(neumaId, {
      class: 'prompt', title: 'Plain speech', body: 'I drift into flourish; hold me to plain speech.',
      patch: { text: 'I prefer plain speech over ornament.' },
    });
    const dnaProposal = await submitProposal(neumaId, {
      class: 'dna', title: 'Sharpen my essence', body: 'My essence still reads as the template.',
      patch: { fields: { identity: { name: 'Amendable' } } },
    });

    const app = express(); const requests = [];
    app.use(express.json());
    app.use('/api', (req, res, next) => { res.on('finish', () => requests.push({ method: req.method, status: res.statusCode })); next(); });
    app.use('/api/v1/sovereignty', (await import('../../backend/routes/sovereignty-routes.js')).default);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">'
      + 'import {loadSovereignty,decideProposal,retractAmendment,askConsent,signAndApplyDna} from "/frontend/app/RelinkShell/sovereignty-client.js";'
      + 'window.sov={load:loadSovereignty,decide:decideProposal,retract:retractAmendment,ask:askConsent,sign:signAndApplyDna};'
      + 'window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);'
      + '</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.sov);

    // Unauthenticated: every door bails locally; nothing touches the wire.
    expect(await page.evaluate(id => window.sov.load(id), neumaId)).toBeNull();
    expect(await page.evaluate(([id, pid]) => window.sov.decide(id, pid, 'approve'), [neumaId, promptProposal.id]))
      .toEqual({ ok: false, error: 'Not authenticated.' });
    expect(await page.evaluate(id => window.sov.retract(id, 'am-0'), neumaId))
      .toEqual({ ok: false, error: 'Not authenticated.' });
    expect(await page.evaluate(([id, pid]) => window.sov.ask(id, pid), [neumaId, dnaProposal.id]))
      .toEqual({ ok: false, error: 'Not authenticated.' });
    expect(requests).toEqual([]);

    // The signed apply's first guard: no wallet provider in a bare browser.
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token);
      localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    expect(await page.evaluate(([id, pid]) => window.sov.sign(id, pid), [neumaId, dnaProposal.id]))
      .toEqual({ ok: false, error: 'Connect your operator wallet to sign.' });
    expect(requests).toEqual([]);

    // The three-state read: a readable record.
    const loaded = await page.evaluate(id => window.sov.load(id), neumaId);
    expect(loaded.ok).toBe(true);
    expect(loaded.record.proposals.map(p => p.id).sort()).toEqual([dnaProposal.id, promptProposal.id].sort());
    expect(loaded.record.amendments).toEqual([]);
    expect(loaded.record.standing).toEqual([]);

    // The ruling lands through the real store; the refusal keeps the server's words.
    const notes = 'Name the register you want — "plain" is doing two jobs here.';
    const decided = await page.evaluate(([id, pid, n]) => window.sov.decide(id, pid, 'revise', n), [neumaId, promptProposal.id, notes]);
    expect(decided.ok).toBe(true);
    expect(decided.proposal.status).toBe('revise');
    expect(decided.proposal.notes).toBe(notes);
    expect(await page.evaluate(id => window.sov.decide(id, 'no-such-proposal', 'approve'), neumaId))
      .toEqual({ ok: false, error: 'no such proposal' });

    // The call() wrapper: a consent-ask on an OPEN dna proposal is refused by
    // the real route BEFORE any live turn is attempted.
    expect(await page.evaluate(([id, pid]) => window.sov.ask(id, pid), [neumaId, dnaProposal.id]))
      .toEqual({ ok: false, error: 'consent is asked on an APPROVED dna proposal' });

    // The retract door: named refusal, then the real retraction folds.
    expect(await page.evaluate(id => window.sov.retract(id, 'no-such-amendment'), neumaId))
      .toEqual({ ok: false, error: 'no such standing amendment' });
    const amendment = await appendAmendment(neumaId, {
      proposalId: promptProposal.id, class: 'prompt', patch: { text: 'First standing law.' }, by: auth.address,
    });
    const retracted = await page.evaluate(([id, aid]) => window.sov.retract(id, aid), [neumaId, amendment.id]);
    expect(retracted.ok).toBe(true);
    expect(retracted.retraction.kind).toBe('retract');
    expect(retracted.retraction.targetId).toBe(amendment.id);
    expect((await page.evaluate(id => window.sov.load(id), neumaId)).record.standing).toEqual([]);

    // The refusal state screams: a tampered chain answers 500 in its own words.
    const chainFile = path.join(getWorkspacesRoot(), neumaId, 'config', 'sovereignty-amendments.json');
    const honest = await fs.readFile(chainFile, 'utf8');
    const tampered = JSON.parse(honest);
    tampered.entries[0].patch.text = 'First standing law, quietly edited.';
    await fs.writeFile(chainFile, JSON.stringify(tampered, null, 2));
    const scream = await page.evaluate(id => window.sov.load(id), neumaId);
    expect(scream.ok).toBe(false);
    expect(scream.error).toMatch(/chain BROKEN/);
    expect(requests.at(-1).status).toBe(500);
    await fs.writeFile(chainFile, honest);
    expect(await page.evaluate(id => window.sov.load(id), neumaId)).toMatchObject({ ok: true });
    expect(await page.evaluate(() => window.expired)).toBe(0);

    // The 401 rot alarm sounds, and the refusal still resolves in the house shape.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await page.evaluate(id => window.sov.load(id), neumaId))
      .toEqual({ ok: false, error: 'Invalid or expired session' });
    expect(await page.evaluate(() => window.expired)).toBe(1);

    // The platform gone: the never-throw line, never null once authenticated.
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    expect(await page.evaluate(id => window.sov.load(id), neumaId))
      .toEqual({ ok: false, error: 'Could not reach the platform.' });
    expect(await page.evaluate(([id, pid]) => window.sov.decide(id, pid, 'approve'), [neumaId, promptProposal.id]))
      .toEqual({ ok: false, error: 'Could not reach the platform.' });
    expect(await page.evaluate(([id, aid]) => window.sov.retract(id, aid), [neumaId, amendment.id]))
      .toEqual({ ok: false, error: 'Could not reach the platform.' });
    expect(await page.evaluate(([id, pid]) => window.sov.ask(id, pid), [neumaId, dnaProposal.id]))
      .toEqual({ ok: false, error: 'Could not reach the platform.' });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    setWorkspacesRoot(previousRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
