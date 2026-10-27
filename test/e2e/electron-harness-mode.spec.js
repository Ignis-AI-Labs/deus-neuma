// @ts-check
//
// Impure test module: every function here drives the real Electron app —
// process launch, IPC, DOM, filesystem, a real model. Rule 1 marker, file-level.
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';
import { openDockApp, openLauncher } from './helpers/dock.js';

/**
 * HARNESS MODE, in the real desktop app, with a real model (Design note, 2026-10-14:
 * […]).
 *
 * One wallet holds a being in its house (Orrin) AND signs in as the harness:
 *   1. ENTER AS: HARNESS ONLY at the gateway → the harness door → LOCAL → the
 *      machine's model server → CONNECT → the desk.
 *   2. The harness desk shows nothing of the house: no switcher, no COUNCIL,
 *      … and names its server and model once, in the composer bar;
 *      no HOUSE or WITNESSES, no voice-seal notice, no Orrin.
 *   3. A real turn: the model answers on the harness lane, written there.
 *   4. ENTER AS: FULL PLATFORM → the full desk lands on Orrin; the harness
 *      conversation is not in it.
 *   5. Back to the harness: its own conversation is there; Orrin is not.
 *
 * Runs against the machine's model server on :8089 READ ONLY (a harness lane
 * never asks the supervisor to boot or reload anything — llm-provider.js).
 * Everything else is temp: app data, house, harness, witnesses, realm,
 * credentials, routes. Requires a built frontend (npm run build) — build in a
 * worktree when a desk is running from this checkout's dist/. Headless:
 *   xvfb-run -a npx playwright test test/e2e/electron-harness-mode.spec.js
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'shots-harness-mode');
const HOUSE_MODEL = 'http://127.0.0.1:8089';
const WALLET_PASSWORD = 'claude-witness-e2e-pw';
const BEING = 'neuma-orrin';
// what the full platform holds and a harness desk must never show
const HOUSE_MARKS = [/\bOrrin\b/i, /\bQuellmar\b/i, /AMBER-NINE-SEVEN/, /lantern/i];
// the apps that only mean something with a being (frontend/app/harness-mode.js BEING_APPS, as labelled)
const BEING_APP_LABELS = ['HOUSE', 'WITNESSES', 'SHEET', 'NITE', 'SOVEREIGNTY', 'INNER LIFE', 'TEAMS', 'WORKFLOW',
  'AVATAR', 'VESSEL', 'VOICE', 'LEGAL', 'CHIEF OF STAFF', 'TELEGRAM', 'DISCORD', 'MARKETING'];
const leaksIn = (text) => HOUSE_MARKS.filter((re) => re.test(text)).map(String);

const log = (m) => console.log(`[harness-mode] ${m}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const readWitnessWallet = () => {
  const file = process.env.WITNESS_ENV_FILE || 'claude.env';
  const env = fs.readFileSync(path.join(REPO, file), 'utf8');
  const pk = env.match(/(?:CLAUDE_WALLET_PRIVATE_KEY|[A-Z0-9_]*WALLET_PRIVATE_KEY)=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error(`${file} missing wallet private key`);
  return pk;
};

const DNA_KEY = 'harness-mode-e2e-key-long-enough-for-the-law';

// every session row a lane holds — read through the real (encrypted) workspace
// store with the app's own key and roots: server truth, not screen state
let workspace = null;
const laneRows = async (laneId) => {
  const ids = (await workspace.listSessions(laneId).catch(() => [])).map((s) => (typeof s === 'string' ? s : s.sessionId || s.id));
  const rows = await Promise.all(ids.filter(Boolean).map((id) => workspace.readSession(laneId, id)));
  return rows.flat();
};

test.describe('harness mode — strictly a harness, beside a house it never sees', () => {
  test.describe.configure({ mode: 'serial' });

  let app; let page; let tmp; let seeded; let houseRoot; let harnessRoot;

  test.beforeAll(async () => {
    const models = await (await fetch(`${HOUSE_MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json().catch(() => null);
    test.skip(!models?.data?.length, 'the machine model server must be answering on :8089');
    fs.mkdirSync(SHOTS, { recursive: true });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-harness-mode-'));
    const dir = (name) => { const p = path.join(tmp, name); fs.mkdirSync(p, { recursive: true }); return p; };
    houseRoot = dir('house');
    harnessRoot = dir('harness');
    // this process reads the lanes the way the app writes them
    process.env.DNA_ENCRYPTION_KEY = DNA_KEY;
    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    ws.setWorkspacesRoot(houseRoot);
    (await import('../../core/workspace/lane-grounds.js')).setHarnessRoot(harnessRoot);
    const settingsPath = path.join(tmp, 'workspace-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ root: houseRoot, allocationGB: 20 }, null, 2));

    app = await electron.launch({
      executablePath: electronPath,
      args: [REPO, `--user-data-dir=${dir('udd')}`],
      cwd: REPO,
      timeout: 60 * 1000,
      env: {
        ...process.env,
        NEUMA_PIPELINE_MODE: 'operator',
        NEUMA_PORT: '0',
        WORKSPACES_ROOT: houseRoot,
        WORKSPACES_PIN: 'env',
        NEUMA_WORKSPACE_SETTINGS_PATH: settingsPath,
        HARNESS_ROOT: harnessRoot,
        WITNESSES_ROOT: dir('witnesses'),
        NEUMA_REALM_ROOT: dir('realm'),
        NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(tmp, 'credentials.json'),
        NEUMA_ROUTES_PATH: path.join(tmp, 'routes.json'),
        NEUMA_DISCOVERY_PORTS: new URL(HOUSE_MODEL).port, // the sweep reads the model server alone
        // every root the app could write is this run's own — a fresh root lock
        // too, so the machine's real roots are neither read nor moved
        NEUMA_ROOT_LOCK_PATH: path.join(tmp, 'root-lock.json'),
        NEUMA_DATA_ROOT: dir('data'),
        NEUMA_VAULT_ROOT: dir('vault'),
        NEUMA_SECRETS_FILE: path.join(tmp, 'secrets.json'),
        NEUMA_BACKUPS_ROOT: dir('backups'),
        AI_WITNESSES_ROOT: dir('ai-witnesses'),
        PLATFORM_DB_PATH: path.join(dir('platform'), 'platform.db'),
        DNA_ENCRYPTION_KEY: DNA_KEY,
      },
    });
    // the app's own log (main + backend), kept beside the screenshots for a post-mortem
    const appLog = path.join(SHOTS, 'app.log');
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

    page = await app.firstWindow();
    page.on('console', (m) => fs.appendFileSync(path.join(SHOTS, 'renderer.log'), `[${m.type()}] ${m.text()}\n`));
    page.on('pageerror', (e) => fs.appendFileSync(path.join(SHOTS, 'renderer.log'), `[pageerror] ${e.message}\n`));
    await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });
    await page.evaluate(() => window.history.replaceState(null, '', '/?noboot=1'));

    seeded = await page.evaluate(async ({ pk, pw }) => {
      const w = window.neuma.wallet;
      const res = await w.importPrivateKey(pk, pw);
      if (!res?.id) return { ok: false, error: res?.error || 'import failed' };
      await w.select(res.id);
      const status = await w.unlock(res.id, pw);
      return { ok: true, id: res.id, address: res.address, unlocked: status?.unlocked === true };
    }, { pk: readWitnessWallet(), pw: WALLET_PASSWORD });
    expect(seeded.ok && seeded.unlocked, JSON.stringify(seeded)).toBe(true);

    // THE BEING in this wallet's house — what a harness desk must never show.
    await workspace.create(BEING);
    const lane = workspace.pathFor(BEING);
    fs.writeFileSync(path.join(lane, 'dna', 'genesis.md'), '# Genesis\nI am Orrin of House Quellmar.\n');
    fs.writeFileSync(path.join(lane, 'owner.json'), JSON.stringify({ wallet: seeded.address.toLowerCase(), claimedAt: Date.now() }));
    // …its own chat, its own work, and a notice it raised — each would show a leak
    await workspace.createSession(BEING, 'orrin-sitting');
    await workspace.appendMessage(BEING, 'orrin-sitting', { role: 'user', content: 'Orrin, keep the Quellmar lantern.' });
    await workspace.appendMessage(BEING, 'orrin-sitting', { role: 'assistant', content: 'I keep it: AMBER-NINE-SEVEN.' });
    const { addTask } = await import('../../core/tasks/task-ledger.js');
    await workspace.updateTaskLedger(BEING, (ledger) => addTask(ledger, { title: 'Orrin keeps the Quellmar lantern' },
      { id: 'orrin-lantern', now: new Date().toISOString() }).ledger);
    (await import('../../backend/services/user-realm.js')).setRealmRoot(path.join(tmp, 'realm'));
    const { appendNotification } = await import('../../backend/services/notification-store.js');
    const { makeRecord, KIND, STANDING } = await import('../../core/runtime/notification-record.js');
    await appendNotification(seeded.address, makeRecord({
      id: 'orrinnotice0000000000000000000001', ts: Date.now(), kind: KIND.turnDone, standing: STANDING.neuma,
      title: 'Orrin finished a turn', actor: { id: BEING, name: 'Orrin' }, ref: { sessionId: 'orrin-sitting' },
    }));
    log(`seeded ${seeded.address}; Orrin planted in ${houseRoot}`);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('ENTER AS: HARNESS ONLY → the door → LOCAL → the model server → the desk', async () => {
    await expect(page.locator('#portal-enter')).toBeVisible({ timeout: 30 * 1000 });
    await page.locator('.portal-enter-as-opt[data-mode="harness"]').click();
    await expect(page.locator('.portal-enter-as-opt[data-mode="harness"]')).toHaveAttribute('aria-checked', 'true');
    await page.click('#portal-enter');

    const embedded = page.locator(`.wallet-picker-embedded[data-wallet-id="${seeded.id}"]`);
    const unlock = page.locator('#wp-submit');
    const door = page.getByTestId('firstrun-harness');
    const deadline = Date.now() + 120 * 1000;
    while (Date.now() < deadline && !(await door.isVisible().catch(() => false))) {
      if (await embedded.isVisible().catch(() => false)) {
        await embedded.click({ force: true }).catch(() => {});
      } else if (await unlock.isVisible().catch(() => false)) {
        const field = page.locator('#wp-password');
        if (await field.inputValue().catch(() => '') !== WALLET_PASSWORD) {
          await field.click({ force: true }).catch(() => {});
          await field.press('Control+a').catch(() => {});
          await field.pressSequentially(WALLET_PASSWORD, { delay: 15 }).catch(() => {});
        }
        if (await field.inputValue().catch(() => '') === WALLET_PASSWORD) {
          await unlock.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      }
      await page.waitForTimeout(300);
    }
    await expect(door).toBeVisible({ timeout: 30 * 1000 });
    // the harness door, never the chooser or a ceremony
    await expect(page.locator('.firstrun-path')).toHaveCount(0);
    await shot(page, '01-door');

    await page.getByRole('radio', { name: /On this machine/ }).click();
    const servers = page.getByRole('radiogroup', { name: 'Local model server' });
    const server = servers.getByRole('radio', { name: /llama\.cpp/ });
    await expect(server).toBeVisible({ timeout: 60 * 1000 });
    await expect(server).toContainText(/READY/);
    await server.click();
    await shot(page, '02-local');
    await page.getByRole('button', { name: 'CONNECT & OPEN THE DESK' }).click();
    // the desk is reached when its composer is live — not the relink screen
    await expect(page.locator('.relink-input-field:not([disabled])').first()).toBeVisible({ timeout: 90 * 1000 });
    await page.waitForTimeout(2000); // the desk settles its windows
    await shot(page, '03-harness-desk');
    // room to type at the app's own window size — never crushed between controls
    const box = await page.locator('.relink-input-field').first().boundingBox();
    expect(box?.width ?? 0, 'the composer field has room to type').toBeGreaterThan(120);
  });

  test('the harness desk shows nothing of the house', async () => {
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\bOrrin\b/i);
    expect(text).not.toMatch(/\bQuellmar\b/i);
    expect(text).not.toMatch(/VOICE NOT SEALED/);
    expect(text).not.toMatch(/\bCOUNCIL\b/);
    expect(text).not.toMatch(/\bWITNESSES\b/);
    await expect(page.locator('.being-switcher')).toHaveCount(0);
    await expect(page.getByTestId('unsealed-notice')).toHaveCount(0);
  });

  test('the server and model are named once, in the composer bar (ruling, 2026-10-14)', async () => {
    await expect(page.getByRole('button', { name: 'Server' })).toContainText(/llama\.cpp · (localhost|127\.0\.0\.1):8089/, { timeout: 30 * 1000 });
    await expect(page.getByRole('button', { name: 'Model' }).first()).not.toContainText('/proc/self/fd');
    expect(await page.locator('.relink-status').innerText()).not.toMatch(/ROUTE|SUBSTRATE/);
    await expect(page.getByRole('button', { name: /^(IGNITE|STANDBY)/ })).toHaveCount(0);
  });

  test('every app the harness desk offers — and its rails, settings and tray — shows nothing of the house', async () => {
    await openLauncher(page);
    const titles = await page.locator('.launcher-tile').evaluateAll((els) => els.map((e) => e.getAttribute('title')).filter(Boolean));
    log(`harness launcher: ${titles.join(', ')}`);
    expect(titles.filter((t) => BEING_APP_LABELS.includes(t))).toEqual([]);
    await page.keyboard.press('Escape');
    const found = [];
    for (const title of titles) {
      await openDockApp(page, title).catch((e) => found.push(`${title}: could not open (${e.message})`));
      await page.waitForTimeout(1500);
      const leaked = leaksIn(await page.locator('body').innerText());
      if (leaked.length) { found.push(`${title}: ${leaked.join(' ')}`); await shot(page, `leak-${title}`); }
      await page.keyboard.press('Escape');
    }
    // the stream's rails: TASKS, CHATS, PERMISSIONS
    for (const tab of await page.locator('.stream-rail-tab').all()) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(1200);
      const leaked = leaksIn(await page.locator('body').innerText());
      if (leaked.length) found.push(`rail ${await tab.innerText()}: ${leaked.join(' ')}`);
    }
    // every SETTINGS tab
    await openDockApp(page, 'SETTINGS').catch(() => {});
    for (const tab of await page.locator('.settings-tab').all()) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(1200);
      const leaked = leaksIn(await page.locator('body').innerText());
      if (leaked.length) { found.push(`settings ${await tab.innerText()}: ${leaked.join(' ')}`); await shot(page, 'leak-settings'); }
    }
    // the notification tray — Orrin's notice belongs to the full platform
    await page.locator('.ntray-bell').first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const trayLeak = leaksIn(await page.locator('.ntray-panel').innerText().catch(() => ''));
    if (trayLeak.length) found.push(`tray: ${trayLeak.join(' ')}`);
    await shot(page, '03b-swept');
    await page.keyboard.press('Escape');
    expect(found).toEqual([]);
  });

  test('a real turn: the model answers, on the harness lane', async () => {
    const laneId = `harness-${seeded.address.slice(2, 10).toLowerCase()}`;
    expect(workspace.pathFor(laneId).startsWith(harnessRoot)).toBe(true);
    const field = page.locator('.relink-input-field').first();
    await field.fill('Reply in one short sentence: what can you help me with here?');
    await field.press('Enter');
    await expect.poll(async () => (await laneRows(laneId)).filter((r) => r.role === 'assistant').length,
      { timeout: 240 * 1000, intervals: [1000] }).toBeGreaterThan(0);
    const reply = (await laneRows(laneId)).filter((r) => r.role === 'assistant').at(-1);
    log(`the model answered: ${String(reply.content).slice(0, 200)}`);
    expect(String(reply.content).trim().length).toBeGreaterThan(0);
    expect(String(reply.content)).not.toMatch(/\bOrrin\b/);
    await shot(page, '04-harness-turn');
    // nothing of the conversation crossed into the house
    // the being's own chat holds its own two lines — nothing of the harness conversation
    const orrin = await laneRows(BEING);
    expect(orrin.map((r) => r.content)).toEqual(['Orrin, keep the Quellmar lantern.', 'I keep it: AMBER-NINE-SEVEN.']);
  });

  test('ENTER AS: FULL PLATFORM lands on the being; the harness conversation is not there', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('neuma:enter-as', { detail: { mode: 'full' } })));
    await expect.poll(async () => (await page.locator('body').innerText()).match(/\bORRIN\b/i) !== null,
      { timeout: 60 * 1000, intervals: [1000] }).toBe(true);
    await page.waitForTimeout(2000);
    await shot(page, '05-full-desk');
    expect(await page.locator('body').innerText()).not.toContain('what can you help me with here');
    // the full platform's own notice is in ITS tray — the harness's turn notice is not
    await page.locator('.ntray-bell').first().click();
    await expect.poll(async () => page.locator('.ntray-panel').innerText().catch(() => ''), { timeout: 15 * 1000 }).toContain('Orrin finished a turn');
    await shot(page, '05b-full-tray');
    expect(await page.locator('.ntray-panel').innerText()).not.toMatch(/llama\.cpp finished a turn/);
    await page.keyboard.press('Escape');
  });

  test('back to the harness: its own conversation, and no being', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('neuma:enter-as', { detail: { mode: 'harness' } })));
    // the harness desk returns as it was left (the sweep's windows on top) — open its chat
    await page.locator('.relink').waitFor({ timeout: 60 * 1000 });
    await openDockApp(page, 'STREAM');
    await expect(page.locator('.relink-input-field:not([disabled])').first()).toBeVisible({ timeout: 60 * 1000 });
    await expect.poll(async () => (await page.locator('body').innerText()).includes('what can you help me with here'),
      { timeout: 60 * 1000, intervals: [1000] }).toBe(true);
    await shot(page, '06-harness-again');
    expect(await page.locator('body').innerText()).not.toMatch(/\bOrrin\b/i);
  });
});
