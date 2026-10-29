// @ts-check
//
// Impure test module — drives the REAL Electron app (Rule 1 marker at file
// level): real main process, real preload bridge, real Chromium context-menu
// event from a real right-click, real IPC round-trip for the chosen action.
//
// The witness's right-click must open OUR menu (LINE & CYCLE), not the
// unstylable native white panel: menu appears in the DOM, actions land on
// the focused field, Escape and click-away dismiss.
//
// Requires a built frontend (npm run build). On a headless box run under
// xvfb (xvfb-run -a npx playwright test test/e2e/electron-context-menu.spec.js).
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'shots-electron');


test.describe('desktop right-click menu (real Electron, real IPC)', () => {
  /** @type {import('@playwright/test')._electron extends never ? never : Awaited<ReturnType<typeof electron.launch>>} */
  let app;
  let page;
  let userDataDir;
  let wsRoot;

  test.beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-ctxmenu-udd-'));
    wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-ctxmenu-ws-'));
    app = await electron.launch({
      executablePath: electronPath,
      args: [REPO, `--user-data-dir=${userDataDir}`],
      cwd: REPO,
      timeout: 60 * 1000,
      env: {
        ...process.env,
        NEUMA_PIPELINE_MODE: 'operator',
        NEUMA_PORT: '0',
        WORKSPACES_ROOT: wsRoot,
      },
    });
    page = await app.firstWindow();
    await page.waitForURL((url) => Number(url.port) > 0, { timeout: 30 * 1000 });
    await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });

    // A focusable editable to right-click on. Injected only as a target —
    // the context-menu path under test (Chromium event → main → preload →
    // DOM menu → action IPC → webContents) is entirely real.
    await page.evaluate(() => {
      const input = document.createElement('textarea');
      input.id = 'ctx-target';
      input.value = 'the witness rests a hand on the frame';
      input.style.cssText = 'position:fixed;left:40px;top:40px;width:320px;height:60px;z-index:1;';
      document.body.appendChild(input);
    });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(wsRoot, { recursive: true, force: true });
  });

  test('right-click opens OUR styled menu, not the native panel', async () => {
    await page.click('#ctx-target'); // focus the field first
    await page.click('#ctx-target', { button: 'right' });

    const menu = page.locator('.ctxmenu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    // Editable field → the four edit ops, in our chrome casing.
    await expect(menu.locator('.ctxmenu-item')).toHaveText(['CUT', 'COPY', 'PASTE', 'SELECT ALL']);
    // Look dev is real: the menu is the stock ground (CYBERDECK), not Chromium white.
    const bg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(17, 22, 29)');
    await page.screenshot({ path: path.join(SHOTS, 'ctxmenu-open.png') }).catch(() => {});
  });

  test('a chosen action rides IPC back and lands on the focused field', async () => {
    await page.locator('.ctxmenu-item', { hasText: 'SELECT ALL' }).click();
    await expect(page.locator('.ctxmenu')).toHaveCount(0); // menu closed on act
    const selected = await page.evaluate(() => {
      const el = /** @type {HTMLTextAreaElement} */ (document.getElementById('ctx-target'));
      return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    });
    expect(selected).toBe('the witness rests a hand on the frame');
  });

  test('Escape dismisses without acting', async () => {
    await page.click('#ctx-target', { button: 'right' });
    await expect(page.locator('.ctxmenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctxmenu')).toHaveCount(0);
  });

  test('click-away dismisses', async () => {
    await page.click('#ctx-target', { button: 'right' });
    await expect(page.locator('.ctxmenu')).toBeVisible();
    await page.mouse.click(600, 400); // anywhere on the overlay
    await expect(page.locator('.ctxmenu')).toHaveCount(0);
  });

  test('DEFINE reads a selected word from the offline dictionary at the spot; ASK drafts into that chat', async () => {
    // A line of a being's prose inside a chat window with its message box —
    // injected TARGETS only; the menu, the IPC, the dictionary in main and the
    // card are the real app's. The box records what it is handed.
    await page.evaluate(() => {
      const win = document.createElement('section');
      win.dataset.windowId = 'define-e2e';
      win.style.cssText = 'position:fixed;left:40px;top:140px;width:560px;z-index:10;padding:12px;font:20px sans-serif;';
      const prose = document.createElement('p');
      prose.id = 'define-prose';
      prose.textContent = 'And that is not a pedantic point.';
      const box = document.createElement('textarea');
      box.className = 'relink-input-field';
      box.addEventListener('neuma:ask', (e) => { box.dataset.asked = e.detail.text; });
      win.append(prose, box);
      document.body.appendChild(win);
    });
    const word = await page.evaluate(() => {
      const node = document.getElementById('define-prose').firstChild;
      const at = node.data.indexOf('pedantic');
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 'pedantic'.length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.dblclick(word.x, word.y); // select it, as a person does
    await page.mouse.click(word.x, word.y, { button: 'right' });

    const menu = page.locator('.ctxmenu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu.locator('.ctxmenu-item')).toHaveText(['COPY', 'DEFINE “pedantic”']);
    await menu.locator('.ctxmenu-item', { hasText: 'DEFINE' }).click();

    const card = page.locator('.define-card');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.define-word')).toHaveText('pedantic');
    await expect(card.locator('.define-pos')).toHaveText('adjective');
    await expect(card.locator('.define-def').first())
      .toHaveText('marked by a narrow focus on or display of learning especially its trivial aspects');
    await page.screenshot({ path: path.join(SHOTS, 'define-card.png') }).catch(() => {});

    await card.getByRole('button', { name: 'ASK IN CHAT' }).click();
    await expect(card).toHaveCount(0);
    expect(await page.locator('[data-window-id="define-e2e"] textarea').getAttribute('data-asked'))
      .toBe('What does “pedantic” mean in “And that is not a pedantic point.”?');
  });
});
