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
import { openDockApp } from './helpers/dock.js';
import { settleDesk } from './helpers/explorer-panel-harness.js';

/**
 * WAITING ON YOU, END TO END — Design note, 2026-10-24 (#585): […]
 * And the same day, on where it stood: […] So it lives in the notification tray: its own mark on the
 * bell, its section first in the opened tray, its arrivals in the toast lane —
 * and nothing of it at the top of the desk.
 *
 * Three decisions owed by one house, each from its own real source: a tool
 * approval card a being's real turn raised in a chat (the being's tool call
 * through the real portal, the real ACTS gate, the real approval broker), a
 * post the being staged on the house's X queue, and a question its house work
 * filed in the house clock's ask ledger (the real ledger writer). The tray's
 * bell must count all three, its section must list them first, each row must
 * land on its own card, deciding one must drop the count, a new one must rise
 * once in the toast lane, the X window's band must show its decision on
 * arrival at 560x600 with nothing scrolled, and the tray must keep the
 * bottom-right corner whichever edge the taskbar sits on.
 *
 * The only stand-in is the SERVING: a real OpenAI-wire HTTP server whose
 * tokens are scripted (ask-sequence.spec.js's precedent) — the model's
 * generation is not what is under test; every byte after its tool call is
 * production code. The draft is staged as a being's queue tool writes it,
 * authored by the house's own lane, as a DRAFT (never seeded approved).
 *
 * SAFETY LAW: never a live stack — its own backend + vite on PID-derived
 * bind-probed ports, a disposable root holding the whole data root, realm and
 * workspaces, NO social keys (an isolated data root and the X key env vars
 * emptied: nothing can leave the machine), and the web search the being asks
 * for is DENIED, so no request goes out. Only the recorded PIDs are killed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Clear of every other isolated stack's base, and of the live desk's ports.
const FPORT_BASE = 6561 + (process.pid % 149);
const BPORT_BASE = 5561 + (process.pid % 149);
const NEUMA_ID = 'e2e-waitingbeing';
const SHOTS = process.env.WAITING_SHOTS_DIR || path.join(os.tmpdir(), 'waiting-e2e-shots');
const MODEL = 'stub-searcher';
const POST_TEXT = 'Launch week opens today. The house is at the door.';
const ASK_QUESTION = 'Which banner goes up for launch week?';
const LATE_QUESTION = 'Does the launch post carry the new mark?';

let FPORT; let BPORT; let BASE;
let stub; let root; let backendProc; let viteProc; let token; let addr; let askId; let draftId;

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) if (await canBind(p)) return p;
  throw new Error(`no free port in [${start}, ${start + 120})`);
};
const waitFor = async (urls, ms = 90000) => {
  const list = Array.isArray(urls) ? urls : [urls];
  const t0 = Date.now();
  for (;;) {
    for (const url of list) {
      try { if ((await fetch(url)).status < 500) return; } catch { /* not up */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

const sse = (res, text) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};

/** A real OpenAI-wire serving: the being reaches for a web search (a gated act), then speaks. */
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
      try { body = JSON.parse(raw); } catch { /* answer anyway */ }
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      if (!JSON.stringify(body.messages || []).includes('tool_response')) {
        sse(res, `Let me look that up.\n[TOOL: web/web_search ${JSON.stringify({ query: 'launch week banners' })}]`);
        return;
      }
      sse(res, 'Understood — I will not search.');
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
const HOUSE_WALLET = new ethers.Wallet(readClaudeWallet()).address.toLowerCase();

const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const { challenge } = await (await fetch(`${BASE}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BASE}/api/v1/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token: t } = await res.json();
  if (!t) throw new Error('auth/verify returned no token');
  return { token: t, addr: w.address };
};

// impure — the two durable decisions, written as their real writers write them.
const stageDecisions = async () => {
  // The post the being staged: a DRAFT, authored and queued by the house's lane.
  draftId = 'draft-launch-post';
  const queue = [{
    id: draftId, channelId: 'x', accountId: 'x-1', text: POST_TEXT, scheduledFor: null, campaignId: null, pillar: '',
    media: [], authorNeumaId: NEUMA_ID, queuedBy: NEUMA_ID, status: 'draft', createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
  }];
  await fs.promises.mkdir(path.join(root, 'social'), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(path.join(root, 'social', 'social-post-queue.json'), `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
  // The question house work filed — through the ledger's own writer, into this stack's realm.
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setRealmRoot(process.env.NEUMA_REALM_ROOT);
  const { fileAsk } = await import('../../backend/services/house-clock/wake-ledger.js');
  ({ id: askId } = await fileAsk(HOUSE_WALLET, { wakeId: null, seat: NEUMA_ID, kind: 'decision', question: ASK_QUESTION, why: 'the launch week banner' }));
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fs.promises.mkdir(SHOTS, { recursive: true });
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  stub = await startStub();
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'waiting-e2e-'));
  await stageDecisions();
  const env = {
    ...process.env,
    PORT: String(BPORT),
    FRONTEND_PORT: String(FPORT),
    WORKSPACES_ROOT: root,
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'witness-home'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(root, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    NEUMA_EFFORT_PATH: path.join(root, 'neuma-effort.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'neuma-routes.json'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'creds.json'),
    NEUMA_SKILLS_ROOT: path.join(root, 'skills'),
    NEUMA_SOCIAL_POST_QUEUE_PATH: path.join(root, 'social', 'social-post-queue.json'),
    NEUMA_REPLY_CANDIDATES_PATH: path.join(root, 'social', 'reply-candidates.json'),
    // NO social keys reach this stack: every channel reads honestly unconfigured.
    X_API_KEY: '', X_API_SECRET: '', X_ACCESS_TOKEN: '', X_ACCESS_SECRET: '',
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: stub.url,
    SUBSTRATE_IDLE_MINUTES: '0',
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);
  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  // A bound being speaks only with its identity readable: its DNA, through the real workspace engine.
  const { default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(root);
  await workspace.writeDNA(NEUMA_ID, { version: '1.0.0', identity: { name: 'Waitingbeing' }, genesis: '# Essence\nI am Waitingbeing.' });
  await fetch(`${BASE}/api/v1/routing/providers/lm-studio/key`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: stub.url }),
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
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: 'Waitingbeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await settleDesk(page);
});

const mark = (page) => page.locator('.ntray-bell .ntray-wait-n');
const bell = (page) => page.locator('.ntray-bell');
const panel = (page) => page.locator('.ntray-panel');
const openTray = async (page) => {
  if (!(await panel(page).count())) await bell(page).click();
  await expect(panel(page)).toBeVisible();
};
const rowOf = (page, kind) => panel(page).locator('.waiting-row', { has: page.locator('.waiting-row-kind', { hasText: kind }) });
const windowOf = (page, title) => page.locator('.fwin', { has: page.locator('.fwin-bar-title', { hasText: title }) }).first();
const fileHouseAsk = async (question) => {
  const { fileAsk } = await import('../../backend/services/house-clock/wake-ledger.js');
  return (await fileAsk(HOUSE_WALLET, { wakeId: null, seat: NEUMA_ID, kind: 'decision', question, why: 'the launch week' })).id;
};

test('the tray carries it: the bell counts all three, the tray opens on them first, every row lands, deciding drops the count, a new one rises once', async ({ page }) => {
  // Nothing of it at the top of the desk any more.
  await expect(page.locator('.relink-status')).toBeVisible();
  await expect(page.locator('.relink-status')).not.toContainText('WAITING ON YOU');
  await expect(page.locator('.relink-status .mandate-chip, .waiting-chip, .waiting-on-you')).toHaveCount(0);

  // Before the turn: the two durable decisions, the true count on the bell's own mark, the oldest wait on hover.
  await expect(mark(page)).toHaveText('2', { timeout: 20000 });
  await expect(bell(page)).toHaveAttribute('title', /^2 waiting on you · oldest 2\dM · Notifications/);
  await expect(bell(page)).toHaveClass(/is-owed/);
  // Bottom-right, where notifications come up.
  const vp = page.viewportSize();
  const bellBox = await bell(page).boundingBox();
  expect(bellBox.x + bellBox.width).toBeGreaterThan(vp.width - 60);
  expect(bellBox.y + bellBox.height).toBeGreaterThan(vp.height - 120);
  // Steady: no animation on the mark, ever (no-flash law).
  const animations = await page.locator('.ntray-bell .ntray-wait, .ntray-bell .waiting-chip-mark').evaluateAll(
    (els) => els.map((el) => getComputedStyle(el).animationName),
  );
  expect(animations).toEqual(['none', 'none']);

  // The being's real turn reaches for a gated act: a real approval card rises in the chat.
  await page.locator('.relink-input-field').fill('what banners fit launch week?');
  await page.keyboard.press('Enter');
  const card = page.locator('.approval-chip.pending');
  await expect(card).toBeVisible({ timeout: 60000 });
  await expect(mark(page)).toHaveText('3', { timeout: 20000 });
  // It rose in the chat in front of the operator: no toast needed for it.
  await page.waitForTimeout(600);
  await expect(page.locator('.ntray-card.is-waiting')).toHaveCount(0);

  // Look away: MARKETING (X's account level) opens over the chat, so the jump must raise the chat again.
  await openDockApp(page, 'X');
  await expect(windowOf(page, 'MARKETING //')).toHaveClass(/is-focused/, { timeout: 20000 });

  // The opened tray: WAITING ON YOU first, above every ordinary notification; three rows, the longest wait first.
  await openTray(page);
  const first = await panel(page).evaluate((el) => el.firstElementChild?.className);
  expect(first).toMatch(/^ntray-wait-sec( |$)/);
  const sec = await panel(page).locator('.ntray-wait-sec').boundingBox();
  const notes = await panel(page).locator('.ntray-panel-head').boundingBox();
  expect(sec.y + sec.height).toBeLessThanOrEqual(notes.y + 1);
  await expect(panel(page).locator('.ntray-wait-h')).toContainText('3 WAITING ON YOU');
  const rows = panel(page).locator('.waiting-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('POST');
  await expect(rows.nth(1)).toContainText('HOUSE ASK');
  await expect(rows.nth(2)).toContainText('APPROVAL');
  await page.waitForTimeout(400); // the panel settles before the picture
  await page.screenshot({ path: path.join(SHOTS, 'waiting-tray-open.png') });

  // APPROVAL → the tray puts itself away; its chat window raised, its card in view and marked.
  await rowOf(page, 'APPROVAL').click();
  await expect(panel(page)).toHaveCount(0);
  const cardId = await card.getAttribute('data-wait-id');
  expect(cardId).toBeTruthy();
  const chat = page.locator('.fwin', { has: page.locator(`[data-wait-id="${cardId}"]`) });
  await expect(chat).toHaveClass(/is-focused/);
  await expect(card).toBeInViewport();
  await expect(card).toHaveClass(/is-wait-landed/);
  // Deciding it drops the count: DENY — nothing leaves the machine.
  await card.locator('.approval-deny').click();
  await expect(page.locator('.approval-chip.pending')).toHaveCount(0, { timeout: 20000 });
  await expect(mark(page)).toHaveText('2', { timeout: 20000 });

  // HOUSE ASK → the house clock opens on ASKS, on the ask's own row.
  await openTray(page);
  await rowOf(page, 'HOUSE ASK').click();
  const ask = page.locator(`[data-ask="${askId}"]`);
  await expect(ask).toBeInViewport({ timeout: 20000 });
  await expect(ask).toContainText(ASK_QUESTION);
  await expect(windowOf(page, 'HOUSE CLOCK')).toHaveClass(/is-focused/);
  await ask.locator('.hclock-btn', { hasText: 'CLOSE' }).click();
  await expect(mark(page)).toHaveText('1', { timeout: 20000 });

  // A NEW decision arrives while the operator works elsewhere: the mark updates, and it rises ONCE in the toast lane.
  await openDockApp(page, 'X');
  await expect(windowOf(page, 'MARKETING //')).toHaveClass(/is-focused/, { timeout: 20000 });
  await page.mouse.move(vp.width / 2, vp.height / 3);
  const lateId = await fileHouseAsk(LATE_QUESTION);
  await expect(mark(page)).toHaveText('2', { timeout: 20000 });
  const toast = page.locator('.ntray-card.is-waiting', { hasText: LATE_QUESTION });
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('WAITING ON YOU · HOUSE ASK');
  await page.waitForTimeout(800); // past the toast's grace: a rising toast takes no press
  await toast.locator('.ntray-card-body').click();
  const late = page.locator(`[data-ask="${lateId}"]`);
  await expect(late).toBeInViewport({ timeout: 20000 });
  await expect(page.locator('.ntray-card.is-waiting')).toHaveCount(0);
  // The mark stays until it is decided.
  await expect(mark(page)).toHaveText('2');
  await late.locator('.hclock-btn', { hasText: 'CLOSE' }).click();
  await expect(mark(page)).toHaveText('1', { timeout: 20000 });

  // POST → MARKETING raised at X's account level, on the queue, on the draft's own card.
  await openTray(page);
  await rowOf(page, 'POST').click();
  const draft = page.locator(`[data-entry-id="${draftId}"]`);
  await expect(draft).toBeInViewport({ timeout: 20000 });
  await expect(windowOf(page, 'MARKETING //')).toHaveClass(/is-focused/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('X\'s account level band (in MARKETING) shows its decision on arrival at 560x600 — nothing scrolled — and OPEN lands on the card', async ({ page }) => {
  await expect(mark(page)).toHaveText('1', { timeout: 20000 });
  await openDockApp(page, 'X');
  const win = windowOf(page, 'MARKETING //');
  const box = await win.boundingBox();
  expect(Math.round(box.width)).toBe(560);
  expect(Math.round(box.height)).toBe(600);

  // The band is the first thing under MARKETING's path at the account level, above the console head, and whole on screen.
  const band = win.locator('[data-mkt-level="account"] .waiting-band');
  await expect(band).toBeVisible({ timeout: 20000 });
  await expect(band.locator('.waiting-band-h')).toContainText('1 WAITING ON YOU');
  await expect(band.locator('.waiting-band-text')).toHaveText(POST_TEXT);
  await expect(band.locator('.waiting-band-go')).toHaveText('APPROVE');
  const head = await win.locator('.pc-head').boundingBox();
  const bodyBox = await win.locator('.fwin-body').boundingBox();
  const bandBox = await band.boundingBox();
  expect(bandBox.y).toBeLessThan(head.y);
  expect(bandBox.y).toBeGreaterThanOrEqual(bodyBox.y - 1);
  expect(bandBox.y).toBeGreaterThanOrEqual((await win.locator('[data-mkt-path]').boundingBox()).y);
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height);
  const scrolled = await win.locator('.fwin-body').evaluate((el) => [el, ...el.querySelectorAll('*')]
    .filter((n) => n.scrollHeight > n.clientHeight + 4).map((n) => n.scrollTop));
  expect(scrolled.every((t) => t === 0)).toBe(true);

  // OPEN lands on the card in the queue below; REJECT there settles it, and every signal clears.
  await band.locator('.waiting-band-open').click();
  const draft = win.locator(`[data-entry-id="${draftId}"]`);
  await expect(draft).toBeInViewport({ timeout: 20000 });
  await draft.locator('.settings-set', { hasText: 'REJECT' }).click();
  await expect(win.locator('.waiting-band')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('.ntray-bell .ntray-wait')).toHaveCount(0, { timeout: 20000 });
  await expect(bell(page)).not.toHaveClass(/is-owed/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the tray keeps the bottom-right corner, its mark with it, wherever the taskbar sits', async ({ page }) => {
  await fileHouseAsk('Which edge suits the bar?');
  await expect(mark(page)).toHaveText('1', { timeout: 20000 });
  const vp = page.viewportSize();
  for (const edge of ['left', 'top', 'bottom']) {
    await page.locator('.taskbar-fill').click({ button: 'right' });
    await page.locator('.taskbar-menu [role="menuitemradio"]', { hasText: new RegExp(edge, 'i') }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.taskbarEdge)).toBe(edge);
    await expect(mark(page)).toBeVisible();
    const b = await bell(page).boundingBox();
    const bar = await page.locator('.taskbar-bar').boundingBox();
    expect(b.x + b.width).toBeGreaterThan(vp.width - 60);
    if (edge === 'bottom') {
      // above the bar's right end, never under it
      expect(b.y + b.height).toBeLessThanOrEqual(bar.y);
      expect(b.y + b.height).toBeGreaterThan(vp.height - 120);
    } else {
      // the corner itself, clear of a bar that no longer runs along the bottom
      expect(b.y + b.height).toBeGreaterThan(vp.height - 40);
      if (edge === 'left') expect(b.x).toBeGreaterThan(bar.x + bar.width);
      else expect(b.y).toBeGreaterThan(bar.y + bar.height);
    }
    await openTray(page);
    await expect(panel(page).locator('.ntray-wait-sec .waiting-row')).toHaveCount(1);
    await expect(panel(page)).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: path.join(SHOTS, `waiting-tray-edge-${edge}.png`) });
    await bell(page).click();
    await expect(panel(page)).toHaveCount(0);
  }
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
