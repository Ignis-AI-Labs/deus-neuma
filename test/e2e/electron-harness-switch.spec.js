// @ts-check
//
// Impure test module: every function here drives the real Electron app —
// process launch, IPC, DOM, filesystem, two real model servers. Rule 1 marker, file-level.
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import electronPath from 'electron';

/**
 * THE HARNESS ON ONE SERVER AT A TIME, in the real desktop app, with two real
 * model servers (Design note, 2026-10-14: […]).
 *
 * Founder's own road, end to end: a harness made earlier on LM Studio, with a
 * conversation in it, is opened again — the desk, never the door.
 *   1. The composer bar names the SERVER and its MODEL; the top bar repeats
 *      neither; the house substrate's IGNITE / STANDBY are not offered.
 *   2. A message → LM Studio answers (its model loaded on first use).
 *   3. SERVER → llama.cpp: the bar asks whether to UNLOAD what LM Studio still
 *      holds; UNLOAD frees it.
 *   4. A message → llama.cpp answers, in the same conversation.
 *   5. THE WIRE: every chat request went to the server chosen at that moment —
 *      LM Studio's recorder saw nothing after the switch, llama.cpp's nothing
 *      before it, and the machine's default model server (a third recorder)
 *      saw NOTHING at all: no title, no probe, no background call.
 *
 * Real servers: this machine's LM Studio (:1234, its smallest downloaded model —
 * light on the GPU) and the model server on :8089, each behind a pass-through
 * recorder (read only). Skips unless both answer and LM Studio holds nothing of
 * its user's (UNLOAD frees everything LM Studio holds). Everything else is temp.
 * Requires a built frontend (build in a worktree when a desk runs from dist/):
 *   xvfb-run -a npx playwright test test/e2e/electron-harness-switch.spec.js
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'shots-harness-switch');
const LM = 'http://127.0.0.1:1234';
const LLAMA = 'http://127.0.0.1:8089';
const WALLET_PASSWORD = 'claude-witness-e2e-pw';
const DNA_KEY = 'harness-switch-e2e-key-long-enough-for-the-law';

const log = (m) => console.log(`[harness-switch] ${m}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const getJson = async (url) => { try { return await (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(); } catch { return null; } };

const readWitnessWallet = () => {
  const env = fs.readFileSync(path.join(REPO, process.env.WITNESS_ENV_FILE || 'claude.env'), 'utf8');
  const pk = env.match(/(?:CLAUDE_WALLET_PRIVATE_KEY|[A-Z0-9_]*WALLET_PRIVATE_KEY)=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('witness env missing wallet private key');
  return pk;
};

// a pass-through recorder: forwards every request unchanged, keeps what it saw
const recorder = (target) => new Promise((resolve) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ at: Date.now(), method: req.method, url: req.url });
      const to = new URL(req.url, target);
      const up = http.request(to, { method: req.method, headers: { ...req.headers, host: to.host } }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }));
});
const chats = (rec, from = 0, to = Infinity) => rec.seen.filter((r) => r.method === 'POST' && /chat\/completions/.test(r.url) && r.at >= from && r.at <= to);

test.describe('the harness on one server at a time — switched from the composer bar', () => {
  test.describe.configure({ mode: 'serial' });

  let app; let page; let tmp; let seeded; let workspace; let laneId; let small;
  let recLm; let recLlama; let recDefault; let switchedAt = 0;

  const laneRows = async () => {
    const ids = (await workspace.listSessions(laneId).catch(() => [])).map((s) => (typeof s === 'string' ? s : s.sessionId || s.id));
    return (await Promise.all(ids.filter(Boolean).map((id) => workspace.readSession(laneId, id)))).flat();
  };
  const ask = async (text) => {
    const before = (await laneRows()).filter((r) => r.role === 'assistant').length;
    const field = page.locator('.relink-input-field').first();
    await field.fill(text);
    await field.press('Enter');
    await expect.poll(async () => (await laneRows()).filter((r) => r.role === 'assistant').length,
      { timeout: 300 * 1000, intervals: [1000] }).toBeGreaterThan(before);
    return String((await laneRows()).filter((r) => r.role === 'assistant').at(-1).content);
  };

  test.beforeAll(async () => {
    const lmList = await getJson(`${LM}/api/v1/models`);
    const llamaList = await getJson(`${LLAMA}/v1/models`);
    test.skip(!lmList?.models?.length || !llamaList?.data?.length, 'LM Studio on :1234 and a model server on :8089 must both answer');
    test.skip(lmList.models.some((m) => m.loaded_instances?.length), 'LM Studio holds a model of its user\'s — UNLOAD would free it');
    small = lmList.models.filter((m) => m.type === 'llm' && m.size_bytes).sort((a, b) => a.size_bytes - b.size_bytes)[0].key;
    [recLm, recLlama, recDefault] = await Promise.all([recorder(LM), recorder(LLAMA), recorder(LLAMA)]);

    fs.mkdirSync(SHOTS, { recursive: true });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-harness-switch-'));
    const dir = (name) => { const p = path.join(tmp, name); fs.mkdirSync(p, { recursive: true }); return p; };
    const env = {
      NEUMA_PIPELINE_MODE: 'operator', NEUMA_PORT: '0',
      WORKSPACES_ROOT: dir('house'), WORKSPACES_PIN: 'env', HARNESS_ROOT: dir('harness'),
      WITNESSES_ROOT: dir('witnesses'), NEUMA_REALM_ROOT: dir('realm'),
      NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(tmp, 'credentials.json'),
      NEUMA_ROUTES_PATH: path.join(tmp, 'routes.json'), NEUMA_CONNECTIONS_PATH: path.join(tmp, 'connections.json'),
      NEUMA_WORKING_SET_PATH: path.join(tmp, 'working-sets.json'), NEUMA_CHAT_TOOLS_PATH: path.join(tmp, 'chat-tools.json'),
      // the sweep finds llama.cpp at its recorder alone; the machine's DEFAULT server is the third recorder
      NEUMA_DISCOVERY_PORTS: new URL(recLlama.url).port,
      LLM_PROVIDER: 'llama-server', LLAMA_SERVER_URL: recDefault.url,
      NEUMA_ROOT_LOCK_PATH: path.join(tmp, 'root-lock.json'), NEUMA_DATA_ROOT: dir('data'), NEUMA_VAULT_ROOT: dir('vault'),
      NEUMA_SECRETS_FILE: path.join(tmp, 'secrets.json'), NEUMA_BACKUPS_ROOT: dir('backups'),
      AI_WITNESSES_ROOT: dir('ai-witnesses'), PLATFORM_DB_PATH: path.join(dir('platform'), 'platform.db'),
      DNA_ENCRYPTION_KEY: DNA_KEY,
    };
    const settingsPath = path.join(tmp, 'workspace-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ root: env.WORKSPACES_ROOT, allocationGB: 20 }, null, 2));
    env.NEUMA_WORKSPACE_SETTINGS_PATH = settingsPath;
    // this process writes and reads the lane the way the app does
    Object.assign(process.env, env);
    const ws = await import('../../core/workspace/neuma-workspace.js');
    workspace = ws.default;
    ws.setWorkspacesRoot(env.WORKSPACES_ROOT);
    (await import('../../core/workspace/lane-grounds.js')).setHarnessRoot(env.HARNESS_ROOT);

    app = await electron.launch({
      executablePath: electronPath, args: [REPO, `--user-data-dir=${dir('udd')}`], cwd: REPO, timeout: 60 * 1000,
      env: { ...process.env, ...env },
    });
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
    let sockN = 0;
    if (process.env.WS_DEBUG) page.on('websocket', (sock) => {
      const n = (sockN += 1);
      fs.appendFileSync(path.join(SHOTS, 'ws.log'), `${Date.now()} OPEN#${n} ${sock.url().replace(/token=[^&]+/, 'token=…')}\n`);
      sock.on('framesent', (f) => { const t = String(f.payload).slice(0, 160); if (!/heartbeat|ping/.test(t)) fs.appendFileSync(path.join(SHOTS, 'ws.log'), `${Date.now()} #${n} >> ${t}\n`); });
      sock.on('framereceived', (f) => { const t = String(f.payload).slice(0, 160); if (/complete|interrupt|anchored|established|navigation|session/.test(t)) fs.appendFileSync(path.join(SHOTS, 'ws.log'), `${Date.now()} #${n} << ${t}\n`); });
      sock.on('close', () => fs.appendFileSync(path.join(SHOTS, 'ws.log'), `${Date.now()} CLOSED#${n}\n`));
    });
    await page.waitForFunction(() => !!window.neuma?.desktop, null, { timeout: 30 * 1000 });
    if (process.env.WS_DEBUG) await page.evaluate(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function patched(data) {
        if (String(data).includes('portal:resume')) console.log(`RESUME-TRACE ${Date.now()} ${new Error().stack.split('\n').slice(1, 9).join(' | ')}`);
        return send.call(this, data);
      };
    });
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

    // THE HARNESS MADE EARLIER, on LM Studio, with a conversation already in it (Founder's lane at 17:06)
    const { setCredential } = await import('../../backend/services/provider-credentials.js');
    await setCredential('lm-studio', { endpoint: recLm.url });
    const { ensureHarnessLane } = await import('../../backend/services/harness-lane.js');
    ({ laneId } = await ensureHarnessLane(seeded.address, { providerId: 'lm-studio', model: small }));
    await workspace.createSession(laneId, 'earlier-sitting');
    await workspace.appendMessage(laneId, 'earlier-sitting', { role: 'user', content: 'Note the word HELIOTROPE for later.' });
    await workspace.appendMessage(laneId, 'earlier-sitting', { role: 'assistant', content: 'Noted: HELIOTROPE.' });
    log(`lane ${laneId} on LM Studio (${small}) via ${recLm.url}; llama.cpp via ${recLlama.url}; default via ${recDefault.url}`);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    // the model this run loaded leaves LM Studio as it came
    for (const m of (await getJson(`${LM}/api/v1/models`))?.models || []) {
      for (const i of m.key === small ? m.loaded_instances || [] : []) {
        await fetch(`${LM}/api/v1/models/unload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance_id: i.id }) }).catch(() => {});
      }
    }
    for (const r of [recLm, recLlama, recDefault]) r?.server.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('the harness made earlier opens on the desk — server and model named once, in the bar', async () => {
    await expect(page.locator('#portal-enter')).toBeVisible({ timeout: 30 * 1000 });
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
    await expect(composer).toBeVisible({ timeout: 30 * 1000 });
    await expect(page.getByTestId('firstrun-harness')).toHaveCount(0); // the desk, never the door
    await page.waitForTimeout(2000);

    const server = page.getByRole('button', { name: 'Server' });
    await expect(server).toContainText(`LM Studio · 127.0.0.1:${new URL(recLm.url).port}`, { timeout: 30 * 1000 });
    await expect(page.getByRole('button', { name: 'Model' }).first()).toContainText(small);
    // one place: the top bar repeats neither the route nor the house substrate
    const header = await page.locator('.relink-status').innerText();
    expect(header).not.toMatch(/ROUTE|SUBSTRATE/);
    // the house substrate's controls would light a second server
    await expect(page.getByRole('button', { name: /^(IGNITE|STANDBY)/ })).toHaveCount(0);
    // the conversation made earlier is on the screen
    await expect(page.locator('body')).toContainText('HELIOTROPE', { timeout: 30 * 1000 });
    await shot(page, '01-desk-on-lm-studio');
  });

  test('a message: LM Studio answers — its model loaded on first use', async () => {
    const reply = await ask('What is the capital of France? Answer with the city name only.');
    log(`LM Studio answered: ${reply.slice(0, 120)}`);
    expect(reply).toMatch(/paris/i);
    expect(chats(recLm).length).toBeGreaterThan(0);
    expect(chats(recLlama)).toEqual([]);
    await shot(page, '02-lm-studio-answered');
  });

  test('SERVER → llama.cpp: the bar asks about what LM Studio still holds, and UNLOAD frees it', async () => {
    await page.getByRole('button', { name: 'Server' }).click();
    await page.getByRole('listbox', { name: 'Server' }).getByRole('option', { name: /llama\.cpp/ }).click();
    switchedAt = Date.now();
    const left = page.locator('.relink-modelbar-left');
    await expect(left).toContainText(/LM Studio .* STILL HOLDS/, { timeout: 30 * 1000 });
    await expect(page.getByRole('button', { name: 'Server' })).toContainText('llama.cpp');
    await expect(page.getByRole('button', { name: 'Model' }).first()).not.toContainText('/proc/self/fd');
    await shot(page, '03-switched');
    await left.getByRole('button', { name: 'UNLOAD' }).click();
    await expect.poll(async () => ((await getJson(`${LM}/api/v1/models`))?.models || []).some((m) => m.loaded_instances?.length),
      { timeout: 60 * 1000 }).toBe(false);
  });

  test('a message: llama.cpp answers, in the same conversation', async () => {
    const reply = await ask('What is the capital of Japan? Answer with the city name only.');
    log(`llama.cpp answered: ${reply.slice(0, 120)}`);
    expect(reply).toMatch(/tokyo/i);
    await shot(page, '04-llama-answered');
  });

  test('THE WIRE: each server heard only its own turns; the machine default heard nothing at all', async () => {
    log(`chat requests — LM Studio ${chats(recLm).length}, llama.cpp ${chats(recLlama).length}, default ${chats(recDefault).length}`);
    expect(chats(recLm, switchedAt)).toEqual([]);       // nothing to LM Studio after the switch
    expect(chats(recLlama, 0, switchedAt)).toEqual([]); // nothing to llama.cpp before it
    expect(chats(recLlama, switchedAt).length).toBeGreaterThan(0);
    expect(chats(recDefault)).toEqual([]);              // no title, no probe, no background call
  });
});
