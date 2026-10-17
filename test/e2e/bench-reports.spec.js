// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDockApp } from './helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { buildBenchFixtureTree, addBenchRunFixtures } from '../helpers/bench-fixture-tree.js';

/**
 * End-to-end BENCH → OVERVIEW's atlas + REPORTS (bench-atlas-explorer): charts from real
 * captured receipts, the LIBRARY stepped with ‹ ›, and SHARE drawing the real
 * PNG card through the backend's Chromium, then copying the image and the
 * Markdown to the clipboard and saving the file. No mock anywhere.
 *
 * Isolated stack: ports from :0 (the port law) and a temp harness tree built
 * from test/fixtures/bench (captured 2026-09-25) — the live stack and the
 * real harness are never touched. Proof certificates live under the data
 * root, which the server's ROOT LOCK refuses to move for a test (it would
 * boot an empty house), so they are READ from this checkout's own data root
 * — the assertions count them rather than pinning one.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = process.env.BENCH_E2E_SHOTS || null; // a dir to keep screenshots in, when asked
const NEUMA_ID = 'e2e-bench';

// impure — an ephemeral port the kernel just handed out.
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const waitFor = async (urls, ms = 90000) => {
  const t0 = Date.now();
  for (;;) {
    for (const url of urls) {
      try {
        if ((await fetch(url)).status < 500) return;
      } catch { /* not listening yet */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${urls.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

let root;
let backendProc;
let viteProc;
let token;
let addr;
let FPORT;

test.beforeAll(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bench-reports-e2e-'));
  const harness = path.join(root, 'harness');
  await buildBenchFixtureTree(harness);
  await addBenchRunFixtures(harness);
  FPORT = await freePort();
  const BPORT = await freePort();
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: path.join(root, 'workspaces'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_BENCH_HARNESS_PATH: harness,
    NEUMA_BENCH_WATCH_PATH: path.join(root, 'watch', 'incidents.jsonl'),
    NEUMA_BENCH_SERVING_URL: 'http://127.0.0.1:9',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  const base = `http://localhost:${BPORT}`;
  await waitFor([`${base}/api/v1/health`]);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  const w = new ethers.Wallet(readClaudeWallet());
  addr = w.address;
  const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${addr}`)).json();
  const res = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature: await w.signMessage(challenge), challenge }),
  });
  ({ token } = await res.json());
  if (!token) throw new Error('auth/verify returned no token');
  // The desk opens onto a bound companion — claim a lane the relink phase lands on.
  // Only ever inside the temp root — never a lane in the live house.
  await claimOwner(path.join(root, 'workspaces'), NEUMA_ID, addr);
});

test.afterAll(async () => {
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

// The fresh temp lane owes its first seal and its setup acts; both gates wear
// a way past (STAND ASIDE / CONTINUE TO THE DESK) — top first, after the veil parts.
const standAside = async (page) => {
  const veil = page.locator('.arrival');
  if (await veil.count()) {
    await veil.click({ force: true }).catch(() => {});
    await expect(veil).toHaveCount(0, { timeout: 20000 });
  }
  for (const gate of ['.voice-seal-gate', '.birth-setup-gate']) {
    const button = page.locator(`${gate} button`, { hasText: /STAND ASIDE|CONTINUE TO THE DESK/ });
    if (await button.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
      await button.click();
      await expect(page.locator(gate)).toHaveCount(0, { timeout: 20000 });
    }
  }
};

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(({ t, a, id }) => {
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Bench', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await standAside(page);
  await openDockApp(page, 'BENCH');
  await page.locator('.bench-tab', { hasText: 'REPORTS' }).click();
});

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `bench-${name}.png`) });
};

test('THE ATLAS on OVERVIEW: the influence per layer, every benchmark as points on one line, ↑↓ Enter into REPORTS', async ({ page }) => {
  await page.locator('.bench-tab', { hasText: 'OVERVIEW' }).click();
  const atlas = page.locator('.atlas');
  await expect(atlas.locator('.atlas-count')).toHaveText(/^1 BENCHMARK TAKEN · 0 NOT TAKEN YET$/, { timeout: 20000 });
  // The fixture's four-arm n=100 set: FULL BEING 98% against bare 67%.
  const being = atlas.locator('.atlas-layer', { hasText: 'FULL BEING' });
  await expect(being.locator('.atlas-layer-num')).toHaveText('+31.0 pts');
  await expect(being).toContainText('mean over 1 paired benchmark');
  // The FULL BEING point really stands at 98% of the track — not just a class.
  await atlas.getByRole('button', { name: 'STRONGEST EVIDENCE' }).click();
  const row = atlas.locator('.atlas-row', { hasText: 'gsm8k-2568' });
  const [point, track] = await Promise.all([row.locator('.atlas-point.is-neuma').boundingBox(), row.locator('.atlas-track').boundingBox()]);
  expect((point.x + point.width / 2 - track.x) / track.width).toBeCloseTo(0.98, 1);
  // The three core arms, each with a glyph you can SEE (Design note, 2026-10-01: the
  // HARNESS glyph had no style, so every harness point rendered invisible).
  await expect(atlas.locator('.atlas-legend-item')).toHaveText(['BARE MODEL', 'HARNESS', 'FULL BEING']);
  const harnessGlyph = atlas.locator('.atlas-legend-item', { hasText: 'HARNESS' }).locator('.atlas-glyph');
  expect(await harnessGlyph.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await shot(page, 'atlas');
  // The table view reads the same numbers.
  await atlas.getByRole('button', { name: 'TABLE' }).click();
  await expect(atlas.locator('.atlas-table')).toContainText('+31.0');
  await atlas.getByRole('button', { name: 'CHART' }).click();
  // Keyboard: focus the chart, ↓ selects the first row, Enter opens it in REPORTS.
  await atlas.locator('.atlas-chart').focus();
  await page.keyboard.press('ArrowDown');
  await expect(atlas.locator('.atlas-reading')).toContainText('GSM8K-2568');
  await page.keyboard.press('Enter');
  await expect(page.locator('.bx-title')).toContainText('gsm8k-2568');
});

test('the EXPLORER: search the list, step the comparisons, read every arm\u2019s stats and history', async ({ page }) => {
  const bx = page.locator('.bx');
  await expect(bx.locator('.bx-item', { hasText: 'gsm8k-2568' })).toBeVisible({ timeout: 20000 });
  await expect(bx.locator('.bx-title')).toContainText('gsm8k-2568');
  await expect(bx.locator('.bx-meaning')).toContainText('Grade-school math word problems');
  // The newest comparison leads; the chips step to older ones.
  const chips = bx.locator('.bx-chip');
  await expect(chips).toHaveCount(3);
  await chips.filter({ hasText: 'n=100' }).click();
  await expect(bx.locator('.bench-bars-row.is-top')).toContainText('NEUMA');
  await expect(bx.locator('.bench-bars-row.is-top')).toContainText('+31.0 pts');
  // Every arm: score, change against bare, time, tokens.
  const stats = bx.locator('.bx-stats');
  await expect(stats.locator('tbody tr')).toHaveCount(4);
  await expect(stats.locator('tbody tr', { hasText: 'FULL BEING' })).toContainText('+31.0');
  await expect(bx.locator('.bx-history .bx-history-point').first()).toBeVisible();
  await shot(page, 'explorer');
  // Search narrows the list.
  await bx.getByLabel('Search benchmarks').fill('nothing-like-this');
  await expect(bx.locator('.bx-none')).toBeVisible();
});

test('RUNS: the band and day strip, runs by day and set, the focus with its set, a failure in its own words', async ({ page }) => {
  await page.locator('.bench-tab', { hasText: 'RUNS' }).click();
  const lx = page.locator('.lx');
  // THE BAND reads the whole fixture ledger: 8 runs, 7 landed, 1 failed.
  const inst = (label) => lx.locator('.lx-band-inst', { hasText: label }).locator('.lx-band-num');
  await expect(inst('RUNS ON RECORD')).toHaveText('8', { timeout: 20000 });
  await expect(inst('LANDED')).toHaveText('88%');
  await expect(inst('FAILED')).toHaveText('1');
  // THE RAIL: the four-arm set stands together, in the ladder order.
  const set = lx.locator('.lx-set', { hasText: 'gsm8k-2568' }).filter({ has: page.locator('.lx-run', { hasText: 'PLATFORM WIRE' }) });
  await expect(set.locator('.lx-run-arm')).toHaveText(['BARE MODEL', 'PLATFORM WIRE', 'SILO', 'FULL BEING']);
  // THE FOCUS on the full being: change vs bare, the set's four siblings, provenance + hashes.
  await set.locator('.lx-run', { hasText: 'FULL BEING' }).click();
  const focus = lx.locator('.lx-focus');
  await expect(focus.locator('.lx-kicker')).toContainText('FULL BEING');
  await expect(focus.locator('.lx-num')).toHaveText('98.0%');
  await expect(focus.locator('.lx-delta')).toHaveText('+31.0 PTS VS BARE');
  await expect(focus.locator('.lx-sib')).toHaveCount(4);
  await expect(focus.locator('.lx-hash').first()).toBeVisible();
  await shot(page, 'runs');
  // A sibling tile steps the focus to that arm.
  await focus.locator('.lx-sib', { hasText: 'BARE MODEL' }).click();
  await expect(lx.locator('.lx-focus .lx-kicker')).toContainText('BARE MODEL');
  await expect(lx.locator('.lx-focus .lx-delta')).toHaveCount(0);
  // ↓ walks the rail.
  await lx.locator('.lx-list').focus();
  await page.keyboard.press('ArrowDown');
  await expect(lx.locator('.lx-focus .lx-kicker')).toContainText('PLATFORM WIRE');
  // FAILED narrows to the one failure; its focus says why it stopped.
  await lx.getByRole('button', { name: /^FAILED/ }).click();
  await expect(lx.locator('.lx-run')).toHaveCount(1);
  await lx.locator('.lx-run').click();
  await expect(lx.locator('.lx-failure')).toContainText('BENCHMARK_PROCESS_FAILED');
  // WHAT HAPPENED: the stage that died and the real stderr — the cause itself.
  const happened = lx.locator('.why', { hasText: 'WHAT HAPPENED' });
  await expect(happened.locator('.why-stage.is-loud')).toContainText('EXIT 1');
  await expect(happened.locator('.why-log-tail')).toContainText('502 Server Error: Bad Gateway');
  // WHY IT MISSED: asked of its set; this fixture kept no scored samples, and it says so.
  await expect(lx.locator('.why', { hasText: 'WHY IT MISSED' })).toContainText('no scored samples on disk');
  // A day column narrows the rail to that day; the chip clears it.
  await lx.getByRole('button', { name: /^ALL/ }).first().click();
  const busiest = lx.locator('.lx-day:not([disabled])').first();
  await busiest.click();
  await expect(lx.locator('.lx-dayfilter')).toBeVisible();
  await expect(lx.locator('.lx-dayblock')).toHaveCount(1);
  await lx.locator('.lx-dayfilter').click();
  await expect(lx.locator('.lx-run')).toHaveCount(8);
  // OPEN IN REPORTS carries the benchmark into the explorer.
  await lx.locator('.lx-run').first().click();
  await lx.locator('.lx-open').click();
  await expect(page.locator('.bx-title')).toContainText('gsm8k-2568');
});

test('LIBRARY steps through proofs and nights with ‹ › and the arrow keys', async ({ page }) => {
  await page.locator('.bench-subtabs .bench-btn', { hasText: 'LIBRARY' }).click();
  const lib = page.locator('.bench-library');
  const pos = lib.locator('.bench-library-pos');
  await expect(pos).toHaveText(/^— \/ \d+$/, { timeout: 20000 });
  const total = Number((await pos.textContent()).split('/')[1]);
  // The fixture night bundle was copied in at setup, so it is the NEWEST
  // item; every proof certificate under the data root is older.
  await lib.getByRole('button', { name: 'older' }).click();
  await expect(pos).toHaveText(`1 / ${total}`);
  await expect(lib.locator('.bench-report-pane')).toContainText('Benchmark night', { timeout: 15000 });
  await lib.locator('.bench-report-pane').focus();
  for (let i = 1; i < total; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- one keypress, one step
    await page.keyboard.press('ArrowRight');
  }
  await expect(pos).toHaveText(`${total} / ${total}`);
  await expect(lib.locator('.bench-report-pane')).toContainText('PASS', { timeout: 15000 });
  await page.keyboard.press('ArrowLeft');
  await expect(pos).toHaveText(`${total - 1} / ${total}`);
  await shot(page, 'library');
});

test('SHARE draws the real PNG, copies image + Markdown to the clipboard, and saves the file', async ({ page }) => {
  await page.locator('.bx-chip', { hasText: 'n=100' }).click({ timeout: 20000 });
  await page.locator('.bx-actions').getByRole('button', { name: 'SHARE THIS' }).click();
  const share = page.locator('.bench-share');
  const img = share.locator('.bench-share-preview img');
  await expect(img).toBeVisible({ timeout: 60000 });
  // The preview is the exported PNG at the card's raster density.
  expect(await img.evaluate((el) => [el.naturalWidth, el.naturalHeight])).toEqual([4000, 2250]);
  await shot(page, 'share-16x9');

  await share.getByRole('button', { name: /^4:5/ }).click();
  await expect.poll(() => img.evaluate((el) => [el.naturalWidth, el.naturalHeight]), { timeout: 60000 }).toEqual([2700, 3375]);
  await shot(page, 'share-4x5');

  await share.getByRole('button', { name: 'COPY MARKDOWN' }).click();
  await expect(share).toContainText('MARKDOWN COPIED');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('| **NEUMA** | **98.0%** | +31.0 pts |');

  await share.getByRole('button', { name: 'COPY IMAGE' }).click();
  await expect(share).toContainText('IMAGE COPIED');
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain('image/png');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    share.getByRole('button', { name: 'SAVE PNG' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('neuma-bench-gsm8k-2568-2026-09-15-4x5.png');
});
