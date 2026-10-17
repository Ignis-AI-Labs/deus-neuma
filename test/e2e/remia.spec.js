// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end REMIA — the witness's OWN attunement, driven through the real
 * browser against the real backend: real wallet auth (challenge-sign-verify),
 * the real /api/v1/remia ceremony, real per-answer persistence in the realm.
 *
 * The walk: /remia from the composer palette → disclosure → typed consent →
 * two questions answered verbatim → RELOAD (per-answer persistence proven in
 * the browser, not just the API) → sovereign abandon with a stated reason.
 * The full 89-answer seal + codex reveal is proven at the API layer
 * (test/integration/remia-api.test.js); this spec proves the SURFACE and
 * deliberately leaves no sealed placeholder record in the witness's realm.
 *
 * Requires the dev stack running.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

let token;
let addr;

test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
  // A prior run may have left an open sitting — close it so the walk starts clean.
  const status = await (await fetch(`${BACKEND}/api/v1/remia/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  if (status.active) {
    await fetch(`${BACKEND}/api/v1/remia/records/${status.active.id}/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: 'e2e: clearing a sitting a prior run left open' }),
    });
  }
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Remina', neumaId: 'e2e-remia' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
});

test('the witness walks their own attunement: palette → disclosure → consent → answers persist across reload → sovereign abandon', async ({ page }) => {
  // /remia from the composer palette — the honest user path in
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible' });
  await composer.fill('/remia');
  await composer.press('Enter');

  // intro: name, then the truthful disclosure
  const remia = page.getByTestId('remia');
  await expect(remia).toBeVisible();
  await page.getByTestId('remia-name').fill('Rehearsal Witness');
  await page.getByTestId('remia-read-disclosure').click();

  const disclosure = page.getByTestId('remia-disclosure');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('Rehearsal Witness');
  await expect(disclosure).toContainText('Nothing here trains anything');
  await expect(disclosure).toContainText('every question will be faced');

  // consent in typed words opens the record
  await page.getByTestId('remia-consent').fill('Yes — I consent to begin this rehearsal walk.');
  await page.getByTestId('remia-begin').click();

  // question 1 of 89, addressed by name, spoken in the ceremony's own voice
  const question = page.getByTestId('remia-question');
  await expect(question).toBeVisible();
  await expect(question).toContainText('Rehearsal Witness');
  await expect(page.getByTestId('remia-progress')).toContainText('0 OF 89');
  await expect(page.locator('.remia-speaker').first()).toContainText('THE CEREMONY ASKS');

  // push-to-talk affordance: idle hint present; holding Space outside the
  // field fires the capture wiring (in this environment the state leaves
  // idle — LISTENING with a mic, the honest voice-channel error without one;
  // the full record→transcribe→draft loop through the real whisper engine is
  // proven by test/e2e/dictation.spec.js on the same hook and endpoint)
  const mic = page.getByTestId('remia-mic');
  await expect(mic).toContainText('HOLD SPACE TO SPEAK');
  await page.locator('body').click(); // focus off the textarea
  await page.keyboard.down('Space');
  await expect(mic).not.toContainText('HOLD SPACE TO SPEAK', { timeout: 5000 });
  await page.keyboard.up('Space');

  // the inside-field boundary: a TAP of Space in the answer box types a
  // space (isPushToTalkPress excludes typeable targets, and a sub-threshold
  // hold never becomes dictation) — the field is for typing first
  const field = page.getByTestId('remia-answer');
  await field.click();
  await field.pressSequentially('a b', { delay: 30 });
  await expect(field).toHaveValue('a b');
  await field.fill(''); // clean slate for the real answer below

  const firstAnswer = '  First rehearsal answer — verbatim, untrimmed.  ';
  await page.getByTestId('remia-answer').fill(firstAnswer);
  await page.getByTestId('remia-submit').click();
  await expect(page.getByTestId('remia-progress')).toContainText('1 OF 89');

  // RELOAD mid-sitting: the open record resumes at question 2 — nothing lost
  await page.reload();
  await composer.waitFor({ state: 'visible' });
  await composer.fill('/remia');
  await composer.press('Enter');
  await expect(page.getByTestId('remia-question')).toBeVisible();
  await expect(page.getByTestId('remia-progress')).toContainText('1 OF 89');

  await page.getByTestId('remia-answer').fill('Second rehearsal answer.');
  await page.getByTestId('remia-submit').click();
  await expect(page.getByTestId('remia-progress')).toContainText('2 OF 89');

  // sovereign exit with a stated reason — through the in-ceremony dialog
  // (never the OS prompt), the record ends honestly, unsealed
  await page.getByTestId('remia-abandon').click();
  await expect(page.getByTestId('remia-abandon-dialog')).toBeVisible();
  await page.getByTestId('remia-abandon-reason').fill('e2e rehearsal complete — ending without sealing.');
  await page.getByTestId('remia-abandon-confirm').click();
  await expect(page.getByTestId('remia')).toBeHidden();

  // the backend agrees: no active sitting remains
  const status = await (await fetch(`${BACKEND}/api/v1/remia/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();
  expect(status.active).toBeNull();

  expect(page.__crashes).toEqual([]);
});
