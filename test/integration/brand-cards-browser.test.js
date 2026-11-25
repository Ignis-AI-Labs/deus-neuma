// THE CARDS SECTION in a real browser — Design note, 2026-11-16: cards […]
// The production brand kit editor against the real brand routes, a real house ground in a temp
// realm, real kits and templates on disk, real Chromium. Nothing mocked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { createServer as createVite } from 'vite';
import { chromium } from '@playwright/test';
import { fullAuth } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { loadBrand, listTemplates } from '../../backend/services/branding/brand-tokens.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(os.tmpdir(), 'neuma-brand-cards-shots');
const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000000"/></svg>';
let tmp; let ground; let vite; let server; let browser; let auth; let savedRealm;

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'brand-cards-ui-')));
  savedRealm = getRealmRoot();
  setRealmRoot(path.join(tmp, 'realm'));
  auth = await fullAuth();
  ground = path.join(tmp, 'ground');
  await fs.mkdir(ground, { recursive: true });
  await setHouseWorkspace(auth.address, ground);
  // Northwind: a real kit (Umbrae's real tokens under another company's name) in the ground.
  const { tokens } = await loadBrand('umbrae');
  const dir = path.join(ground, 'brands', 'northwind');
  await fs.mkdir(path.join(dir, 'marks'), { recursive: true });
  await fs.writeFile(path.join(dir, 'brand.json'), JSON.stringify({
    ...tokens, brand: 'northwind', name: 'Northwind', handle: '@northwind',
    marks: { wordmark: { file: 'wordmark.svg', recolor: { '#000000': 'ink' } }, mask: { file: 'mask.svg', recolor: { '#000000': 'ink' } } },
  }, null, 2));
  await fs.writeFile(path.join(dir, 'marks', 'wordmark.svg'), art);
  await fs.writeFile(path.join(dir, 'marks', 'mask.svg'), art);

  const web = express();
  web.use(express.json({ limit: '100kb' }));
  web.use('/api/v1/brands', (await import('../../backend/routes/brand-routes.js')).default);
  web.use('/api/v1/user/realm', (await import('../../backend/routes/user-realm-routes.js')).default);
  vite = await createVite({
    configFile: false, root: REPO, cacheDir: path.join(tmp, 'vite-cache'), appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: ['test/helpers/brand-kits-page.jsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  web.get('/', (req, res) => res.type('html').send(
    `<!doctype html><html><body style="background:#000;margin:0"><script>window.brandKitsFixture=${JSON.stringify({ token: auth.token, brand: 'northwind' })}</script><div id="root"></div><script type="module" src="/test/helpers/brand-kits-page.jsx"></script></body></html>`,
  ));
  web.use(vite.middlewares);
  server = http.createServer(web);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  await fs.mkdir(SHOTS, { recursive: true });
}, 240000);

afterAll(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await vite?.close();
  setRealmRoot(savedRealm);
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}, 30000);

describe('CARDS — every card a company draws, each made its own', () => {
  it('lists every card as shared, redesigns one in place, refuses an unsafe design, and lets it go', async () => {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    const errors = [];
    // Vite's own dev client (HMR is off in this harness) gives up its socket with this line; it is
    // the test server's, never the panel's.
    page.on('pageerror', (e) => { if (e.message !== 'WebSocket closed without opened.') errors.push(e.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const cardsRow = page.locator('.bk-rail-row', { hasText: 'CARDS' });
    await cardsRow.waitFor({ timeout: 120000 });
    const total = (await listTemplates()).length;
    await cardsRow.click();

    // The gallery: every card type, each the shared drawing Ignis and Umbrae draw too.
    const tiles = page.locator('.bk-card-tile');
    await expect.poll(() => tiles.count(), { timeout: 30000 }).toBe(total);
    expect(await page.locator('.bk-section-head .bk-note').first().textContent())
      .toBe(`${total} of ${total} cards are still the shared layout other companies draw too. Open one to make it NORTHWIND's.`);
    expect(await cardsRow.textContent()).toBe(`CARDS0/${total}`);
    const stat = page.locator('.bk-card-tile', { hasText: 'STAT ROW' });
    expect(await stat.locator('.bk-card-standing').textContent()).toBe('SHARED LAYOUT');
    expect(await stat.getAttribute('title')).toContain('The same drawing IGNIS, UMBRAE use');
    // Thumbnails are drawn from the kit, one by one — every one, the guest-logo cards on the shipped sample.
    await expect.poll(() => page.locator('.bk-card-thumb .bk-svg').count(), { timeout: 60000 }).toBe(total);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-1400.png'), fullPage: true });

    // The designer: the shared stat card, drawn; redesigned by editing its drawing; saved as Northwind's.
    await stat.click();
    await expect.poll(() => page.locator('.bk-designer h4').textContent()).toBe('STAT ROW · SHARED LAYOUT');
    await page.locator('.bk-designer-stage .bk-svg').waitFor({ timeout: 30000 });
    const drawing = page.getByLabel("the stat card's drawing as SVG");
    const shared = await drawing.inputValue();
    const redesign = shared.replace('</svg>', '  <circle id="northwind-orbit" cx="1380" cy="450" r="300" fill="none" stroke="{{token.trim}}" stroke-width="2"/>\n</svg>');
    await drawing.fill(redesign);
    await page.getByRole('button', { name: 'SAVE THIS DESIGN' }).click();
    await expect.poll(() => page.locator('.bk-notice').textContent()).toBe('Saved. Every stat card NORTHWIND posts is drawn from this design.');
    expect(await page.locator('.bk-designer h4').textContent()).toBe("STAT ROW · NORTHWIND'S OWN DESIGN");
    expect(await fs.readFile(path.join(ground, 'brands', 'northwind', 'cards', 'stat.svg'), 'utf8')).toContain('northwind-orbit');
    // Drawn from the saved design: the new circle is in the card on screen.
    await expect.poll(() => page.locator('.bk-designer-stage .bk-svg').evaluate((el) => el.shadowRoot.innerHTML.includes('northwind-orbit')), { timeout: 30000 }).toBe(true);

    // An unsafe drawing is refused by name, never drawn.
    await drawing.fill(redesign.replace('</svg>', '<script>alert(1)</script></svg>'));
    await page.locator('.bk-preview-refusal').waitFor({ timeout: 30000 });
    expect(await page.locator('.bk-preview-refusal').textContent()).toContain('<script> is not something a card draws');
    await page.getByRole('button', { name: 'UNDO CHANGES' }).click();
    await page.screenshot({ path: path.join(SHOTS, 'designer-1400.png'), fullPage: true });

    // Back in the gallery, the count moved; then the design is let go and the shared card stands again.
    await page.getByRole('button', { name: '← ALL CARDS' }).click();
    await expect.poll(() => stat.locator('.bk-card-standing').textContent(), { timeout: 30000 }).toMatch(/^OWN/);
    expect(await cardsRow.textContent()).toBe(`CARDS1/${total}`);
    await stat.click();
    await page.getByRole('button', { name: 'BACK TO THE SHARED DESIGN' }).click();
    await expect.poll(() => page.locator('.bk-designer h4').textContent(), { timeout: 30000 }).toBe('STAT ROW · SHARED LAYOUT');
    await expect(fs.access(path.join(ground, 'brands', 'northwind', 'cards', 'stat.svg'))).rejects.toThrow();
    expect(errors).toEqual([]);
  }, 240000);
});
