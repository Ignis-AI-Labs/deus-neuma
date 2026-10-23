/* global window, fetch, AbortSignal */
// THE DOOR'S MODEL BAR, in all its states, in a real Chromium against the real backend: the
// one-truth mind check (GET /api/v1/preflight/mind), the real machine read, and the real model
// setup (plan, install, status, cancel) behind real signed-wallet auth. Nothing is mocked:
//   NO MODEL — the default route points at no server and the port sweep at a dead port;
//   SETTING UP — the real setup job starts downloading the pinned Ollama into this test's own data
//     root, the bar shows one progress bar with the step, the percent and the time left, and the
//     STOP press really stops it (nothing is kept: the data root is removed);
//   READY — the route is pointed at the house model server, which answers for real.
// It also proves the gate end to end: Summon pressed while no model runs is held, and goes
// through by itself once the model answers. Screenshots land in test/e2e/shots/door-*.png.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { expect as pw } from '@playwright/test';
import { expect, test } from 'vitest';
import { realSessionToken, serveDoor, shotPath, wordsOnScreen } from '../helpers/first-run-door-kit.js';

const HOUSE_MODEL = 'http://127.0.0.1:8089';
const ENV = ['NEUMA_DATA_ROOT', 'NEUMA_DISCOVERY_PORTS'];
const VIEWPORTS = Object.freeze([{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]);
// The door used to put 445 words in front of a first-run person with no model; it must stay lean
const WORD_CAP = 80;

test('the model bar: no model, setting up, ready — and the door it holds opens by itself', async () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-door-states-'));
  let door; let cancelJob = () => false; let setConfig; let before;
  try {
    const models = await (await fetch(`${HOUSE_MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json().catch(() => null);
    expect(models?.data?.length, 'the house model server must be answering for the READY state').toBeGreaterThan(0);

    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_DISCOVERY_PORTS = '1'; // the sweep reads a dead port: no local server is found
    await fs.mkdir(path.join(process.env.NEUMA_DATA_ROOT, 'settings'), { recursive: true });
    const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');
    const { default: modelServerRouter } = await import('../../backend/routes/model-server-routes.js');
    ({ cancelJob } = await import('../../backend/services/managed-ollama.js'));
    const selection = await import('../../backend/services/llm-selection.js');
    setConfig = selection.setConfig;
    before = selection.getConfig();
    // NO MODEL: the route points at a port nothing listens on
    setConfig({ provider: 'custom', endpoint: 'http://127.0.0.1:9', model: 'none' });

    door = await serveDoor({ cacheDir: path.join(root, 'cache'), token: await realSessionToken(),
      routers: [['/api/v1/preflight', preflightRouter], ['/api/v1/model-server', modelServerRouter]] });
    const show = async (viewport) => {
      const page = await door.open(viewport);
      await page.evaluate(() => window.showDoor());
      return page;
    };
    const bar = (page) => page.getByTestId('door-bar');
    const setUp = (page) => bar(page).getByRole('button', { name: /^SET UP / });

    // ── NO MODEL ────────────────────────────────────────────────────────────────────────────────
    for (const viewport of VIEWPORTS) {
      const page = await show(viewport);
      await pw(bar(page)).toContainText('No model is running on this computer', { timeout: 60_000 });
      await pw(setUp(page)).toBeEnabled({ timeout: 30_000 });
      // the act names the model and the download, both read from this machine's real plan
      expect(await setUp(page).textContent()).toMatch(/^SET UP .+ · \d+(\.\d)? GB$/);
      // the doors that need the local model wait, pointing at the bar; the others do not
      const summon = page.locator('.firstrun-door', { hasText: 'Summon a neuma' });
      await pw(summon).toHaveClass(/is-waiting/);
      await pw(summon).toContainText('needs the model above');
      await pw(page.locator('.firstrun-door', { hasText: 'Witness' })).not.toHaveClass(/is-waiting/);
      await page.screenshot({ path: shotPath(`door-no-model-${viewport.width}`) });
      if (viewport.width === 1366) {
        const words = await wordsOnScreen(page);
        process.stdout.write(`[door] words on screen, no model, ${viewport.width}: ${words.length}\n`);
        expect(words.length).toBeLessThanOrEqual(WORD_CAP);
        // the technical depth is one press away, never on arrival
        await bar(page).getByRole('button', { name: 'details' }).click();
        await pw(page.locator('.firstrun-capacity')).toHaveClass(/is-(ok|cpu|insufficient|unknown)/);
        await pw(page.locator('.door-bar-steps li').first()).toBeVisible();
        // the flight check's setup card reads the same plan through the same hook
        const named = (await setUp(page).textContent()).replace(/^SET UP | · .*$/g, '');
        await page.evaluate(() => window.showSetupCard());
        const card = page.getByTestId('model-server-setup');
        await pw(card).toContainText(named, { timeout: 30_000 });
        await pw(card.getByRole('button', { name: 'SET IT UP FOR ME' })).toBeEnabled();
        // real signed-wallet auth carried every read: the auth-rot alarm never sounded
        expect(await page.evaluate(() => window.expired)).toBe(0);
      }
      await page.close();
    }

    // ── SETTING UP ── the real job: one bar, the step, the percent, the time left ──────────────
    const working = await show(VIEWPORTS[0]);
    await pw(setUp(working)).toBeEnabled({ timeout: 30_000 });
    await setUp(working).click();
    const line = working.locator('.door-bar-line');
    await pw(line).toHaveText(/^Downloading the model server · \d+% · .+ left$/, { timeout: 90_000 });
    await pw(working.locator('.door-bar-progress')).toBeVisible();
    await working.screenshot({ path: shotPath('door-setting-up-1366') });
    // a second window joins the running job where it stands
    const wide = await show(VIEWPORTS[1]);
    await pw(wide.locator('.door-bar-line')).toHaveText(/^Downloading the model server · \d+% · .+ left$/, { timeout: 60_000 });
    await wide.screenshot({ path: shotPath('door-setting-up-1920') });
    await wide.close();
    // STOP really stops it, and the bar offers the way back in one press
    await bar(working).getByRole('button', { name: 'STOP' }).click();
    await pw(line).toHaveText('The setup was stopped.', { timeout: 30_000 });
    await pw(bar(working).getByRole('button', { name: 'TRY AGAIN' })).toBeVisible();
    await working.screenshot({ path: shotPath('door-stopped-1366') });

    // ── THE GATE ── Summon pressed while no model runs is held, then goes through by itself ─────
    await working.locator('.firstrun-path', { hasText: 'Summon a neuma' }).click();
    await pw(bar(working)).toContainText('The summoning starts by itself once the model runs.');
    expect(await working.evaluate(() => window.chosen)).toBeNull();
    setConfig({ provider: 'custom', endpoint: HOUSE_MODEL, model: models.data[0].id });
    await bar(working).getByRole('button', { name: 'check again' }).click();
    await working.waitForFunction(() => window.chosen === 'neuma', null, { timeout: 120_000 });
    await working.close();

    // ── READY ── the house model answers: the bar says so in the signal, the doors wake ────────
    for (const viewport of VIEWPORTS) {
      const page = await show(viewport);
      await pw(bar(page)).toHaveClass(/is-ready/, { timeout: 120_000 });
      await pw(page.locator('.door-bar-line')).toHaveText(/^Model ready/);
      await pw(setUp(page)).toHaveCount(0);
      const summon = page.locator('.firstrun-door', { hasText: 'Summon a neuma' });
      await pw(summon).not.toHaveClass(/is-waiting/);
      await pw(summon.locator('.firstrun-path-need')).toHaveClass(/is-met/);
      await page.screenshot({ path: shotPath(`door-ready-${viewport.width}`) });
      if (viewport.width === 1366) {
        process.stdout.write(`[door] words on screen, ready, ${viewport.width}: ${(await wordsOnScreen(page)).length}\n`);
        await page.locator('.firstrun-path', { hasText: 'Summon a neuma' }).click();
        expect(await page.evaluate(() => window.chosen)).toBe('neuma');
      }
      await page.close();
    }
  } finally {
    cancelJob();
    await door?.close();
    if (setConfig && before) setConfig(before);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 600_000);
