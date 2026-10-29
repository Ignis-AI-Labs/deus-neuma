import { beforeAll, afterAll, it, expect } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import http from 'node:http';
import fs from 'node:fs/promises';
import { attachMobileBrowserPortal } from '../helpers/mobile-browser-portal.js';
let browser, context, server, vite, root, url, portal;
beforeAll(async () => {
  root = await fs.mkdtemp('/tmp/neuma-outbox-browser-');
  vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: root, appType: 'custom', server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
  server = http.createServer((req, res) => req.url === '/' ? res.end('<!doctype html><title>Outbox proof</title><script type="module" src="/test/fixtures/portal-outbox.js"></script>') : vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); }));
  portal = await attachMobileBrowserPortal(server, root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { loadConfig } = await import('../../backend/config.js');
  loadConfig({ ...process.env, PORT: String(server.address().port) });
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  context = await browser.newContext();
}, 20000);
afterAll(async () => {
  await browser?.close(); await portal?.close(); await vite?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
});
const page = async () => { const p = await context.newPage(); await p.goto(url); await p.waitForFunction(() => window.portalOutboxProof); return p; };

it('real service queues only its addressed sitting; reload cannot leak words into B or C', async () => {
  const p = await page();
  await p.evaluate(async () => {
    const { WebSocketService } = window.portalOutboxProof;
    localStorage.setItem('walletAddress', 'wallet-a');
    const a = new WebSocketService({ quiet: true });
    a.setSessionState({ neumaId: 'lane-a', sessionId: 'sitting-a' });
    await a._outbox.queue({ type: 'consciousness:stream', thought: 'Only for A', messageId: 'word-a', timestamp: Date.now() });
  });
  await p.reload();
  await p.waitForFunction(() => window.portalOutboxProof);
  const result = await p.evaluate(async () => {
    const { WebSocketService } = window.portalOutboxProof;
    const { portalOutboxScope, drainPortalWords } = window.portalOutboxProof;
    const b = new WebSocketService(), c = new WebSocketService();
    b.setSessionState({ neumaId: 'lane-b', sessionId: 'sitting-b' });
    c.setSessionState({ neumaId: 'lane-c', sessionId: 'sitting-c' });
    const wrong = [], right = [], repeat = [];
    for (const client of [b, c]) await drainPortalWords(portalOutboxScope('wallet-a', client.getSessionState()), (m) => { wrong.push(m); return true; });
    const scope = portalOutboxScope('wallet-a', { neumaId: 'lane-a', sessionId: 'sitting-a' });
    await drainPortalWords(scope, (m) => { right.push(m); return true; });
    await drainPortalWords(scope, (m) => { repeat.push(m); return true; });
    return { wrong, right, repeat, queues: [b.messageQueue, c.messageQueue] };
  });
  expect(result.wrong).toEqual([]); expect(result.repeat).toEqual([]);
  expect(result.queues).toEqual([[], []]);
  expect(result.right.map((m) => m.thought)).toEqual(['Only for A']);
  await p.close();
});

it('two browser pages atomically consume one queue without duplication', async () => {
  const a = await page(), b = await page();
  await a.evaluate(async () => {
    const { queuePortalWord } = window.portalOutboxProof;
    for (let i = 0; i < 20; i++) await queuePortalWord('concurrent-scope', { messageId: `concurrent-${i}`, timestamp: i });
  });
  const consume = (p) => p.evaluate(async () => {
    const { drainPortalWords } = window.portalOutboxProof;
    const ids = []; await drainPortalWords('concurrent-scope', (m) => { ids.push(m.messageId); return true; }); return ids;
  });
  const groups = await Promise.all([consume(a), consume(b)]);
  expect(groups.flat()).toHaveLength(20);
  expect(new Set(groups.flat()).size).toBe(20);
  await a.close(); await b.close();
});

it('account changes and a failed handoff cannot consume the original queue', async () => {
  const p = await page();
  const result = await p.evaluate(async () => {
    const { portalOutboxScope, queuePortalWord, drainPortalWords } = window.portalOutboxProof;
    const bind = { neumaId: 'lane', sessionId: 'sitting' };
    const original = portalOutboxScope('original', bind);
    await queuePortalWord(original, { messageId: 'account-word', timestamp: 1 });
    const wrong = [], kept = [];
    await drainPortalWords(portalOutboxScope('changed', bind), (m) => { wrong.push(m); return true; });
    await drainPortalWords(original, () => false);
    await drainPortalWords(original, (m) => { kept.push(m); return true; });
    return { wrong, kept, unbound: portalOutboxScope('original', { neumaId: 'lane' }) };
  });
  expect(result.wrong).toEqual([]); expect(result.kept).toHaveLength(1); expect(result.unbound).toBeNull();
  await p.close();
});


it('the real portal confirms the exact sitting before a queued frame is handed off', async () => {
  const p = await page();
  await p.evaluate(async ({ token, wallet, binding }) => {
    const { WebSocketService } = window.portalOutboxProof;
    localStorage.setItem('walletAddress', wallet);
    sessionStorage.setItem('authToken', token);
    const service = new WebSocketService({ quiet: true });
    service.setSessionState(binding);
    window.mobileSocket = service;
    window.mobileFrames = [];
    service.on('message', (frame) => window.mobileFrames.push(frame));
    // A harmless real portal command proves the actual queue/transport route;
    // no consciousness turn, inference, or execution is substituted here.
    await service._outbox.queue({ type: 'tool:mode', mode: 'observe', messageId: 'real-queued-mode', timestamp: Date.now() });
    service.connect();
  }, { token: portal.token, wallet: portal.wallet, binding: portal.binding });
  await p.waitForFunction(() => window.mobileFrames.some((m) => m.type === 'tool:mode'));
  const frames = await p.evaluate(() => window.mobileFrames.map((m) => ({ type: m.type, sessionId: m.sessionId, neumaId: m.neumaId })));
  const resume = frames.findIndex((m) => m.type === 'portal:resumed');
  const handoff = frames.findIndex((m) => m.type === 'tool:mode');
  expect(resume).toBeGreaterThanOrEqual(0); expect(handoff).toBeGreaterThan(resume);
  expect(frames[resume]).toMatchObject({ neumaId: portal.binding.neumaId, sessionId: portal.binding.sessionId });
  await p.evaluate(() => window.mobileSocket.disconnect());
  await p.close();
});
