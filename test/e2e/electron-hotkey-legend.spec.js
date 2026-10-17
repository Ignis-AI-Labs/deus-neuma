// @ts-check
//
// Impure test module — drives the REAL Electron app (Rule 1 marker at file
// level): real main process, real `hotkeys:list` IPC handler, real sandboxed
// preload bridge, real react effect in HotkeysSection. No fakes anywhere on
// the claimed path.
//
// Gnosis for the Settings hotkey legend's DESK group: inside the desktop
// shell, the legend must show the app-level accelerators from the ONE
// registry (electron/hotkeys.cjs) — the same table the application menu
// binds. A browser tab proves the absence (desk.spec.js); THIS spec proves
// the presence, which no unit test can reach (renderToStaticMarkup never
// runs effects) and no web e2e can reach (no window.neuma bridge).
//
// Requires a built frontend (npm run build). On a headless box run under
// xvfb (xvfb-run -a npx playwright test test/e2e/electron-hotkey-legend.spec.js).
import { test, expect, _electron as electron } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';
import { APP_HOTKEYS } from '../../electron/hotkeys.cjs';
import { openDockApp } from './helpers/dock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

let origin;

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token via the in-app backend's challenge-sign-verify — the
// same flow the gateway runs, against the backend Electron itself spawned.
const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const { challenge } = await (await fetch(`${origin}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${origin}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr: w.address };
};

test.describe('settings hotkey legend — DESK group (real Electron, real IPC)', () => {
  test.setTimeout(180 * 1000);
  let app;
  let page;
  let userDataDir;
  let wsRoot;

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-hklegend-udd-'));
    wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-hklegend-ws-'));
    app = await electron.launch({
      executablePath: electronPath,
      args: [REPO, `--user-data-dir=${userDataDir}`],
      cwd: REPO,
      timeout: 60 * 1000,
      env: {
        ...process.env,
        NEUMA_PIPELINE_MODE: 'operator',
        NEUMA_PORT: '0',
        WORKSPACES_ROOT: wsRoot,
      },
    });
    page = await app.firstWindow();
    origin = new URL(page.url()).origin;
    expect(Number(new URL(origin).port)).toBeGreaterThan(0);
    await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });

    // Land on the relink desk WITHOUT navigating the first window — reload
    // and goto never settle under Playwright-Electron (footgun recorded in
    // electron-birth.spec.js). Instead: seed the first window with a REAL
    // session, then spawn a sibling desk through the product's own one-shot
    // boot relay (window.neuma.desk.open, proven in desk-relay.spec.js) —
    // the new desk wakes authenticated at first paint and IS the surface
    // under test. localStorage (wallet + active companion) is origin-shared
    // across windows; the token rides the relay into sessionStorage.
    const { token, addr } = await mintToken();
    await page.evaluate(({ t, a }) => {
      localStorage.setItem('walletAddress', a);
      localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-hklegend' }));
      sessionStorage.setItem('authToken', t);
    }, { t: token, a: addr });
    const [desk2] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.neuma.desk.open()),
    ]);
    page = desk2;
    await expect(page.locator('.relink')).toBeVisible({ timeout: 60 * 1000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(wsRoot, { recursive: true, force: true });
  });

  test('the DESK group renders every registry accelerator through the real bridge', async () => {
    await openDockApp(page, 'SETTINGS');
    await expect(page.locator('.settings-h', { hasText: 'HOTKEYS' })).toBeVisible();

    // The headline: DESK leads, fed by hotkeys:list IPC → the real registry.
    const legend = page.locator('.settings-hotkeys');
    const desk = legend.locator('.settings-hk-group').first();
    await expect(desk.locator('.settings-hk-title')).toHaveText('DESK');
    await expect(desk.locator('.settings-hk-row')).toHaveCount(APP_HOTKEYS.length);

    // Every row of the ONE registry appears with its keys and description —
    // the drift sentinel on the real rendered surface: a row added to
    // hotkeys.cjs must show up here without anyone copying it.
    for (const hk of APP_HOTKEYS) {
      const row = desk.locator('.settings-hk-row', { hasText: hk.description });
      await expect(row).toBeVisible();
      // Linux/Windows spell CmdOrCtrl as CTRL (this box is not darwin).
      for (const key of hk.accelerator.replace(/CmdOrCtrl/i, 'CTRL').split('+')) {
        await expect(row.locator('.settings-key', { hasText: new RegExp(`^${key.toUpperCase()}$`) })).toBeVisible();
      }
    }

    // The renderer groups still follow — one legend, both registries.
    await expect(legend.locator('.settings-hk-title', { hasText: 'SKILL PALETTE' })).toBeVisible();
  });
});
