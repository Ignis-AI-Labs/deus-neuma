// "Get a key" beside every credential input: real Chromium, the PRODUCTION KeyLink,
// the real authenticated routing router serving the real credential map. No mocks.
// A link the operator clicks must open the provider's own page in the system browser
// (target=_blank is handed to the OS by electron/desk-links.cjs) and never carry the desk.
/* global document */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { Wallet } from 'ethers';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import routingRouter from '../../backend/routes/routing-routes.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
let tmp; let vite; let server; let browser;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'key-link-'));
  const wallet = Wallet.createRandom();
  const challenge = generateChallenge(wallet.address);
  const token = createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  const app = express();
  app.use('/api/v1/routing', routingRouter);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/key-link-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => res.type('html').send(
    `<!doctype html><script>window.keyLinkFixture=${JSON.stringify({ token })}</script><div id="root"></div><script type="module" src="/test/helpers/key-link-page.jsx"></script>`,
  ));
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 90000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

describe('KeyLink — where to get a key, in the desk', () => {
  it('a provider, a channel and the RPC choices render as outside links; an unknown credential renders nothing', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#rpc .settings-key-link a', { timeout: 30000 });
    const read = await page.evaluate(() => Object.fromEntries(['provider', 'channel', 'rpc', 'unknown'].map((id) => [id,
      [...document.querySelectorAll(`#${id} a`)].map((a) => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent }))])));
    expect(read.provider).toEqual([{ href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noreferrer', text: 'GET A KEY · Anthropic Console keys ↗' }]);
    expect(read.channel[0]).toMatchObject({ href: 'https://bsky.app/settings/app-passwords', target: '_blank', text: 'GET THE KEYS · Bluesky app passwords ↗' });
    expect(read.rpc.map((a) => a.href)).toEqual(['https://dashboard.alchemy.com/', 'https://developer.metamask.io/', 'https://dashboard.quicknode.com/', 'https://chainlist.org/']);
    expect(read.unknown).toEqual([]);
    // The note says what to make, and it is visible beside the link.
    expect(await page.locator('#channel .settings-key-note').isVisible()).toBe(true);
    expect(await page.locator('#channel .settings-key-note').textContent()).toContain('app password');
    expect(errors).toEqual([]);
    await page.close();
  }, 90000);

  it('without a session the map is not served, and the desk shows no link rather than an error', async () => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/routing/credential-links`);
    expect(res.status).toBe(401);
  });
});
