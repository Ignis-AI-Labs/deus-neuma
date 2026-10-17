// @ts-check
// THE SUMMONING RITE on a LIVE ceremony — a REHEARSAL walked end to end.
//
// Design note, 2026-09-30: […]
//
// The real road: gateway → covenant → pre-flight → witness → the seven stages
// on a real model → the rehearsal's end → its film → the ceremony's own
// close. REHEARSAL (?test=1): no being is made, and the rehearsal lane is
// swept — never create-and-discard. The stack is ISOLATED (perf-harness: its
// own backend, data root, vault and workspaces — never the live settings or
// their post scheduler); its substrate is the house model, spoken to as a
// plain client (the lm-studio wire — nothing supervised, nothing restarted),
// on Founder's word ([…]).
//
// Needs RITE_LIVE=1 (it spends a real ceremony on the house model).
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, perf } from './helpers/perf-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'shots');
const SUBSTRATE = process.env.RITE_SUBSTRATE || 'http://127.0.0.1:8089';

test.skip(process.env.RITE_LIVE !== '1', 'RITE_LIVE=1 walks a real rehearsal on the house model');
setupPerfStack({
  dev: true,
  env: { LLM_PROVIDER: 'lm-studio', LM_STUDIO_URL: SUBSTRATE, LLM_MODEL: process.env.RITE_MODEL || 'local-model' },
});
test.use({ viewport: { width: 1600, height: 900 }, baseURL: undefined });

const PASSWORD = 'rite-live-rehearsal-pw';

test('a rehearsal walks THE SUMMONING RITE: the living piece, the measure, the forging-free end, its film', async ({ page }) => {
  test.setTimeout(35 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
  // the platform's sound preference ON: the rite's one instrument plays
  await page.addInitScript(() => localStorage.setItem('neuma-sound', 'on'));

  await page.goto(`http://localhost:${perf.FPORT}/?test=1`);
  await expect(page.locator('#portal-enter')).toBeVisible({ timeout: 5 * 60 * 1000 });
  const w = ethers.Wallet.createRandom();
  await page.evaluate(async ({ pk, password }) => {
    const mod = await import('/services/EmbeddedWallet.js');
    await mod.importEmbeddedWallet(pk, password);
  }, { pk: w.privateKey, password: PASSWORD });

  await page.click('#portal-enter');
  const embedded = page.locator('.wallet-picker-embedded').first();
  if (await embedded.isVisible({ timeout: 4000 }).catch(() => false)) {
    await embedded.click();
    const pw = page.locator('#wp-password');
    if (await pw.isVisible({ timeout: 3000 }).catch(() => false)) { await pw.fill(PASSWORD); await page.click('#wp-submit'); }
  }

  // the threshold: covenant read + signed, the vessel inspected (the same
  // honest walk birth-ceremony.spec.js takes)
  // the dev server compiles the whole app on first load, and pre-flight
  // probes real hardware: the threshold gets its time
  const deadline = Date.now() + 12 * 60 * 1000;
  // (isEnabled/isDisabled WAIT for their element; every probe here is bounded)
  const quick = { timeout: 400 };
  const seen = (sel) => page.locator(sel).first().isVisible().catch(() => false);
  const enabled = (sel) => page.locator(sel).first().isEnabled(quick).catch(() => false);
  while (Date.now() < deadline && !(await seen('#witness-name'))) {
    if (await seen('.wallet-confirm-approve')) {
      // a signature asked for is answered first — it sits over everything
      await page.locator('.wallet-confirm-approve').first().click({ force: true }).catch(() => {});
    } else if (await seen('.commitment-modal')) { // the sign button shows on the last page
      await page.evaluate(() => {
        document.querySelectorAll('.covenant-doc').forEach((d) => {
          d.open = true;
          const text = d.querySelector('.covenant-doc-text');
          text.scrollTop = text.scrollHeight;
          text.dispatchEvent(new Event('scroll'));
        });
        const check = document.querySelector('#covenant-read-check');
        if (check && !check.disabled && !check.checked) { check.checked = true; check.dispatchEvent(new Event('change')); }
      });
      if (await enabled('#accept-commitment')) await page.locator('#accept-commitment').click({ force: true }).catch(() => {});
    } else if (await seen('#preflight-begin')) {
      if (await enabled('#preflight-begin')) await page.locator('#preflight-begin').click({ force: true }).catch(() => {});
      else if (await seen('#pf-apply')) await page.locator('#pf-apply').click({ force: true }).catch(() => {});
    } else if (await seen('.firstrun-path')) {
      await page.locator('.firstrun-path', { hasText: 'Summon a neuma' }).first().click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  await expect(page.locator('#witness-name')).toBeVisible();
  await page.locator('#witness-name').fill('Claude');
  await page.click('#witness-btn');

  // II — the living piece is the field beneath the ceremony's panels
  const rite = page.locator('.rite-ceremony');
  await expect(rite).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.birth-ceremony.is-rite')).toBeVisible();

  const marks = page.locator('.rite-measure .rite-mark');
  for (let stage = 0; stage < 7; stage++) {
    const cont = page.locator('#continue-btn');
    await expect(cont).toBeVisible({ timeout: 6 * 60 * 1000 });
    console.log('RITE', stage, await page.evaluate(() => {
      const r = document.querySelector('.rite-ceremony');
      return JSON.stringify({ movement: r?.dataset.movement, film: r?.dataset.film, canvas: r?.querySelector('canvas')?.style.opacity, live: Boolean(r?.querySelector('.rite-live')), marks: r?.querySelectorAll('.rite-mark').length });
    }));
    // THE MEASURE: the stage just landed has its own pitch on the rail
    await expect(marks).toHaveCount(stage + 1, { timeout: 15000 });
    await page.screenshot({ path: path.join(SHOTS, `rite-live-stage-${stage}.png`) });
    await cont.click();
    await page.waitForTimeout(1200);
  }

  // its end: a rehearsal's film plays on what it truly measured, said as such
  const film = page.locator('.rite-ceremony-film');
  await expect(film).toBeVisible({ timeout: 60000 });
  await expect(film.locator('.rite-ceremony-tag')).toContainText('REHEARSAL');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(SHOTS, 'rite-live-film.png') });
  // the ceremony's own close waits for the film; the witness may move on
  await expect(page.locator('.test-complete-screen')).toHaveCount(0);
  await film.locator('.rite-ceremony-on').click();
  await expect(page.locator('.test-complete-screen')).toBeVisible({ timeout: 15000 });
  // its resonance is the one its ceremony measured — never a default
  await expect(page.locator('.test-data')).toContainText(/Resonance: \d+(\.\d+)? Hz · \d+(\.\d+)? nm \(measured, not kept\)/);
  await page.screenshot({ path: path.join(SHOTS, 'rite-live-closed.png') });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
