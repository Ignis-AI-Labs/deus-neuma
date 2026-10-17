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
 * End-to-end KOTODAMA TEMPO — the witness's speech-rate control for the true
 * name. Driven for real: a real browser on an isolated stack cycles the KOTO
 * toggle (persisted across reload), then REAL Web Audio timing proves the
 * same signature program speaks slow at ×1 and inside a second at ×8. No
 * mock anywhere on a claimed path (RULE 0). Needs no LLM.
 *
 * SAFETY LAW: NEVER a live witness stack — own backend+vite on PID-derived
 * bind-probed ports, disposable temp roots, recorded-PID teardown.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const FPORT_BASE = 8251 + (process.pid % 149);
const BPORT_BASE = 4251 + (process.pid % 149);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-koto';

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

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'koto-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  const sec = await (await fetch(`${BASE}/api/v1/security/status`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null);
  const activeRoot = sec?.roots?.active;
  if (activeRoot && activeRoot !== root) await claimOwner(activeRoot, NEUMA_ID, addr);
});

test.afterAll(async () => {
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  // The arrival veil eats pointer events until its parting beat unmounts it —
  // interacting with window chrome before then races the shutters.
  await expect(page.locator('.arrival')).toHaveCount(0, { timeout: 30000 });
  // A synthetic companion owes the birth-setup checklist — the gate veils
  // the desk center. Stand aside (the designed door), never fight the veil.
  const gate = page.locator('.birth-setup-gate');
  if (await gate.count()) {
    await page.locator('button', { hasText: 'STAND ASIDE' }).click();
    await expect(gate).toHaveCount(0);
  }
});

test('the KOTO toggle cycles the ladder and persists across reload', async ({ page }) => {
  const koto = page.locator('.relink-snd', { hasText: 'KOTO' });
  await expect(koto).toHaveText('KOTO ×1');
  await koto.click();
  await expect(koto).toHaveText('KOTO ×2');
  await koto.click();
  await expect(koto).toHaveText('KOTO ×4');
  await koto.click();
  await expect(koto).toHaveText('KOTO ×8');
  await koto.click();
  await expect(koto).toHaveText('KOTO ×1');

  // The choice persists — two clicks from ×1 sets ×4; after a reload the
  // toggle still reads ×4.
  await koto.click();
  await koto.click();
  await expect(koto).toHaveText('KOTO ×4');
  await page.reload();
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.relink-snd', { hasText: 'KOTO' })).toHaveText('KOTO ×4');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('REAL Web Audio timing: the same true name speaks slow at ×1 and inside a second at ×8', async ({ page }) => {
  // A user gesture first (autoplay policy), then time two real playbacks of
  // the same signature through the vendored modules — real oscillators on a
  // real AudioContext, never a mock.
  await page.locator('.relink').click();
  const timings = await page.evaluate(async () => {
    const { buildSignature } = await import('/@kotodama/signature.js');
    const { playProgram } = await import('/@kotodama/play.js');
    const ctx = new AudioContext();
    await ctx.resume();
    const speak = async (rate) => {
      const sig = buildSignature({
        chosenName: 'Fenna', genesisName: 'Veyla', houseName: 'Ignis',
        lean: 7, soulHex: 'a1b2c3d4e5f6', rate,
      });
      const t0 = performance.now();
      await playProgram(ctx, sig);
      return performance.now() - t0;
    };
    const slow = await speak(1);
    const fast = await speak(8);
    return { slow, fast };
  });

  // ×1 is the ceremonial pace (~5s for this name); ×8 lands inside a second
  // (+0.5s scheduling slack for the headless audio clock).
  expect(timings.slow).toBeGreaterThan(3500);
  expect(timings.fast).toBeLessThan(1500);
  expect(timings.fast).toBeLessThan(timings.slow / 3);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
