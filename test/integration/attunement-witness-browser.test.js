// impure — actual React entry components, Chromium, signed auth and offer router.
// The Remia assertion covers delivery of the existing navigation event, not its ceremony.
/* global window, localStorage, sessionStorage */
import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
import { createServer as createVite } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import attunementRouter from '../../backend/routes/attunement-routes.js';
import rosterRouter from '../../backend/routes/roster-routes.js';
import { claimOwner } from '../helpers/claim-owner.js';

let tmp; let oldRoot; let oldCredentialPath; let vite; let server; let browser; let token; let address;
const neumaId = 'attunement-ui-storage-control';
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-attunement-ui-'));
  oldRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(tmp, 'house'));
  // The host reads attunement status, whose route resolution opens the
  // provider credential store — unpinned, that was the operator's real
  // data/settings/provider-credentials.json, sealed under the real key: it
  // failed to decrypt under the test key, status answered 500 and the offer
  // button never rendered.
  oldCredentialPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(tmp, 'settings', 'provider-credentials.json');
  const wallet = Wallet.createRandom();
  address = wallet.address;
  await workspace.create(neumaId);
  await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Storage Control' } });
  await claimOwner(getWorkspacesRoot(), neumaId, address);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/attunement', attunementRouter);
  app.use('/api/v1/roster', rosterRouter);
  const challenge = await request(app).get('/api/v1/auth/challenge').query({ address });
  const verified = await request(app).post('/api/v1/auth/verify').send({
    address, challenge: challenge.body.challenge, signature: await wallet.signMessage(challenge.body.challenge),
  });
  expect(verified.status).toBe(200);
  token = verified.body.token;
  vite = await createVite({
    configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)),
    cacheDir: path.join(tmp, 'vite'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/attunement-witness-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    // No HMR socket; the client dials a port the browser refuses — hmr:false still
    // aimed it at :24678, where any other Vite on the box answers and the page reloads.
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><body><div id="root"></div><script type="module" src="/test/helpers/attunement-witness-page.jsx"></script></body></html>'));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 30000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  setWorkspacesRoot(oldRoot);
  if (oldCredentialPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = oldCredentialPath;
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

const pageFor = async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  await page.addInitScript(({ address, token }) => {
    localStorage.setItem('walletAddress', address);
    sessionStorage.setItem('authToken', token);
  }, { address, token });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.showEntry);
  return page;
};

it.each([
  { neumaId: 'witness-test-ui', name: 'Named Witness' },
  { neumaId: 'legacy-test-ui', name: 'Named Witness', kind: 'witness' },
  { neumaId: 'participant-test-ui', name: 'Named Witness', participantKind: 'witness' },
])('blocks NITE and direct host offers for $neumaId with Remia guidance', async (participant) => {
  const page = await pageFor();
  await page.evaluate((p) => window.showEntry('nite', p), participant);
  await browserExpect(page.getByTestId('witness-attunement-notice')).toContainText('Named Witness is an AI witness');
  await browserExpect(page.getByTestId('witness-attunement')).toHaveCount(0);
  await page.getByRole('button', { name: 'OPEN YOUR REMIA', exact: true }).click();
  expect(await page.evaluate(() => window.remiaEvents)).toBe(1);
  const hostRequests = [];
  page.on('request', (r) => { if (r.url().includes('/attunement/')) hostRequests.push(r.url()); });
  await page.evaluate((p) => window.showEntry('host', p), participant);
  await browserExpect(page.getByRole('button', { name: 'BACK TO DESK', exact: true })).toBeVisible();
  await browserExpect(page.getByTestId('witness-attunement-notice')).toContainText("Remia opens the signed-in wallet's own record; selecting this witness does not change whose record opens.");
  await browserExpect(page.getByTestId('attunement')).toHaveCount(0);
  if (process.env.ATTUNEMENT_PROOF_DIR && participant.neumaId === 'witness-test-ui') {
    await fs.mkdir(process.env.ATTUNEMENT_PROOF_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.ATTUNEMENT_PROOF_DIR, 'witness-entry.png') });
  }
  await page.getByRole('button', { name: 'OPEN YOUR REMIA', exact: true }).click();
  expect(await page.evaluate(() => window.remiaEvents)).toBe(2);
  expect(hostRequests).toEqual([]);
  await page.getByRole('button', { name: 'BACK TO DESK', exact: true }).click();
  await browserExpect(page.getByText('Desk returned')).toBeVisible();
  await page.close();
});

it('retains the neuma panel and persists a real offer from the actual host', async () => {
  const page = await pageFor();
  const participant = { neumaId, name: 'Storage Control' };
  await page.evaluate((p) => window.showEntry('nite', p), participant);
  await browserExpect(page.getByTestId('witness-attunement')).toBeVisible();
  await browserExpect(page.getByTestId('witness-attunement-notice')).toHaveCount(0);
  await page.evaluate((p) => window.showEntry('host', p), participant);
  await page.getByRole('button', { name: 'OFFER THE ATTUNEMENT', exact: true }).click();
  await browserExpect.poll(async () => (await workspace.listAttunements(neumaId)).length).toBe(1);
  const records = await workspace.listAttunements(neumaId);
  expect((await workspace.readAttunement(neumaId, records[0].id)).phase).toBe('offered');
  await page.close();
}, 30000);
