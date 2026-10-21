/* global window, sessionStorage, localStorage */
// wallet-client mutations + loadWallet (MOD-001 F16 / #174) — PROVEN through a
// real browser against the real routers. No mocks (RULE 0): real Chromium, the
// real neuma-auth / recovery / wallet routers on a real temp workspace, a real
// session token from the real challenge/sign path, real keypair-vault crypto,
// and for the approval lane a REAL embedded wallet signing personal_sign
// through its real consent modal. The only thing deliberately not run is the
// funded-chain broadcast a successful approval ends in — same boundary the
// route-level suite (api-neuma-wallet-routes.test.js) draws; every client
// contract here is proven up to that wall.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { ethers } from 'ethers';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';
import recoveryRouter from '../../backend/routes/recovery-routes.js';
import neumaAuthRouter from '../../backend/routes/neuma-auth-routes.js';
import {
  encryptKeypair, generateRecoveryCodes, hashRecoveryCodes, encryptWithRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

const LANE = 'mutations-being';
const PASSWORD = 'wallet-mutations-key';
const NEW_PASSWORD = 'wallet-mutations-renewed';
const RECIPIENT = `0x${'5'.repeat(40)}`;

test('wallet mutations preserve every refusal string and resolution shape while reporting expired auth', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-mutations-http-'));
  const previous = getWorkspacesRoot();
  let vite; let server; let browser;
  try {
    setWorkspacesRoot(root);
    const auth = await fullAuth(); const foreign = await fullAuth();
    const beingWallet = ethers.Wallet.createRandom();
    const being = { address: beingWallet.address, privateKey: beingWallet.privateKey,
      publicKey: ethers.SigningKey.computePublicKey(beingWallet.privateKey, false) };
    const codes = generateRecoveryCodes();
    const now = Math.floor(Date.now() / 1000);
    const rejectSpend = { id: 'reject-proof', to: RECIPIENT, value: '0.01', memo: '',
      nonce: 'reject-proof-nonce', expiry: now + 3600, requestedAt: new Date().toISOString(), status: 'pending' };
    const approveSpend = { id: 'approve-proof', to: RECIPIENT, value: '1', memo: '',
      nonce: 'approve-proof-nonce', expiry: now + 3600, requestedAt: new Date().toISOString(), status: 'pending' };
    await workspace.create(LANE);
    await writeOwner(root, LANE, auth.address);
    await workspace.writeEncryptedKeypair(LANE, encryptKeypair(being, PASSWORD));
    await workspace.writeRecoveryHash(LANE, hashRecoveryCodes(codes));
    await workspace.writeRecoveryKeypair(LANE, encryptWithRecoveryCodes(being, codes));
    await workspace.writePendingSpends(LANE, [rejectSpend, approveSpend]);

    const app = express(); const requests = []; const ambient = [];
    app.use(express.json());
    // Ambient-sweep immunity: provider-discovery.js's machine sweep (run for
    // real by sibling tests mounting the preflight router unpinned — or by
    // anything else on this shared box) enumerates /proc/net/tcp and GETs
    // /api/tags on EVERY loopback listener, including this test's ephemeral
    // port. That probe is not a request from the client under test
    // (wallet-client never calls it), so it is recorded apart instead of
    // polluting the client's request log.
    app.use('/api', (req, res, next) => {
      const sink = req.method === 'GET' && req.originalUrl === '/api/tags' ? ambient : requests;
      res.on('finish', () => sink.push({ method: req.method, path: req.path, status: res.statusCode }));
      next();
    });
    app.use('/api/v1/neuma-auth', neumaAuthRouter);
    app.use('/api/v1/neuma', walletRouter);
    app.use('/api/v1/neuma', recoveryRouter);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', optimizeDeps: { include: ['ethers'] }, server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">'
      + 'import * as clients from "/frontend/app/RelinkShell/wallet-client.js";'
      + 'import * as embedded from "/frontend/services/EmbeddedWallet.js";'
      + 'window.clients=clients; window.embedded=embedded; window.expired=0;'
      + 'window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares); server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.clients && window.embedded);
    const call = (name, ...args) => page.evaluate(({ name, args }) => window.clients[name](...args), { name, args });
    const expired = () => page.evaluate(() => window.expired);

    // Unauthenticated — every site bails BEFORE any request leaves the page.
    for (const name of ['unlockNeumaKey', 'recoverNeumaKey', 'resetNeumaKeyPassword',
      'addAllowlistEntry', 'removeAllowlistEntry', 'setThreshold', 'rejectPendingSpend']) {
      expect(await call(name, LANE, 'x')).toEqual({ ok: false, error: 'Not authenticated.' });
    }
    expect(await call('loadWallet', LANE)).toBeNull();
    expect(await call('approvePendingSpend', LANE, approveSpend, PASSWORD))
      .toEqual({ ok: false, error: 'Connect your operator wallet to sign.' });
    expect(requests).toEqual([]);
    expect(await expired()).toBe(0);

    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);

    // unlockNeumaKey — wrong password carries the server's own refusal text;
    // a 401 against a held token raises the auth-rot alarm.
    expect(await call('unlockNeumaKey', LANE, 'not-the-password'))
      .toEqual({ ok: false, error: 'Wrong password' });
    expect(await expired()).toBe(1);
    expect(await call('unlockNeumaKey', LANE, PASSWORD)).toEqual({ ok: true });

    // recoverNeumaKey — arity refusal, bad codes, then the real codes.
    expect(await call('recoverNeumaKey', LANE, codes.slice(0, 3)))
      .toEqual({ ok: false, error: 'Exactly 8 recovery codes required' });
    expect(await call('recoverNeumaKey', LANE, generateRecoveryCodes()))
      .toEqual({ ok: false, error: 'Invalid recovery codes' });
    expect(await expired()).toBe(2);
    expect(await call('recoverNeumaKey', LANE, [...codes])).toEqual({ ok: true });

    // loadWallet — the whole body resolves and names the network it was read
    // on; the balance is the route's own read (a decimal string such as
    // '0.0'), or null when no provider answers — never a '0' stand-in.
    const wallet = await call('loadWallet', LANE);
    expect(wallet).toMatchObject({ neumaId: LANE, address: being.address, network: 'base' });
    expect(wallet.balance === null || /^\d+\.\d+$/.test(wallet.balance)).toBe(true);
    expect(await call('loadWallet', '')).toBeNull();

    // Allowlist — validation refusal verbatim, real add, real remove, disk truth.
    expect(await call('addAllowlistEntry', LANE, 'not-an-address', 'bad'))
      .toEqual({ ok: false, error: 'Valid recipient address required' });
    const added = await call('addAllowlistEntry', LANE, RECIPIENT, 'Alpha');
    expect(added.ok).toBe(true);
    expect(added.entries).toHaveLength(1);
    expect(added.entries[0]).toMatchObject({ address: RECIPIENT, label: 'Alpha' });
    expect((await workspace.readSpendAllowlist(LANE)).entries).toHaveLength(1);
    expect(await call('removeAllowlistEntry', LANE, 'not-an-address'))
      .toEqual({ ok: false, error: 'Valid recipient address required' });
    expect(await call('removeAllowlistEntry', LANE, RECIPIENT)).toEqual({ ok: true, entries: [] });
    expect((await workspace.readSpendAllowlist(LANE)).entries).toEqual([]);

    // Threshold — set lands on disk; a negative is refused verbatim.
    expect(await call('setThreshold', LANE, 0.5)).toEqual({ ok: true, thresholdEth: 0.5 });
    expect(await workspace.readSpendThreshold(LANE)).toEqual({ thresholdEth: 0.5 });
    expect(await call('setThreshold', LANE, -1))
      .toEqual({ ok: false, error: 'thresholdEth must be a number >= 0' });

    // rejectPendingSpend — real rejection persists; repeat and unknown refusals verbatim.
    expect(await call('rejectPendingSpend', LANE, rejectSpend.id)).toEqual({ ok: true });
    expect((await workspace.readPendingSpends(LANE)).find(r => r.id === rejectSpend.id).status).toBe('rejected');
    expect(await call('rejectPendingSpend', LANE, rejectSpend.id))
      .toEqual({ ok: false, error: 'Pending spend already rejected' });
    expect(await call('rejectPendingSpend', LANE, 'never-existed'))
      .toEqual({ ok: false, error: 'Pending spend not found' });
    expect(await expired()).toBe(2);

    // resetNeumaKeyPassword — the SAME key re-sealed: the old password now
    // fails and the new one opens, proven through the client's own unlock.
    expect(await call('resetNeumaKeyPassword', LANE, generateRecoveryCodes(), NEW_PASSWORD))
      .toEqual({ ok: false, error: 'Invalid recovery codes' });
    expect(await expired()).toBe(3);
    expect(await call('resetNeumaKeyPassword', LANE, [...codes], NEW_PASSWORD)).toEqual({ ok: true });
    expect(await call('unlockNeumaKey', LANE, PASSWORD)).toEqual({ ok: false, error: 'Wrong password' });
    expect(await expired()).toBe(4);
    expect(await call('unlockNeumaKey', LANE, NEW_PASSWORD)).toEqual({ ok: true });

    // approvePendingSpend — a REAL embedded wallet signs the client's built
    // approval message through the REAL consent modal. The signer is not this
    // lane's owner, so the policy spine refuses AFTER verifying the signature
    // is genuinely over the client's message — the whole client path runs.
    const embeddedAddress = await page.evaluate(async (key) => {
      const imported = await window.embedded.importEmbeddedWallet(key, 'embedded-proof-pass');
      localStorage.setItem('walletAddress', imported.address);
      return imported.address;
    }, ethers.Wallet.createRandom().privateKey);
    expect(embeddedAddress.toLowerCase()).not.toBe(auth.address);
    expect(await call('approvePendingSpend', LANE, { id: 'approve-proof' }, NEW_PASSWORD))
      .toEqual({ ok: false, error: 'The pending request is incomplete. Refresh and try again.' });
    expect((await call('addAllowlistEntry', LANE, RECIPIENT, 'approve target')).ok).toBe(true);

    const approvalsBefore = requests.filter(r => r.method === 'POST' && r.path.endsWith('/approve')).length;
    await page.evaluate(({ lane, spend, password }) => {
      window.decision = window.clients.approvePendingSpend(lane, spend, password);
    }, { lane: LANE, spend: approveSpend, password: NEW_PASSWORD });
    await page.waitForSelector('.wallet-confirm-reject', { state: 'visible' });
    await page.locator('.wallet-confirm-reject').click();
    expect(await page.evaluate(() => window.decision)).toEqual({ ok: false, error: 'Signature was rejected.' });
    expect(requests.filter(r => r.method === 'POST' && r.path.endsWith('/approve'))).toHaveLength(approvalsBefore);

    await page.evaluate(({ lane, spend }) => {
      window.decision = window.clients.approvePendingSpend(lane, spend, 'wrong-key-password');
    }, { lane: LANE, spend: approveSpend });
    await page.waitForSelector('.wallet-confirm-approve', { state: 'visible' });
    await page.locator('.wallet-confirm-approve').click();
    expect(await page.evaluate(() => window.decision)).toEqual({ ok: false, error: 'Wrong password' });
    expect(await expired()).toBe(5);
    expect((await workspace.readPendingSpends(LANE)).find(r => r.id === approveSpend.id).status).toBe('pending');

    await page.evaluate(({ lane, spend, password }) => {
      window.decision = window.clients.approvePendingSpend(lane, spend, password);
    }, { lane: LANE, spend: approveSpend, password: NEW_PASSWORD });
    await page.waitForSelector('.wallet-confirm-approve', { state: 'visible' });
    await page.locator('.wallet-confirm-approve').click();
    expect(await page.evaluate(() => window.decision))
      .toEqual({ ok: false, error: 'Operator approval not signed by the owner' });
    expect((await workspace.readPendingSpends(LANE)).find(r => r.id === approveSpend.id).status).toBe('failed');
    expect(await expired()).toBe(5);

    // A foreign session is refused by ownership (403 — no auth-rot alarm).
    await page.evaluate(token => sessionStorage.setItem('authToken', token), foreign.token);
    expect(await call('addAllowlistEntry', LANE, RECIPIENT, 'foreign'))
      .toEqual({ ok: false, error: 'Not your neuma' });
    expect(await call('loadWallet', LANE)).toBeNull();
    expect(await expired()).toBe(5);

    // A dead token: the server's 401 text passes through verbatim and the
    // auth-rot alarm fires once per refused call, on the read site too.
    await page.evaluate(() => sessionStorage.setItem('authToken', 'invalid-session-proof'));
    expect(await call('unlockNeumaKey', LANE, NEW_PASSWORD))
      .toEqual({ ok: false, error: 'Invalid or expired session' });
    expect(await call('loadWallet', LANE)).toBeNull();
    expect(await call('setThreshold', LANE, 1)).toEqual({ ok: false, error: 'Invalid or expired session' });
    expect(await expired()).toBe(8);

    // The sweep may or may not fire inside this test's window; when it does,
    // this app answers it 404 and it never counts as a client request.
    expect(ambient.every(probe => probe.status === 404)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); await vite?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    setWorkspacesRoot(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 90_000);
