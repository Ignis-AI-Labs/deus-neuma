// @ts-check
//
// Impure test module: drives a REAL chromium page (Rule 1 marker, file level).
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Retry-anywhere gnosis — the takes machinery in the real desk UI on the real
 * stack (RULE 0: no mocks anywhere): real auth (Claude's witness wallet), the
 * real sealed Basunor lane (kimi-for-coding/k3) under a PRIVATE isolated root,
 * real provider streams.
 *
 * Proves:
 *   1. ↻ on the WITNESS's OWN message mints a new take of that point (1/2 → 2/2)
 *   2. EDIT-fork: editing the own message and submitting regenerates from that
 *      point with the REVISED ask shown on the bubble (take 2, ask replaced)
 *
 * The error-bubble retry case is proven by backend integration
 * (api-witness-routes: real ECONNREFUSED leaves a retryable point) and render
 * tests (↻ on error+turnId); it needs a broken route, which this stack must
 * not mutate — deliberately not covered here.
 *
 * Requires the isolated dev stack (see MONITORING_SETUP.md §3 — PRIVATE root).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const LANE = { laneId: 'witness-kimi-code-Basunor', name: 'Basunor' };

const PROMPT = 'Reply with exactly one short sentence containing the word ALPHA.';
const REVISED = 'Reply with exactly one short sentence containing the word OMEGA.';

const mintToken = async () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  const w = new ethers.Wallet(pk);
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

const waitComplete = (page) =>
  expect
    .poll(async () => page.evaluate(() => Boolean(window.__completes > 0)), { timeout: 90000 })
    .toBe(true);

test('retry from the witness’s own message + edit-fork with revised ask', async ({ page }) => {
  const { token, addr } = await mintToken();
  await page.addInitScript(({ t, a, id, n }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: n, neumaId: id }));
    sessionStorage.setItem('authToken', t);
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
    // @ts-ignore — in-page probe handle
    window.__completes = 0;
    const orig = window.WebSocket;
    // @ts-ignore — deliberate wrapper; MUST stay transparent (statics copied)
    window.WebSocket = function (url, protocols) {
      const ws = protocols ? new orig(url, protocols) : new orig(url);
      if (String(url).includes('/ws')) {
        ws.addEventListener('message', (e) => {
          try {
            const m = JSON.parse(String(e.data));
            // @ts-ignore — in-page probe handle
            if (m.type === 'consciousness:complete') window.__completes += 1;
          } catch { /* non-JSON */ }
        });
      }
      return ws;
    };
    window.WebSocket.prototype = orig.prototype;
    window.WebSocket.CONNECTING = orig.CONNECTING;
    window.WebSocket.OPEN = orig.OPEN;
    window.WebSocket.CLOSING = orig.CLOSING;
    window.WebSocket.CLOSED = orig.CLOSED;
  }, { t: token, a: addr, id: LANE.laneId, n: LANE.name });

  await page.goto('/');
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 30000 });
  // The birth-setup gate rises over a freshly provisioned lane — stand aside.
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 8000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }

  // Turn 1 — the point everything else forks from.
  await field.fill(PROMPT);
  await field.press('Enter');
  await waitComplete(page);
  const userBubble = page.locator('.relink-msg--user').last();
  await expect(userBubble).toContainText('ALPHA');

  // (1) ↻ on the WITNESS'S OWN message — a fresh answer from that point.
  await page.evaluate(() => { window.__completes = 0; });
  await userBubble.locator('.stream-retry').click();
  await waitComplete(page);
  // The answer now offers take navigation at 2/2.
  await expect(page.locator('.stream-take-pos').last()).toHaveText('2/2', { timeout: 15000 });

  // (2) EDIT, IN PLACE (Design note, 2026-07-28: […]) — the bubble itself becomes the editor; the
  // composer NEVER seeds. SAVE re-sends the revised words from that point:
  // the answer regenerates and the bubble shows the REVISED ask, not the
  // original words. This is take 3 of the same point (take 1 = original,
  // take 2 = plain retry above).
  await userBubble.locator('.relink-edit').click();
  const inlineField = userBubble.locator('.relink-inline-edit-field');
  await expect(inlineField).toHaveValue(PROMPT, { timeout: 10000 });
  // The composer was never involved — the field stays empty.
  await expect(field).toHaveValue('');
  await inlineField.fill(REVISED);
  await page.evaluate(() => { window.__completes = 0; });
  await userBubble.locator('.relink-inline-save').click();
  await waitComplete(page);
  await expect(page.locator('.relink-msg--user').last()).toContainText('OMEGA');
  await expect(page.locator('.relink-msg--user').last()).not.toContainText('ALPHA');
  await expect(page.locator('.stream-take-pos').last()).toHaveText('3/3', { timeout: 15000 });
});
