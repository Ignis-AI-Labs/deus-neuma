/* global URL, sessionStorage, window, document */
// first-run-door-kit — serve the REAL first-run door in a real Chromium: the real preflight router
// (the one-truth mind check, the machine read) and the real model-server router (plan, install,
// status, cancel) behind real signed-wallet auth, the door's modules through Vite. Nothing is
// mocked; the caller decides the machine's state with the real LLM config and env.
//
// impure — sockets, a browser, a Vite server.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** A real session token for a fresh wallet (the signed challenge the gateway signs). impure */
export const realSessionToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  return createSessionToken(verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge)));
};

/**
 * Serve the door. Routers are imported by the caller AFTER it has pinned its env.
 * @param {{cacheDir: string, routers: Array<[string, import('express').Router]>, token?: string|null}} opts
 * @returns {Promise<{browser: import('@playwright/test').Browser, url: string, open: (viewport?: {width:number,height:number}) => Promise<import('@playwright/test').Page>, close: () => Promise<void>}>}
 */
export const serveDoor = async ({ cacheDir, routers, token = null }) => {
  const vite = await createServer({ configFile: false, root: REPO, cacheDir, appType: 'custom',
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['test/fixtures/first-run-door.jsx'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
  const app = express();
  app.use(express.json());
  for (const [mount, router] of routers) app.use(mount, router);
  app.get('/', (_q, res) => res.type('html').send('<!doctype html><body style="margin:0"><script type="module" src="/test/fixtures/first-run-door.jsx"></script>'));
  app.use(vite.middlewares);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const open = async (viewport = { width: 1366, height: 768 }) => {
    const page = await browser.newPage({ viewport });
    if (token) await page.addInitScript((t) => sessionStorage.setItem('authToken', t), token);
    await page.goto(url);
    await page.waitForFunction(() => window.ready, null, { timeout: 60_000 });
    return page;
  };
  const close = async () => {
    await browser.close().catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await vite.close();
  };
  return { browser, url, open, close };
};

/** Every word a person sees on the page right now. impure (reads the page) */
export const wordsOnScreen = async (page) => {
  const text = await page.evaluate(() => document.body.innerText);
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
};

/** Where the door's screenshots land. Pure. */
export const shotPath = (name) => path.join(REPO, 'test', 'e2e', 'shots', `${name}.png`);
