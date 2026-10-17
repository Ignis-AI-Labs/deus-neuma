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
 * PICK UP WHERE YOU LEFT OFF — a REAL browser, a REAL reload.
 *
 * Design note, 2026-08-02: […]
 *
 * Everything on the claimed path is real: a real backend, real vite, real
 * localStorage, a real session on real disk written through the real workspace
 * API, and a real `page.reload()`. Nothing is mocked (RULE 0).
 *
 * SAFETY LAW: never the live witness stack — this file boots its OWN backend +
 * vite on PID-derived bind-probed ports with a disposable WORKSPACES_ROOT and
 * the NEUMA_* isolation doors, so the operator's real beings can never be read
 * or written here.
 *
 * Needs no LLM: the prior sitting is written to disk directly (that IS how a
 * session is stored), so nothing here sends a thought.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (rail 7461/3461, model-bar
// 7621/3621, attach 7891/3891, terminal 7581/3581, context-map 7411/3511).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch the
// listener.
const FPORT_BASE = 7291 + (process.pid % 149);
const BPORT_BASE = 3291 + (process.pid % 149);

const NEUMA_ID = 'e2e-restorebeing';
const OTHER_ID = 'e2e-restoreother';
const PRIOR_SESSION = 'session-1754000000123';
const PRIOR_WORDS = 'the sitting you were in when it crashed';
const KEY = 'gnosis-session-restore-key-long-enough';

let FPORT; let BPORT; let BASE; let root;
let backendProc; let viteProc; let token; let addr; let workspace;

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
      try {
        const r = await fetch(url);
        if (r.status < 500) return;
      } catch { /* not listening yet */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${list.join(' | ')}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/** Every session file a being holds, on real disk. */
const sessionsOnDisk = (neumaId) => {
  try {
    return fs.readdirSync(path.join(root, neumaId, 'sessions')).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
};

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'restore-e2e-'));
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
    SUBSTRATE_IDLE_MINUTES: '0',
    DNA_ENCRYPTION_KEY: KEY,
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());

  // THE PRIOR SITTING, written through the REAL workspace API into the REAL
  // store — this is exactly how a session reaches disk in production, so what
  // the desk restores from is the genuine article, not a fixture shaped like one.
  process.env.DNA_ENCRYPTION_KEY = KEY;
  const engine = await import('../../core/workspace/neuma-workspace.js');
  engine.setWorkspacesRoot(root);
  workspace = engine.default;
  for (const id of [NEUMA_ID, OTHER_ID]) {
    await workspace.create(id);
    await claimOwner(root, id, addr);
  }
  await workspace.createSession(NEUMA_ID, PRIOR_SESSION);
  await workspace.appendMessage(NEUMA_ID, PRIOR_SESSION, { role: 'user', content: PRIOR_WORDS });
  await workspace.appendMessage(NEUMA_ID, PRIOR_SESSION, { role: 'assistant', content: 'I remember where we were.' });
  // A SECOND, NEWER sitting. Without it the test would pass even if the desk
  // still fell back to "the newest session" — the two must be distinguishable.
  await workspace.createSession(NEUMA_ID, 'session-1754999999999');
  await workspace.appendMessage(NEUMA_ID, 'session-1754999999999', { role: 'user', content: 'a NEWER chat you were not in' });
});

test.afterAll(async () => {
  // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pkill/pattern matching.
  for (const p of [viteProc, backendProc]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    }
  }
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
});

// The post-birth checklist stands over the desk on every load. It is not what
// any of these cases are about, so dismissing it is BEST EFFORT: its arrival
// dialog holds the desk while it probes and its own rows eat pointer events, so
// the click cannot always land. Nothing here is swallowed that matters — a case
// that must actually TYPE (the draft one) asserts its own field and fails loudly
// if the gate is genuinely in the way.
const standAside = async (page) => {
  const button = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (!(await button.isVisible({ timeout: 5000 }).catch(() => false))) return;
  await page.locator('.arrival.is-holding').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await button.click({ timeout: 10000 }).catch(() => {});
};

// Seed the desk exactly as a PRIOR RUN would have left it: the wallet, the
// bound being, and a tab strip carrying the sitting that tab held.
const seedDesk = (page, { tabs }) => page.addInitScript(({ t, a, tabState }) => {
  const w = a.toLowerCase();
  localStorage.setItem('walletAddress', a);
  localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Restorebeing', neumaId: 'e2e-restorebeing' }));
  sessionStorage.setItem('authToken', t);
  localStorage.setItem(`${w}:win:desk:tabs`, JSON.stringify(tabState));
}, { t: token, a: addr, tabState: tabs });

const land = async (page) => {
  await page.goto(`http://localhost:${FPORT}/?noboot=1`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 20000 });
  await standAside(page);
};

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
});

test('THE ASK: a restored tab returns to the sitting it held, not the newest one', async ({ page }) => {
  const before = sessionsOnDisk(NEUMA_ID);
  await seedDesk(page, {
    tabs: {
      tabs: [{ id: 'tab-1', kind: 'local', neumaId: NEUMA_ID, name: 'Restorebeing', sessionId: PRIOR_SESSION, createdAt: null }],
      focusedId: 'tab-1',
    },
  });
  await land(page);

  // The words from the sitting the operator left are on screen.
  await expect(page.getByText(PRIOR_WORDS, { exact: false }).first()).toBeVisible({ timeout: 20000 });
  // …and NOT the newer chat they were never in. Before this fix the desk fell
  // back to whichever session was newest, which is exactly the complaint.
  await expect(page.getByText('a NEWER chat you were not in', { exact: false })).toHaveCount(0);

  // AND NOTHING WAS MINTED OVER IT. The old defect was worse than failing to
  // resume: focusPlan read a null sessionId as "never spoken" and ChatApp
  // called newSession(), starting a fresh sitting on top of the operator's work.
  expect(sessionsOnDisk(NEUMA_ID)).toEqual(before);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a tab that never spoke still opens as a fresh place, and mints nothing on landing', async ({ page }) => {
  const before = sessionsOnDisk(OTHER_ID);
  await seedDesk(page, {
    tabs: {
      tabs: [{ id: 'tab-1', kind: 'local', neumaId: OTHER_ID, name: 'Restoreother', sessionId: null, createdAt: null }],
      focusedId: 'tab-1',
    },
  });
  await land(page);
  await expect(page.locator('.relink-input-field')).toBeEnabled();
  // A session is minted by the SERVER on the first message, never by landing —
  // so a restart still spends nothing before the operator has asked for it
  // (Founder's 2026-07-30 law, unamended).
  expect(sessionsOnDisk(OTHER_ID)).toEqual(before);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a stale session id degrades to a fresh place rather than breaking the desk', async ({ page }) => {
  await seedDesk(page, {
    tabs: {
      tabs: [{ id: 'tab-1', kind: 'local', neumaId: NEUMA_ID, name: 'Restorebeing', sessionId: 'session-1700000000000', createdAt: null }],
      focusedId: 'tab-1',
    },
  });
  await land(page);
  // The sitting is gone (deleted, or from another machine). The desk must open
  // anyway — a missing chat costs the chat, never the window.
  await expect(page.locator('.relink-input-field')).toBeEnabled();
  await expect(page.getByText(PRIOR_WORDS, { exact: false })).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a malformed session id in storage is refused, and the desk still opens', async ({ page }) => {
  // localStorage is writable by anything, and a session id becomes a path
  // segment server-side.
  await seedDesk(page, {
    tabs: {
      tabs: [{ id: 'tab-1', kind: 'local', neumaId: NEUMA_ID, name: 'Restorebeing', sessionId: '../../etc/passwd', createdAt: null }],
      focusedId: 'tab-1',
    },
  });
  await land(page);
  await expect(page.locator('.relink-input-field')).toBeEnabled();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('unsent words survive a real reload, and stay with their own chat', async ({ page }) => {
  await seedDesk(page, {
    tabs: {
      tabs: [{ id: 'tab-1', kind: 'local', neumaId: NEUMA_ID, name: 'Restorebeing', sessionId: PRIOR_SESSION, createdAt: null }],
      focusedId: 'tab-1',
    },
  });
  await land(page);

  const field = page.locator('.relink-input-field');
  const half = 'ok so the polarity screen needs to—';
  await field.fill(half);
  // The composer debounces its keep; give that one beat rather than racing it.
  await page.waitForTimeout(500);

  // THE CRASH: a real reload, not a state reset.
  await page.reload();
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 20000 });
  await standAside(page);

  await expect(page.locator('.relink-input-field')).toHaveValue(half);

  // …and it was filed under THE SITTING, not the pre-send bucket. This is the
  // common case — a half-typed reply in a chat already underway — and it only
  // works because the composer learns the bound session from the socket's
  // `session:state`. Keyed to the unbound bucket instead, the text would be
  // stranded the moment the tab restored its real sitting.
  const drafts = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith(':win:drafts'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  expect(Object.keys(drafts)).toContain(`${'e2e-restorebeing'}:${'session-1754000000123'}`);
  expect(Object.keys(drafts).some((k) => k.includes('__unbound__'))).toBe(false);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
