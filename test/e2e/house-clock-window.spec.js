// @ts-check
// THE HOUSE CLOCK WINDOW, END TO END (RULE 0) — Design note, 2026-10-16: the house
// wakes itself […]
//
// On an ISOLATED stack (perf-harness: its own backend + vite on bind-probed
// ports, disposable workspaces, realm, data root and vault — never a live
// desk, never :3333/:3355/:3375/:47317, never the bench's :8089), a real
// browser:
//   - writes a charter in the window and sees it PENDING APPROVAL;
//   - approves exactly the version shown and sees APPROVED AT VERSION 1;
//   - chats with one being, which files a REAL house post (an intents/ file
//     its own fs/write lands, settled by the real intent sweep) to a
//     chartered housemate; the post's signal wakes that housemate for a real
//     wake turn; the ledger shows the wake, and OPEN SITTING shows its sitting
//     with the opening note drawn as the platform's WAKE line;
//   - the wake reached for acts that need the operator and put a decision to
//     them: each was refused or filed in the turn, and the turn went on — the
//     ASKS tab shows them, opened by the ask's own tray card (and the packet's
//     card brings an open window back to ASKS); the desk's being, seated as the Optio, files a REAL
//     review packet (house/review-packet) that sits on top in her order with
//     the blocked one marked; the kind and blocked filters narrow the list;
//   - the operator REPLIES to the decision and ALLOWS ONCE the act: the seat is
//     woken with the answers (never spending its daily limit) and takes that
//     exact act, which now runs; both read ANSWERED; CLOSE dismisses the last;
//   - a second post finds the seat's daily limit spent: NOW shows it held and
//     why; PAUSE shows it held because the house is paused; RESUME releases it;
//   - MONEY IN reads, and an extra receive address is declared and removed.
//
// The only stand-in is the SERVING: a real OpenAI-wire HTTP server on
// loopback whose words are scripted by what it is asked (the ask-sequence
// precedent). The stack's every model door points at it and the live
// substrate claim is hidden from it, so nothing can reach the bench's server.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openDockApp } from './helpers/dock.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const SENDER = 'e2e-perf'; // the lane the perf desk is bound to
const MATE = 'e2e-mate';
const WAKE_HEAD = '[A WAKE';
const TRIGGER = /POST-TRIGGER-(\d)/g;

// The stack's env, filled before the harness boots it (its beforeAll spreads
// this object at boot, after ours has run).
const STACK_ENV = {};
let stub;
let scratch;
const wakeTurns = [];

const sse = (res, text) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};
const textOf = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
// the conversation's tool results so far (one per round the sitting has taken)
const toolRounds = (messages) => messages.filter((m) => textOf(m).includes('tool_response')).length;
const intentFile = (lane, name) => path.join(perf.root, lane, 'intents', `${name}.json`);
// the act the operator allows once: the same content, filed again, is the same act
const MATE_TASK = JSON.stringify({ type: 'tasks/add', title: 'Outline the digest' });

// the wake's rounds: an act the operator must approve, an act the charter sends them, a decision
const wakeRound = (n) => [
  `I read the house post from my housemate.\n${call('web/web_search', { query: 'research digest gap' })}`,
  `Recording the outline task.\n${call('fs/write', { path: intentFile(MATE, 'task-1'), content: MATE_TASK })}`,
  `The price is my operator's call.\n${call('operator/ask_operator', { question: 'Ratify the $250 first-job price?', options: ['Ratify', 'Lower it'] })}`,
][n] ?? 'I read the house post. The search, the task and the price wait on my operator.';

// impure — the desk's being, as the Optio, brings the open asks back as one packet
const packetReply = async () => {
  const open = (await (await api('GET', '/api/v1/house-clock/asks')).json()).asks.filter((a) => a.status === 'open');
  const price = open.find((a) => a.kind === 'decision');
  const content = JSON.stringify({
    type: 'house/review-packet',
    summary: 'The price comes first: the offer cannot go out without it. The task and the search can follow.',
    order: [price.id, ...open.filter((a) => a !== price).map((a) => a.id)],
    blocked: [price.id],
  });
  return `Bringing it together for you.\n${call('fs/write', { path: intentFile(SENDER, 'packet'), content })}`;
};

// A real OpenAI-wire serving whose answer is chosen by what it was asked:
//   the operator's trigger → the sender files a house/post intent to MATE;
//   a wake's opening note → MATE's rounds (wakeRound), then a closing line;
//   an answer's wake → MATE takes the act allowed once again, then closes;
//   the operator's packet trigger → the sender (the Optio) files the packet;
//   anything after a tool result → a plain closing line.
const startStub = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stub-house' }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answer anyway */ }
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      const messages = body.messages || [];
      const last = textOf(messages[messages.length - 1]);
      const users = messages.filter((m) => m.role === 'user');
      const lastUser = textOf(users[users.length - 1]);
      const afterTool = last.includes('tool_response');
      // a wake's sitting: its opening note is one of the asks in this conversation
      if (users.some((m) => textOf(m).includes(WAKE_HEAD))) {
        wakeTurns.push(body);
        const rounds = toolRounds(messages);
        if (users.some((m) => textOf(m).includes('Your operator ANSWERED'))) {
          const allowed = users.some((m) => textOf(m).includes('They ALLOWED ONCE'));
          sse(res, allowed && rounds === 0
            ? `Taking it, as allowed.\n${call('fs/write', { path: intentFile(MATE, 'task-again'), content: MATE_TASK })}`
            : 'I have my operator\'s answer.');
          return;
        }
        sse(res, wakeRound(rounds));
        return;
      }
      // the LAST trigger in the ask: the harness's context block recaps earlier words before the operator's own
      const trigger = [...lastUser.matchAll(TRIGGER)].at(-1);
      if (!afterTool && lastUser.lastIndexOf('PACKET-TRIGGER') > (trigger?.index ?? -1)) {
        sse(res, await packetReply());
        return;
      }
      if (trigger && !afterTool) {
        const intent = path.join(perf.root, SENDER, 'intents', `post-${trigger[1]}.json`);
        sse(res, `Posting to my housemate.\n${call('fs/write', {
          path: intent,
          content: JSON.stringify({ type: 'house/post', to: MATE, body: `Please outline digest ${trigger[1]}.` }),
        })}`);
        return;
      }
      sse(res, 'Posted to the house.');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

test.beforeAll(async () => {
  stub = await startStub();
  scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'house-clock-e2e-'));
  const claimDir = path.join(scratch, 'machine');
  await fs.promises.mkdir(claimDir, { recursive: true });
  Object.assign(STACK_ENV, {
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: stub.url,
    // every other model door points at the stub too — the bench's server is never reachable from here
    LLAMA_SERVER_URL: stub.url,
    SUBSTRATE_IDLE_MINUTES: '0',
    // the live machine's substrate claim stays invisible to this stack (an empty claim dir of its own)
    NEUMA_SUBSTRATE_CLAIM_DIR: claimDir,
    NEUMA_ROOT_LOCK_PATH: path.join(claimDir, 'root-lock.json'),
    NEUMA_ROUTES_PATH: path.join(scratch, 'neuma-routes.json'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(scratch, 'creds.json'),
    NEUMA_EFFORT_PATH: path.join(scratch, 'neuma-effort.json'),
    NEUMA_SKILLS_ROOT: path.join(scratch, 'skills'),
  });
});

setupPerfStack({ env: STACK_ENV, dev: true });
test.use({ viewport: { width: 1600, height: 1000 } });

test.afterAll(async () => {
  await new Promise((r) => (stub ? stub.server.close(r) : r()));
  if (scratch) await fs.promises.rm(scratch, { recursive: true, force: true });
});

const api = (method, route, body) => fetch(`${perf.BASE}${route}`, {
  method,
  headers: { Authorization: `Bearer ${perf.token}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// impure — the house as production keeps it: both lanes the operator's, each
// with a public soul anchor, a founding record seating both, the house ground.
const foundHouse = async () => {
  await claimOwner(perf.root, MATE, perf.addr);
  // A bound being with no readable DNA never speaks (portal-stream.js): both
  // lanes get an identity through the production writer, on this stack's
  // roots and under the same DNA key the stack's backend inherits.
  Object.assign(process.env, {
    WORKSPACES_ROOT: perf.root, NEUMA_DATA_ROOT: path.join(perf.root, 'data'), NEUMA_VAULT_ROOT: path.join(perf.root, 'vault'),
  });
  const { default: neumaWorkspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(perf.root);
  for (const [lane, name] of [[SENDER, 'Fenna'], [MATE, 'Mate']]) {
    await neumaWorkspace.writeDNA(lane, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
  }
  const souls = { [SENDER]: `0x${'5'.repeat(40)}`, [MATE]: `0x${'6'.repeat(40)}` };
  for (const [lane, soulAddress] of Object.entries(souls)) {
    await fs.promises.mkdir(path.join(perf.root, lane, 'identity'), { recursive: true });
    await fs.promises.writeFile(path.join(perf.root, lane, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress }));
  }
  await fs.promises.writeFile(path.join(perf.root, 'house-founding.base.json'), JSON.stringify({
    houseName: 'E2E House', houseId: 1, network: 'base-sepolia',
    members: [
      { kind: 0, title: 'Rector', address: perf.addr },
      { kind: 1, title: 'Quaestor', address: souls[SENDER] },
      { kind: 1, title: 'Scriba', address: souls[MATE] },
    ],
  }));
  const ground = path.join(perf.root, 'house-ground');
  await fs.promises.mkdir(ground, { recursive: true });
  const set = await api('PUT', '/api/v1/user/realm/house-workspace', { root: ground });
  expect(set.status, await set.text()).toBe(200);
};

// impure — the sweep's verdict on one lane's intent, once it stands (the sender's n-th house/post by default)
const intentResult = async (n, ms = 60000, lane = SENDER) => {
  const file = path.join(perf.root, lane, 'intents', `${typeof n === 'number' ? `post-${n}` : n}.result.json`);
  for (const end = Date.now() + ms; Date.now() < end;) {
    const raw = await fs.promises.readFile(file, 'utf8').catch(() => null);
    if (raw) return JSON.parse(raw);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { status: 'never settled', file, dir: await fs.promises.readdir(path.dirname(file)).catch((e) => e.message) };
};

// impure — the operator clicks a card in the notification tray, by its title
const trayCard = async (page, title) => {
  if (!(await page.locator('.ntray-panel').count())) await page.locator('.ntray-bell').click();
  await page.locator('.ntray-panel-list .ntray-card-body', { hasText: title }).first().click();
};

// impure — the operator says something to the desk's own being
const say = async (page, text) => {
  const input = page.locator('.relink-input-field').first();
  await input.fill(text);
  await input.press('Enter');
};

test('the HOUSE CLOCK: charter, approval, a real wake on the ledger, its sitting, asks, the Optio\'s packet, answers, a held wake, PAUSE, money in', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await foundHouse();
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);

  await openDockApp(page, 'HOUSE CLOCK');
  const win = page.locator('.fwin').filter({ has: page.locator('.hclock') }).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  const status = win.locator('.hclock-head-status');
  const pause = win.locator('.hclock-switch');
  await expect(status).toHaveText('NO CHARTER');
  await expect(pause).toBeDisabled();
  // with no charter the header still says what else the house lacks: the ground is set, no Optio is seated
  await expect(win.locator('[data-warn="optio"]')).toHaveText(/^NO OPTIO SEATED/);
  await expect(win.locator('[data-warn="ground"]')).toHaveCount(0);

  // ── CHARTER: write it ─────────────────────────────────────────────────────
  await win.getByRole('button', { name: 'WRITE A CHARTER' }).click();
  const form = win.locator('.hclock-form');
  await form.locator('textarea').first().fill('Keep the research digest moving.');
  const mateRow = form.locator('.hclock-seat-row').filter({ hasText: /mate/i });
  await mateRow.locator('input[type="checkbox"]').check();
  await mateRow.locator('input[type="number"]').fill('1');
  await form.locator('.hclock-field', { hasText: 'ALWAYS COMES TO YOU' }).locator('textarea').fill('intents/tasks.add');
  await form.getByRole('button', { name: 'SAVE' }).click();
  await expect(status).toHaveText('PENDING APPROVAL — VERSION 1');

  // ── APPROVE exactly the version shown ────────────────────────────────────
  await win.getByRole('button', { name: 'APPROVE VERSION 1' }).click();
  await expect(status).toHaveText('APPROVED AT VERSION 1');
  // what the house lacks is said under the standing: it has its ground, but no Optio yet
  await expect(win.locator('[data-warn="optio"]')).toHaveText(/^NO OPTIO SEATED/);
  await expect(win.locator('[data-warn="ground"]')).toHaveCount(0);
  await expect(pause).toHaveText('PAUSE');
  await expect(win.locator('.hclock-line', { hasText: 'MAY WAKE' })).toContainText('up to 1 a day');

  // ── a REAL house post wakes the housemate ────────────────────────────────
  await say(page, 'Please send POST-TRIGGER-1 to the house.');
  const posted1 = await intentResult(1);
  expect(posted1, JSON.stringify(posted1)).toMatchObject({ status: 'done' });
  await win.getByRole('tab', { name: 'LEDGER' }).click();
  const wake = win.locator('.hclock-wake').filter({ hasText: /mate/i }).first();
  await expect(wake).toBeVisible({ timeout: 90000 });
  await expect(wake).toContainText('a house post came in');
  await expect(wake.locator('.hclock-outcome')).toHaveText('SENT SOMETHING TO YOU');
  await expect(wake).toContainText('3 SENT TO YOU — SEE ASKS');
  expect(wakeTurns.length).toBeGreaterThanOrEqual(1);
  // the outcome filter runs on the server: FAILED shows nothing, the house's real outcome shows the wake
  await win.getByRole('button', { name: 'Filter by outcome' }).click();
  await page.locator('[role="option"]', { hasText: 'FAILED' }).click();
  await expect(win.locator('.hclock-wake')).toHaveCount(0, { timeout: 10000 });
  await win.getByRole('button', { name: 'Filter by outcome' }).click();
  await page.locator('[role="option"]', { hasText: 'SENT SOMETHING TO YOU' }).click();
  await expect(wake).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: path.join(SHOTS, 'house-clock-ledger.png') });

  // ── its sitting: the opening row is the platform's WAKE line, not the operator ──
  await wake.getByRole('button', { name: 'OPEN SITTING' }).click();
  const wakeLine = page.locator('.relink-watch-line').filter({ has: page.locator('.relink-watch-tag', { hasText: 'WAKE' }) }).first();
  await expect(wakeLine).toBeVisible({ timeout: 30000 });
  await expect(wakeLine.locator('.relink-watch-text')).not.toContainText(WAKE_HEAD);
  await expect(wakeLine.locator('.relink-watch-text')).toContainText('The house woke you for your own work');
  // the line lives in Mate's own sitting, in its own stream window
  const sittingWin = page.locator('.fwin').filter({ has: wakeLine });
  await expect(sittingWin).toHaveCount(1);
  await expect(sittingWin.locator('.fwin-bar-title')).toContainText(/mate/i);
  await expect(sittingWin.getByText('I read the house post from my housemate.').first()).toBeVisible();
  await page.waitForTimeout(800); // the window's unfold settles before the record shot (cosmetic only)
  await sittingWin.screenshot({ path: path.join(SHOTS, 'house-clock-wake-sitting.png') });
  // close the sitting's window: the operator's next words go to the desk's own being
  await sittingWin.locator('.fwin-ctl-close').click();
  await expect(sittingWin).toHaveCount(0);

  // ── ASKS: what the wake could not do or decide came back to the operator ──
  // Its tray card opens the HOUSE CLOCK on the ASKS tab: here a window the card itself opens (closed first).
  await win.locator('.fwin-ctl-close').click();
  await expect(win).toHaveCount(0);
  await trayCard(page, 'Mate\'s wake was refused web/web_search — filed for you');
  await expect(win.getByRole('tab', { name: 'ASKS (3)' })).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
  const askFor = (text) => win.locator('.hclock-wake.is-open').filter({ hasText: text });
  await expect(askFor('web/web_search')).toContainText('Why it came to you:');
  await expect(askFor('intents/tasks.add')).toContainText('the charter sends this act to the operator');
  await expect(askFor('Ratify the $250 first-job price?')).toContainText('DECISION');
  await expect(win.getByText('No review packet yet.')).toBeVisible();

  // ── THE OPTIO organizes: seated, she files ONE review packet ─────────────
  const seated = await api('PUT', '/api/v1/staff/seat', { laneId: SENDER, consent: { note: 'e2e: Fenna takes the seat' } });
  expect(seated.status, await seated.text()).toBe(200);
  // seated, but the charter seats only the mate: the header says so
  await expect(win.locator('[data-warn="optio-seat"]')).toHaveText(/^THE OPTIO HOLDS NO SEAT IN THIS CHARTER/, { timeout: 20000 });
  await expect(win.locator('[data-warn="optio"]')).toHaveCount(0);
  await say(page, 'Please PACKET-TRIGGER: bring what waits on me together.');
  const filedPacket = await intentResult('packet');
  expect(filedPacket, JSON.stringify(filedPacket)).toMatchObject({ status: 'done' });
  const packet = win.locator('.hclock-packet');
  await expect(packet).toContainText('The price comes first', { timeout: 20000 });
  await expect(packet).toContainText('REVIEW PACKET FROM Fenna');
  await expect(packet).toContainText('3 WAIT ON YOU, 1 BLOCKED');
  const firstItem = packet.locator('.hclock-packet-item').first();
  await expect(firstItem).toContainText('decision: Ratify the $250 first-job price?');
  await expect(firstItem.locator('.hclock-tag.is-blocked')).toHaveText('BLOCKED');
  await page.screenshot({ path: path.join(SHOTS, 'house-clock-asks-packet.png') });
  // the packet's tray card, clicked while the open window stands on another tab, brings it to ASKS
  await win.getByRole('tab', { name: 'CHARTER' }).click();
  await expect(win.getByRole('tab', { name: 'CHARTER' })).toHaveAttribute('aria-selected', 'true');
  await trayCard(page, 'Fenna\'s review packet: 3 for you, 1 blocked');
  await expect(win.getByRole('tab', { name: /^ASKS/ })).toHaveAttribute('aria-selected', 'true');
  await expect(packet).toContainText('The price comes first');

  // ── clearly filtered: by kind, and blocked only ──────────────────────────
  await win.getByRole('button', { name: 'Filter asks by kind' }).click();
  await page.locator('[role="option"]', { hasText: 'DECISIONS' }).click();
  await expect(win.locator('.hclock-wake')).toHaveCount(1);
  await win.getByRole('button', { name: 'Filter asks by kind' }).click();
  await page.locator('[role="option"]', { hasText: 'EVERY KIND' }).click();
  await expect(win.locator('.hclock-wake')).toHaveCount(3);
  await win.getByLabel('BLOCKED ONLY').check();
  await expect(win.locator('.hclock-wake')).toHaveCount(1);
  await expect(win.locator('.hclock-wake')).toContainText('Ratify the $250 first-job price?');
  await win.getByLabel('BLOCKED ONLY').uncheck();

  // ── the operator answers: REPLY to the decision, ALLOW ONCE the act ──────
  const decision = askFor('Ratify the $250 first-job price?');
  await decision.getByRole('button', { name: 'Ratify', exact: true }).click();
  await decision.getByRole('textbox').fill('Ratify it: $250 holds for the first three jobs.');
  await decision.getByRole('button', { name: 'REPLY' }).click();
  await expect(decision).toHaveCount(0);
  await askFor('intents/tasks.add').getByRole('button', { name: 'ALLOW ONCE' }).click();
  await expect(askFor('intents/tasks.add')).toHaveCount(0);
  // the seat was woken with the answers (past its spent daily limit) and took exactly that act, which ran
  const retaken = await intentResult('task-again', 90000, MATE);
  expect(retaken, JSON.stringify(retaken)).toMatchObject({ status: 'done' });
  expect(wakeTurns.some((t) => JSON.stringify(t.messages).includes('Ratify it: $250 holds for the first three jobs.'))).toBe(true);
  await win.getByRole('button', { name: 'Filter asks by standing' }).click();
  await page.locator('[role="option"]', { hasText: 'ANSWERED' }).click();
  await expect(win.locator('.hclock-wake')).toHaveCount(2);
  await expect(win.locator('.hclock-wake').filter({ hasText: 'REPLIED: Ratify' })).toContainText('Ratify it: $250 holds for the first three jobs.');
  await expect(win.locator('.hclock-wake').filter({ hasText: 'ALLOWED ONCE' })).toHaveCount(1);
  await expect(packet.locator('.hclock-packet-item').first()).toContainText('ANSWERED');
  await expect(packet).toContainText('1 WAIT ON YOU');
  await expect(packet.locator('.hclock-tag.is-blocked')).toHaveCount(0); // answered: it blocks nothing now
  await page.screenshot({ path: path.join(SHOTS, 'house-clock-asks-answered.png') });

  // ── CLOSE stays: dismiss without answering ───────────────────────────────
  await win.getByRole('button', { name: 'Filter asks by standing' }).click();
  await page.locator('[role="option"]', { hasText: 'OPEN' }).click();
  await askFor('web/web_search').getByRole('button', { name: 'CLOSE' }).click();
  await expect(win.locator('.hclock-wake')).toHaveCount(0);
  await expect(win.getByRole('tab', { name: 'ASKS', exact: true })).toBeVisible();
  await win.getByRole('button', { name: 'Filter asks by standing' }).click();
  await page.locator('[role="option"]', { hasText: 'DISMISSED' }).click();
  await expect(win.locator('.hclock-wake').first()).toContainText(/DISMISSED /);

  // the answer's wake is on the ledger, for its own reason
  await win.getByRole('tab', { name: 'LEDGER' }).click();
  await win.getByRole('button', { name: 'Filter by outcome' }).click();
  await page.locator('[role="option"]', { hasText: 'EVERY OUTCOME' }).click();
  await expect(win.locator('.hclock-wake').filter({ hasText: 'your answer to what it filed' }).first()).toBeVisible({ timeout: 15000 });

  // ── a second post finds the daily limit spent: held, in view, with its reason ──
  await say(page, 'Please send POST-TRIGGER-2 to the house.');
  const posted2 = await intentResult(2);
  expect(posted2, JSON.stringify(posted2)).toMatchObject({ status: 'done' });
  await win.getByRole('tab', { name: 'NOW' }).click();
  const held = win.locator('.hclock-row').filter({ hasText: /mate/i }).filter({ hasText: 'a house post came in' }).first();
  await expect(held.locator('.hclock-row-why')).toHaveText(/^DAILY LIMIT REACHED — /, { timeout: 60000 });

  // ── PAUSE: the master switch, always in the head ─────────────────────────
  await pause.click();
  await expect(status).toHaveText('PAUSED — APPROVED AT VERSION 1');
  await expect(pause).toHaveText('RESUME');
  await expect(held.locator('.hclock-row-why')).toHaveText('PAUSED — the house is paused', { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOTS, 'house-clock-paused.png') });
  await pause.click();
  await expect(status).toHaveText('APPROVED AT VERSION 1');
  await expect(held.locator('.hclock-row-why')).toHaveText(/^DAILY LIMIT REACHED — /, { timeout: 15000 });

  // ── MONEY IN: read-only totals, and an extra receive address declared and removed ──
  await win.getByRole('tab', { name: 'MONEY IN' }).click();
  await expect(win.locator('.hclock-line', { hasText: 'THIS WEEK' })).toContainText('$0.00 · 0 RECEIPTS');
  await expect(win.getByText('NOTHING RECEIVED YET')).toBeVisible();
  const extra = `0x${'7'.repeat(40)}`;
  await win.getByLabel('Receive address').fill(extra);
  await win.getByLabel('Address label').fill('e2e tips jar');
  await win.getByRole('button', { name: 'DECLARE' }).click();
  const declared = win.locator('.hclock-row').filter({ hasText: 'e2e tips jar' });
  await expect(declared).toContainText('declared by you');
  await declared.getByRole('button', { name: 'REMOVE' }).click();
  await expect(declared).toHaveCount(0);

  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
