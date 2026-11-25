/* global window, document, fetch, sessionStorage */
// THE DOOR SAYS WHERE THE MODELS GO, before anything downloads (Design note, 2026-11-13: a teammate's
// Windows setup put its model on a full C: drive). A real Chromium on the real door, against the
// real preflight and model-server routes behind real signed-wallet auth; the machine read is this
// machine's own, the local-server sweep pinned to a dead port so no model is found. Nothing is
// mocked: the folder is chosen through the same POST /home the CHANGE press sends (the system's
// folder dialog itself is Electron's, which a headless browser does not have, so CHANGE is
// rightly absent here). The screenshot lands outside the repo.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect as pw } from '@playwright/test';
import { expect, test } from 'vitest';
import { realSessionToken, serveDoor, wordsOnScreen } from '../helpers/first-run-door-kit.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { verifySessionToken } from '../../backend/services/auth.js';

const ENV = ['NEUMA_DATA_ROOT', 'NEUMA_DISCOVERY_PORTS'];
// the door's own cap (first-run-door-states-browser.test.js): the folder line must fit inside it
const WORD_CAP = 130;

test('no model: the bar says where the models go and how much room that drive has, and follows a new folder', async () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-model-folder-door-'));
  let door; let setConfig; let before;
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_DISCOVERY_PORTS = '1';
    await fs.mkdir(path.join(process.env.NEUMA_DATA_ROOT, 'settings'), { recursive: true });
    const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');
    const { default: modelServerRouter } = await import('../../backend/routes/model-server-routes.js');
    const selection = await import('../../backend/services/llm-selection.js');
    setConfig = selection.setConfig;
    before = selection.getConfig();
    setConfig({ provider: 'custom', endpoint: 'http://127.0.0.1:9', model: 'none' });

    const token = await realSessionToken();
    await makeInstallOwner(verifySessionToken(token).address);
    door = await serveDoor({ cacheDir: path.join(root, 'cache'), token,
      routers: [['/api/v1/preflight', preflightRouter], ['/api/v1/model-server', modelServerRouter]] });
    const page = await door.open({ width: 1366, height: 768 });
    await page.evaluate(() => window.showDoor());
    const bar = page.getByTestId('door-bar');
    await pw(bar).toContainText('No model is running on this computer', { timeout: 60_000 });
    await pw(bar.getByRole('button', { name: /^SET UP / })).toBeVisible({ timeout: 30_000 });

    const plan = await page.evaluate(async () => (await fetch('/api/v1/model-server/plan', { headers: { Authorization: `Bearer ${sessionStorage.getItem('authToken')}` } })).json());
    const folder = page.locator('.door-bar-folder');
    if (!plan.homeChangeable) {
      // this machine's setup would use the person's own Ollama: its models stay where it keeps them
      await pw(folder).toHaveCount(0);
      process.stdout.write(`[model-folder] this machine's setup is "${plan.plan?.server}": no folder line, as designed\n`);
      return;
    }
    const shown = (p) => p.replace(os.homedir(), '~');
    await pw(folder).toContainText(`Models: ${shown(path.join(process.env.NEUMA_DATA_ROOT, 'model-server'))}`);
    await pw(folder).toContainText(/ · \d+(\.\d)? (GB|MB|TB) free$/);
    // a plain browser has no system folder dialog: CHANGE is offered only in the app
    await pw(folder.getByRole('button', { name: 'change' })).toHaveCount(0);
    const words = await wordsOnScreen(page);
    process.stdout.write(`[model-folder] words on screen with the folder line: ${words.length}\n`);
    expect(words.length).toBeLessThanOrEqual(WORD_CAP);

    // the person picks a folder on another drive: the same request CHANGE sends after the dialog
    const other = path.join(root, 'other-drive', 'Deus Neuma models');
    const answer = await page.evaluate(async (home) => (await fetch('/api/v1/model-server/home', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionStorage.getItem('authToken')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ home }),
    })).json(), other);
    expect(answer.homePath).toBe(other);
    await bar.getByRole('button', { name: 'check again' }).click();
    await pw(folder).toContainText(`Models: ${shown(other)}`, { timeout: 30_000 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'model-folder-door-1366.png') });
    expect(await page.evaluate(() => document.querySelector('.door-bar-folder').getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.expired)).toBe(0);
  } finally {
    await door?.close();
    if (setConfig && before) setConfig(before);
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 180_000);
