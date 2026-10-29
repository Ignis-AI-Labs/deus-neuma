// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';
import { solidPng } from '../helpers/image-fixtures.js';
import { openDockApp } from './helpers/dock.js';

/**
 * End-to-end THE LOUPE — the Lightbox over the marketing previews (Founder,
 * 2026-09-01: […]).
 *
 * Both marketing surfaces that carry preview images, each with the full
 * contract the ask named:
 *   1. a staged post's thumbnail (X → QUEUE → POSTS): click opens the loupe
 *      on the SAME staged bytes, the wheel leans in, Escape walks back
 *   2. a brand mark's ground tile (BRAND KITS → MARKS): click opens the
 *      loupe, CLOSE walks back
 *
 * REAL throughout (RULE 0): real preview routers + built desk on one ephemeral port, real auth
 * (challenge-sign-verify), the real queue store on real disk read by the real
 * preview route (the thumbnail's bytes travel the real authenticated fetch),
 * the brand kit raised through the real REST (house ground → kit → mark
 * upload), and the real browser events (click, wheel, Escape) against the
 * real component. Nothing on the claimed path is mocked.
 *
 * SAFETY LAW (queue-decisions.spec.js pattern): never the live witness stack
 * — its own preview stack on :0, a disposable
 * WORKSPACES_ROOT, and the store/env doors pointed inside that temp root.
 * No LLM, no network: nothing here sends a thought or a post.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
test.use({ launchOptions: { args: ['--disable-gpu'] } });
// One actual :0 listener serves the built desk and its real preview routes.
const NEUMA_ID = 'e2e-loupebeing';
const BRAND = 'loupe-e2e';

let FPORT;
let BPORT;
let BASE;
let root;
let backendProc;
let token;
let addr;

// THE SPEC'S OWN WALLET. The stack is a disposable root that claimOwner
// claims fresh, so a throwaway key removes both the gitignored claude.env
// dependency (unrunnable on any clone that lacks it) and the use of another
// sealed witness's wallet — the desk-suite specs still read claude.env, and
// migrating THEM is their own lane, not this spec's.
const mintToken = async () => {
  const w = ethers.Wallet.createRandom();
  const { challenge } = await (await fetch(`${BASE}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BASE}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token: t } = await res.json();
  if (!t) throw new Error('auth/verify returned no token');
  return { token: t, addr: w.address };
};

// One staged draft post carrying ONE REAL IMAGE — the bytes are a real PNG
// (built per the PNG spec in image-fixtures.js) on real disk at the absolute
// path staging would have recorded, so the preview route's realpath re-check
// and magic-byte sniff both pass exactly as they do for a live staged post.
const DRAFT_TEXT = 'The loupe proof — a staged card with its art attached.';
const seedStores = async () => {
  const mediaDir = path.join(root, 'staged-media');
  await fs.promises.mkdir(mediaDir, { recursive: true, mode: 0o700 });
  const artPath = path.join(mediaDir, 'staged-card.png');
  await fs.promises.writeFile(artPath, solidPng([0x5f, 0xe9, 0xff], 640, 360), { mode: 0o600 });

  const queue = [{
    id: 'draft-with-art',
    channelId: 'x',
    text: DRAFT_TEXT,
    scheduledFor: null,
    campaignId: null,
    pillar: '',
    media: [{ path: artPath, alt: 'the staged card, described' }],
    authorNeumaId: null,
    queuedBy: '',
    status: 'draft',
    expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
  }];

  const dir = path.join(root, 'social');
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(
    path.join(dir, 'social-post-queue.json'), `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 },
  );
};

// A brand with a real mark, raised through the real REST the panel itself
// uses: the house ground is set first (a mark upload refuses with no ground
// of one's own), then the kit is saved from its own skeleton with the mark
// declared, then the SVG rides the real multipart upload + sniff.
const raiseBrand = async () => {
  const auth = { Authorization: `Bearer ${token}` };
  const realm = await (await fetch(`${BASE}/api/v1/user/realm`, { headers: auth })).json();
  expect(realm.root).toBe(path.join(root, 'realm'));
  const groundResponse = await fetch(`${BASE}/api/v1/user/realm/house-workspace`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ root: path.join(root, 'house') }),
  });
  if (!groundResponse.ok) throw new Error(`ground setup refused: ${await groundResponse.text()}`);

  const { kit } = await (await fetch(`${BASE}/api/v1/brands/${BRAND}/new`, { headers: auth })).json();
  const saved = await fetch(`${BASE}/api/v1/brands/${BRAND}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ ...kit, marks: { wordmark: { file: 'wordmark.svg' } } }),
  });
  if (!saved.ok) throw new Error(`kit save refused: ${await saved.text()}`);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48">'
    + '<text x="8" y="34" font-family="monospace" font-size="30" letter-spacing="4" fill="#000000">LOUPE</text>'
    + '</svg>';
  const form = new FormData();
  form.append('name', 'wordmark');
  form.append('mark', new Blob([svg], { type: 'image/svg+xml' }), 'wordmark.svg');
  const up = await fetch(`${BASE}/api/v1/brands/${BRAND}/marks`, { method: 'POST', headers: auth, body: form });
  if (!up.ok) throw new Error(`mark upload refused: ${await up.text()}`);
};

test.beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'loupe-e2e-'));
  await seedStores();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DNA_ENCRYPTION_KEY: 'lightbox-fixture-encryption-key-only',
    WORKSPACES_ROOT: root,
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'witness-home'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    // THE WHOLE DATA ROOT (queue-decisions law): with only the store paths
    // redirected, the board still read the operator's REAL X credentials and
    // went out to X's API. An isolated root leaves every channel honestly
    // unconfigured — no real credential is read, no request leaves the box.
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_CMO_PATH: path.join(root, 'cmo.json'),
    NEUMA_WEEKLY_PLAN_PATH: path.join(root, 'weekly-plan.json'),
    NEUMA_SOCIAL_CREDENTIALS_PATH: path.join(root, 'social', 'credentials.json'),
    NEUMA_SOCIAL_BINDINGS_PATH: path.join(root, 'social', 'bindings.json'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    NEUMA_SOCIAL_POST_QUEUE_PATH: path.join(root, 'social', 'social-post-queue.json'),
    NEUMA_REPLY_CANDIDATES_PATH: path.join(root, 'social', 'reply-candidates.json'),
    X_API_KEY: '', X_API_SECRET: '', X_ACCESS_TOKEN: '', X_ACCESS_SECRET: '',
    SUBSTRATE_IDLE_MINUTES: '0',
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID',
    'MASTODON_INSTANCE_URL', 'MASTODON_ACCESS_TOKEN', 'BLUESKY_SERVICE', 'BLUESKY_IDENTIFIER',
    'BLUESKY_APP_PASSWORD', 'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN',
    'LINKEDIN_PERSON_URN', 'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_TOKEN_EXPIRES_AT']) env[key] = '';
  backendProc = spawn('node', ['test/e2e/helpers/lightbox-stack.mjs'], {
    cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let startupLog = '';
  backendProc.stdout.on('data', (chunk) => { startupLog += chunk; });
  backendProc.stderr.on('data', (chunk) => { startupLog += chunk; });
  BPORT = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`preview stack did not start: ${startupLog}`)), 30000);
    backendProc.once('message', ({ port }) => { clearTimeout(timer); resolve(port); });
    backendProc.once('error', (error) => { clearTimeout(timer); reject(error); });
    backendProc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`preview stack exited ${code}: ${startupLog}`)); });
  });
  FPORT = BPORT;
  BASE = `http://127.0.0.1:${BPORT}`;

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  await raiseBrand();
});

test.afterAll(async () => {
  if (backendProc && backendProc.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => backendProc.kill('SIGKILL'), 5000);
      backendProc.once('exit', () => { clearTimeout(timer); resolve(); });
      backendProc.kill('SIGTERM');
    });
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

// Clear every modal that intercepts pointer events, however late it arrives:
// the birth-setup gate, the voice-seal notice, the arrival hold. They mount
// asynchronously after the desk does, so this is a LOOP over the live dialog
// count rather than a one-shot click (stream-tab-transfer.spec.js pattern —
// a single pass dismissed the gate that was up and then the next one
// appeared behind it, which is exactly how this spec's first run died).
const clearGates = async (page) => {
  for (let i = 0; i < 12; i += 1) {
    if ((await page.locator('[role="dialog"], .birth-setup-gate').count()) === 0) return;
    const doors = page.locator('button').filter({ hasText: /STAND ASIDE/i });
    const n = await doors.count();
    let clicked = false;
    for (let d = 0; d < n; d += 1) {
      const door = doors.nth(d);
      if (await door.isVisible({ timeout: 500 }).catch(() => false)) {
        await door.click({ timeout: 3000 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(400);
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(400);
  }
};

// JS crashes collected per test (module scope — tests in a worker run
// serially, and `// @ts-check` rightly refuses an ad-hoc property on Page).
let crashes = [];

test.beforeEach(async ({ page }) => {
  crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Loupebeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://127.0.0.1:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await clearGates(page);
  await page.waitForTimeout(1200);
  await clearGates(page);
});

// X's account level (in MARKETING) → its queue → POSTS section. POSTS opens on the month calendar;
// an unscheduled draft lives behind the UNSCHEDULED chip — the same click
// the operator makes to reach it.
const openPostsBoard = async (page) => {
  await openDockApp(page, 'X');
  // X's space is MARKETING's account level (slice 6).
  const win = page.locator('.fwin', { has: page.locator('[data-mkt-level="account"][data-mkt-account^="x:"]') }).first();
  // The account level's one board is the queue: no tab to press (SDT-6).
  await expect(win.locator('.queue-section-tab').first()).toBeVisible({ timeout: 20000 });
  await win.locator('.queue-section-tab', { hasText: 'POSTS' }).click();
  const unscheduled = win.locator('button', { hasText: 'UNSCHEDULED' });
  if (await unscheduled.isVisible({ timeout: 5000 }).catch(() => false)) {
    await unscheduled.click();
  }
  return win;
};

test('a staged post\'s thumbnail opens the loupe on the same bytes; the wheel leans in; Escape walks back', async ({ page }) => {
  const win = await openPostsBoard(page);
  const card = win.locator('.queue-card', { hasText: DRAFT_TEXT }).first();
  await expect(card).toBeVisible({ timeout: 20000 });

  const door = card.locator('.queue-media-zoom');
  await expect(door).toBeVisible();
  const thumbSrc = await card.locator('.queue-media-thumb').getAttribute('src');
  await door.click();

  // THE POP: a modal dialog over the desk, hanging the SAME staged bytes —
  // the loupe reuses the thumb's own object URL, so equality here is the
  // proof no second, different fetch happened.
  const loupe = page.locator('.lightbox[role="dialog"]');
  await expect(loupe).toBeVisible();
  const media = loupe.locator('.lightbox-media');
  await expect(media).toBeVisible();
  await expect(media).toHaveAttribute('src', thumbSrc);
  await expect(loupe.locator('.lightbox-caption')).toContainText('staged-card.png');

  // THE LEAN: a real wheel over the real image grows the transform's scale.
  await media.hover();
  await page.mouse.wheel(0, -400);
  await expect
    .poll(async () => Number((await media.getAttribute('style') || '').match(/scale\(([\d.]+)/)?.[1]))
    .toBeGreaterThan(1);

  const fit = loupe.getByRole('button', { name: 'FIT', exact: true });
  const close = loupe.getByRole('button', { name: 'CLOSE', exact: true });
  await page.keyboard.press('Tab');
  await expect(fit).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(fit).toBeFocused();
  await fit.click();
  await expect(fit).toBeDisabled();
  await expect(loupe).toBeFocused();

  // Escape after FIT still reaches the dialog and restores its opener.
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);
  // And the board it came from is still standing.
  await expect(card).toBeVisible();
  await expect(door).toBeFocused();

  expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
});

test('a brand mark\'s ground tile opens the loupe; CLOSE walks back', async ({ page }) => {
  await openDockApp(page, 'BRAND KITS');
  const panel = page.locator('.outreach-panel').last();
  const switcher = panel.locator('.bk-switch .lc-sel-trigger');
  await expect(switcher).toBeVisible();
  // raiseBrand() threw in beforeAll if the kit did not land, and this stack's
  // root is the isolated temp it landed in — a switcher that will not open
  // here is the BRAND KITS surface failing to list it, never […]. That failure must fail, not skip green.
  await expect(switcher).toBeEnabled({ timeout: 20000 });
  await switcher.click();
  await page.locator('.lc-sel-panel .lc-sel-opt').first().click();
  await panel.locator('.bk-rail-row', { hasText: 'MARKS' }).first().click();

  // Three grounds, each a door now; the mark loads as recoloured data URIs.
  // ON WHITE is the ground that catches a white-on-white mark — the loupe
  // must carry the tile's own colour onto its wall, or the caption says
  // ON WHITE while the art hangs on the void.
  const door = panel.locator('.bk-mark-zoom').nth(2);
  await expect(door).toBeVisible({ timeout: 20000 });
  await door.click();

  const loupe = page.locator('.lightbox[role="dialog"]');
  await expect(loupe).toBeVisible();
  await expect(loupe.locator('.lightbox-media')).toBeVisible();
  await expect(loupe.locator('.lightbox-caption')).toContainText('wordmark');
  await expect(loupe.locator('.lightbox-caption')).toContainText('ON WHITE');
  await expect(loupe.locator('.lightbox-stage')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // THE SIZING (the failure that motivated this surface): a viewBox-only SVG
  // has no intrinsic size, so a max-only hang would pin it to the browser's
  // 300px default object size — barely bigger than the tile it replaced.
  // The vector hang FILLS the wall.
  const art = await loupe.locator('.lightbox-media').boundingBox();
  const wall = await loupe.locator('.lightbox-stage').boundingBox();
  expect(art.width, 'the mark fills the wall, not the 300px default').toBeGreaterThan(wall.width * 0.6);

  // ONE Escape, TWO claims: the loupe closes, and — because React portals
  // bubble through the React tree, not the DOM tree — nothing it reached on
  // the way (the window host) closes with it. One Escape must leave the
  // operator where they were, not two surfaces down.
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);
  await expect(panel).toBeVisible();

  // And the CLOSE act walks back too.
  await door.click();
  await expect(loupe).toBeVisible();
  await loupe.locator('button', { hasText: 'CLOSE' }).click();
  await expect(page.locator('.lightbox')).toHaveCount(0);

  expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
});
