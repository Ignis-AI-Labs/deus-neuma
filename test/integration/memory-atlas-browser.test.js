// CONTEXT MAP · MEMORY in a real browser: the PRODUCTION view with its real
// stylesheets, reading a real lane over the real REST routes (real auth, real
// observation files, the real atlas). The lane's memories are a stated
// fixture: six subjects written out in varied sentences. No mocks (RULE 0).
/* global process, fetch */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(REPO, 'test/e2e/shots');
const LANE = 'neuma-atlas-browser';

const SUBJECTS = {
  pools: ['liquidity pool', 'Umbrae router', 'deposit', 'LP wallet', 'swap fees', 'price range', 'pool position', 'slippage'],
  film: ['motion film', 'quasar body', 'render frames', 'sound bed', 'TikTok cut', 'storyboard', 'caption safe area', 'review sheet'],
  mail: ['DKIM key', 'DMARC policy', 'SPF record', 'Cloudflare DNS', 'selector', 'spam folder', 'Postmaster tools', 'sender reputation'],
  leads: ['lead list', 'outreach email', 'Hunter lookup', 'campaign', 'fit score', 'first email subject', 'bounce check', 'audience'],
  bench: ['benchmark night', 'tokens per second', 'judge model', 'baseline run', 'GPU card', 'draft acceptance', 'score table', 'frozen subject'],
  house: ['house charter', 'seat holder', 'chief of staff', 'position hub', 'house clock', 'waiting on you', 'company line', 'treasury'],
};
const ASKS = ['Where do we stand on the', 'Can you check the', 'What changed with the', 'Walk me through the', 'Is anything blocking the'];
const TELLS = ['is settled and holds', 'needs one more pass', 'was fixed this morning', 'still waits on a decision', 'is proven by a test'];

let tmp; let vite; let server; let browser; let token; let base;

beforeAll(async () => {
  process.env.DNA_ENCRYPTION_KEY = 'memory-atlas-browser-test-key';
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-atlas-browser-'));
  const root = path.join(tmp, 'workspaces');
  await fs.mkdir(root);
  const workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
  workspace.root = root;
  const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
  const { createAuthRouter } = await import('../../backend/services/auth.js');

  const app = express();
  app.use('/api', express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/workspace', workspaceRouter);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom',
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/memory-atlas-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => {
    const fixture = { neumaId: LANE, width: Number(req.query.w) || 1280, height: Number(req.query.h) || 820 };
    res.type('html').send(
      `<!doctype html><body style="margin:0;background:#000"><script>window.atlasFixture=${JSON.stringify(fixture)};sessionStorage.setItem('authToken',${JSON.stringify(token)})</script><div id="root"></div><script type="module" src="/test/helpers/memory-atlas-page.jsx"></script></body>`,
    );
  });
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await workspace.create(LANE);
  await fs.mkdir(path.join(root, LANE, 'dna'), { recursive: true });
  await fs.writeFile(path.join(root, LANE, 'dna', 'genesis.md'), '# Genesis\nborn for the atlas browser test\n');
  const owner = generateKeypair();
  const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${owner.address}`)).json();
  const verified = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: owner.address, signature: await signMessage(owner.privateKey, challenge), challenge }),
  });
  ({ token } = await verified.json());
  await claimOwner(root, LANE, owner.address);

  // One moment with its real conversation rows, so the reader reopens a real source.
  const said = 'Where do we stand on the liquidity pool and the Umbrae router deposit?';
  const answered = 'The LP wallet signs the deposit, the Umbrae router places it in the liquidity pool, and the swap fees come back to the pool position.';
  const userRow = await workspace.appendMessage(LANE, 'sess-atlas', { role: 'user', content: said });
  const replyRow = await workspace.appendMessage(LANE, 'sess-atlas', { role: 'assistant', content: answered });
  await workspace.addObservation(LANE, {
    type: 'exchange', userMessage: said, response: answered, timestamp: '2026-11-19T15:00:00.000Z',
    anchor: makeAnchor({ sessionId: 'sess-atlas', userMessage: userRow, assistantMessage: replyRow }),
  });
  const writes = [];
  Object.entries(SUBJECTS).forEach(([, words], s) => {
    const count = [34, 26, 20, 16, 12, 9][s];
    for (let i = 0; i < count; i += 1) {
      const a = words[i % 8]; const b = words[(i * 3 + 1) % 8]; const c = words[(i * 5 + 2) % 8];
      const at = new Date(Date.UTC(2026, 7 + ((s + i) % 4), 1 + ((i * 7 + s * 3) % 27), 9 + (i % 9))).toISOString();
      writes.push(i % 6 === 5
        ? { type: 'self-note', noteKind: i % 12 === 5 ? 'fact' : 'note', source: 'self-authored', content: `The ${a} ${TELLS[i % 5]}; the ${b} depends on it.`, timestamp: at }
        : {
            type: 'exchange', timestamp: at, ...(i % 11 === 3 ? { origin: 'link' } : {}),
            userMessage: `${ASKS[i % 5]} ${a}${i % 4 === 0 ? ', Metidar' : ''}?`,
            response: `The ${a} ${TELLS[(i + s) % 5]}. The ${b} ${TELLS[(i + 2) % 5]}, and the ${c} follows from it.`,
          });
    }
  });
  writes.push({ type: 'exchange', userMessage: 'What is the weather in Jakarta like in March?', response: 'Hot and dry before the rains.', timestamp: '2026-09-09T09:00:00.000Z' });
  for (const w of writes) await workspace.addObservation(LANE, w);
  const withdrawn = await workspace.addObservation(LANE, { type: 'self-note', noteKind: 'note', source: 'self-authored', content: 'The Umbrae router takes no swap fees on a deposit.', timestamp: '2026-10-10T09:00:00.000Z' });
  await workspace.invalidateObservation(LANE, withdrawn.id, { lifecycle: 'retracted', reason: 'wrong' });

  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
}, 180000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

const rows = (page) => page.locator('[data-sheet="memories"] tbody tr');

describe('CONTEXT MAP · MEMORY — real view, real styles, real routes', () => {
  it('ways in, a search, a memory opened and a thread followed, then the map', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    // The dev server's own reload socket is switched off for this fixture (hmr port 1); its client saying so is not the view's.
    page.on('pageerror', (e) => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
    await page.goto(`${base}/`);
    await page.locator('.atlas-rail').waitFor({ timeout: 90000 });

    // The whole, counted: every memory, the set-aside one among them.
    expect(await page.locator('.atlas-sum').textContent()).toMatch(/^120 MEMORIES·\d+ TOPICS·AUG \d+, 2026 → NOV \d+, 2026·1 SET ASIDE$/);
    expect(await page.locator('.atlas-shown').textContent()).toBe('120 OF 120 SHOWN');
    expect(await rows(page).count()).toBe(100); // the sheet pages past a hundred, and says so
    expect(await page.locator('[data-sheet-range]').textContent()).toBe('SHOWING 1–100 OF 120');

    // Topics are named by their own words, never by small talk.
    const names = await page.locator('.atlas-group').first().locator('.atlas-way-name').allTextContents();
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names.join(' ')).not.toMatch(/\b(stand|walk|settled|morning|blocking)\b/i);
    await page.screenshot({ path: path.join(SHOTS, 'memory-atlas-list.png') });

    // A topic narrows the list; the other ways-in recount to what it holds.
    const first = page.locator('.atlas-group').first().locator('.atlas-way').first();
    const size = Number((await first.locator('.atlas-way-n').textContent()).replace(/,/g, ''));
    await first.click();
    expect(await rows(page).count()).toBe(size);
    expect(await page.locator('.atlas-shown').textContent()).toBe(`${size} OF 120 SHOWN`);
    expect(await page.locator('.atlas-chip').first().textContent()).toContain('TOPIC');
    const months = await page.locator('.atlas-group', { hasText: 'MONTHS' }).locator('.atlas-way-n').allTextContents();
    expect(months.map(Number).reduce((a, b) => a + b, 0)).toBe(size);
    await page.locator('.atlas-chip').first().click();
    expect(await page.locator('.atlas-shown').textContent()).toBe('120 OF 120 SHOWN');

    // A search for words reaches the set-aside memory too, and says how it stands.
    await page.locator('.atlas-search').fill('router takes no swap fees');
    await expect.poll(() => rows(page).count(), { timeout: 15000 }).toBe(1);
    expect(await rows(page).first().textContent()).toContain('TAKEN BACK');
    await page.locator('.atlas-search').fill('');
    await expect.poll(() => page.locator('.atlas-shown').textContent()).toBe('120 OF 120 SHOWN');

    // Open the remembered conversation: its own words in full, where it came from, what lies near.
    await page.locator('.atlas-row-open', { hasText: 'Where do we stand on the liquidity pool and the Umbrae router deposit?' }).click();
    const reader = page.locator('.atlas-reader');
    await reader.locator('.atlas-turns').waitFor({ timeout: 15000 });
    // The conversation reads as turns, the remembered pair marked — not as the raw text a being is handed.
    expect(await reader.locator('.atlas-turn.is-kept .atlas-turn-who').allTextContents()).toEqual(['SAID TO IT · REMEMBERED', 'IT ANSWERED · REMEMBERED']);
    expect(await reader.locator('.atlas-turn.is-answered .atlas-turn-words').textContent()).toContain('the swap fees come back to the pool position');
    expect(await reader.locator('.atlas-turns').textContent()).not.toContain('Remembered from');
    expect(await reader.locator('.atlas-read-h').first().textContent()).toBe('READ FROM THE CONVERSATION IT HAPPENED IN');
    expect(await reader.locator('.atlas-exact').textContent()).toMatch(/^mem_sess-atlas_\d+_[a-f0-9]{8}$/);
    expect(await page.locator('tr[data-atlas-open]').count()).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, 'memory-atlas-reader.png') });

    // Follow a thread: a near memory opens in its place, and BACK returns.
    const back = reader.locator('.atlas-read-bar .atlas-btn', { hasText: 'BACK' });
    expect(await back.isDisabled()).toBe(true);
    const nearLine = await reader.locator('.atlas-near-line').first().textContent();
    await reader.locator('.atlas-near-row').first().click();
    await reader.locator('.atlas-read-text').waitFor({ timeout: 15000 }); // a memory with no conversation behind it shows its own line
    expect(nearLine.length).toBeGreaterThan(0);
    expect(await back.isDisabled()).toBe(false);
    await back.click();
    await reader.locator('.atlas-turns').waitFor({ timeout: 15000 });

    // The map: every memory a dot inside its topic's disc, the opened one marked with its threads.
    await page.locator('.atlas-seg .atlas-btn', { hasText: 'MAP' }).click();
    expect(await page.locator('.atlas-dot').count()).toBe(120);
    expect(await page.locator('.atlas-dot.is-open').count()).toBe(1);
    expect(await page.locator('.atlas-thread').count()).toBeGreaterThan(0);
    expect(await page.locator('.atlas-disc').count()).toBeGreaterThanOrEqual(6);
    // Discs never overlap: the picture is a map, not a ball of yarn.
    const discs = await page.locator('.atlas-disc circle').evaluateAll((els) => els.map((e) => ({ x: +e.getAttribute('cx'), y: +e.getAttribute('cy'), r: +e.getAttribute('r') })));
    for (let i = 0; i < discs.length; i += 1) {
      for (let j = i + 1; j < discs.length; j += 1) {
        expect(Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y)).toBeGreaterThan(discs[i].r + discs[j].r);
      }
    }
    await page.screenshot({ path: path.join(SHOTS, 'memory-atlas-map.png') });
    // A disc is a way in too: pressing one narrows to its topic and dims the rest.
    // (pressed at its rim: the middle of a disc is covered by its own memories)
    const rim = await page.locator('.atlas-disc circle').first().boundingBox();
    await page.mouse.click(rim.x + rim.width / 2, rim.y + 4);
    expect(await page.locator('.atlas-dot.is-dim').count()).toBeGreaterThan(0);

    await page.locator('.atlas-chip', { hasText: 'TOPIC' }).click();

    // THE SPACE: the same memories as lights to move through. It draws, it turns under a drag, and
    // choosing a topic carries the camera to that cluster, whose core memory then sits mid-screen.
    await page.locator('.atlas-read-bar .atlas-btn', { hasText: 'CLOSE' }).click();
    await page.locator('.atlas-seg .atlas-btn', { hasText: 'SPACE' }).click();
    const canvas = page.locator('.atlas-space-canvas');
    await expect.poll(() => canvas.getAttribute('data-at'), { timeout: 15000 }).toBe('whole');
    await page.locator('.atlas-btn', { hasText: 'DRIFT' }).click(); // hold it still to compare frames
    const lights = () => canvas.evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; let sum = 0;
      for (let i = 3; i < d.length; i += 4) { if (d[i] > 40) { lit += 1; sum = (sum + i * d[i]) % 1000000007; } }
      return { lit, sum };
    });
    const whole = await lights();
    expect(whole.lit).toBeGreaterThan(400); // 120 lights and their names are on the canvas
    await page.screenshot({ path: path.join(SHOTS, 'memory-atlas-space.png') });
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height - 70, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    expect((await lights()).sum).not.toBe(whole.sum); // the drag turned it

    const second = page.locator('.atlas-group').first().locator('.atlas-way').nth(1);
    const topicName = await second.locator('.atlas-way-name').textContent();
    await second.click();
    await expect.poll(() => canvas.getAttribute('data-at'), { timeout: 15000 }).toBe('topic:1'); // the camera has arrived
    await page.screenshot({ path: path.join(SHOTS, 'memory-atlas-space-topic.png') });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.atlas-reader .atlas-facts').waitFor({ timeout: 15000 });
    expect(await page.locator('.atlas-reader .atlas-link').first().textContent()).toBe(topicName);

    expect(errors).toEqual([]);
    await page.close();
  }, 180000);

  it('a narrow window keeps every part reachable: the reader moves under the list', async () => {
    const page = await browser.newPage({ viewport: { width: 860, height: 640 } });
    await page.goto(`${base}/?w=840&h=620`);
    await page.locator('.atlas-rail').waitFor({ timeout: 90000 });
    await page.locator('.atlas-row-open').first().click();
    await page.locator('.atlas-reader .atlas-facts').waitFor({ timeout: 15000 });
    const list = await page.locator('.atlas-main').boundingBox();
    const reader = await page.locator('.atlas-reader').boundingBox();
    expect(reader.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
    expect(reader.x + reader.width).toBeLessThanOrEqual(841);
    await page.screenshot({ path: path.join(SHOTS, 'memory-atlas-narrow.png') });
    await page.close();
  }, 120000);
});
