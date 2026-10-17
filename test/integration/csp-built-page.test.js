// impure — built frontend, actual CSP/files routes and real Chromium.
/* global window, localStorage, document, addEventListener, PerformanceObserver */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import express from 'express';
import { build } from 'vite';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, test } from 'vitest';
import { securityHeaders } from '../../backend/services/security-headers.js';
import filesRouter from '../../backend/routes/user-files-routes.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { fullAuth } from '../helpers/audit-auth.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const listen = app => new Promise(resolve => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
const close = server => server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
const restore = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

test('the built page paints its saved LOOK and renders the real gateway without CSP violations', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-csp-page-'));
  const oldData = process.env.NEUMA_DATA_ROOT;
  let server, browser;
  try {
    process.env.NEUMA_DATA_ROOT = tmp;
    const app = express();
    app.use(securityHeaders);
    app.use(express.static(path.dirname(process.env.NEUMA_CSP_DIST_INDEX || path.join(root, 'dist/index.html'))));
    server = await listen(app);
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('neuma-look', JSON.stringify({ ground: '#102030', panel: '#203040', ink: '#abcdef', trim: '#fedcba' }));
      window.cspViolations = [];
      addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
      new PerformanceObserver(list => {
        if (list.getEntries().some(entry => entry.name === 'first-paint')) {
          window.firstPaintGround = document.documentElement.style.getPropertyValue('--color-void');
        }
      }).observe({ type: 'paint', buffered: true });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await browserExpect(page.locator('.portal-title')).toHaveText('DEUS NEUMA');
    await page.waitForFunction(() => Boolean(window.firstPaintGround));
    expect(await page.evaluate(() => window.firstPaintGround)).toBe('#102030');
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/tmp/neuma-csp-built-page.png', fullPage: true });
  } finally {
    await browser?.close(); await close(server);
    restore('NEUMA_DATA_ROOT', oldData);
    await fs.rm(tmp, { recursive: true, force: true });
  }
}, 30000);

// Explicit replacement corpus; not the unavailable private 2026-07-31 fixtures.
const hostileNames = Object.freeze([
  '<img src=x onerror=alert(1)>', '<svg onload=alert(2)>', '<script>alert(3)',
  '" autofocus onfocus=alert(4) x="', "' onmouseover='alert(5)", '<iframe srcdoc=alert(6)>',
  '<input autofocus onfocus=alert(7)>', '<details open ontoggle=alert(8)>',
  '&lt;img onerror=alert(9)&gt;', '&#60;svg onload=alert(10)&#62;',
  'quotes "double" and \'single\'', 'ampersand & and <angle>',
].flatMap((name, index) => ['.txt', '.md', '.json'].map(extension => `${index}-${name}${extension}`)));

test('36 hostile filenames render verbatim without injected nodes under the production CSP', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-csp-files-'));
  const folder = path.join(tmp, 'files'), priorRoots = getRoots();
  let server, browser;
  try {
    await fs.mkdir(folder);
    for (const name of hostileNames) await fs.writeFile(path.join(folder, name), 'file content');
    setRoots([folder]);
    const { token } = await fullAuth();
    const input = path.join(tmp, 'index.html');
    await fs.writeFile(input, `<!doctype html><div id="root"></div><script type="module" src="${path.join(root, 'test/fixtures/files-rename.jsx')}"></script>`);
    // Compile the actual FilesApp fixture, so Vite dev's injected inline code
    // cannot bypass or conflict with production CSP enforcement.
    await build({ configFile: false, root: tmp, logLevel: 'error',
      esbuild: { jsx: 'automatic' }, build: { outDir: path.join(tmp, 'dist'), emptyOutDir: true },
    });
    const app = express();
    app.use(express.json()); app.use(securityHeaders);
    app.use('/api/v1/user/files', filesRouter);
    app.use(express.static(path.join(tmp, 'dist')));
    server = await listen(app);
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const dialogs = [], errors = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(token => {
      globalThis.sessionStorage.setItem('authToken', token);
      window.cspViolations = [];
      addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    }, token);
    await page.goto(`http://127.0.0.1:${server.address().port}/?folder=${encodeURIComponent(folder)}`);
    const rows = page.locator('button.files-row');
    for (const name of hostileNames) {
      await browserExpect(rows.filter({ hasText: name })).toHaveCount(1);
    }
    expect(await page.locator('.files-rowwrap img, .files-rowwrap svg[onload], .files-rowwrap script, .files-rowwrap iframe, .files-rowwrap [onerror], .files-rowwrap [onfocus], .files-rowwrap details').count()).toBe(0);
    expect(dialogs).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  } finally {
    await browser?.close(); await close(server); setRoots(priorRoots);
    await fs.rm(tmp, { recursive: true, force: true });
  }
}, 30000);
