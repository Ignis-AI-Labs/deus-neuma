// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';

/**
 * End-to-end EXPLORER MULTI-SELECT — the file-manager grammar 5f0d5ee18
 * shipped (ctrl toggles, shift ranges, modified clicks never open), driven
 * for real in the real desk: real backend child, real vite dev server, real
 * challenge-sign-verify auth, real disk. No mock anywhere (RULE 0).
 *
 * Exists because the first pass proved only the pure model (unit tests) and
 * the paint was invisible on the dark rail — in Founder's live desk the feature
 * read as a dead click. This spec is the missing gnosis: the gestures AND
 * that a selected row is VISIBLY different from its neighbors.
 *
 * Own spec file, not explorer-panel.spec.js: that file stands AT its 1172
 * frozen size-law baseline — shrink-only, no growth.
 *
 * SAFETY LAW: never a live witness stack — own PID-derived bind-probed
 * ports, disposable temp WORKSPACES_ROOT, files/realm isolation doors
 * (explorer-panel.spec.js precedent).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct bases from explorer-panel (7731/3731), multi-terminal (7581/3581),
// context-map (7411/3511); clear of live-dev 3333/7777 + 3355/7755 and the
// operator's serving :8089. Occupied means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7151 + (process.pid % 97);
const BPORT_BASE = 3051 + (process.pid % 97);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-xmulti';

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) {
    if (await canBind(p)) return p;
  }
  throw new Error(`no free port in [${start}, ${start + 120})`);
};

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${BASE}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BASE}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try {
        const r = await fetch(url);
        if (r.status < 500) return;
      } catch { /* not listening yet */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

let root;
let backendProc;
let viteProc;
let token;
let addr;
let dir; // the one probe folder: nest/ (with inner.txt) + alpha..delta.txt

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xmulti-e2e-'));
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xmulti-tree-'));
  await fs.promises.mkdir(path.join(dir, 'nest'));
  await fs.promises.writeFile(path.join(dir, 'nest', 'inner.txt'), 'inner\n');
  for (const name of ['alpha.txt', 'bravo.txt', 'charlie.txt', 'delta.txt']) {
    await fs.promises.writeFile(path.join(dir, name), `probe ${name}\n`);
  }
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);
  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
});

test.afterAll(async () => {
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  for (const d of [root, dir]) {
    if (d) await fs.promises.rm(d, { recursive: true, force: true });
  }
});

test.use({ viewport: { width: 1600, height: 900 } });

const initSession = (page) => page.addInitScript(({ t, a, id }) => {
  const w = a.toLowerCase();
  localStorage.setItem('walletAddress', a);
  localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
  sessionStorage.setItem('authToken', t);
}, { t: token, a: addr, id: NEUMA_ID });

const settleDesk = async (page) => {
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  const veil = page.locator('.arrival');
  if (await veil.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    const retry = page.locator('.arrival .arrival-action', { hasText: 'RETRY' });
    if (await retry.isVisible({ timeout: 1500 }).catch(() => false)) await retry.click();
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
};

const openFolderViaPanel = async (page, folder) => {
  await page.locator('.xp-open').click();
  await expect(page.locator('.picker')).toBeVisible();
  await expect(page.locator('.picker-cwd')).not.toBeEmpty();
  await expect(async () => {
    await page.locator('.picker-pathinput').fill(folder);
    await page.locator('.picker-go').click();
    await expect(page.locator('.picker-cwd')).toContainText(path.basename(folder), { timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await page.locator('.picker-open').click();
  await expect(page.locator('.picker')).toHaveCount(0);
};

test('ctrl toggles, shift ranges, modified clicks never open, and a selected row is VISIBLY different', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await initSession(page);
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
  await openFolderViaPanel(page, dir);
  await expect(page.locator('.files-name', { hasText: 'alpha.txt' })).toBeVisible({ timeout: 15000 });

  const row = (name) => page.locator('.files-rowwrap', { hasText: name });
  // Clicks land on the row LABEL (inside the button) — the wrapper's right
  // edge holds the hover-revealed action buttons.
  const label = (name) => page.locator('.files-name', { hasText: name });
  const selected = page.locator('.files-rowwrap.is-selected');
  const editors = page.locator('.fwin .editor');

  // CTRL selects — and a modified click on a FILE opens nothing.
  await label('alpha.txt').click({ modifiers: ['Control'] });
  await expect(selected).toHaveCount(1);
  await expect(row('alpha.txt')).toHaveClass(/is-selected/);
  await expect(editors).toHaveCount(0);

  // SHIFT ranges from the anchor (alpha) over the rows as rendered.
  await label('delta.txt').click({ modifiers: ['Shift'] });
  await expect(selected).toHaveCount(4);
  for (const name of ['alpha.txt', 'bravo.txt', 'charlie.txt', 'delta.txt']) {
    await expect(row(name)).toHaveClass(/is-selected/);
  }
  await expect(editors).toHaveCount(0);

  // CTRL on a standing member toggles it OUT of the range — and moves the
  // anchor to it, the real file-manager grammar (proven by the first run of
  // this spec: shift after a toggle ranges from the TOGGLED row).
  await label('charlie.txt').click({ modifiers: ['Control'] });
  await expect(selected).toHaveCount(3);
  await expect(row('charlie.txt')).not.toHaveClass(/is-selected/);

  // THE VISIBILITY GNOSIS — the reason this spec exists: a selected row must
  // PAINT differently from an unselected sibling. The old --color-glass fill
  // passed every class assertion while rendering imperceptibly.
  const paintOf = (loc) => loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  const sel = await paintOf(row('alpha.txt'));
  const unsel = await paintOf(row('nest').first());
  expect(sel.bg).not.toBe(unsel.bg);
  expect(sel.shadow).not.toBe('none');

  // CTRL on a DIRECTORY selects without expanding — the gesture is a
  // selection, never a navigation.
  await label('nest').first().click({ modifiers: ['Control'] });
  await expect(selected).toHaveCount(4);
  await expect(page.locator('.files-name', { hasText: 'inner.txt' })).toHaveCount(0);
  await expect(row('nest').first().locator('.files-caret.is-open')).toHaveCount(0);

  // A PLAIN click collapses the set to one — and still opens the file, the
  // grammar the tree always had.
  await label('bravo.txt').click();
  await expect(selected).toHaveCount(1);
  await expect(row('bravo.txt')).toHaveClass(/is-selected/);
  await expect(editors).toHaveCount(1);
  await expect(page.locator('.fwin .files-panepath')).toContainText('bravo.txt');

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-multi-select.png') });
  expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
});

// ————— bulk delete (ruling, 2026-08-16): the gesture takes the WHOLE selection,
// and the ask is a desk-level POPUP — never a bar crammed into the rail —————

test('a delete on a selected row takes the whole selection: popup confirms, cancel keeps every byte, delete lands recursively and closes buried editors', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await initSession(page);
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
  await openFolderViaPanel(page, dir);
  await expect(page.locator('.files-name', { hasText: 'alpha.txt' })).toBeVisible({ timeout: 15000 });

  const row = (name) => page.locator('.files-rowwrap', { hasText: name });
  const label = (name) => page.locator('.files-name', { hasText: name });
  const selected = page.locator('.files-rowwrap.is-selected');

  // Open nest and its file in an editor — the bulk delete must close the
  // window whose file dies UNDER the deleted folder.
  await label('nest').first().click();
  await label('inner.txt').click();
  await expect(page.locator('.fwin .editor')).toBeVisible();

  // Select inner.txt + alpha + nest; the gesture lands on alpha's trash.
  await label('alpha.txt').click({ modifiers: ['Control'] });
  await label('nest').first().click({ modifiers: ['Control'] });
  await expect(selected).toHaveCount(3);
  await row('alpha.txt').hover();
  await row('alpha.txt').locator('.files-act[aria-label="Delete"]').click();

  // THE POPUP — a desk-level window portaled to the body, never in the rail;
  // inner.txt folds into nest (delete-set), so the ask honestly names TWO.
  const pop = page.locator('.delconfirm');
  await expect(pop).toBeVisible();
  expect(await page.locator('body > .delconfirm-overlay').count()).toBe(1);
  await expect(pop).toContainText('DELETE 2 ITEMS?');
  await expect(pop).toContainText('alpha.txt');
  await expect(pop).toContainText('nest (folder + contents)');
  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/explorer-bulk-delete.png') });

  // CANCEL keeps every byte on the real disk.
  await pop.locator('.delconfirm-x').click();
  await expect(pop).toHaveCount(0);
  expect(fs.existsSync(path.join(dir, 'alpha.txt'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'nest', 'inner.txt'))).toBe(true);

  // Again — DELETE: both land, the folder recursively, for real.
  await row('alpha.txt').hover();
  await row('alpha.txt').locator('.files-act[aria-label="Delete"]').click();
  await page.locator('.delconfirm-go').click();
  await expect(page.locator('.delconfirm')).toHaveCount(0);
  await expect(label('alpha.txt')).toHaveCount(0);
  await expect(label('nest')).toHaveCount(0);
  expect(fs.existsSync(path.join(dir, 'alpha.txt'))).toBe(false);
  expect(fs.existsSync(path.join(dir, 'nest'))).toBe(false);

  // The editor on nest/inner.txt died with its folder; nothing dead lingers
  // selected; the note says exactly what happened.
  await expect(page.locator('.fwin .editor')).toHaveCount(0);
  await expect(selected).toHaveCount(0);
  await expect(page.locator('.files-note')).toContainText('Deleted 2 items');
  expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
});

// ————— external truth (ruling, 2026-08-16): […] —————

test('the live watch drops a row deleted behind the desk on its own; right-click REFRESH surfaces an external arrival', async ({ page }) => {
  const ext = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xmulti-ext-'));
  try {
    await fs.promises.writeFile(path.join(ext, 'watched.txt'), 'watched\n');
    await fs.promises.writeFile(path.join(ext, 'steady.txt'), 'steady\n');
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    await initSession(page);
    await page.goto(`http://localhost:${FPORT}/`);
    await settleDesk(page);
    await openFolderViaPanel(page, ext);
    const label = (name) => page.locator('.files-name', { hasText: name });
    await expect(label('watched.txt')).toBeVisible({ timeout: 15000 });

    // THE WATCH LANE, no gesture: the file dies on the real disk (Dolphin,
    // a terminal — anything external) and the row leaves ON ITS OWN via
    // fs.watch → SSE → the files-changed bus.
    await fs.promises.rm(path.join(ext, 'watched.txt'));
    await expect(label('watched.txt')).toHaveCount(0, { timeout: 15000 });
    await expect(label('steady.txt')).toBeVisible();

    // REFRESH — the operator's manual truth: an external arrival lands on
    // disk, the root's right-click menu re-lists the subtree.
    await fs.promises.writeFile(path.join(ext, 'arrival.txt'), 'arrived\n');
    await page.locator('.files-rowwrap', { hasText: path.basename(ext) }).first().click({ button: 'right' });
    await page.locator('.cmenu-item', { hasText: 'REFRESH' }).click();
    await expect(label('arrival.txt')).toBeVisible({ timeout: 15000 });
    expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
  } finally {
    await fs.promises.rm(ext, { recursive: true, force: true });
  }
});
