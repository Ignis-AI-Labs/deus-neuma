// Real Chromium + production terminal UI/window close + HTTP alarm + PTY backend.
// Scope: terminal lifecycle under a fixture phase host, NOT full AppShell/gateway.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startTerminalKit, until, pidAlive } from '../helpers/terminal-lifecycle-kit.js';

describe('HR-TERMINAL browser lifecycle (no GPU)', () => {
  let kit, vite, browser, base, a, b;
  beforeAll(async () => {
    kit = await startTerminalKit();
    a = await kit.signIn();
    b = await kit.signIn();
    // No repo Vite config/dotenv, no global dev ports, no GPU or model bootstrap.
    vite = await createServer({
      configFile: false, envFile: false,
      root: fileURLToPath(new URL('../../', import.meta.url)),
      cacheDir: path.join(kit.root, 'vite-cache'),
      optimizeDeps: { entries: ['test/fixtures/terminal-lifecycle.html'] },
      esbuild: { jsx: 'automatic' },
      server: {
        // No watcher: rooted at the repo, a watcher walks every data and
        // build folder and ran the worker out of memory (seen 2026-10-03).
        watch: null, hmr: { port: 1 }, ws: false,
        host: '127.0.0.1', port: 0,
        proxy: { '/api': kit.base, '/terminal-ws': { target: kit.base, ws: true } },
      },
    });
    await vite.listen(0);
    base = `http://127.0.0.1:${vite.httpServer.address().port}/test/fixtures/terminal-lifecycle.html`;
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  }, 60000);
  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await kit?.dispose();
  });

  const authenticatePage = (page, identity) => page.evaluate(({ token, address }) => {
    sessionStorage.setItem('authToken', token);
    localStorage.setItem('walletAddress', address);
  }, { token: identity.token, address: identity.address });
  const storedId = (page, identity) => page.evaluate((wallet) =>
    sessionStorage.getItem(`neuma:terminal:${wallet}:terminal`), identity.address);
  const type = async (page, command) => {
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');
  };
  const text = (page) => page.locator('.terminal-stage').innerText();
  const readPid = async (page) => {
    await until(() => page.locator('.xterm-helper-textarea').count());
    await type(page, 'printf "BROWSER_PID=%s\\n" "$$"');
    return Number(await until(async () => (await text(page)).match(/BROWSER_PID=(\d+)/)?.[1]));
  };

  test('REST rejection unmount, signed reauth, reload, wallet switch and explicit window close', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    let idA, idB;
    try {
      // Establish the origin without mounting a terminal before authentication.
      await page.goto(new URL('/test/fixtures/terminal-lifecycle.html', base).origin);
      await authenticatePage(page, a);
      await page.goto(base);
      idA = await until(() => storedId(page, a));
      const pid = await readPid(page);
      await type(page, 'NEUMA_MARK=browser_$((6*7)); printf "MARK=%s\\n" "$NEUMA_MARK"');
      await until(async () => (await text(page)).includes('MARK=browser_42'));
      expect(await kit.count(a)).toBe(1); // StrictMode must not double-spawn.

      await page.getByRole('button', { name: 'Rejected REST' }).click();
      await until(async () => (await page.locator('output').innerText()).includes('REST 401'));
      await until(async () => (await page.locator('.terminal-stage').count()) === 0);
      expect(await storedId(page, a)).toBe(idA);
      expect(pidAlive(pid)).toBe(true);
      const renewed = await kit.signIn(a.wallet);
      await authenticatePage(page, renewed);
      await page.getByRole('button', { name: 'Resume view' }).click();
      await until(async () => (await text(page)).includes('MARK=browser_42'));
      await type(page, 'printf "RECOVERED=%s:%s\\n" "$NEUMA_MARK" "$$"');
      await until(async () => (await text(page)).includes(`RECOVERED=browser_42:${pid}`));

      await page.reload();
      await until(async () => (await text(page)).includes('MARK=browser_42'));
      expect(await storedId(page, renewed)).toBe(idA);
      await type(page, 'printf "RELOADED=%s:%s\\n" "$NEUMA_MARK" "$$"');
      await until(async () => (await text(page)).includes(`RELOADED=browser_42:${pid}`));

      await page.getByRole('button', { name: 'Detach view' }).click();
      await until(async () => (await page.locator('.terminal-stage').count()) === 0);
      await authenticatePage(page, b);
      expect(await storedId(page, b)).toBeNull();
      await page.getByRole('button', { name: 'Resume view' }).click();
      idB = await until(() => storedId(page, b));
      expect(idB).not.toBe(idA);
      const pidB = await readPid(page);
      expect(pidB).not.toBe(pid);
      expect(await text(page)).not.toContain('MARK=browser_42');
      await page.getByRole('button', { name: 'Close window', exact: true }).click();
      await until(() => !pidAlive(pidB));
      expect(await storedId(page, b)).toBeNull();
      expect(await storedId(page, a)).toBe(idA);

      await page.getByRole('button', { name: 'Detach view' }).click();
      await authenticatePage(page, renewed);
      await page.getByRole('button', { name: 'Resume view' }).click();
      await until(async () => (await text(page)).includes('MARK=browser_42'));
      await page.getByRole('button', { name: 'Close window', exact: true }).click();
      await until(() => !pidAlive(pid));
      expect(await storedId(page, a)).toBeNull();
      expect(await kit.count(a)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      if (idA) await kit.close(a, idA);
      if (idB) await kit.close(b, idB);
    }
  }, 90000);

  test('foreign persisted ID refuses visibly without retries/fallback; another window key stays isolated', async () => {
    const page = await browser.newPage();
    let id;
    try {
      await page.goto(new URL(base).origin);
      await authenticatePage(page, a);
      await page.goto(base);
      id = await until(() => storedId(page, a));
      await readPid(page);
      await page.getByRole('button', { name: 'Detach view' }).click();
      await until(async () => (await page.locator('.terminal-stage').count()) === 0);
      await authenticatePage(page, b);
      await page.evaluate(({ wallet, id }) => {
        sessionStorage.setItem(`neuma:terminal:${wallet}:terminal`, id);
        sessionStorage.setItem(`neuma:terminal:${wallet}:terminal#2`, 'other-window-id');
      }, { wallet: b.address, id });
      await page.getByRole('button', { name: 'Resume view' }).click();
      await until(async () => (await text(page)).includes('Terminal unavailable for this wallet'));
      expect(await kit.count(a)).toBe(1);
      expect(await storedId(page, b)).toBe(id); // refusal remains honest across reload
      await page.getByRole('button', { name: 'Close window', exact: true }).click();
      await until(async () => (await page.locator('.terminal-stage').count()) === 0);
      expect(await storedId(page, b)).toBeNull();
      expect(await page.evaluate((wallet) => sessionStorage.getItem(`neuma:terminal:${wallet}:terminal#2`), b.address)).toBe('other-window-id');
      expect(await kit.count(a)).toBe(1); // B's close never killed A
    } finally { await page.close(); if (id) await kit.close(a, id); }
  }, 45000);

  test('production transport stops input on token replacement; dispose cannot override deliberate close', async () => {
    const page = await browser.newPage();
    let id;
    try {
      await page.goto(new URL(base).origin);
      await authenticatePage(page, a);
      // A string keeps Vitest's SSR transform out of the browser-native import.
      await page.evaluate("import('/frontend/services/terminal-socket.js').then((module) => { window.terminalSocketModule = module; })");
      await page.evaluate(() => {
        window.capture = { output: '', error: '', hello: null };
        window.client = window.terminalSocketModule.openTerminalSocket({
          onHello: (hello) => { window.capture.hello = hello; },
          onData: (data) => { window.capture.output += data; },
          onError: (error) => { window.capture.error = error; },
        });
      });
      id = await until(() => page.evaluate(() => window.capture.hello?.id));
      await page.evaluate(() => window.client.send('NEUMA_MARK=transport_$((6*7)); printf "WIRE=%s:%s\\n" "$NEUMA_MARK" "$$"\n'));
      const pid = Number(await until(() => page.evaluate(() => window.capture.output.match(/WIRE=transport_42:(\d+)/)?.[1])));
      await authenticatePage(page, b);
      await page.evaluate(() => window.client.send('NEUMA_MARK=stolen\n'));
      expect(await page.evaluate(() => window.capture.error)).toContain('authentication changed');
      expect(pidAlive(pid)).toBe(true);
      await authenticatePage(page, await kit.signIn(a.wallet));
      await page.evaluate((id) => {
        window.capture = { output: '', hello: null };
        window.client = window.terminalSocketModule.openTerminalSocket({
          termId: id,
          onHello: (hello) => { window.capture.hello = hello; },
          onData: (data) => { window.capture.output += data; },
        });
      }, id);
      await until(() => page.evaluate(() => window.capture.hello?.attached));
      await page.evaluate(() => window.client.send('printf "WIRE_RECOVERED=%s:%s\\n" "$NEUMA_MARK" "$$"\n'));
      await until(() => page.evaluate((pid) => window.capture.output.includes(`WIRE_RECOVERED=transport_42:${pid}`), pid));
      await page.evaluate(() => { window.client.close(); window.client.detach(); });
      await until(() => !pidAlive(pid));
      expect(await kit.count(a)).toBe(0);
    } finally { await page.close(); if (id) await kit.close(a, id); }
  }, 45000);
});
