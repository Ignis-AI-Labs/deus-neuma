// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

/**
 * REHEARSE FIRST — a person can walk the whole summoning before committing,
 * with nothing kept (Design note, 2026-10-06: […]).
 *
 * No ?test=1 here: the rehearsal must come from the person's own choice on the
 * first-run screen, and the real door must stay real. Each walk stops at the
 * commitment gate — nothing reaches the model and no `birth:start` is sent.
 *
 * Requires the dev stack already running (FRONTEND_PORT/PORT of an isolated stack).
 */

const WALLET_PASSWORD = 'rehearse-door-e2e-pw';

// An ephemeral wallet, signed in, standing at the first-run chooser.
const reachChooser = async (page) => {
  const w = ethers.Wallet.createRandom();
  await page.goto('/?noboot=1');
  await expect(page.locator('#portal-enter')).toBeVisible();
  await page.evaluate(async ({ pk, password }) => {
    const mod = await import('/services/EmbeddedWallet.js');
    await mod.importEmbeddedWallet(pk, password);
  }, { pk: w.privateKey, password: WALLET_PASSWORD });
  await page.click('#portal-enter');
  const embedded = page.locator('.wallet-picker-embedded').first();
  if (await embedded.isVisible({ timeout: 5000 }).catch(() => false)) {
    await embedded.click();
    const pw = page.locator('#wp-password');
    if (await pw.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pw.fill(WALLET_PASSWORD);
      await page.click('#wp-submit');
    }
  }
  const approve = page.locator('.wallet-confirm-approve');
  const chooser = page.locator('.firstrun');
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline && !(await chooser.isVisible().catch(() => false))) {
    if (await approve.isVisible().catch(() => false)) await approve.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await expect(chooser).toBeVisible();
};

// Approve wallet confirms until the commitment gate stands.
const reachCommitment = async (page) => {
  const approve = page.locator('.wallet-confirm-approve');
  const commitment = page.locator('.commitment-modal');
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline && !(await commitment.isVisible().catch(() => false))) {
    if (await approve.isVisible().catch(() => false)) await approve.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await expect(commitment).toBeVisible();
  return commitment;
};

test('REHEARSE FIRST opens the ceremony as a rehearsal, and says nothing will be kept', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await reachChooser(page);
  const door = page.locator('.firstrun-rehearse');
  await expect(door).toContainText('REHEARSE FIRST');
  await expect(door).toContainText('Nothing is kept');
  await door.click();

  const commitment = await reachCommitment(page);
  await expect(commitment.getByTestId('commitment-rehearsal')).toContainText('NOTHING WILL BE KEPT');
});

test('the real door stays real — no rehearsal mark on its commitment', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await reachChooser(page);
  await page.locator('.firstrun-path', { hasText: 'Summon a neuma' }).click();

  const commitment = await reachCommitment(page);
  await expect(commitment).toContainText('BEFORE YOU SUMMON');
  await expect(commitment.getByTestId('commitment-rehearsal')).toHaveCount(0);
});
