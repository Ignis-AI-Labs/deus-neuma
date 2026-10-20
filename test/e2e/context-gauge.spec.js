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
 * End-to-end CTX STRIP — the composer's context readout, driven for real: a
 * real browser sends a real thought through the real backend to the real
 * local model, and the strip above the composer must light up with the
 * measured percentage on the ring and the used/total label. No mock
 * anywhere on a claimed path (RULE 0).
 *
 * Skipped honestly when no model is loaded on the local substrate (the
 * live-test doctrine — load one first, e.g. `lms load google/gemma-3-4b`).
 *
 * SAFETY LAW: NEVER a live witness stack — own backend+vite on PID-derived
 * bind-probed ports, disposable temp roots, recorded-PID teardown.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const FPORT_BASE = 8181 + (process.pid % 149);
const BPORT_BASE = 4181 + (process.pid % 149);
let FPORT;
let BPORT;
let BASE;
const NEUMA_ID = 'e2e-ctxgauge';

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

const witnessEnvPath = process.env.NEUMA_WITNESS_ENV
  ? path.resolve(process.env.NEUMA_WITNESS_ENV)
  : null;

const readWitnessWallet = () => {
  const env = fs.readFileSync(witnessEnvPath, 'utf8');
  const pk = env.match(/^[A-Z0-9_]*WITNESS_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];
  if (!pk) throw new Error(`${witnessEnvPath} has no witness private key`);
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readWitnessWallet());
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
let liveModel = null;
let liveProvider = null;

test.beforeAll(async () => {
  // The substrate gate: no loaded model or no calling witness, no live proof.
  // Probe both local wires the app supports; this machine normally serves the
  // supervised llama-server, while developer laptops may use LM Studio.
  const candidates = [
    { provider: 'llama-server', endpoint: 'http://127.0.0.1:8089' },
    { provider: 'lm-studio', endpoint: 'http://127.0.0.1:1234' },
  ];
  for (const candidate of candidates) {
    const probe = await fetch(`${candidate.endpoint}/v1/models`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const model = probe?.data?.[0]?.id || null;
    if (model) {
      liveModel = model;
      liveProvider = candidate;
      break;
    }
  }
  if (!liveModel || !witnessEnvPath) return;

  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ctxgauge-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    LLM_PROVIDER: liveProvider.provider,
    LLM_MODEL: liveModel,
    ...(liveProvider.provider === 'llama-server'
      ? { LLAMA_SERVER_URL: liveProvider.endpoint }
      : { LM_STUDIO_URL: liveProvider.endpoint }),
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

test('a real turn streams smoothly and reports measured context used and left', async ({ page }) => {
  test.skip(!witnessEnvPath, 'set NEUMA_WITNESS_ENV to the calling sealed witness');
  test.skip(!liveModel, 'no model loaded on llama-server or LM Studio — load one to run this live proof');

  const crashes = [];
  const wireFrames = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const recordFrame = (direction) => ({ response }) => {
    try {
      wireFrames.push({ direction, frame: JSON.parse(response.payloadData) });
    } catch { /* WebSocket control/non-JSON frame */ }
  };
  cdp.on('Network.webSocketFrameSent', recordFrame('sent'));
  cdp.on('Network.webSocketFrameReceived', recordFrame('received'));
  page.on('pageerror', (e) => crashes.push(e.message));
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible().catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }

  // No strip before the first turn — nothing honest to show yet.
  await expect(page.locator('.ctx-strip')).toHaveCount(0);

  // Observe the real DOM commits. The live counterpart row must stay on the
  // cheap plain-text renderer while it grows, then become Markdown exactly
  // once after settlement.
  await page.evaluate(() => {
    window.__streamRenderProbe = {
      livePlain: false,
      settledMarkdown: false,
      mutations: 0,
      longestTaskMs: 0,
    };
    const stream = document.querySelector('.relink-stream');
    const observer = new MutationObserver(() => {
      const probe = window.__streamRenderProbe;
      if (stream.querySelector('.relink-msg--neuma.is-streaming .relink-md--verbatim')) {
        probe.livePlain = true;
        probe.mutations += 1;
      }
      if (stream.querySelector('.relink-msg--neuma:not(.is-streaming) .relink-md:not(.relink-md--verbatim)')) {
        probe.settledMarkdown = true;
      }
    });
    observer.observe(stream, { childList: true, characterData: true, subtree: true });
    window.__streamRenderObserver = observer;
    const taskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__streamRenderProbe.longestTaskMs = Math.max(
          window.__streamRenderProbe.longestTaskMs,
          entry.duration,
        );
      }
    });
    taskObserver.observe({ type: 'longtask' });
    window.__streamTaskObserver = taskObserver;
  });

  const input = page.locator('.relink-input-field');
  const firstPrompt = 'Write three short paragraphs about clear thinking. Use a bold heading.';
  await input.fill(firstPrompt);
  await input.press('Enter');

  // The turn completes → emission 2 lands → the strip lights. A real model
  // turn can take a while; the strip IS the turn-end signal here.
  const strip = page.locator('.ctx-strip');
  await expect(strip).toBeVisible({ timeout: 180000 });
  await expect(strip.locator('.ctx-strip-label')).toContainText(/CTX ≈?[\d.]+[KMB]? \/ ≈?[\d.]+[KMB]?/);
  await expect.poll(() => strip.getAttribute('title'), { timeout: 180000 })
    .toMatch(/total \(measured usage/);
  // The ring carries the percentage; a fresh session keeps compaction OFF the
  // strip — the hover states the distance and the count.
  await expect(strip.locator('.ctx-strip-session')).toHaveCount(0);
  const title = await strip.getAttribute('title');
  expect(title).toMatch(/\d[\d,]* used · \d[\d,]* left · \d[\d,]* total \((measured|estimated) usage · limit per [\w.-]+\)/);
  // FACTS ONLY (ruling, 2026-08-15): the hover states the exact mechanic —
  // never a message-count prediction of when compaction lands.
  expect(title).toContain('self-compaction arms at 80% of the window');
  expect(title).toContain('self-compacted 0×');
  expect(title).not.toMatch(/message/i);
  await expect(strip.locator('.ctx-ring-fill')).toBeVisible();
  await expect(strip.locator('.ctx-strip-pct')).toHaveText(/^\d{1,3}%$/);
  const dash = await strip.locator('.ctx-ring-fill').getAttribute('stroke-dasharray');
  expect(parseFloat(dash)).toBeGreaterThan(0);

  const renderProbe = await page.evaluate(() => {
    window.__streamRenderObserver?.disconnect();
    window.__streamTaskObserver?.disconnect();
    return window.__streamRenderProbe;
  });
  expect(renderProbe.livePlain).toBe(true);
  expect(renderProbe.settledMarkdown).toBe(true);
  expect(renderProbe.mutations).toBeGreaterThan(2);
  expect(renderProbe.longestTaskMs).toBeLessThan(100);

  // The full readout is keyboard reachable, and a narrow desk truncates its
  // visible labels rather than widening the conversation window.
  await strip.focus();
  await expect(strip).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => strip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  // A fresh chat immediately clears the prior session's anatomy.
  await page.locator('.relink-snd', { hasText: 'NEW CHAT' }).click();
  await expect(strip).toHaveCount(0);

  // Navigate AGAIN during a real in-flight turn. The backend must abort and
  // settle that old turn before acknowledging the reset; the client must
  // suppress every pre-ack frame. A thought sent from the cleared composer is
  // queued behind that acknowledgement and must mint the next session.
  const interruptedPrompt = 'Write twenty numbered sentences about deliberate attention.';
  await input.fill(interruptedPrompt);
  await input.press('Enter');
  const interruptedMessage = page.locator('.relink-msg--neuma.is-streaming');
  await expect(interruptedMessage).toBeVisible({ timeout: 180000 });
  await expect.poll(() => interruptedMessage.textContent()).toMatch(/\S{5}/);
  const interruptedPrefix = await interruptedMessage.textContent();
  await page.evaluate((oldPrefix) => {
    window.__navigationMutationProbe = { active: false, staleOldMessage: false };
    const stream = document.querySelector('.relink-stream');
    const observer = new MutationObserver(() => {
      if (!window.__navigationMutationProbe.active) return;
      const stale = [...stream.querySelectorAll('.relink-msg--neuma')]
        .some((entry) => entry.textContent.includes(oldPrefix));
      if (stale) window.__navigationMutationProbe.staleOldMessage = true;
    });
    observer.observe(stream, { childList: true, characterData: true, subtree: true });
    window.__navigationMutationObserver = observer;
  }, interruptedPrefix);

  const postNavigationPrompt = 'Reply with one short sentence about patient focus.';
  const wireMark = wireFrames.length;
  // One browser task: NEW CHAT emits the reset frame, React commits the cleared
  // stream, then the real textarea emits the next thought. No inbound socket
  // event can interleave this task, so the thought is genuinely on the wire
  // before the server's reset acknowledgement.
  await page.evaluate((prompt) => {
    const button = [...document.querySelectorAll('.relink-snd')]
      .find((entry) => entry.textContent.trim() === 'NEW CHAT');
    if (!button) throw new Error('NEW CHAT control not found');
    window.__navigationMutationProbe.active = true;
    button.click();
    const field = document.querySelector('.relink-input-field');
    if (!field) throw new Error('stream composer not found after NEW CHAT');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setValue.call(field, prompt);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
  }, postNavigationPrompt);
  await expect(strip).toBeVisible({ timeout: 180000 });
  await expect(strip.locator('.ctx-strip-label')).toContainText(/CTX ≈?[\d.]+[KMB]? \/ ≈?[\d.]+[KMB]?/);
  await expect.poll(() => strip.getAttribute('title'), { timeout: 180000 })
    .toMatch(/total \(measured usage/);
  await expect(page.locator('.relink-msg--user')).toHaveCount(1);
  await expect(page.locator('.relink-msg--user')).toContainText(postNavigationPrompt);
  await expect(page.locator('.relink-msg--neuma')).toHaveCount(1);
  await expect(page.getByText(interruptedPrompt, { exact: true })).toHaveCount(0);
  await expect(page.locator('.relink-msg.is-streaming')).toHaveCount(0);

  const navigationWire = wireFrames.slice(wireMark);
  const resetSent = navigationWire.findIndex(({ direction, frame }) =>
    direction === 'sent' && frame.type === 'portal:new-session');
  const thoughtSent = navigationWire.findIndex(({ direction, frame }) =>
    direction === 'sent' && frame.type === 'consciousness:stream'
      && frame.thought === postNavigationPrompt);
  const resetReceived = navigationWire.findIndex(({ direction, frame }) =>
    direction === 'received' && frame.type === 'portal:session-reset');
  const interruptedComplete = navigationWire.findIndex(({ direction, frame }) =>
    direction === 'received' && frame.type === 'consciousness:complete');
  expect(resetSent).toBeGreaterThanOrEqual(0);
  expect(thoughtSent).toBeGreaterThan(resetSent);
  expect(interruptedComplete).toBeGreaterThan(resetSent);
  expect(interruptedComplete).toBeLessThan(resetReceived);
  expect(resetReceived).toBeGreaterThan(thoughtSent);

  const navigationMutationProbe = await page.evaluate(() => {
    window.__navigationMutationObserver?.disconnect();
    return window.__navigationMutationProbe;
  });
  expect(navigationMutationProbe.staleOldMessage).toBe(false);

  // Disk truth: completed, interrupted, and post-navigation thoughts occupy
  // three distinct append-only sessions; no prompt crossed the reset seam.
  const auth = { Authorization: `Bearer ${token}` };
  const sessionsResponse = await fetch(`${BASE}/api/v1/workspace/${NEUMA_ID}/sessions`, { headers: auth });
  expect(sessionsResponse.status).toBe(200);
  const { sessions } = await sessionsResponse.json();
  const persisted = await Promise.all(sessions.map(async (sessionId) => {
    const response = await fetch(
      `${BASE}/api/v1/workspace/${NEUMA_ID}/sessions/${encodeURIComponent(sessionId)}`,
      { headers: auth },
    );
    expect(response.status).toBe(200);
    return { sessionId, messages: (await response.json()).messages };
  }));
  const sessionWith = (prompt) => persisted.find(({ messages }) =>
    messages.some((message) => message.role === 'user' && message.content === prompt));
  const firstSession = sessionWith(firstPrompt);
  const interruptedSession = sessionWith(interruptedPrompt);
  const postNavigationSession = sessionWith(postNavigationPrompt);
  expect(firstSession?.sessionId).toBeTruthy();
  expect(interruptedSession?.sessionId).toBeTruthy();
  expect(postNavigationSession?.sessionId).toBeTruthy();
  expect(new Set([
    firstSession.sessionId,
    interruptedSession.sessionId,
    postNavigationSession.sessionId,
  ]).size).toBe(3);
  expect(interruptedSession.messages.some((message) => message.content === postNavigationPrompt)).toBe(false);
  expect(postNavigationSession.messages.some((message) => message.content === interruptedPrompt)).toBe(false);

  await page.screenshot({ path: path.join(REPO, 'test/e2e/shots/context-strip.png') });
  await cdp.detach();
  expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
});

test('NEW settles a real pending approval before acknowledging navigation', async ({ page }) => {
  test.skip(!witnessEnvPath, 'set NEUMA_WITNESS_ENV to the calling sealed witness');
  test.skip(!liveModel, 'no model loaded on llama-server or LM Studio — load one to run this live proof');

  const wireFrames = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    try { wireFrames.push(JSON.parse(response.payloadData)); } catch { /* control frame */ }
  });
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
    sessionStorage.setItem('authToken', t);
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible().catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }

  await page.locator('.relink-snd', { hasText: 'NEW CHAT' }).click();
  await expect(page.locator('.relink-msg')).toHaveCount(0);
  const input = page.locator('.relink-input-field');
  await input.fill('Call press_document now with markdown "# Navigation gate proof". Do not call any other tool and do not answer before the tool call.');
  await input.press('Enter');
  await expect(page.locator('.approval-chip.pending')).toBeVisible({ timeout: 180000 });

  const wireMark = wireFrames.length;
  const started = Date.now();
  await page.locator('.relink-snd', { hasText: 'NEW CHAT' }).click();
  await expect.poll(
    () => wireFrames.slice(wireMark).some((frame) => frame.type === 'portal:session-reset'),
    { timeout: 30000 },
  ).toBe(true);
  expect(Date.now() - started).toBeLessThan(30000);

  const settled = wireFrames.slice(wireMark);
  const approvalResolved = settled.findIndex((frame) =>
    frame.type === 'tool:approval_resolved' && frame.decision === 'interrupted');
  const turnComplete = settled.findIndex((frame) => frame.type === 'consciousness:complete');
  const reset = settled.findIndex((frame) => frame.type === 'portal:session-reset');
  expect(approvalResolved).toBeGreaterThanOrEqual(0);
  expect(turnComplete).toBeGreaterThan(approvalResolved);
  expect(reset).toBeGreaterThan(turnComplete);
  await expect(page.locator('.approval-chip.pending')).toHaveCount(0);
  await expect(page.locator('.relink-msg')).toHaveCount(0);
  await cdp.detach();
});
