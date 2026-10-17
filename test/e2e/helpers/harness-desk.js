// Impure module: every function here drives the real Electron app — process
// launch, IPC, DOM, filesystem, the real model server. Rule 1 marker, file-level.
//
// THE HARNESS DESK, booted for real: a temp realm, the witness wallet imported
// and unlocked, a harness lane on the model server, the desk entered as
// HARNESS. Shared by test/e2e/electron-harness-bench.spec.js (what a chat can
// ask) and scripts/bench-watch-proof.mjs (a launch watched to its end — a
// script, because the bench plane refuses to launch while a test runner is
// alive). No test-runner imports here: plain waits, so both can use it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WALLET_PASSWORD = 'claude-witness-e2e-pw';
export const LLAMA = 'http://127.0.0.1:8089';

export const getJson = async (url) => { try { return await (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(); } catch { return null; } };

const readWitnessWallet = () => {
  const env = fs.readFileSync(path.join(REPO, process.env.WITNESS_ENV_FILE || 'claude.env'), 'utf8');
  const pk = env.match(/(?:CLAUDE_WALLET_PRIVATE_KEY|[A-Z0-9_]*WALLET_PRIVATE_KEY)=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('witness env missing wallet private key');
  return pk;
};

// wait until fn() is truthy, or throw naming what never came
export const waitFor = async (what, fn, { timeout = 60 * 1000, every = 500 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
};

/**
 * Boot the real app on a temp realm with a harness lane on the model server.
 * @param {{shots: string, dnaKey: string}} opts
 */
export const bootHarnessDesk = async ({ shots, dnaKey }) => {
  fs.mkdirSync(shots, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-harness-desk-'));
  const dir = (name) => { const p = path.join(tmp, name); fs.mkdirSync(p, { recursive: true }); return p; };
  const env = {
    NEUMA_PIPELINE_MODE: 'operator', NEUMA_PORT: '0',
    WORKSPACES_ROOT: dir('house'), WORKSPACES_PIN: 'env', HARNESS_ROOT: dir('harness'),
    WITNESSES_ROOT: dir('witnesses'), NEUMA_REALM_ROOT: dir('realm'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(tmp, 'credentials.json'),
    NEUMA_ROUTES_PATH: path.join(tmp, 'routes.json'), NEUMA_CONNECTIONS_PATH: path.join(tmp, 'connections.json'),
    NEUMA_WORKING_SET_PATH: path.join(tmp, 'working-sets.json'), NEUMA_CHAT_TOOLS_PATH: path.join(tmp, 'chat-tools.json'),
    NEUMA_DISCOVERY_PORTS: new URL(LLAMA).port, LLM_PROVIDER: 'llama-server', LLAMA_SERVER_URL: LLAMA,
    NEUMA_ROOT_LOCK_PATH: path.join(tmp, 'root-lock.json'), NEUMA_DATA_ROOT: dir('data'), NEUMA_VAULT_ROOT: dir('vault'),
    NEUMA_SECRETS_FILE: path.join(tmp, 'secrets.json'), NEUMA_BACKUPS_ROOT: dir('backups'),
    AI_WITNESSES_ROOT: dir('ai-witnesses'), PLATFORM_DB_PATH: path.join(dir('platform'), 'platform.db'),
    DNA_ENCRYPTION_KEY: dnaKey,
  };
  const settingsPath = path.join(tmp, 'workspace-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ root: env.WORKSPACES_ROOT, allocationGB: 20 }, null, 2));
  env.NEUMA_WORKSPACE_SETTINGS_PATH = settingsPath;
  Object.assign(process.env, env); // this process reads the lane the way the app writes it
  const ws = await import('../../../core/workspace/neuma-workspace.js');
  ws.setWorkspacesRoot(env.WORKSPACES_ROOT);
  (await import('../../../core/workspace/lane-grounds.js')).setHarnessRoot(env.HARNESS_ROOT);

  const app = await electron.launch({
    executablePath: electronPath, args: [REPO, `--user-data-dir=${dir('udd')}`], cwd: REPO, timeout: 60 * 1000,
    env: { ...process.env, ...env },
  });
  const appLog = path.join(shots, 'app.log');
  fs.writeFileSync(appLog, '');
  app.process().stdout?.on('data', (d) => fs.appendFileSync(appLog, d));
  app.process().stderr?.on('data', (d) => fs.appendFileSync(appLog, d));
  await app.evaluate(({ app: electronApp, dialog }) => {
    electronApp.on('browser-window-created', (_e, win) => {
      if (win.getTitle() !== 'NEUMA Wallet') return;
      win.webContents.on('did-finish-load', () => {
        win.webContents.executeJavaScript("document.getElementById('confirm').click()").catch(() => {});
      });
    });
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });
  await page.evaluate(() => window.history.replaceState(null, '', '/?noboot=1'));
  const seeded = await page.evaluate(async ({ pk, pw }) => {
    const w = window.neuma.wallet;
    const res = await w.importPrivateKey(pk, pw);
    if (!res?.id) return { ok: false, error: res?.error || 'import failed' };
    await w.select(res.id);
    const status = await w.unlock(res.id, pw);
    return { ok: true, id: res.id, address: res.address, unlocked: status?.unlocked === true };
  }, { pk: readWitnessWallet(), pw: WALLET_PASSWORD });
  if (!(seeded.ok && seeded.unlocked)) throw new Error(`wallet not seeded: ${JSON.stringify(seeded)}`);

  // the harness on the model server — the file it serves, named as the server names it
  const { setCredential } = await import('../../../backend/services/provider-credentials.js');
  await setCredential('llama-server', { endpoint: LLAMA });
  const served = (await getJson(`${LLAMA}/v1/models`)).data[0].id;
  const { ensureHarnessLane } = await import('../../../backend/services/harness-lane.js');
  const { laneId } = await ensureHarnessLane(seeded.address, { providerId: 'llama-server', model: served });

  const laneRows = async () => {
    const ids = (await ws.default.listSessions(laneId).catch(() => [])).map((s) => (typeof s === 'string' ? s : s.sessionId || s.id));
    return (await Promise.all(ids.filter(Boolean).map((id) => ws.default.readSession(laneId, id)))).flat();
  };
  const close = async () => {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { app, page, seeded, laneId, served, laneRows, close };
};

/** Enter the desk as HARNESS: the door, the wallet picker, the unlock — until the composer stands. */
export const enterHarnessDesk = async ({ page, seeded }) => {
  await page.locator('#portal-enter').waitFor({ state: 'visible', timeout: 30 * 1000 });
  await page.locator('.portal-enter-as-opt[data-mode="harness"]').click();
  await page.click('#portal-enter');
  const embedded = page.locator(`.wallet-picker-embedded[data-wallet-id="${seeded.id}"]`);
  const unlock = page.locator('#wp-submit');
  const composer = page.locator('.relink-input-field:not([disabled])').first();
  const deadline = Date.now() + 120 * 1000;
  while (Date.now() < deadline && !(await composer.isVisible().catch(() => false))) {
    if (await embedded.isVisible().catch(() => false)) await embedded.click({ force: true }).catch(() => {});
    else if (await unlock.isVisible().catch(() => false)) {
      const field = page.locator('#wp-password');
      if (await field.inputValue().catch(() => '') !== WALLET_PASSWORD) {
        await field.click({ force: true }).catch(() => {});
        await field.press('Control+a').catch(() => {});
        await field.pressSequentially(WALLET_PASSWORD, { delay: 15 }).catch(() => {});
      }
      if (await field.inputValue().catch(() => '') === WALLET_PASSWORD) { await unlock.click({ force: true }).catch(() => {}); await page.waitForTimeout(1200); }
    }
    await page.waitForTimeout(300);
  }
  await composer.waitFor({ state: 'visible', timeout: 30 * 1000 });
};

/** Size the window as a desk, so the desk's windows open (a small window is the phone layout, where they do not stand). */
export const widenDesk = async ({ app, page }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.setSize(1600, 1000)));
  await page.waitForTimeout(1500);
};

/** Send one message; resolve with the model's answer and every tool its turn called. */
export const askHarness = async ({ page, laneRows }, text, { timeout = 300 * 1000 } = {}) => {
  const answers = async () => (await laneRows()).filter((r) => r.role === 'assistant');
  const before = (await answers()).length;
  const field = page.locator('.relink-input-field').first();
  await field.fill(text);
  await field.press('Enter');
  await waitFor(`an answer to "${text}"`, async () => (await answers()).length > before, { timeout, every: 1000 });
  const row = (await answers()).at(-1);
  return { reply: String(row.content), tools: (row.tools || []).map((t) => String(t.tool || t.name || t.id || JSON.stringify(t))) };
};

/** The cell a live benchmark run is measuring, read from the runner's own command line — or null. */
export const liveRunCell = () => {
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let argv;
    try { argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { continue; }
    const at = argv.indexOf('run');
    if (at > 0 && argv[at - 1].endsWith('bench.mjs') && argv[at + 1]) return argv[at + 1];
  }
  return null;
};
