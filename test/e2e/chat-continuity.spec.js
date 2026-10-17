// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { ethers } from 'ethers';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

/**
 * End-to-end chat continuity — the chatbot contract: the chat on screen IS
 * the chat the next message continues. Returning to the desk, reloading, or
 * resuming from the CHATS window must append to the same session (and carry
 * its context into the prompt); only NEW CHAT forks.
 *
 * Everything is REAL (RULE 0): real auth (challenge-sign-verify), real
 * portal WS, real LLM turns through the live substrate, and the session
 * record asserted on the actual workspace files — the same neumaWorkspace
 * module the backend writes through, pointed at the same root.
 *
 * Requires the dev stack running with an ISOLATED temp workspace root:
 *   WORKSPACES_ROOT=<tmp>/workspaces (backend AND this test process)
 * The suite refuses to run against a non-temp root — it creates and wipes
 * test lanes, and must never touch a real workspace home.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

const ROOT = process.env.WORKSPACES_ROOT || '';
const rootIsTemp = () => {
  if (!ROOT) return false;
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(ROOT));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// A lane, not a being: bare storage scaffolding in a disposable temp root —
// no ceremony, no DNA, no identity. Wiped and reseeded per run.
const NEUMA_ID = 'e2e-continuity';
const SEED_SESSION = 'session-1000000000000';

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token via the backend's challenge-sign-verify.
const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

const sessionCount = async () => (await neumaWorkspace.listSessions(NEUMA_ID)).length;
const seedLength = async () => (await neumaWorkspace.readSession(NEUMA_ID, SEED_SESSION)).length;

// One real turn: type, send, and wait until the exchange has actually been
// persisted into the given session (server truth on disk, not screen state).
const sendAndAwaitPersist = async (page, text, sessionId, expectedLength) => {
  const field = page.locator('.relink-input-field');
  await field.fill(text);
  await field.press('Enter');
  await expect
    .poll(async () => (await neumaWorkspace.readSession(NEUMA_ID, sessionId)).length, {
      timeout: 180000, // a real LLM turn
      intervals: [1000],
    })
    .toBe(expectedLength);
};

let token;
let addr;
test.beforeAll(async () => {
  if (!rootIsTemp()) {
    throw new Error(
      'chat-continuity.spec.js needs WORKSPACES_ROOT set to a temp dir (for the backend AND the test), '
      + 'so its disposable test lane never touches a real workspace home.',
    );
  }
  ({ token, addr } = await mintToken());
  // Fresh lane every run: wipe leftover sessions, reseed one prior chat that
  // holds a fact ("plum") the resumed conversation must still know.
  await fs.promises.rm(path.join(ROOT, NEUMA_ID, 'sessions'), { recursive: true, force: true });
  await neumaWorkspace.create(NEUMA_ID);
  // The workspace REST routes require ownership — claim the lane for the
  // test wallet the way a real claim writes it.
  await fs.promises.writeFile(
    path.join(ROOT, NEUMA_ID, 'owner.json'),
    JSON.stringify({ wallet: addr.toLowerCase(), claimedAt: Date.now() }),
  );
  await neumaWorkspace.createSession(NEUMA_ID, SEED_SESSION);
  await neumaWorkspace.appendMessage(NEUMA_ID, SEED_SESSION, {
    role: 'user', content: 'Remember this for later: the sky word is plum.',
  });
  await neumaWorkspace.appendMessage(NEUMA_ID, SEED_SESSION, {
    role: 'assistant', content: 'Understood — the sky word is plum. I will keep it.',
  });
});

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Sessia', neumaId: 'e2e-continuity' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
});

test('CONTINUITY: resumed history is fully alive — no dimming, the past stays interactive', async ({ page }) => {
  // A chat picked back up is the living conversation, not a faded artifact:
  // past turns render at full weight and stay interactive (EDIT-recall,
  // ArrowUp) exactly like live ones. Only the SESSION RESUMED divider marks
  // the re-entry. Runs first, against the pristine seeded history.
  await page.goto('/');
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });

  const pastUser = page.locator('.relink-msg--user.is-history').first();
  await expect(pastUser).toBeVisible({ timeout: 15000 });
  expect(await pastUser.evaluate((el) => getComputedStyle(el).opacity)).toBe('1'); // no gray-out

  // WHEN it was said rides the record into the resumed view: the clock
  // stamp renders on restored turns (seeded moments ago → the time alone).
  await expect(pastUser.locator('.relink-msg-when')).toHaveText(/\d{1,2}:\d{2} (AM|PM)/);

  // The past is editable: hover reveals EDIT, clicking pulls that message
  // into the composer — stepping back to reframe, without rewriting time.
  await pastUser.hover();
  const edit = pastUser.locator('.relink-edit');
  await expect
    .poll(() => edit.evaluate((el) => getComputedStyle(el).opacity)) // hover fade-in
    .toBe('1');
  await edit.click();
  await expect(field).toHaveValue(/sky word is plum/);

  // ArrowUp in an emptied field recalls the last sent message — from history.
  await field.fill('');
  await field.press('ArrowUp');
  await expect(field).toHaveValue(/sky word is plum/);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('CONTINUITY: arriving (and reloading) continues the latest chat — same session, context intact', async ({ page }) => {
  // Watch the portal frames: the turn's complete must carry the session it
  // landed in (the client's reconnect anchor).
  const completes = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    try {
      const m = JSON.parse(String(f.payload));
      if (m.type === 'consciousness:complete') completes.push(m);
    } catch { /* non-JSON frame */ }
  }));

  await page.goto('/');
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });
  // Coming back doesn't read as memory loss: the prior chat is on screen.
  await expect(page.getByText(/sky word is plum/i).first()).toBeVisible({ timeout: 15000 });

  // Continue it. The exchange must land in the SAME session — the reported
  // bug was a silent fork into a fresh session here.
  await sendAndAwaitPersist(page, 'What is the sky word? Answer in one short sentence.', SEED_SESSION, 4);
  expect(await neumaWorkspace.listSessions(NEUMA_ID)).toEqual([SEED_SESSION]); // no fork
  const afterFirst = await neumaWorkspace.readSession(NEUMA_ID, SEED_SESSION);
  expect(afterFirst[3].role).toBe('assistant');
  // The context truly came back: the neuma answers from the resumed chat.
  expect(afterFirst[3].content.toLowerCase()).toContain('plum');
  expect(completes.some((m) => m.sessionId === SEED_SESSION)).toBe(true);

  // The exact reported scenario: leave and come back (reload), continue again.
  await page.reload();
  await expect(field).toBeEnabled({ timeout: 15000 });
  await expect(page.getByText(/sky word is plum/i).first()).toBeVisible({ timeout: 15000 });
  await sendAndAwaitPersist(page, 'Say the sky word once more, briefly.', SEED_SESSION, 6);
  expect(await neumaWorkspace.listSessions(NEUMA_ID)).toEqual([SEED_SESSION]); // still one chat
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('CONTINUITY: a backend restart reconnects into the SAME chat — a severed link never forks the session', async ({ page }) => {
  // Not a reload — the server goes away mid-session (exactly what a dev
  // --watch respawn or a crash does) and comes back. The client
  // auto-reconnects and must re-issue portal:resume from the held session
  // state; without that, the next message after ANY reconnect silently
  // minted a fresh session. Requires AUTH_SECRET pinned in the backend env
  // so the session token survives the restart (per-boot random otherwise).
  test.skip(!process.env.AUTH_SECRET, 'needs AUTH_SECRET shared with the backend so tokens survive the restart');

  // Only the portal sockets count — vite's HMR socket lives on this page too
  // (and even carries its own token= param), and must not fake a "reconnect".
  const sockets = [];
  page.on('websocket', (ws) => { if (ws.url().includes('/ws?')) sockets.push(ws); });

  await page.goto('/');
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });
  await expect(page.getByText(/sky word is plum/i).first()).toBeVisible({ timeout: 15000 });

  const countBefore = await sessionCount();
  const lengthBefore = await seedLength();
  const port = process.env.PORT || 3333;

  // Kill the backend for real and bring it back with the same env. Only the
  // LISTENER: a bare -i:<port> also matches the dev server's proxy
  // connections TO the backend and would take the frontend down with it.
  execSync(`kill -9 $(lsof -t -iTCP:${port} -sTCP:LISTEN)`);
  await expect
    .poll(() => { try { execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN`); return 'bound'; } catch { return 'free'; } },
      { timeout: 15000 })
    .toBe('free');
  const backend = spawn('node', ['backend/server.js'], {
    cwd: REPO, env: process.env, detached: true, stdio: 'ignore',
  });
  backend.unref();

  // The client notices the sever and re-links on its own — a SECOND portal
  // socket opens (auto-reconnect), no reload involved. Behind the dev proxy
  // the browser-side socket may survive the backend's death, in which case
  // the client's own stale check (120s of server silence, checked every
  // 15s) is what notices — allow for that full window.
  await expect
    .poll(() => sockets.length, { timeout: 220000, intervals: [2000] })
    .toBeGreaterThan(1);
  await expect(field).toBeEnabled({ timeout: 60000 }); // re-linked

  // Continue the conversation across the restart — same session, no fork.
  await sendAndAwaitPersist(page, 'After that hiccup: the sky word again, please, briefly.', SEED_SESSION, lengthBefore + 2);
  expect(await sessionCount()).toBe(countBefore);
  const seed = await neumaWorkspace.readSession(NEUMA_ID, SEED_SESSION);
  expect(seed[seed.length - 1].content.toLowerCase()).toContain('plum');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('CONTINUITY: NEW CHAT forks deliberately; resuming from CHATS appends to that chat', async ({ page }) => {
  await page.goto('/');
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });

  // Only NEW CHAT forks: sever, speak, and a second session is minted.
  await openDockApp(page, 'CHATS');
  await page.locator('.chats-new').click();
  await field.fill('A fresh topic: name any one color, one word only.');
  await field.press('Enter');
  // The session file is minted at turn start; the exchange lands at turn end.
  await expect.poll(sessionCount, { timeout: 180000, intervals: [1000] }).toBe(2);
  const [newest] = await neumaWorkspace.listSessions(NEUMA_ID);
  expect(newest).not.toBe(SEED_SESSION);
  await expect
    .poll(async () => (await neumaWorkspace.readSession(NEUMA_ID, newest)).length, {
      timeout: 180000, intervals: [1000],
    })
    .toBe(2);

  // Resume the seeded chat from the CHATS list — the next message appends
  // there, and no third session appears.
  const before = await seedLength();
  // The stream window took focus for the reply — raise CHATS back above it.
  await openDockApp(page, 'CHATS');
  await page.locator('.chats-row', { hasText: '2001' }).first().click(); // the 2001-epoch seed label
  await expect(page.getByText(/sky word is plum/i).first()).toBeVisible({ timeout: 15000 });
  await sendAndAwaitPersist(page, 'Back to our old thread: the sky word, one word.', SEED_SESSION, before + 2);
  expect(await sessionCount()).toBe(2);
  const seed = await neumaWorkspace.readSession(NEUMA_ID, SEED_SESSION);
  expect(seed[seed.length - 1].content.toLowerCase()).toContain('plum');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
