// THE BIG RED BUTTON IN A REAL BROWSER (ruling, 2026-10-24) — real Chromium,
// the PRODUCTION MandatePanel and grant screen and the tray's mandate mark,
// the real mandate + waiting routes over a real signed-wallet session at
// this computer's own desk, the house social check against a loopback X, the
// real stores on tmp disk (mandate-desk-kit.js). No double (RULE 0). A screen
// of the armed grant is written for a person to look at.
/* global document, getComputedStyle */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { readMandate } from '../../backend/services/marketing/mandate/mandate-store.js';
import { buildDeskHouse, teardownDeskHouse } from '../helpers/mandate-desk-kit.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SHOTS = path.join(os.tmpdir(), 'neuma-mandate-grant-shots');
let k; let vite; let server; let browser; let base;

beforeAll(async () => {
  k = await buildDeskHouse();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/mandate', (await import('../../backend/routes/mandate-routes.js')).default);
  app.use('/api/v1/waiting', (await import('../../backend/routes/waiting-routes.js')).default);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(k.houses.tmp, 'vite-cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/mandate-grant-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (req, res) => {
    const seed = { token: k.operator.token, wallet: k.operator.address };
    res.type('html').send(`<!doctype html><html><body style="background:#000"><script>window.mandateFixtureSeed=${JSON.stringify(seed)}</script><div id="root"></div><script type="module" src="/test/helpers/mandate-grant-page.jsx"></script></body></html>`);
  });
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 180000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((r) => server.close(r));
  await vite?.close();
  if (k) await teardownDeskHouse(k);
}, 30000);

const open = async () => {
  const page = await (await browser.newContext()).newPage();
  await page.setViewportSize({ width: 1100, height: 1600 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'GRANT A MANDATE…' }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'GRANT A MANDATE…' }).click();
  await page.locator('.mandate-grant').waitFor();
  return { page, errors };
};
const hold = async (page, ms) => {
  const box = await page.locator('.mandate-hold').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
};
const rowOk = (page, id) => page.locator(`[data-check="${id}"]`).getAttribute('data-ok');
const toggle = (page, id) => page.locator('.mandate-accounts .mandate-toggle', { hasText: id }).click();

describe('the grant screen is a danger act, disarmed until every check passes, granted only by a HOLD', () => {
  it('opens on the danger line; nothing chosen → disarmed; x-2 not clear → ✗ with its door, still disarmed', async () => {
    const { page, errors } = await open();
    const first = await page.locator('.mandate-grant > *').first().textContent();
    expect(first).toBe('The CMO will post as your companies without asking you. What it posts goes public.');
    await page.locator('[data-check="accounts"][data-ok="false"]').waitFor();
    expect(await page.locator('.mandate-hold').isDisabled()).toBe(true);
    await toggle(page, 'x-2');
    await page.waitForFunction(() => document.querySelector('[data-check="accounts"] .mandate-check-words')?.textContent.startsWith('x-2:'), null, { timeout: 30000 });
    expect(await rowOk(page, 'accounts')).toBe('false');
    // Its door names the place it is fixed — that account on ACCOUNTS — never the window it is in.
    expect(await page.locator('[data-check="accounts"] .door-btn').textContent()).toBe('ACCOUNTS');
    expect(await page.locator('.mandate-hold').isDisabled()).toBe(true);
    expect(await page.locator('.mandate-hold').textContent()).toBe('NOT ARMED — EVERY CHECK MUST PASS');
    expect(await page.locator('text=UNTIL I WITHDRAW').count()).toBe(0);
    expect(errors).toEqual([]);
  }, 90000);

  it('x-1 clear → every row ✓ and the button arms; a short press does NOTHING; the full hold grants', async () => {
    const { page, errors } = await open();
    await toggle(page, 'x-1');
    await page.locator('.mandate-hold:not([disabled])').waitFor({ timeout: 30000 });
    for (const id of ['seat', 'accounts', 'security', 'legal', 'settled']) expect(await rowOk(page, id)).toBe('true');
    // Five ✓ marks in one row, each named on hover; no check opens while every one passes (show-dont-tell finding 6).
    expect(await page.locator('[data-check-marks] [data-ok="true"]').count()).toBe(5);
    expect(await page.locator('[data-mandate-checks]').count()).toBe(0);
    expect(await page.locator('[data-check-marks] [data-check="accounts"]').getAttribute('title')).toBe('Every account is clear on the social check — 1 of 1 clear.');
    expect(await page.locator('.mandate-hold').textContent()).toBe('HOLD 2 S TO GRANT');
    expect(await page.locator('[data-mandate-marks]').textContent()).toContain('x-1 · 2/DAY');
    expect(await page.locator('.mandate-term-end').textContent()).toMatch(/^OFF ON [A-Z]{3} \d{1,2}, \d{4} — then everything asks you again$/);
    await page.screenshot({ path: path.join(SHOTS, 'grant-armed.png'), fullPage: true });

    await page.locator('.mandate-hold').click();
    await hold(page, 900);
    await page.waitForTimeout(1500);
    expect(await readMandate(k.operator.address)).toBeNull();

    await hold(page, 2400);
    await page.locator('.mandate-head[data-tone="live"]').waitFor({ timeout: 15000 });
    expect((await readMandate(k.operator.address)).status).toBe('active');
    expect(errors).toEqual([]);
  }, 90000);

  it('the tray shows MANDATE · 7D in the alert colour, still, and its WITHDRAW ends it in one press', async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(base);
    await page.locator('.ntray-mandate-mark').waitFor({ timeout: 60000 });
    expect(await page.locator('.ntray-mandate-k').textContent()).toBe('MANDATE · 7D');
    const style = await page.locator('.ntray-mandate-mark').evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, size: s.fontSize, animation: s.animationName, transition: s.transitionDuration };
    });
    expect(style).toEqual({ color: 'rgb(255, 85, 51)', size: '13px', animation: 'none', transition: '0s' });
    await page.locator('.ntray-mandate-mark .mandate-withdraw').click();
    await page.locator('.ntray-mandate-mark').waitFor({ state: 'detached', timeout: 15000 });
    expect(await readMandate(k.operator.address)).toBeNull();
  }, 90000);

  it('MARKETING\'s own WITHDRAW ends a fresh grant too; no label on the grant screen is under 13px', async () => {
    const { page, errors } = await open();
    const small = await page.locator('.mandate-grant').evaluate((root) => [...root.querySelectorAll('*')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((el) => ({ text: el.textContent.trim().slice(0, 30), px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter((r) => r.px < 13));
    expect(small).toEqual([]);
    await toggle(page, 'x-1');
    await page.locator('.mandate-hold:not([disabled])').waitFor({ timeout: 30000 });
    await hold(page, 2400);
    await page.locator('.mandate-head .mandate-withdraw').waitFor({ timeout: 15000 });
    await page.locator('.mandate-head .mandate-withdraw').click();
    await page.getByRole('button', { name: 'GRANT A MANDATE…' }).waitFor({ timeout: 15000 });
    expect(await readMandate(k.operator.address)).toBeNull();
    expect(errors).toEqual([]);
  }, 90000);

  it('ANSWER EASY REPLIES names what still asks you, and its REPLIES A DAY box (up to 50) is what the grant holds', async () => {
    const { page, errors } = await open();
    await toggle(page, 'x-1');
    const replies = page.locator('.mandate-acts .mandate-toggle', { hasText: 'ANSWER EASY REPLIES' });
    await replies.click();
    expect(await replies.textContent()).toContain('money, migration, arguments, claims and promises still ask you');
    await page.getByRole('spinbutton', { name: 'replies a day, up to 50' }).fill('30');
    await page.locator('.mandate-hold:not([disabled])').waitFor({ timeout: 30000 });
    await hold(page, 2400);
    await page.locator('.mandate-head[data-tone="live"]').waitFor({ timeout: 15000 });
    expect(await readMandate(k.operator.address)).toMatchObject({ status: 'active', replyPace: 30, acts: { replies: true } });
    await page.locator('.mandate-head .mandate-withdraw').click();
    await page.getByRole('button', { name: 'GRANT A MANDATE…' }).waitFor({ timeout: 15000 });
    expect(errors).toEqual([]);
  }, 90000);
});
