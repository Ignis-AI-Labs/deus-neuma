/**
 * SPELLING IS CHECKED ON THIS COMPUTER, AND NOTHING IS FETCHED FROM GOOGLE. In a REAL Electron on
 * fresh profiles, every request routed through a local recording proxy: the app's own
 * spellcheck-main.cjs marks a misspelled word with suggestions and asks the network for nothing,
 * and a language it ships no dictionary for goes unchecked, still asking nothing. The control,
 * Chromium as it comes, sends its dictionary download through the same proxy, which proves the
 * proxy sees one. Nothing is mocked.
 *
 * When Electron is upgraded and its dictionary file names move, the first test fails here: refresh
 * electron/dictionaries/ from that release's hunspell_dictionaries.zip (see its README.md).
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { afterAll, beforeAll, expect, test } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../fixtures/offline-spellcheck-main.cjs', import.meta.url));
let proxy;
const asked = [];
let root;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-spellcheck-'));
  // A proxy that records every request and forwards none: nothing reaches the internet either way.
  proxy = http.createServer((req, res) => { asked.push(req.url); res.writeHead(403).end(); });
  proxy.on('connect', (req, socket) => { asked.push(`CONNECT ${req.url}`); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
  proxy?.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

const launch = (name, env) => electron.launch({
  executablePath: electronPath,
  args: ['--disable-gpu', `--proxy-server=http://127.0.0.1:${proxy.address().port}`, FIXTURE],
  env: { ...process.env, SPELL_PROFILE: path.join(root, name), ...env },
});

/** Type a misspelled word, wait for the spellchecker, right-click it; what the menu was told. */
const misspell = async (app) => {
  const page = await app.firstWindow();
  await page.waitForSelector('#t', { state: 'attached' });
  await page.focus('#t');
  await page.keyboard.type('helo ');
  await page.waitForTimeout(5000);
  await page.mouse.click(16, 14, { button: 'right' });
  await expect.poll(() => app.evaluate(() => global.menu), { timeout: 10_000 }).not.toBeNull();
  return app.evaluate(() => ({ menu: global.menu, events: global.spellEvents }));
};

test('English is checked from the shipped dictionary, and nothing is asked of the network', async () => {
  asked.length = 0;
  const app = await launch('app-en', { SPELL_MODE: 'app', SPELL_LANG: 'en-US' });
  try {
    const { menu, events } = await misspell(app);
    expect(menu.word).toBe('helo');
    expect(menu.suggestions).toContain('hello');
    expect(events).toEqual(['initialized:en-US']);
    expect(asked).toEqual([]);
  } finally {
    await app.close();
  }
}, 60_000);

test('a language with no shipped dictionary goes unchecked, still asking nothing', async () => {
  asked.length = 0;
  const app = await launch('app-fr', { SPELL_MODE: 'app', SPELL_LANG: 'fr-FR' });
  try {
    const { menu, events } = await misspell(app);
    expect(menu.word).toBe('');
    expect(events).not.toContain('download-success:fr-FR');
    expect(asked).toEqual([]);
  } finally {
    await app.close();
  }
}, 60_000);

test('a build without the dictionaries launches, unchecked, asking nothing', async () => {
  asked.length = 0;
  const app = await launch('no-bundle', { SPELL_MODE: 'app', SPELL_BUNDLE: path.join(root, 'missing') });
  try {
    const { menu } = await misspell(app);
    expect(menu.word).toBe('');
    expect(await app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages())).toEqual([]);
    expect(asked).toEqual([]);
  } finally {
    await app.close();
  }
}, 60_000);

test('the control: Chromium as it comes sends its dictionary download through the proxy', async () => {
  asked.length = 0;
  const app = await launch('stock', { SPELL_MODE: 'stock', SPELL_LANG: 'en-US' });
  try {
    await expect.poll(() => asked.length, { timeout: 30_000 }).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
}, 60_000);
