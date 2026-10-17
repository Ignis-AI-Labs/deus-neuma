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
import { settleDesk } from './helpers/explorer-panel-harness.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { buildBenchFixtureTree, BENCH_FIXTURES } from '../helpers/bench-fixture-tree.js';

/**
 * End-to-end BENCH → LAUNCH, the two-column redesign (2026-09-25): tier tabs
 * over a bounded list on the left, THIS RUN pinned on the right, readable
 * type. And the Terminal-Bench trap it closes: a benchmark that offers only
 * FULL BEING used to inherit the default BARE, invisibly, so every RUN
 * was refused.
 *
 * Isolated stack: ports from :0, a temp harness tree from the captured
 * fixtures plus the REAL terminal-bench-rem2b CELL.json (captured
 * 2026-09-25), serving pointed at a dead port. No mock anywhere; the live
 * stack and the real harness are never touched.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = process.env.BENCH_E2E_SHOTS || null;
const NEUMA_ID = 'e2e-bench-launch';

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
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bench-launch-e2e-'));
  const harness = path.join(root, 'harness');
  await buildBenchFixtureTree(harness);
  const tb = path.join(harness, 'cells', 't3', 'terminal-bench-rem2b');
  await fs.promises.mkdir(tb, { recursive: true });
  await fs.promises.copyFile(path.join(BENCH_FIXTURES, 'CELL-terminal-bench-rem2b.json'), path.join(tb, 'CELL.json'));
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

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `bench-launch-${name}.png`) });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ t, a, id }) => {
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Bench', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`http://localhost:${FPORT}/`);
  await settleDesk(page);
  await openDockApp(page, 'BENCH');
  await page.locator('.bench-tab', { hasText: 'LAUNCH' }).click();
});

test('two columns: the picker on the left, THIS RUN pinned on the right, readable type', async ({ page }) => {
  const setup = page.locator('.bl-setup');
  const run = page.locator('.bl-run');
  await expect(setup.getByRole('tab', { name: /T1 QUICK/ })).toBeVisible({ timeout: 20000 });
  // At the window's default width the columns stack (THIS RUN under the picker);
  // given room they stand side by side.
  let [s, r] = await Promise.all([setup.boundingBox(), run.boundingBox()]);
  expect(r.y).toBeGreaterThanOrEqual(s.y + s.height - 1);
  await page.locator('.fwin').filter({ has: setup }).getByRole('button', { name: 'Maximize window' }).click();
  await expect.poll(async () => {
    [s, r] = await Promise.all([setup.boundingBox(), run.boundingBox()]);
    return r.x >= s.x + s.width - 1;
  }).toBe(true);
  await expect(run).toContainText('Pick a benchmark on the left.');
  // Prose reads at the legibility floor (14px), never the old 9–10px mono.
  const prose = await setup.locator('.bl-prose').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(prose).toBeGreaterThanOrEqual(14);

  await setup.getByRole('option', { name: /GSM8K/ }).click();
  await expect(run.locator('.bl-run-name').nth(0)).toBeVisible();
  await expect(run.locator('.bl-numeral')).toHaveText('~45 min'); // the cell's own wallclock, one arm
  await expect(setup.getByRole('button', { name: /BARE MODEL/ })).toHaveAttribute('aria-pressed', 'true');
  // HARNESS is its own arm now — the platform agent with identity off (Design note, 2026-09-29.
  await expect(setup.getByRole('button', { name: /^HARNESS/ })).toBeVisible();
  await expect(setup.getByRole('button', { name: /^HARNESS/ })).toContainText('every identity layer off');
  // Three core arms stand open; the two diagnostic arms wait folded until asked for (Design note, 2026-09-29.
  await expect(setup.getByRole('button', { name: /PLATFORM WIRE/ })).toBeHidden();
  await setup.getByText('DIAGNOSTIC ARMS — FOR DEBUGGING A SPECIFIC LAYER').click();
  await setup.getByRole('button', { name: /PLATFORM WIRE/ }).click();
  await expect(run.locator('.bl-numeral')).toHaveText('~1.5 h');
  await expect(run.getByRole('button', { name: 'RUN THE MATCHED SET (2)' })).toBeDisabled(); // nothing is served here
  await expect(run).toContainText('NOTHING IS LOADED');
  // One row per benchmark: GSM8K stands once, its variant asked beneath it.
  await expect(setup.getByRole('option', { name: /GSM8K/ })).toHaveCount(1);
  await expect(setup.getByRole('option', { name: /GSM8K/ })).toContainText('2 VERSIONS');
  const versions = setup.getByRole('radiogroup', { name: 'GSM8K version' });
  await expect(versions.getByRole('radio')).toHaveCount(2);
  await expect(versions.getByRole('radio', { name: /Standard/ })).toHaveAttribute('aria-checked', 'true');
  await versions.getByRole('radio', { name: /2568-token/ }).click();
  await expect(versions.getByRole('radio', { name: /2568-token/ })).toHaveAttribute('aria-checked', 'true');
  await expect(setup.getByRole('button', { name: /PLATFORM WIRE/ })).toHaveAttribute('aria-pressed', 'true'); // the arms carry over
  await shot(page, 'gsm8k');
});

test('Terminal-Bench offers only the full being — BARE is dropped, never carried invisibly', async ({ page }) => {
  const setup = page.locator('.bl-setup');
  await setup.getByRole('tab', { name: /T3 AGENTIC/ }).click({ timeout: 20000 });
  await setup.getByRole('option', { name: /Terminal-Bench/ }).click();
  const bare = setup.getByRole('button', { name: /BARE MODEL/ });
  await expect(bare).toBeDisabled();
  await expect(bare).toHaveAttribute('aria-pressed', 'false');
  await expect(bare).toContainText('not offered by this benchmark');
  await expect(setup.getByRole('button', { name: /FULL BEING/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(setup.locator('.bl-step-aside')).toHaveText('1 OF 1 PICKED');
  // The being is asked for once, from the operator's own lanes.
  await expect(setup.getByLabel('The being under test')).toBeVisible();
  await expect(page.locator('.bl-run .bl-numeral')).toHaveText('~6 h');
  await shot(page, 'terminal-bench');
});
