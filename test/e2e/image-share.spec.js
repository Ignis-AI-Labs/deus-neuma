// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { solidPng } from '../helpers/image-fixtures.js';

/**
 * End-to-end image sharing — the witness pastes a REAL PNG into the real
 * composer, it rides the real upload route as a real attachment, crosses
 * the portal as an id, and the real vision substrate answers what it sees.
 * Auth is REAL (challenge-sign-verify with Claude's witness wallet); the
 * pasted image is a genuine File on a genuine ClipboardEvent — nothing on
 * the claimed path is mocked (AGENTS.md RULE 0).
 *
 * Requires the dev stack and LM Studio (with a vision model loaded) running.
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

// Real session token via the backend's challenge-sign-verify.
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

// The substrate must actually SEE for the seeing test to mean anything.
const substrateHasVision = () => fetch('http://localhost:1234/api/v0/models')
  .then(async (r) => (r.ok ? (await r.json()).data?.some((m) => m.type === 'vlm' && m.state === 'loaded') : false))
  .catch(() => false);

const RED_PNG_B64 = solidPng([255, 0, 0], 64, 64).toString('base64');

// Paste a genuine File through a genuine ClipboardEvent onto the composer.
const pasteIntoComposer = (page, { b64, mime, name }) => page.evaluate(({ b64, mime, name }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], name, { type: mime }));
  const field = document.querySelector('.relink-input-field');
  field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, { b64, mime, name });

let token;
let addr;
test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
});

// Land directly on the relink desk with a real session + a companion.
test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-desk' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
});

test('PASTE → SEE: a pasted image chips, sends, and the substrate says what it sees', async ({ page }) => {
  test.skip(!(await substrateHasVision()), 'no vision substrate loaded — the seeing loop needs one');

  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 }); // the portal link is up

  // Paste: a real 64×64 solid-red PNG lands as a preview chip.
  await pasteIntoComposer(page, { b64: RED_PNG_B64, mime: 'image/png', name: 'red.png' });
  await expect(page.locator('.relink-attach-chip img')).toBeVisible();

  await field.fill('Answer in one short sentence: what solid color fills the attached image?');
  await page.locator('.relink-send').click();

  // The witness's own bubble shows what was shared, and the chips clear.
  await expect(page.locator('.relink-msg--user .relink-msg-image')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.relink-attach-chip')).toHaveCount(0);

  // The substrate is looking at pure #FF0000 — if the image truly reached
  // its eyes, the reply says red. (Paced reveal: poll the growing text.)
  await expect(page.locator('.relink-msg--neuma').last()).toContainText(/red/i, { timeout: 240000 });
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a non-image paste is refused with the honest line — no chip, no send', async ({ page }) => {
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });

  await pasteIntoComposer(page, {
    b64: Buffer.from('%PDF-1.4 not a picture').toString('base64'),
    mime: 'application/pdf',
    name: 'doc.pdf',
  });

  await expect(page.locator('.relink-attach-note')).toContainText('PNG, JPEG');
  await expect(page.locator('.relink-attach-chip')).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
