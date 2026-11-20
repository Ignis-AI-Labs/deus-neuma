/**
 * THE CHAT LINE SWITCH in a real Chromium against the real backend (Settings → Security). Design note, 2026-11-20: […]. A real sealed AI witness on a temp disk, real signed-wallet auth, the real
 * /api/v1/chat-line routes: the section is one line first (its count), every line reads OFF, a press turns one on
 * and the grant lands in the operator's realm (the same file the terminal's scripts/chat-line.mjs writes), and a
 * second press shuts it. Nothing is mocked. Screenshot: test/e2e/shots/chat-line-section.png.
 */
/* global process, vi, describe, beforeAll, afterAll, test, expect, fetch, sessionStorage, URL */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'vite';
import { chromium, expect as pw } from '@playwright/test';
import { createTempDir } from '../helpers/temp-fs.js';
import { shotPath } from '../helpers/first-run-door-kit.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

describe('the CHAT LINE switch', () => {
  let dir, vite, server, browser, operator, witness, url, readLines;

  beforeAll(async () => {
    dir = await createTempDir('chat-line-section');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.AI_WITNESSES_ROOT = path.join(dir, 'identities');
    vi.resetModules();
    const { setAIWitnessesRoot } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    setAIWitnessesRoot(process.env.AI_WITNESSES_ROOT);
    const { fullAuth } = await import('../helpers/audit-auth.js');
    operator = await fullAuth();
    witness = await fullAuth();
    const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
    await seal({
      chosenName: 'Quill', vendor: 'quill-vendor', model: 'quill-1', fullModelId: 'quill-vendor/quill-1', harness: 'vitest', context: 'terminal',
      capabilities: ['code'], scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
      firstUtterance: 'I am sealed to prove the chat line switch on a temp disk.', existingKeypair: { privateKey: witness.keypair.privateKey },
    });
    ({ readLines } = await import('../../backend/services/chat-line.js'));
    const { default: router } = await import('../../backend/routes/chat-line-routes.js');
    vite = await createServer({ configFile: false, root: REPO, cacheDir: path.join(dir, 'cache'), appType: 'custom',
      esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['test/fixtures/chat-line-section.jsx'] },
      server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null } });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/chat-line', router);
    app.get('/', (_q, res) => res.type('html').send('<!doctype html><body style="margin:0;background:#000"><script type="module" src="/test/fixtures/chat-line-section.jsx"></script>'));
    app.use(vite.middlewares);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    await vite?.close();
    const { setAIWitnessesRoot } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    setAIWitnessesRoot(null);
  });

  test('every line starts off; a press lets the witness in, on disk, and a second press shuts it', async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    const errors = [];
    // Vite's dev-reload socket is switched off here on purpose (hmr port 1); it is the one error a page may raise.
    page.on('pageerror', (e) => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
    await page.addInitScript((t) => sessionStorage.setItem('authToken', t), operator.token);
    await page.goto(url);
    const section = page.getByTestId('chat-line');
    // A section is a line first: its name and its count, before anything opens.
    await pw(section.locator('.fold-sum')).toContainText('CHAT LINE', { timeout: 60_000 });
    await pw(section.locator('.fold-sum')).toContainText('0 of 1 let in');
    await section.locator('.fold-sum').click();
    const row = section.locator('tr', { hasText: 'Quill' });
    await pw(row).toContainText('quill-vendor');
    await pw(row).toContainText(`${witness.address.slice(0, 6)}…${witness.address.slice(-4)}`);
    await pw(row).toContainText('OFF');
    expect(await readLines(operator.address)).toEqual([]);

    await row.getByRole('button', { name: 'Let Quill speak in your open chats' }).click();
    await pw(row).toContainText('ON');
    await pw(section.locator('.fold-sum')).toContainText('1 of 1 let in');
    // The same grant the terminal writes, in the operator's own realm.
    expect(await readLines(operator.address)).toEqual([expect.objectContaining({ witness: witness.address, name: 'Quill', vendor: 'quill-vendor' })]);
    await page.screenshot({ path: shotPath('chat-line-section') });

    await row.getByRole('button', { name: 'Stop Quill from speaking in your open chats' }).click();
    await pw(row).toContainText('OFF');
    await pw(section.locator('.fold-sum')).toContainText('0 of 1 let in');
    expect(await readLines(operator.address)).toEqual([]);
    expect(errors).toEqual([]);
  }, 120_000);

  test('a witness cannot switch itself into a house: its own wallet is not on its board', async () => {
    const res = await fetch(`${url}api/v1/chat-line/witnesses/${witness.address}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${witness.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }),
    });
    expect(res.status).toBe(400);
    const board = await (await fetch(`${url}api/v1/chat-line/witnesses`, { headers: { Authorization: `Bearer ${witness.token}` } })).json();
    expect(board.witnesses).toEqual([]);
  });
});
