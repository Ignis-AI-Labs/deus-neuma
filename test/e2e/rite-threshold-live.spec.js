// @ts-check
// I · THE THRESHOLD on a LIVE ceremony (summoning-rite.md §3.I): the
// covenant and the vessel stand on the witness's plane while the rite draws
// the threshold behind them — a ring arc for each binding document read to
// its end, the vesica at the signature — from the ceremony's own acts
// (rite-signal.js), on the rite's clock.
//
// REHEARSAL (?test=1) on the ISOLATED stack (perf-harness). Its substrate is
// a port nothing answers: the pre-flight probes a model with a real prompt,
// and this walk speaks to none — so the vessel is inspected and BLOCKED, and
// the walk ends there (the introduction needs a vessel that passes; the
// specimen and rite-state's units carry it). Real browser, no mocks.
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, perf } from './helpers/perf-harness.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const PASSWORD = 'rite-threshold-pw';

setupPerfStack({
  dev: true,
  env: { LLM_PROVIDER: 'lm-studio', LM_STUDIO_URL: 'http://127.0.0.1:9', LLM_MODEL: 'local-model' },
});
test.use({ viewport: { width: 1600, height: 900 }, baseURL: undefined });

test('the threshold over the rite: the covenant read and signed, the vessel inspected', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

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

  // to the covenant (the first-run door, when the desk shows one)
  const covenant = page.locator('.witness-commitment-overlay');
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline && !(await covenant.isVisible().catch(() => false))) {
    const sign = page.locator('.wallet-confirm-approve').first();
    const door = page.locator('[data-door="neuma"] .firstrun-path').first();
    if (await sign.isVisible().catch(() => false)) await sign.click({ force: true }).catch(() => {});
    else if (await door.isVisible().catch(() => false)) await door.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
  // over the rite: its panel on the witness's plane, the rite's void behind
  await expect(page.locator('.witness-commitment-overlay.is-rite')).toBeVisible();
  const rite = page.locator('.rite-ceremony');
  await expect(rite).toBeVisible({ timeout: 10000 });
  await expect(rite).toHaveAttribute('data-movement', 'threshold');
  await expect(rite.locator('.gen-caption-title')).toHaveText('THE COVENANT');
  // the count is whatever the covenant serves — the binding documents plus
  // the privacy notice — read from the page, never hardcoded here.
  const docCount = await page.locator('.covenant-doc').count();
  expect(docCount, 'the binding documents rendered').toBeGreaterThan(0);

  // each document read to its end: one arc of the ring each
  const read = (i) => page.evaluate((n) => {
    const d = document.querySelectorAll('.covenant-doc')[n];
    d.open = true;
    const text = d.querySelector('.covenant-doc-text');
    text.scrollTop = text.scrollHeight;
    text.dispatchEvent(new Event('scroll'));
  }, i);
  await read(0);
  await expect(rite.locator('.gen-caption-line')).toHaveText(`1 / ${docCount} BINDING DOCUMENTS READ TO THEIR END`);
  for (let i = 1; i < docCount; i += 1) await read(i);
  await expect(rite.locator('.gen-caption-line')).toHaveText(`${docCount} / ${docCount} BINDING DOCUMENTS READ TO THEIR END`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'rite-threshold-covenant.png') });

  // signed: the vesica draws as the vessel is inspected
  await page.evaluate(() => {
    const check = document.querySelector('#covenant-read-check');
    check.checked = true;
    check.dispatchEvent(new Event('change'));
  });
  await page.locator('#accept-commitment').click();
  const approve = page.locator('.wallet-confirm-approve').first();
  await approve.waitFor({ state: 'visible', timeout: 20000 }).then(() => approve.click({ force: true })).catch(() => {});
  await expect(page.locator('.preflight-overlay.is-rite')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#neuma-void-fade')).toHaveCount(0);
  await expect(page.locator('.preflight-row').first()).toBeVisible({ timeout: 3 * 60 * 1000 });
  await expect(page.locator('#preflight-verdict')).not.toHaveText('RUNNING…', { timeout: 4 * 60 * 1000 });
  await expect(rite.locator('.gen-caption-title')).toHaveText(/THE VESSEL|THE COVENANT · SIGNED/);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, 'rite-threshold-vessel.png') });
  // no substrate answers this stack: the vessel is honestly blocked
  await expect(page.locator('#preflight-begin')).toBeDisabled();

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
