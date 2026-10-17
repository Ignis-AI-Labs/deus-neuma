// @ts-check
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../helpers/claim-owner.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

/**
 * THE SEQUENCED ASK, END TO END (RULE 0) — Design note, 2026-07-27: […]
 *
 * Everything on the claimed path is real: a real backend, a real vite, a real
 * browser, a real portal WebSocket, the real reducer and the real AskChip. A
 * real being really calls ask_operator with five questions, the desk really
 * walks them one at a time, and the answers really come back to the being as
 * Q -> A pairs — which the stub asserts by echoing what it received.
 *
 * The only stand-in is the SERVING: a real OpenAI-wire HTTP server whose
 * tokens are scripted. The model's own generation is not the thing under test
 * (and scripting it is the only way to make a being ask a KNOWN set of five
 * questions on demand); every byte after the tool call is production code.
 *
 * SAFETY LAW: never the live witness stack — own backend+vite on PID-derived
 * bind-probed ports, disposable temp roots, recorded-PID teardown.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Clear of live-dev 3333/7777 and 3355/7755, and of every other isolated stack.
const FPORT_BASE = 7911 + (process.pid % 149);
const BPORT_BASE = 3911 + (process.pid % 149);
const NEUMA_ID = 'e2e-asksequence';
const MODEL = 'stub-asker';

// The exact five sc-research locks, in protocol order. EVERY one carries
// options with the recommendation first — the contract, not a courtesy.
const QUESTIONS = [
  {
    question: 'What exact question should this research answer?',
    header: 'Question',
    options: [
      { label: 'Use the proposed scope', description: 'tools for the X-first outreach flow' },
      { label: 'Narrow to publishing only', description: 'drop CRM and analytics' },
      { label: 'Broaden to the whole funnel', description: 'include lead capture' },
    ],
  },
  {
    question: 'What output format?',
    header: 'Format',
    options: [
      { label: 'Markdown report', description: 'decision matrix and phased plan' },
      { label: 'Slide outline', description: 'headlines only' },
    ],
  },
  {
    question: 'What citation standard?',
    header: 'Citations',
    options: [{ label: 'Primary sources required' }, { label: 'Secondary allowed' }],
  },
  {
    question: 'How deep should the research go?',
    header: 'Budget',
    options: [
      { label: 'Deep', description: 'a full day in bounded waves' },
      { label: 'Standard', description: 'a few hours' },
    ],
  },
  {
    question: 'How many research roles?',
    header: 'Team',
    options: [{ label: '4-7 roles' }, { label: '2-3 roles' }, { label: 'Solo research' }],
  },
];

let FPORT; let BPORT; let BASE;
let stub; let stubUrl; let root; let backendProc; let viteProc; let token; let addr;
/** Every prompt the serving was handed — the being's tool result lands here. */
let seen = [];
/** When true the serving asks BARE questions first, to prove the platform
 *  corrects it rather than handing the operator empty text boxes. */
let askBareFirst = false;

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) if (await canBind(p)) return p;
  throw new Error(`no free port in [${start}, ${start + 120})`);
};

const sse = (res, text) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};

/** A real OpenAI-wire serving that asks five questions, then reports back. */
const startStub = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* not json — answer anyway */ }
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      seen.push(body);
      const turn = JSON.stringify(body.messages || []);
      // Round one: ask. Every round after: the tool result has arrived, so say
      // what came back — that text is the proof the pairs reached the being.
      if (!turn.includes('tool_response')) {
        const first = askBareFirst
          ? QUESTIONS.map(({ question, header }) => ({ question, header })) // no options at all
          : QUESTIONS;
        sse(res, `Before Wave 0 I must lock five parameters.\n[TOOL: operator/ask_operator ${JSON.stringify({ questions: first })}]`);
        return;
      }
      // Corrected: the platform refused the bare ask and said why. Comply.
      if (turn.includes('Every question needs at least')) {
        sse(res, `Understood.\n[TOOL: operator/ask_operator ${JSON.stringify({ questions: QUESTIONS })}]`);
        return;
      }
      const answered = turn.slice(turn.indexOf('tool_response'));
      sse(res, `LOCKED::${answered.replace(/\\n/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 900)}`);
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
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

const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  stub = await startStub();
  stubUrl = stub.url;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'asksequence-e2e-'));
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_EFFORT_PATH: path.join(root, 'neuma-effort.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'neuma-routes.json'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'creds.json'),
    NEUMA_SKILLS_ROOT: path.join(root, 'skills'),
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: stubUrl,
    SUBSTRATE_IDLE_MINUTES: '0',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);
  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  await fetch(`${BASE}/api/v1/routing/providers/lm-studio/key`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: stubUrl }),
  });
});

test.afterAll(async () => {
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  await new Promise((r) => stub?.server.close(r));
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  seen = [];
  askBareFirst = false;
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
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 5000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }
});

test('five questions arrive one at a time, and every answer reaches the being paired with its question', async ({ page }) => {
  await page.locator('.relink-input-field').fill('research the outreach tooling');
  await page.keyboard.press('Enter');

  const card = page.locator('.ask-chip.pending');
  await expect(card).toBeVisible({ timeout: 30000 });

  // --- 1 of 5: options ARE offered, and the first reads as the recommendation
  await expect(card.locator('.ask-chip-progress')).toHaveText('1 of 5');
  await expect(card.locator('.ask-chip-header')).toHaveText('Question');
  await expect(card.locator('.ask-chip-question')).toContainText('What exact question');
  await expect(card.locator('.ask-chip-options button')).toHaveCount(3);
  await expect(card.locator('.ask-chip-options button').first()).toContainText('RECOMMENDED');
  await expect(card.locator('.ask-chip-options button').nth(1)).not.toContainText('RECOMMENDED');
  // …and typing your own words is still there beside them, never instead.
  await expect(card.locator('.ask-chip-free input')).toBeVisible();
  await card.locator('.ask-chip-free input').fill('Which tools fit the X-first flow');
  await card.locator('.ask-chip-free button[type="submit"]').click();

  // --- 2 of 5: its OWN options, chosen by click ----------------------------
  await expect(card.locator('.ask-chip-progress')).toHaveText('2 of 5');
  await expect(card.locator('.ask-chip-header')).toHaveText('Format');
  const formatOptions = card.locator('.ask-chip-options button');
  await expect(formatOptions).toHaveCount(2);
  // The regression that started all this: options must belong to THIS
  // question. A Team label here would mean the flattening is back.
  await expect(card.locator('.ask-chip-options')).not.toContainText('roles');
  await expect(formatOptions.first()).toContainText('Markdown report');
  await expect(formatOptions.first()).toContainText('decision matrix and phased plan');
  await formatOptions.first().click();

  // --- 3 of 5: chosen by KEYBOARD, the way a terminal answers ---------------
  await expect(card.locator('.ask-chip-progress')).toHaveText('3 of 5');
  await expect(card.locator('.ask-chip-header')).toHaveText('Citations');
  await card.locator('.ask-chip-free input').press('1');

  // --- 4 of 5: step BACK, then forward again — a wrong turn costs nothing ---
  await expect(card.locator('.ask-chip-progress')).toHaveText('4 of 5');
  await card.locator('.ask-chip-free input').press('Backspace');
  await expect(card.locator('.ask-chip-progress')).toHaveText('3 of 5');
  await card.locator('.ask-chip-free input').press('2');
  await expect(card.locator('.ask-chip-progress')).toHaveText('4 of 5');
  await expect(card.locator('.ask-chip-header')).toHaveText('Budget');
  await card.locator('.ask-chip-free input').press('1');

  // --- 5 of 5: the last answer sends the whole set --------------------------
  await expect(card.locator('.ask-chip-progress')).toHaveText('5 of 5');
  await expect(card.locator('.ask-chip-header')).toHaveText('Team');
  await expect(card.locator('.ask-chip-free button[type="submit"]')).toHaveText('ANSWER');
  await card.locator('.ask-chip-free input').press('2');

  // The card collapses only on the server's echo.
  await expect(page.locator('.ask-chip.resolved')).toBeVisible({ timeout: 15000 });

  // THE PROOF: the being received every answer paired with ITS question, and
  // the corrected citations answer (Secondary, chosen after stepping back) is
  // the one that arrived — not the first press.
  // `seen` holds what the serving RECEIVED, so wait for the round that carries
  // the tool result — that is the being reading its witness's answers.
  await expect.poll(() => seen.filter((b) => JSON.stringify(b.messages || []).includes('tool_response')).length,
    { timeout: 20000 }).toBeGreaterThan(0);
  const echoed = JSON.stringify(seen.filter((b) => JSON.stringify(b.messages || []).includes('tool_response')));
  expect(echoed).toContain('Which tools fit the X-first flow');
  expect(echoed).toContain('Markdown report');
  expect(echoed).toContain('Secondary allowed');
  expect(echoed).toContain('Deep');
  expect(echoed).toContain('2-3 roles');
  expect(page.__crashes).toEqual([]);
});

test('a bare question never reaches the operator — the platform demands options', async ({ page }) => {
  // Design note, 2026-07-27: […]
  // The being asks five questions with NO options. The platform must refuse,
  // tell it what shape to use, and only open the card once real choices exist.
  askBareFirst = true;

  await page.locator('.relink-input-field').fill('research the outreach tooling');
  await page.keyboard.press('Enter');

  const card = page.locator('.ask-chip.pending');
  await expect(card).toBeVisible({ timeout: 30000 });

  // What the operator actually sees is the CORRECTED ask: options, and the
  // recommendation named. The bare version never rendered.
  await expect(card.locator('.ask-chip-progress')).toHaveText('1 of 5');
  await expect(card.locator('.ask-chip-options button')).toHaveCount(3);
  await expect(card.locator('.ask-chip-options button').first()).toContainText('RECOMMENDED');

  // And the correction really went to the being, in words it can act on.
  const corrected = JSON.stringify(seen);
  expect(corrected).toContain('Every question needs at least');
  expect(corrected).toContain('RECOMMENDATION first');
  expect(page.__crashes).toEqual([]);
});
