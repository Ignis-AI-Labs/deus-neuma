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
import { setupExplorerPanel, settleDesk, makeFolder, openFolderViaPanel } from './helpers/explorer-panel-harness.js';

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

  // Plain click opens the editor without moving focus or raising the menu.
  await door.click();
  const editor = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: 'DOOR-NOTE.MD' }) });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).toContainText('opened, not focused');
  await expect(none).toBeVisible();
  await expect(page.locator('.cmenu')).toHaveCount(0);

  // Right-click keeps the menu, with focusing named as its own act.
  await door.click({ button: 'right' });
  const menu = page.locator('.cmenu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Open file');
  await expect(menu).toContainText('Copy path');
  await expect(menu).toContainText('Focus its folder');
  await page.keyboard.press('Escape');

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

test('plain-click a focused project\'s relative PNG and folder: image viewer first, Files lens for the folder', async ({ page }) => {
  test.setTimeout(120_000);
  const dir = await makeFolder('relative-door');
  await fs.promises.mkdir(path.join(dir, 'docs', 'design'), { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, 'docs', 'design', 'ref.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  );

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
  await openFolderViaPanel(page, dir);

  const send = (frame) => client.send(JSON.stringify(frame));
  send({ type: 'consciousness:stream', content: 'Preview `docs/design/ref.png` and open `docs/design`.', turnId: 'relative-turn' });
  send({ type: 'consciousness:complete', turnId: 'relative-turn' });

  const imageDoor = page.locator('.relink-md-path', { hasText: 'docs/design/ref.png' });
  await expect(imageDoor).toBeVisible();
  await imageDoor.click();
  const viewer = page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: 'REF.PNG' }) });
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  await expect(viewer.locator('img')).toBeVisible({ timeout: 15_000 });
  await viewer.getByRole('button', { name: 'Close window' }).click();

  const folderDoor = page.locator('.relink-md-path', { hasText: /^docs\/design$/ });
  await expect(folderDoor).toBeVisible();
  await folderDoor.click();
  await expect(page.locator('.xp')).toContainText('design');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
