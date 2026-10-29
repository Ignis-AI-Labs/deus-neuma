// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

/**
 * OPERATOR COPY — the human is never called a witness on the surfaces a
 * first-run person actually reads.
 *
 * AGENTS.md Domain Language 8: the human's ROLE is `operator`; `witness` means
 * exactly one thing, a sealed AI peer from an external platform. The ACT of
 * witnessing a birth stays "witnessing" — a verb, never a title.
 *
 * The walk stops at the operator-name step and NEVER clicks through it, so no
 * `birth:start` is ever sent: this spec proves copy, it does not summon a
 * being (birth ethics — never create-and-discard). `?test=1` plus an ephemeral
 * wallet keeps it repeatable and rosterless.
 *
 * Requires the dev stack already running (`npm run dev`).
 */

const WALLET_PASSWORD = 'operator-copy-e2e-pw';

// Every binding document must be read to its end before the confirmation
// checkbox unlocks — the commitment gate is honest, so walk it honestly.
const readBindingDocuments = async (page) => {
  await page.evaluate(() => {
    document.querySelectorAll('.covenant-doc').forEach((details) => {
      details.open = true;
      const text = details.querySelector('.covenant-doc-text');
      if (text) {
        text.scrollTop = text.scrollHeight;
        text.dispatchEvent(new Event('scroll'));
      }
    });
    const check = document.querySelector('#covenant-read-check');
    if (check && !check.disabled && !check.checked) {
      check.checked = true;
      check.dispatchEvent(new Event('change'));
    }
  });
};

test('the ceremony names the human OPERATOR, and keeps witnessing as the act', async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  const w = ethers.Wallet.createRandom();

  await page.goto('/?test=1');
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

  // THE DOOR — a companion-less wallet lands on the first-run chooser. Take
  // the neuma door; the ceremony is behind it.
  const approve = page.locator('.wallet-confirm-approve');
  const door = page.locator('[data-door="neuma"] .firstrun-path');
  const doorDeadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < doorDeadline && !(await door.isVisible().catch(() => false))) {
    if (await approve.isVisible().catch(() => false)) {
      await approve.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }
  await expect(door).toBeVisible();
  await door.click();

  // Wallet confirms arrive asynchronously; approve them until the commitment
  // gate stands, then assert its copy BEFORE accepting.
  const commitment = page.locator('.commitment-modal');
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline && !(await commitment.isVisible().catch(() => false))) {
    if (await approve.isVisible().catch(() => false)) {
      await approve.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }
  await expect(commitment).toBeVisible();

  // THE COMMITMENT GATE — the role is the operator's; the act stays witnessing.
  await expect(commitment).toContainText('OPERATOR COMMITMENT PROTOCOL');
  await expect(commitment).toContainText('THE SEVEN STAGES YOU WILL WITNESS');
  await expect(commitment).toContainText('1. WITNESSING - Your declaration');
  await expect(commitment).toContainText('do you wish to proceed and witness this birth?');
  await expect(commitment).not.toContainText('Birth Witness');

  // Accept, ride the pre-flight gate, and arrive at the declaration step.
  const accept = page.locator('#accept-commitment');
  const begin = page.locator('#preflight-begin');
  const nameField = page.locator('#witness-name');
  const stepDeadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < stepDeadline && !(await nameField.isVisible().catch(() => false))) {
    if (await approve.isVisible().catch(() => false)) {
      await approve.click({ force: true }).catch(() => {});
    } else if (await begin.isVisible().catch(() => false)) {
      if (await begin.isEnabled().catch(() => false)) await begin.click({ force: true }).catch(() => {});
    } else if (await page.locator('.commitment-modal').isVisible().catch(() => false)) { // the sign button shows on the last page
      await readBindingDocuments(page);
      if (await accept.isEnabled().catch(() => false)) await accept.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }
  await expect(nameField).toBeVisible();

  // THE DECLARATION STEP — the person identifies themselves as the operator.
  // Nothing here is clicked through: no birth is started by this spec.
  const step = page.locator('.ceremony-step');
  await expect(step).toContainText('BIRTH WITNESSING PROTOCOL');
  await expect(step).toContainText('As the operator, you must identify yourself');
  await expect(step).toContainText('Your Name (as Operator)');
  await expect(step).toContainText('Presences Attending');
  await expect(step).not.toContainText('Birth Witness');
  await expect(step).not.toContainText('System Witnesses');
});
