// @ts-check
/* global window, document, localStorage, sessionStorage, setInterval, clearInterval, setTimeout, process, fetch */
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
import { startTikTokStandIn } from '../helpers/tiktok-stand-in.js';
import { openDockApp } from './helpers/dock.js';
import { settleDesk } from './helpers/explorer-panel-harness.js';
import { ownerClaimHeaders } from './helpers/owner-claim.js';

/**
 * A RUNNING CHAT NEVER MOVES WHAT THE PERSON IS WORKING ON (Design note, 2026-10-23:
 * […]).
 *
 * The desk as he had it: the TIKTOK window over a chat, its queue open on a
 * TikTok draft, the WHO CAN WATCH menu open — while the chat streams a reply
 * underneath and the being's work lands on the very queue he is reading.
 *
 * REAL throughout (RULE 0): a real backend and vite, a real browser, real auth
 * (challenge-sign-verify), the real post queue on real disk read by the real
 * routes, a real portal stream. Two stand-ins, both real servers on loopback:
 * the SERVING (an OpenAI-wire server whose tokens are scripted — the model is
 * not under test) and TIKTOK'S OPEN API (test/helpers/tiktok-stand-in.js — the
 * card reads creator info as it renders). Nothing is posted: the draft is
 * never approved, and TikTok here is the stand-in.
 *
 * SAFETY LAW: never the live desk — own backend + vite on PID-derived
 * bind-probed ports, a disposable data root, recorded-PID teardown.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const FPORT_BASE = 7871 + (process.pid % 149);
const BPORT_BASE = 3871 + (process.pid % 149);
const NEUMA_ID = 'e2e-calmbeing';
const MODEL = 'stub-streamer';
const CLIP = path.join(REPO, 'test', 'fixtures', 'forge', 'ltx-clip.mp4');
const DRAFT_TEXT = 'Forge night — the armillary turning #aiart\nprivacy: everyone\nallow: comments';
// A reply long enough to stream for several seconds, one word per frame.
const WORDS = Array.from({ length: 200 }, (_, i) => `word${i}`);
const WORD_MS = 110;
const ASK_THOUGHT = 'ask me which cut to post';
const ASK_AFTER_MS = 5000;
const ASK = [{ question: 'Which cut goes out first?', header: 'Cut', options: [{ label: 'The long cut' }, { label: 'The short cut' }] }];

let FPORT; let BPORT; let BASE;
let stub; let tiktok; let root; let clip; let backendProc; let viteProc; let token; let addr;

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) if (await canBind(p)) return p;
  throw new Error(`no free port in [${start}, ${start + 120})`);
};

/** A real OpenAI-wire serving that speaks slowly: one word per frame. */
const startStub = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answer anyway */ }
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const said = JSON.stringify(body.messages || []);
      if (said.includes(ASK_THOUGHT) && !said.includes('tool_response')) {
        // The being asks — a few seconds in, while the person works elsewhere.
        await new Promise((r) => setTimeout(r, ASK_AFTER_MS));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `One question.\n[TOOL: operator/ask_operator ${JSON.stringify({ questions: ASK })}]` } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      for (const w of WORDS) {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${w} ` } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, WORD_MS));
      }
      res.write('data: [DONE]\n\n');
      res.end();
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
    headers: { 'Content-Type': 'application/json', ...ownerClaimHeaders(path.join(root, 'data')) },
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

const queuePath = () => path.join(root, 'social', 'social-post-queue.json');
const readQueue = () => JSON.parse(fs.readFileSync(queuePath(), 'utf8'));
// The being's work landing on the queue, as its tools write it: the store's
// own file, rewritten whole (the backend reads it fresh on every request).
const writeQueue = (entries) => fs.writeFileSync(queuePath(), `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });

const draft = (id, text, minsAgo, clip) => ({
  id,
  channelId: 'tiktok',
  accountId: 'tiktok-1',
  text,
  scheduledFor: null,
  campaignId: null,
  pillar: '',
  media: [{ path: clip, alt: '' }],
  authorNeumaId: NEUMA_ID,
  queuedBy: NEUMA_ID,
  status: 'draft',
  createdAt: new Date(Date.now() - minsAgo * 60000).toISOString(),
});

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  stub = await startStub();
  tiktok = await startTikTokStandIn();
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'calm-background-e2e-'));
  await fs.promises.mkdir(path.join(root, 'social'), { recursive: true, mode: 0o700 });
  clip = path.join(root, 'social', 'forge-night.mp4');
  await fs.promises.copyFile(CLIP, clip);
  writeQueue([draft('tt-draft-1', DRAFT_TEXT, 30, clip)]);
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
    NEUMA_SOCIAL_POST_QUEUE_PATH: queuePath(),
    NEUMA_REPLY_CANDIDATES_PATH: path.join(root, 'social', 'reply-candidates.json'),
    NEUMA_SOCIAL_CREDENTIALS_PATH: path.join(root, 'social', 'credentials.json'),
    NEUMA_SOCIAL_BINDINGS_PATH: path.join(root, 'social', 'bindings.json'),
    // TikTok is the loopback stand-in, on stand-in keys: no request leaves the machine.
    NEUMA_TIKTOK_API_ROOT: tiktok.root,
    TIKTOK_CLIENT_KEY: 'awkey',
    TIKTOK_CLIENT_SECRET: 'stand-in-secret',
    TIKTOK_REFRESH_TOKEN: 'refresh-1',
    TIKTOK_ACCESS_TOKEN: 'access-1',
    TIKTOK_ACCESS_EXPIRES_AT: new Date(Date.now() + 20 * 3600_000).toISOString(),
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
  // A being with a DNA record: a bound being with none never speaks.
  await fs.promises.mkdir(path.join(root, NEUMA_ID, 'dna'), { recursive: true });
  await fs.promises.copyFile(path.join(REPO, 'core', 'templates', 'dna-template-v1.0.0.json'), path.join(root, NEUMA_ID, 'dna', 'active.json'));
  await fetch(`${BASE}/api/v1/routing/providers/lm-studio/key`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
  await tiktok?.close();
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  writeQueue([draft('tt-draft-1', DRAFT_TEXT, 30, clip)]);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Calmbeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await settleDesk(page);
});


// TikTok's space is MARKETING's account level (slice 6): the window is MARKETING's, standing on it.
const tiktokWin = (page) => page.locator('.fwin', { has: page.locator('[data-mkt-level="account"][data-mkt-account^="tiktok:"]') });

/** Stand MARKETING (TikTok's account level) at a given rect (its saved geometry), and reload. */
const placeTikTok = async (page, rect) => {
  await page.evaluate(({ a, r }) => {
    localStorage.setItem(`${a.toLowerCase()}:win:outreach-marketing`, JSON.stringify({ ...r, maxed: false }));
  }, { a: addr, r: rect });
  await page.reload();
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await settleDesk(page);
};

/** The TIKTOK window, over the chat, open on its queue's draft card. */
const openDraftCard = async (page) => {
  if (!await tiktokWin(page).count()) await openDockApp(page, 'TIKTOK');
  const win = tiktokWin(page);
  await win.locator('.outreach-tab', { hasText: 'QUEUE' }).click();
  await win.locator('.settings-set', { hasText: /^UNSCHEDULED/ }).click();
  const card = win.locator('.queue-card', { has: page.locator('.tt-settings') }).first();
  await expect(card.locator('.lc-sel-trigger')).toBeVisible({ timeout: 20000 });
  return { win, card };
};

// Every element inside `scope` that reaches past `edge`'s right side, named.
const overflowPast = (scope, edgeSelector) => scope.evaluate((root, sel) => {
  const edge = (sel ? root.querySelector(sel) : root).getBoundingClientRect().right;
  return [...root.querySelectorAll('*')]
    .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > edge + 0.5)
    .map((el) => `${el.className || el.tagName}: ${(el.textContent || '').trim().slice(0, 40)}`);
}, edgeSelector);

test('every row of the TikTok card and the ACCOUNT board stays inside the card at any window width', async ({ page }) => {
  for (const w of [900, 575, 400]) {
    await placeTikTok(page, { x: 320, y: 70, w, h: 840 });
    if (!await tiktokWin(page).count()) await openDockApp(page, 'TIKTOK');
    const win = tiktokWin(page);
    expect(Math.round((await win.boundingBox()).width)).toBe(w);
    // THE ACCOUNT board — the window opens on it.
    const account = win.locator('[data-mkt-level="account"] .outreach-panel');
    await expect(win.locator('.outreach-tab.is-on')).toHaveText('ACCOUNT');
    await expect(account.locator('.tta-head')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    expect(await overflowPast(account, null), `ACCOUNT board at ${w}px`).toEqual([]);
    // THE CARD — every row, its words included, inside the card's frame.
    const { card } = await openDraftCard(page);
    await card.locator('.tt-declaration').scrollIntoViewIfNeeded();
    expect(await overflowPast(card, '.queue-card-in'), `TikTok card at ${w}px`).toEqual([]);
    for (const row of await card.locator('.tt-row').all()) {
      expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    // The meaning is read whole: the AI label's sentence, not a clipped half.
    const help = card.locator('.tt-help', { hasText: 'AI-generated label' });
    await expect(help).toHaveText("Every house post carries TikTok's AI-generated label.");
    const [h, c] = [await help.boundingBox(), await card.boundingBox()];
    expect(h.x + h.width).toBeLessThanOrEqual(c.x + c.width);
    await card.screenshot({ path: path.join(os.tmpdir(), `tiktok-card-${w}.png`) });
  }
  expect(page.__crashes).toEqual([]);
});

// Samples, in the page, what the person is pointing at: the open menu, the
// card's place on screen, the window's stacking, where focus stands, and
// the window's scroll.
const startWatch = (page) => page.evaluate(() => {
  const samples = [];
  window.__watch = samples;
  const sample = () => {
    const tt = [...document.querySelectorAll('.fwin')].find((w) => w.querySelector('.fwin-bar-title')?.textContent.startsWith('TIKTOK'));
    const menu = tt?.querySelector('.tt-settings .lc-sel');
    const z = (w) => Number(w?.style.zIndex || 0);
    samples.push({
      menuOpen: Boolean(menu?.querySelector('.lc-sel-panel')),
      triggerTop: menu ? Math.round(menu.getBoundingClientRect().top) : null,
      reading: Boolean(tt?.querySelector('.tt-settings')?.textContent.includes('READING THE TIKTOK ACCOUNT')),
      onTop: Boolean(tt) && [...document.querySelectorAll('.fwin')].every((w) => w === tt || z(w) < z(tt)),
      focusIn: Boolean(tt?.contains(document.activeElement)),
      scrollTop: tt?.querySelector('.outreach-panel')?.scrollTop ?? null,
    });
  };
  window.__watchTimer = setInterval(sample, 50);
  sample();
});
const stopWatch = (page) => page.evaluate(() => { clearInterval(window.__watchTimer); return window.__watch; });
const distinct = (samples) => [...new Set(samples.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x));

test('a streaming chat and the being\'s edits never close the open menu, move the card or take focus; the edit lands when the person leaves', async ({ page }) => {
  // His window: 575 wide, tall enough that the queue board stands in view
  // as it opens (so its 30 s read is running).
  await placeTikTok(page, { x: 320, y: 60, w: 575, h: 880 });
  await page.locator('.relink-input-field').fill('tell me a long story');
  await page.keyboard.press('Enter');
  const { win, card } = await openDraftCard(page);
  await card.locator('.lc-sel-trigger').click();
  await expect(card.locator('.lc-sel-panel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.body.textContent.match(/word\d+/g) || []).length)).toBeGreaterThan(10);
  await startWatch(page);
  // The being's work lands on the queue: it rewrites this draft's words and
  // stages another — then the board's 30 s read comes round.
  writeQueue([
    { ...readQueue()[0], text: `${DRAFT_TEXT}\n#forge #night` },
    draft('tt-draft-2', 'A second cut\nprivacy: followers', 1, clip),
  ]);
  await page.waitForTimeout(33000);
  const held = await stopWatch(page);
  expect(distinct(held), JSON.stringify(distinct(held))).toEqual([held[0]]);
  // One state, held the whole time: the menu open, the card where it was,
  // the window on top with focus in it, and the window's scroll untouched.
  expect(held[0]).toMatchObject({ menuOpen: true, reading: false, onTop: true, focusIn: true });
  expect(held[0].scrollTop).toBeGreaterThan(0);
  await expect(card.locator('.queue-preview-text')).not.toContainText('#forge');
  // The person closes the menu and leaves the window: what waited lands —
  // the new words and the new card — and the card never blanked to land it.
  await page.keyboard.press('Escape');
  await startWatch(page);
  await page.mouse.click(1450, 500);
  await expect(card.locator('.queue-preview-text')).toContainText('#forge #night', { timeout: 5000 });
  await expect(win.locator('.queue-card', { hasText: 'A second cut' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await stopWatch(page)).every((x) => !x.reading)).toBe(true);
  expect(page.__crashes).toEqual([]);
});

test('a toast rising under the pointer takes no press: the click lands on the window beneath', async ({ page }) => {
  // The TIKTOK window under the announcement lane (bottom right).
  await placeTikTok(page, { x: 900, y: 120, w: 575, h: 820 });
  await page.locator('.relink-input-field').fill('tell me a long story');
  await page.keyboard.press('Enter');
  const { win } = await openDraftCard(page);
  await startWatch(page);
  // The turn ends; its FINISHED card rises — press where it lands at once.
  const toast = page.locator('.ntray-card.is-toast').first();
  await toast.waitFor({ state: 'attached', timeout: 60000 });
  const box = await toast.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const after = await stopWatch(page);
  expect(after.at(-1)).toMatchObject({ onTop: true });
  await expect(win).toBeVisible();
  // Settled, the same card answers a press as it always did.
  await page.waitForTimeout(800);
  if (await toast.count()) {
    await toast.locator('.ntray-card-body').click();
    await expect.poll(() => page.evaluate(() => {
      const wins = [...document.querySelectorAll('.fwin')];
      const tt = wins.find((w) => w.querySelector('.fwin-bar-title')?.textContent.startsWith('TIKTOK'));
      return wins.some((w) => w !== tt && Number(w.style.zIndex) > Number(tt.style.zIndex));
    })).toBe(true);
  }
  expect(page.__crashes).toEqual([]);
});

test('an ask rising in the chat never pulls the caret out of a field in another window', async ({ page }) => {
  await page.locator('.relink-input-field').fill(ASK_THOUGHT);
  await page.keyboard.press('Enter');
  const { win } = await openDraftCard(page);
  const field = win.locator('textarea.settings-input[placeholder="What should go out?"]');
  await field.click();
  await page.keyboard.type('caption draft');
  await expect(page.locator('.ask-chip.pending')).toBeAttached({ timeout: 30000 });
  await page.keyboard.type(' still mine');
  await expect(field).toHaveValue('caption draft still mine');
  expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
  expect(page.__crashes).toEqual([]);
});
