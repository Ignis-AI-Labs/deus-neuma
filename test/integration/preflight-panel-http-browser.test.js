/* global window, sessionStorage, document, setTimeout */
/**
 * PreflightCheck's shared-transport migration (#174 family F4), proven in a real
 * Chromium page against the real backend. NOTHING IS MOCKED: the component is
 * served by a real Vite middleware, its apiCall travel is real HTTP into a real
 * express stack, the preflight and llm routers are the production modules, the
 * Ollama it sees is a real loopback server speaking the real /api/tags shape
 * (registered through the real encrypted credential store), and the session
 * token is a real signed wallet challenge (fullAuth).
 *
 * What each scenario proves:
 *   - run() GET /api/v1/preflight: success renders rows + verdict; a REAL 404
 *     (stack without the route) lands in the catch → the BLOCKED verdict UI.
 *   - renderSubstrateSetup() GET /api/v1/preflight/setup: success builds the
 *     […] panel from the real payload; a REAL 404 is
 *     swallowed SILENTLY — no panel, no console line, no pageerror.
 *   - provider chip PUT /api/v1/llm/provider: fire-and-forget — a 401 (invalid
 *     session) raises neuma:auth_expired, never rejects unhandled, never
 *     surfaces, and the unconditional re-run still happens; a 200 really moves
 *     the persisted provider choice on disk.
 *
 * The configured provider is pinned (operator choice) to llama-server on a dead
 * port so the substrate row FAILS and the setup panel renders; auto-adopt is
 * disabled by that persisted choice (the preflight-unreachable-blocks shape).
 *
 * PARALLEL-SAFETY LAW (the ceremony-http-browser pattern, witnessed 2026-09-11
 * under the 12-way MOD-001 combined batch): under contention the
 * browser→loopback transport can die BEFORE any HTTP response exists ([…] in-page; […] / "different document"
 * when the renderer is recycled). That is not a contract outcome, so every leg
 * drives through `drive()`: an attempt is retried ONLY when no response ever
 * arrived, never when one did — a real 200/401/404 in the server-side request
 * log is the response-arrived witness, and a real regression converges never
 * and still fails. The preflight battery genuinely probes this machine, so
 * battery-gated waits get PANEL_BUDGET, not the default.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

// Transport-loss signatures: no HTTP response ever existed in these cases.
// `is not a function/constructor` after window.ready fired means the probe
// resolved in a doomed context just before a crash-reload — the live context
// simply has not finished evaluating the module script yet.
const TRANSPORT_DRIVER = /Execution context was destroyed|Target crashed|Target closed|frame was detached|is not a function|is not a constructor|different document/i;
const RETRY = Symbol('no-response-yet');

// The battery (13 real machine probes + the row-reveal cadence + the setup
// probe) measures ~9s solo on this rig; MEASURED under the 12-way combined
// batch (2026-09-11): 87s per battery leg, 260s for the whole first test.
// PANEL_BUDGET is ~2.75x that leg; the test timeout ~3.5x the measured test —
// a wait that still exhausts them is a real failure, not a flake.
const PANEL_BUDGET = 240_000;

// Isolate every persisted store BEFORE the backend modules load — the suite's
// writes must never touch the operator's live credentials, choice, or settings.
const ISO = mkdtempSync(path.join(os.tmpdir(), 'preflight-panel-http-'));
const WORKSPACES = mkdtempSync(path.join(os.tmpdir(), 'preflight-panel-lanes-'));
process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(ISO, 'provider-credentials.json');
process.env.NEUMA_PROVIDER_CHOICE_PATH = path.join(ISO, 'llm-provider-choice.json');
writeFileSync(process.env.NEUMA_PROVIDER_CHOICE_PATH, JSON.stringify({
  provider: 'llama-server', chosenBy: 'operator', chosenAt: '2026-08-08T00:00:00.000Z',
}));
process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(ISO, 'workspace-settings.json');
// The dynamic port sweep must not discover this box's real model servers — the
// fixture below IS the machine under test.
process.env.NEUMA_DISCOVERY_PORTS = '1';

const { setCredential, removeCredential } = await import('../../backend/services/provider-credentials.js');
const llm = await import('../../backend/services/llm-provider.js');
const core = await import('../../core/index.js');
const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');
const { default: llmRouter } = await import('../../backend/routes/llm-routes.js');

const PAGE = `<script type="module">
import { PreflightCheck } from '/frontend/components/BirthCeremony/PreflightCheck.js';
window.PreflightCheck = PreflightCheck;
window.expired = 0;
window.addEventListener('neuma:auth_expired', () => { window.expired += 1; });
window.ready = true;
</script>`;

let ollama;
let ollamaEndpoint;
let auth;
let previousConfig;
let previousRoot;

// impure — boots a real express + Vite + Chromium stack; withApi decides
// whether the production routers answer or every /api call gets a real 404.
const boot = async ({ withApi, tag }) => {
  const requests = [];
  const app = express();
  app.use(express.json());
  // The request log is the RESPONSE-ARRIVED witness: an entry is recorded the
  // moment a request begins (re-run proof) and gains its status when the real
  // response finishes. It lives node-side, so it survives a recycled renderer.
  app.use('/api', (req, res, next) => {
    const record = { method: req.method, url: req.originalUrl, status: null };
    requests.push(record);
    res.on('finish', () => { record.status = res.statusCode; });
    next();
  });
  if (withApi) {
    app.use('/api/v1/preflight', preflightRouter);
    app.use('/api/v1', llmRouter);
  }
  const vite = await createServer({
    configFile: false, root: process.cwd(), cacheDir: path.join(ISO, `vite-${tag}`),
    appType: 'custom', optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: { port: 1 }, ws: false, watch: null },
  });
  app.get('/', (_req, res) => res.type('html').send(PAGE));
  app.use(vite.middlewares);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  const consoles = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Chromium itself logs every non-2xx fetch as a console resource error —
  // that is the browser's noise floor, not the app speaking. Keep it out so a
  // console assertion measures only what the code actually says.
  page.on('console', (message) => {
    if (!message.text().startsWith('Failed to load resource')) {
      consoles.push(`${message.type()}: ${message.text()}`);
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  return { requests, page, errors, consoles, async close() {
    await browser?.close();
    await vite?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  } };
};

// impure — one REAL attempt per call; retry only while no HTTP response has
// ever arrived (in-page transport loss, a recycled renderer, or a wait that
// timed out because the world it watched was recycled). A real refusal, a real
// success and a real regression are never retried — the final error carries
// every attempt's page state.
const makeDriver = (page) => {
  const snapshot = async () => {
    try {
      return await page.evaluate(() => ({
        ready: Boolean(window.ready),
        overlay: Boolean(document.querySelector('.preflight-overlay')),
        verdict: document.querySelector('#preflight-verdict')?.textContent || null,
        panel: Boolean(document.querySelector('.pf-setup-panel')),
        rows: document.querySelectorAll('.preflight-row').length,
        expired: typeof window.expired === 'number' ? window.expired : null,
      }));
    } catch (error) {
      return { probe: String(error && error.message) };
    }
  };
  const drive = async (attempt, attempts = 5) => {
    const failures = [];
    for (let n = 0; n < attempts; n += 1) {
      try {
        const value = await attempt();
        if (value !== RETRY) return value;
        failures.push({ attempt: n, retried: true, state: await snapshot() });
      } catch (error) {
        const message = String(error && error.message);
        if (!TRANSPORT_DRIVER.test(message) && error.name !== 'TimeoutError') throw error;
        failures.push({ attempt: n, error: message.slice(0, 160), state: await snapshot() });
      }
      // A recycled context reloads the page — wait for the script to re-run.
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(250 * (n + 1));
    }
    throw new Error(`drive: no real response after ${attempts} attempts — ${JSON.stringify(failures)}`);
  };
  return { drive };
};

const getRuns = (requests) =>
  requests.filter((r) => r.method === 'GET' && r.url === '/api/v1/preflight').length;

const saw = (requests, method, url, status) =>
  requests.some((r) => r.method === method && r.url === url && r.status === status);

const seen = (requests) => requests.map((r) => `${r.method} ${r.url} → ${r.status}`);

const readChoice = () => JSON.parse(readFileSync(process.env.NEUMA_PROVIDER_CHOICE_PATH, 'utf8'));

// impure — poll the node-side log for the re-run the contract demands. The
// PUT's response already arrived when this is called, so a missing re-run is a
// REAL regression: it throws, it is never retried.
const waitForRun = async (requests, before) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (getRuns(requests) > before) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the PUT was answered but the unconditional re-run never began — ${seen(requests).join(', ')}`);
};

beforeAll(async () => {
  ollama = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'gemma3:12b' }] }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((resolve) => ollama.listen(0, '127.0.0.1', resolve));
  ollamaEndpoint = `http://127.0.0.1:${ollama.address().port}`;
  await setCredential('ollama', { endpoint: ollamaEndpoint });
  previousConfig = llm.getConfig();
  llm.setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'local-model' });
  previousRoot = core.getWorkspacesRoot();
  core.setWorkspacesRoot(WORKSPACES);
  auth = await fullAuth();
}, 60000);

afterAll(async () => {
  llm.setConfig(previousConfig);
  core.setWorkspacesRoot(previousRoot);
  await removeCredential('ollama').catch(() => {});
  await new Promise((resolve) => ollama.close(resolve));
  rmSync(ISO, { recursive: true, force: true });
  rmSync(WORKSPACES, { recursive: true, force: true });
  delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  delete process.env.NEUMA_PROVIDER_CHOICE_PATH;
  delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  delete process.env.NEUMA_DISCOVERY_PORTS;
});

test('setup panel renders from the real route; the provider chip really moves the choice, fire-and-forget', async () => {
  const stack = await boot({ withApi: true, tag: 'a' });
  const { drive } = makeDriver(stack.page);
  try {
    // impure — the component must be standing before a leg drives it. A
    // recycled renderer wiped everything (fresh show); a settled run with no
    // panel means the setup fetch died in transport (only possible without a
    // response — the real route answers 200 here), so re-run the battery.
    const standing = (token) => stack.page.evaluate((t) => {
      if (t) sessionStorage.setItem('authToken', t);
      if (!document.querySelector('.preflight-overlay')) {
        window.pf = new window.PreflightCheck(null, null);
        window.pf.show();
      } else if (!document.querySelector('.pf-setup-panel')
        && document.querySelector('#preflight-verdict')?.textContent !== 'RUNNING…') {
        window.pf.run();
      }
    }, token);
    const idleChip = () => stack.page.waitForFunction(() => {
      const chip = document.querySelector('.pf-prov-selectable');
      return Boolean(chip && !chip.dataset.busy);
    }, null, { timeout: PANEL_BUDGET });

    // run() GET /api/v1/preflight (site 1, success): the real blocked verdict —
    // the configured llama-server is dead — and the row set are rendered.
    const panel = await drive(async () => {
      await standing(auth.token);
      await stack.page.waitForFunction(
        () => Boolean(document.querySelector('.pf-setup-panel')), null, { timeout: PANEL_BUDGET },
      );
      return stack.page.evaluate(() => ({
        verdict: document.querySelector('#preflight-verdict').textContent,
        rows: document.querySelectorAll('.preflight-row').length,
        head: document.querySelector('.pf-setup-head').textContent,
        text: document.querySelector('.pf-setup-panel').textContent,
      }));
    });
    expect(panel.verdict).toBe('BLOCKED — RESOLVE THE FAILED CHECKS, THEN RECHECK');
    expect(panel.rows).toBeGreaterThan(0);

    // GET /api/v1/preflight/setup (site 3, success): the panel is built from the
    // real payload and names the fixture the real credential store pointed at.
    expect(panel.head).toBe('GIVE YOUR NEUMA A MIND');
    expect(panel.text).toContain('OLLAMA · 1 model(s)');
    expect(saw(stack.requests, 'GET', '/api/v1/preflight/setup', 200), seen(stack.requests).join(', ')).toBe(true);

    // Site 4, refused: an invalid session makes the PUT a real 401. The chip
    // must NOT reject unhandled, must raise the auth alarm, must clear busy,
    // and must STILL re-run the checks.
    const refused = await drive(async () => {
      await standing('invalid-session-proof');
      await idleChip();
      const before = await stack.page.evaluate(() => window.expired);
      const runsBefore = getRuns(stack.requests);
      await stack.page.click('.pf-prov-selectable');
      // The alarm fires INSIDE apiCall only when the 401 response arrived — a
      // recycled context destroys this wait and the attempt honestly retries.
      await stack.page.waitForFunction((n) => window.expired === n + 1, before, { timeout: 60000 });
      await waitForRun(stack.requests, runsBefore);
      await idleChip();
      return { before, after: await stack.page.evaluate(() => window.expired), runsBefore };
    });
    expect(refused.after).toBe(refused.before + 1);
    expect(saw(stack.requests, 'PUT', '/api/v1/llm/provider', 401), seen(stack.requests).join(', ')).toBe(true);
    expect(getRuns(stack.requests)).toBeGreaterThan(refused.runsBefore);
    // The refusal moved nothing on disk — the operator's llama-server choice stands.
    expect(readChoice().provider).toBe('llama-server');
    expect(stack.errors).toEqual([]);

    // Site 4, accepted: the real session's PUT lands — the persisted choice on
    // disk now names ollama at the fixture's endpoint — and the re-run follows,
    // with no further alarm (the session is valid).
    const accepted = await drive(async () => {
      await standing(auth.token);
      await idleChip();
      const before = await stack.page.evaluate(() => window.expired);
      const runsBefore = getRuns(stack.requests);
      await stack.page.click('.pf-prov-selectable');
      await waitForRun(stack.requests, runsBefore);
      return { before, after: await stack.page.evaluate(() => window.expired), runsBefore };
    });
    expect(accepted.after).toBe(accepted.before);
    expect(saw(stack.requests, 'PUT', '/api/v1/llm/provider', 200), seen(stack.requests).join(', ')).toBe(true);
    expect(readChoice()).toMatchObject({ provider: 'ollama', endpoint: ollamaEndpoint, chosenBy: 'operator' });
    expect(getRuns(stack.requests)).toBeGreaterThan(accepted.runsBefore);
    expect(stack.errors).toEqual([]);
  } finally {
    await stack.close();
  }
}, 900_000);

test('a backend that does not answer blocks loudly; the guidance fetch dies silently', async () => {
  const stack = await boot({ withApi: false, tag: 'b' });
  const { drive } = makeDriver(stack.page);
  try {
    // impure — stand or re-run the component; every run here settles fast (the
    // fetch fails immediately), so a settled verdict is re-produced per attempt.
    const standing = () => stack.page.evaluate((t) => {
      sessionStorage.setItem('authToken', t);
      if (!document.querySelector('.preflight-overlay')) {
        window.pf = new window.PreflightCheck(null, null);
        window.pf.show();
      } else {
        window.pf.run();
      }
    }, auth.token);

    // Site 1, failure: a REAL 404 from the real server lands in the catch —
    // the BLOCKED verdict UI, exactly the pre-migration contract. The settled
    // text alone proves nothing (an in-page "Failed to fetch" settles the same
    // words): the attempt returns only once the 404 exists in the server log.
    const blocked = await drive(async () => {
      await standing();
      await stack.page.waitForFunction(() => {
        const verdict = document.querySelector('#preflight-verdict');
        return Boolean(verdict && verdict.textContent !== 'RUNNING…');
      }, null, { timeout: 60000 });
      if (!saw(stack.requests, 'GET', '/api/v1/preflight', 404)) return RETRY;
      return stack.page.evaluate(() => ({
        verdict: document.querySelector('#preflight-verdict').textContent,
        blockedClass: document.querySelector('#preflight-verdict').classList.contains('blocked'),
      }));
    });
    expect(blocked).toEqual({
      verdict: 'BLOCKED — THE LOCAL BACKEND DID NOT ANSWER',
      blockedClass: true,
    });

    // Site 3, failure: the same real 404 on /preflight/setup is swallowed
    // SILENTLY — no panel, no console line, no unhandled rejection.
    // impure — the instance must exist (a recycled renderer took it); when it
    // was rebuilt, let that run's own site-1 console channel speak and settle
    // BEFORE the mark, so the delta below measures only renderSubstrateSetup.
    const ensured = () => stack.page.evaluate((t) => {
      sessionStorage.setItem('authToken', t);
      if (!document.querySelector('.preflight-overlay')) {
        window.pf = new window.PreflightCheck(null, null);
        window.pf.show();
      }
    }, auth.token);
    const silent = await drive(async () => {
      await ensured();
      await stack.page.waitForFunction(() => {
        const verdict = document.querySelector('#preflight-verdict');
        return Boolean(verdict && verdict.textContent !== 'RUNNING…');
      }, null, { timeout: 60000 });
      await stack.page.waitForTimeout(400); // console events arrive over CDP a beat late
      const mark = stack.consoles.length;
      await stack.page.evaluate(() => window.pf.renderSubstrateSetup());
      if (!saw(stack.requests, 'GET', '/api/v1/preflight/setup', 404)) return RETRY;
      const state = await stack.page.evaluate(() => ({
        children: document.querySelector('#pf-setup').childElementCount,
        visible: document.querySelector('#pf-setup').classList.contains('visible'),
      }));
      return { ...state, consoleDelta: stack.consoles.slice(mark) };
    });
    expect(silent.children).toBe(0);
    expect(silent.visible).toBe(false);
    expect(silent.consoleDelta).toEqual([]);
    expect(stack.errors).toEqual([]);
  } finally {
    await stack.close();
  }
}, 300_000);
