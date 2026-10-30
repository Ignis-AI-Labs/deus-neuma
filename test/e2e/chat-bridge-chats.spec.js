// @ts-check
// WHO MAY TALK WITH THE HOUSE, DECIDED BY THE OPERATOR (channel connections
// C-04/C-05). On the isolated stack (perf-harness.js — its own backend, build,
// realm and workspaces; never a live desk), a stranger's pairing code and a
// person already approved stand on the house's Telegram door (the record the
// real door writes, chat-access.js). A real browser:
//   - finds the code in WAITING ON YOU, and its row lands on TELEGRAM's CHATS
//     tab at that very code;
//   - reads the line: the bot hears nobody while […] is off;
//   - APPROVES the code (the person joins the list) and TAKES OFF the other.
// The bot's own talk (codes sent, turns answered) is proven against
// loopback platforms in test/integration/chat-bridge.test.js.
// Real backend, real auth, real browser, real stores. No mocks (RULE 0).
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { underFloor } from './helpers/legibility.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupPerfStack();
test.use({ viewport: { width: 1600, height: 1000 } });

test('CHATS: a stranger\'s code lands from WAITING ON YOU, is approved, and an approved person is taken off', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  const at = new Date(Date.now() - 4 * 60_000).toISOString();
  const dir = path.join(perf.root, 'realm', perf.addr.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chat-access.json'), JSON.stringify({ 'telegram-1': {
    allowed: [{ kind: 'user', id: '77', name: 'Old Friend', by: 'operator', at }],
    pending: [{ code: 'ABCD2345', kind: 'user', id: '42', name: 'Cy Ventures', chat: { id: '42', type: 'dm' }, at, attempts: 1 }],
  } }));

  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);

  // ── WAITING ON YOU carries the code, and its row lands on the very code ──
  const panel = page.locator('.ntray-panel');
  if (!(await panel.count())) await page.locator('.ntray-bell').click();
  const row = panel.locator('.waiting-row', { hasText: 'Cy Ventures asks to talk with the house on Telegram — code ABCD2345' });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row.locator('.waiting-row-kind')).toHaveText('CHAT');
  await row.click();
  const win = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: 'TELEGRAM' }) }).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  const chats = win.locator('[data-chats="telegram"]');
  await expect(win.getByRole('tab', { name: 'CHATS' })).toHaveAttribute('aria-selected', 'true');
  await expect(chats.locator('[data-chats-line="off"]')).toHaveText('THE BOT HEARS NOBODY — TURN ON "CHATS WITH THE HOUSE" IN SETTINGS → SECURITY → CONNECTIONS');
  const code = chats.locator('[data-chat-code="ABCD2345"]');
  await expect(code).toHaveClass(/is-focus/);
  await expect(code).toContainText('CY VENTURES — CODE ABCD2345 · 4 MIN AGO');
  await expect(chats.locator('.chats-exact')).toHaveCSS('text-transform', 'none');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'chat-bridge-chats.png') });
  expect(await underFloor(chats)).toEqual([]);

  // ── the operator's yes, then a person taken off ──
  await code.getByRole('button', { name: 'APPROVE' }).click();
  await expect(chats.locator('[data-chat-code]')).toHaveCount(0);
  await expect(chats).toContainText('WAITING FOR YOUR YES — 0');
  await expect(chats.locator('[data-chat-allowed="user:42"]')).toContainText('CY VENTURES');
  await chats.locator('[data-chat-allowed="user:77"]').getByRole('button', { name: 'TAKE OFF' }).click();
  await expect(chats.locator('[data-chat-allowed]')).toHaveCount(1);
  await expect(chats).toContainText('MAY TALK WITH THE HOUSE — 1');
  const kept = JSON.parse(fs.readFileSync(path.join(dir, 'chat-access.json'), 'utf8'))['telegram-1'];
  expect(kept.allowed.map((a) => a.id)).toEqual(['42']);
  expect(kept.pending).toEqual([]);
  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
