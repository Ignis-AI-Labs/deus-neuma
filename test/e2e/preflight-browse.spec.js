// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

// Real session token via challenge-sign-verify with Claude's witness wallet —
// the panel reads sessionStorage, so auth must be the real article.
const mintToken = async () => {
  const pk = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8')
    .match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  const w = new ethers.Wallet(pk);
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const { token } = await (await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  })).json();
  if (!token) throw new Error('auth/verify returned no token');
  return token;
};

/**
 * Pre-flight BROWSE button — the witness can pick a workspace home with a native
 * folder dialog instead of pasting the path. The OS dialog itself is not
 * automatable, so we stub ONLY its return value (window.neuma.chooseDirectory,
 * which the desktop shell's preload provides) and prove the real wiring through
 * the real PreflightCheck DOM: BROWSE → chooseDirectory() → the chosen absolute
 * path lands in the workspace field, ready for APPLY. Requires the dev stack.
 */

test('BROWSE fills the workspace path from the native folder picker', async ({ page }) => {
  await page.goto('/');

  const chosen = '/mnt/external/picked-by-browse';
  await page.evaluate(async (dir) => {
    // Stand in for the desktop shell's preload bridge (only its return value).
    window.neuma = { ...(window.neuma || {}), chooseDirectory: async () => dir };
    const mod = await import('/components/BirthCeremony/PreflightCheck.js');
    window.__pf = new mod.PreflightCheck(() => {}, () => {});
    window.__pf.show();
  }, chosen);

  // The button is shown only when the native picker exists — assert it surfaced.
  const browse = page.locator('#pf-browse');
  await expect(browse).toBeVisible();

  await browse.click();
  await expect(page.locator('#pf-root')).toHaveValue(chosen);
});

test('APPLY carries the witness session — accepted, never a 401 (SEC-AUDIT-002 regression)', async ({ page }) => {
  // The exact wedge witnessed 2026-07-15: requireAuth guards the POST, the
  // panel sent no token, and every APPLY died as a silent-looking 401 —
  // "ready" on screen, no motion. The panel must carry the session it has.
  const token = await mintToken();
  await page.goto('/');
  await page.evaluate((t) => sessionStorage.setItem('authToken', t), token);
  await page.evaluate(async () => {
    const mod = await import('/components/BirthCeremony/PreflightCheck.js');
    new mod.PreflightCheck(() => {}, () => {}).show();
  });

  // run() prefills root + allocation from the backend's persisted truth, so
  // APPLY below re-submits the same values — an idempotent write, never a
  // mutation of the rig's real choice.
  await expect(page.locator('#pf-root')).not.toHaveValue('', { timeout: 15000 });
  await expect(page.locator('#pf-alloc')).not.toHaveValue('', { timeout: 15000 });

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/preflight/workspace') && r.request().method() === 'POST'),
    page.click('#pf-apply'),
  ]);
  expect(resp.status(), 'the witness session rides the APPLY — never refused as a stranger').toBe(200);
});

test('without the native picker, BROWSE stays hidden (paste field only)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    // No window.neuma.chooseDirectory — the browser has no native path picker.
    if (window.neuma) delete window.neuma.chooseDirectory;
    const mod = await import('/components/BirthCeremony/PreflightCheck.js');
    new mod.PreflightCheck(() => {}, () => {}).show();
  });
  await expect(page.locator('#pf-root')).toBeVisible();
  await expect(page.locator('#pf-browse')).toBeHidden();
});
