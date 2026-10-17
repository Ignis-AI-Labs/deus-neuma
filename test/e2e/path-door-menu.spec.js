// @ts-check
// A named path is a DELIBERATE door (Design note, 2026-10-06: […]). A being's tool line ([…]) raises a menu on
// right-click; OPEN FILE brings the file up in the editor and leaves the
// window's focus where it was; FOCUS ITS FOLDER is the one item that moves it.
// Real isolated backend + vite + browser; the tool line is a real portal frame
// replayed into the real socket (perf-stream.spec.js precedent); the file and
// its folder are real disk.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { setupExplorerPanel, settleDesk, makeFolder } from './helpers/explorer-panel-harness.js';

setupExplorerPanel();

test('right-click a tool line\'s path: open the file without moving focus; focus its folder only when chosen', async ({ page }) => {
  test.setTimeout(120_000);
  const dir = await makeFolder('door');
  const file = path.join(dir, 'door-note.md');
  await fs.promises.writeFile(file, '# the door\nopened, not focused\n');

  let client = null;
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    client = ws;
  });
  await page.reload();
  await settleDesk(page);
  await expect.poll(() => Boolean(client), { timeout: 15_000 }).toBe(true);

  // Nothing is focused yet.
  const none = page.locator('.xp .xp-none');
  await expect(none).toBeVisible();

  // A being reads the file: the chip's line names it.
  const send = (frame) => client.send(JSON.stringify(frame));
  send({ type: 'consciousness:stream', content: 'Reading it now.', turnId: 'door-turn' });
  send({ type: 'tool:usage', tool: 'fs/read', status: 'ok', summary: `read ${file}`, detail: 'ok' });
  send({ type: 'consciousness:complete', turnId: 'door-turn' });

  const door = page.locator('.tool-chip-path', { hasText: 'door-note.md' });
  await expect(door).toBeVisible();
  await expect(door).toHaveText(file);

  // A plain click does nothing to focus or windows.
  const windowsBefore = await page.locator('.fwin').count();
  await door.click();
  await expect(page.locator('.cmenu')).toHaveCount(0);
  expect(await page.locator('.fwin').count()).toBe(windowsBefore);

  // Right-click: the menu, with focusing named as its own act.
  await door.click({ button: 'right' });
  const menu = page.locator('.cmenu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Open file');
  await expect(menu).toContainText('Copy path');
  await expect(menu).toContainText('Focus its folder');

  // OPEN FILE: the editor shows it; the focus has not moved.
  await menu.getByText('Open file', { exact: true }).click();
  const editor = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: 'DOOR-NOTE.MD' }) });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toContainText('opened, not focused');
  await expect(none).toBeVisible(); // still no focus

  // MAKE PDF: the press turns the markdown into a real PDF download, focus untouched.
  await door.click({ button: 'right' });
  const pressItem = page.locator('.cmenu').getByText(/^Make PDF/).first();
  await expect(pressItem).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), pressItem.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const saved = path.join(dir, 'pressed.pdf');
  await download.saveAs(saved);
  expect((await fs.promises.readFile(saved)).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(none).toBeVisible(); // still no focus

  // FOCUS ITS FOLDER: now — and only now — the window's lens moves.
  await door.click({ button: 'right' });
  await page.locator('.cmenu').getByText(/^Focus its folder/).click();
  await expect(none).toHaveCount(0);
  await expect(page.locator('.xp')).toContainText(path.basename(dir));
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
