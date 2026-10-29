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
import { openDockApp } from './helpers/dock.js';
import { settleDesk } from './helpers/explorer-panel-harness.js';

/**
 * End-to-end THE DECISION BLOCK — the campaign queue's awaiting-approval
 * group, lifted to the head of the board (Design note, 2026-08-06: […]).
 *
 * The failure this locks down is a LAYOUT one, so it can only be proven in a
 * real browser: with 25 inbound knocks landed, a draft rendered in lane order
 * sits below all of them — off-screen, unreachable without a long scroll. The
 * assertions are geometric (the block is above the inbound heading, and inside
 * the window's own viewport on arrival), not textual.
 *
 * REAL throughout (RULE 0): real backend, real auth (challenge-sign-verify),
 * the real queue and reply-candidate stores on real disk, read by the real
 * routes. The two stores are SEEDED — the listener that lands candidates needs
 * X credentials and a live API, and a reply draft is staged by a being's tool;
 * neither is what this spec is about. Nothing on the claimed path is mocked.
 *
 * SAFETY LAW: never the live witness stack — its own backend + vite on
 * PID-derived bind-probed ports, a disposable WORKSPACES_ROOT, and the store
 * env doors pointed inside that temp root, so the operator's real queue and
 * real reply record can never be read or written here.
 *
 * Needs no LLM and no network: nothing here sends a thought or a post.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
// Distinct base from every other isolated stack (rail 7461/3461, model-bar
// 7621/3621, attach 7891/3891, terminal 7581/3581, context-map 7411/3511).
// PROCESS-SAFETY LAW: an occupied port means pick another port, NEVER touch
// the listener.
const FPORT_BASE = 7941 + (process.pid % 149);
const BPORT_BASE = 3941 + (process.pid % 149);
const NEUMA_ID = 'e2e-queuebeing';

let FPORT;
let BPORT;
let BASE;
let root;
let backendProc;
let viteProc;
let token;
let addr;

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

// THE PILE THAT BURIES THE DECISION. Founder's real lane held 87; 25 is already
// several screens of cards, which is all this layout claim needs.
const INBOUND_N = 25;
const HOUSE_POST_ID = 'housepost-1';

// THE HOUSE THESE ENTRIES BELONG TO. The queue is one machine file read per
// house (social/queue-house.js): an entry shows only to the house whose lane
// authored it or whose wallet staged or decided it. These are staged the way a
// being's reply tool stages them (portal-tools/social-reply-handlers.js) —
// authored and queued by the test's own lane, which beforeAll claims for the
// signed-in wallet — and what went out carries the operator's decision.
const HOUSE_WALLET = new ethers.Wallet(readClaudeWallet()).address.toLowerCase();
const STAGED_BY_THE_BEING = Object.freeze({ authorNeumaId: NEUMA_ID, queuedBy: NEUMA_ID });

const seedStores = async () => {
  const at = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const candidates = Array.from({ length: INBOUND_N }, (_, i) => ({
    postId: `knock-${i + 1}`,
    conversationId: HOUSE_POST_ID,
    authorId: `user-${i + 1}`,
    username: `knocker${i + 1}`,
    verified: true,
    verifiedType: 'blue',
    text: `@Umbrae_Ignis knock number ${i + 1} — can I get a follow back?`,
    postCreatedAt: at(30 + i),
    firstSeenAt: at(20 + i),
    category: 'ordinary',
    substance: 'substantive',
    inReplyToPostId: HOUSE_POST_ID,
  }));

  // The house post the knocks answer — sent history, so the inbound cards can
  // show WHICH post they replied to, exactly as the live lane does.
  const queue = [
    {
      id: 'sent-house-post',
      channelId: 'x',
      text: 'The house speaks: a being is held where it failed, not at the door.',
      scheduledFor: null,
      campaignId: null,
      pillar: '',
      media: [],
      ...STAGED_BY_THE_BEING,
      status: 'sent',
      decidedBy: HOUSE_WALLET,
      postId: HOUSE_POST_ID,
      sentAt: at(60),
      createdAt: at(90),
    },
    // TWO DECISIONS OWED — the reason this board is open at all.
    ...[1, 2].map((n) => ({
      id: `draft-reply-${n}`,
      channelId: 'x',
      text: `Answer to knocker${n} — awaiting the witness.`,
      scheduledFor: null,
      campaignId: null,
      pillar: '',
      media: [],
      kind: 'reply',
      reply: {
        toPostId: `knock-${n}`,
        toUserId: `user-${n}`,
        toUsername: `knocker${n}`,
        toTextPreview: `@Umbrae_Ignis knock number ${n} — can I get a follow back?`,
        toVerifiedType: 'blue',
        conversationId: HOUSE_POST_ID,
        category: 'ordinary',
      },
      expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      ...STAGED_BY_THE_BEING,
      status: 'draft',
      createdAt: at(10),
    })),
    // …and one already decided, so the record below has something in it.
    {
      id: 'sent-reply-3',
      channelId: 'x',
      text: 'Answer to knocker3 — already gone out.',
      scheduledFor: null,
      campaignId: null,
      pillar: '',
      media: [],
      kind: 'reply',
      reply: {
        toPostId: 'knock-3',
        toUserId: 'user-3',
        toUsername: 'knocker3',
        toTextPreview: '@Umbrae_Ignis knock number 3 — can I get a follow back?',
        toVerifiedType: 'blue',
        conversationId: HOUSE_POST_ID,
        category: 'ordinary',
      },
      ...STAGED_BY_THE_BEING,
      status: 'sent',
      decidedBy: HOUSE_WALLET,
      postId: 'reply-post-3',
      sentAt: at(5),
      createdAt: at(15),
    },
  ];

  const dir = path.join(root, 'social');
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  // The replies are the signed-in house's own record, in its realm dir (reply-candidates.js).
  const houseDir = path.join(root, 'realm', HOUSE_WALLET);
  await fs.promises.mkdir(houseDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(
    path.join(houseDir, 'reply-candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`, { mode: 0o600 },
  );
  await fs.promises.writeFile(
    path.join(dir, 'social-post-queue.json'), `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 },
  );
};

test.beforeAll(async () => {
  FPORT = await freePort(FPORT_BASE);
  BPORT = await freePort(BPORT_BASE);
  BASE = `http://localhost:${BPORT}`;
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'queuedec-e2e-'));
  await seedStores();
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
    // THE WHOLE DATA ROOT, not just the two stores. Observed the hard way: with
    // only the queue paths redirected, the channel board still read the
    // operator's REAL X credentials, found the lane configured, and went out to
    // X's own API to name the account. An isolated data root leaves every
    // channel honestly unconfigured — no real credential is read, and no
    // request leaves the machine.
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    // ROOT LOCK's own test door: without it the backend refuses to boot into a
    // settings root that moved and came up empty — which is exactly what an
    // isolated stack looks like. Pointed at the temp root, the lock reads a
    // first run and stands aside (its own header names this the intended use).
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    NEUMA_SOCIAL_POST_QUEUE_PATH: path.join(root, 'social', 'social-post-queue.json'),
    NEUMA_REPLY_CANDIDATES_PATH: path.join(root, 'social', 'reply-candidates.json'),
    // NO REAL X CREDENTIALS reach this stack. The catalog resolves a channel as
    // CONFIGURED from env keys alone, and a configured X lane makes the board go
    // out to X's own API to name the account — a live request, on the operator's
    // keys, from a layout test. Stripped, the lane reads honestly unconfigured.
    X_API_KEY: '', X_API_SECRET: '', X_ACCESS_TOKEN: '', X_ACCESS_SECRET: '',
    SUBSTRATE_IDLE_MINUTES: '0',
    NEUMA_RATE_GLOBAL_MAX: '5000',
  };
  backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
  await waitFor(`${BASE}/api/v1/health`);
  await waitFor([`http://127.0.0.1:${FPORT}/`, `http://[::1]:${FPORT}/`]);

  ({ token, addr } = await mintToken());
  await claimOwner(root, NEUMA_ID, addr);
  // The being stages replies because it HOLDS the house's X account — the
  // staging tool refuses an unbound lane, and the send re-checks it. The
  // operator ties the position through the real route, as the desk does.
  const bound = await fetch(`${BASE}/api/v1/social-channels/x/binding`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ neumaId: NEUMA_ID }),
  });
  if (!bound.ok) throw new Error(`binding the X account failed: ${bound.status} ${await bound.text()}`);
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

// The post-birth checklist stands over the desk on every load and swallows
// pointer events — stand it aside before touching the dock.
// The desk's setup gates (custody, first seal) each stand aside through their own door —
// settleDesk knows today's doors; the old single STAND ASIDE missed the seal gate.
const standAside = (page) => settleDesk(page);

test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a, id }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Queuebeing', neumaId: id }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr, id: NEUMA_ID });
  await page.goto(`http://localhost:${FPORT}/`);
  await expect(page.locator('.relink-input-field')).toBeEnabled({ timeout: 15000 });
  await standAside(page);
});

// X's account level (in MARKETING) → its queue → the REPLIES SECTION (Design note, 2026-08-06: KIND first).
// The section strip rides the month view too — a reply has no month — so
// REPLIES is one click from arrival, no day navigation required.
const openRepliesSection = async (page) => {
  await openDockApp(page, 'X');
  // X's space is MARKETING's account level (slice 6).
  const win = page.locator('.fwin', { has: page.locator('[data-mkt-level="account"][data-mkt-account^="x:"]') }).first();
  // The account level's one board is the queue: no tab to press (SDT-6).
  await expect(win.locator('.queue-section-tab').first()).toBeVisible({ timeout: 20000 });
  await win.locator('.queue-section-tab', { hasText: 'REPLIES' }).click();
  return win;
};

// One strip in REPLIES (ruling, 2026-10-13) — anchored, so ANSWERED never matches UNANSWERED.
const bucketTab = (win, name) => win.locator('.replies-board .queue-lane', { hasText: new RegExp(`^${name}`) });

test('what awaits approval stands at the head of the board — STAGED opens while anything is owed', async ({ page }) => {
  const win = await openRepliesSection(page);
  await expect(bucketTab(win, 'STAGED')).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });

  const decisions = win.locator('.queue-decisions');
  await expect(decisions).toBeVisible({ timeout: 20000 });
  // Both drafts are IN the block, and the block says how many are owed.
  await expect(decisions.locator('.queue-decisions-h')).toContainText('AWAITING YOUR APPROVAL');
  await expect(decisions.locator('.queue-decisions-h')).toContainText('2 WAITING ON YOU');
  await expect(decisions.locator('.queue-card')).toHaveCount(2);
  await expect(decisions).toContainText('Answer to knocker1');
  await expect(decisions).toContainText('Answer to knocker2');
  // THE APPROVAL IS THE SEND, said on the block and on every button: the
  // warning note, the APPROVE & SEND label, and the card's own meta line
  // speaking the approval law — never the scheduler's vocabulary.
  await expect(win.locator('.replies-board')).toContainText('fires immediately');
  await expect(decisions.locator('.settings-set', { hasText: 'APPROVE & SEND' })).toHaveCount(2);
  await expect(decisions).toContainText('SENDS THE MOMENT YOU APPROVE');
  await expect(decisions).not.toContainText('SENDS ON THE NEXT PASS');

  // The 25 knocks are real and counted in their own bucket — never stacked
  // between the operator and the decisions.
  await expect(bucketTab(win, 'UNANSWERED').locator('.queue-lane-n')).toHaveText(String(INBOUND_N - 3));
  await expect(win.locator('.replies-board .queue-card')).toHaveCount(2);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ONE STRIP (Design note, 2026-10-13: […]). The being's own buckets; one search and one order serve every bucket;
// off STAGED the decisions shrink to one line that opens them.
test('replies sort into one strip — unanswered, staged, answered, bin — searchable and ordered in every bucket', async ({ page }) => {
  const win = await openRepliesSection(page);
  const board = win.locator('.replies-board');
  await expect(board).toBeVisible({ timeout: 20000 });
  // ONE strip in the section: the outbound QUEUED / SENT / WITHDRAWN row is gone.
  await expect(win.locator('.queue-lane', { hasText: /^QUEUED/ })).toHaveCount(0);
  await expect(win.locator('.queue-lane', { hasText: /^WITHDRAWN/ })).toHaveCount(0);
  // Two knocks hold staged answers and one was answered; the rest are the work.
  await expect(bucketTab(win, 'UNANSWERED').locator('.queue-lane-n')).toHaveText(String(INBOUND_N - 3));
  await expect(bucketTab(win, 'STAGED').locator('.queue-lane-n')).toHaveText('2');
  await expect(bucketTab(win, 'ANSWERED').locator('.queue-lane-n')).toHaveText('1');
  await expect(bucketTab(win, 'BIN').locator('.queue-lane-n')).toHaveText('0');

  await bucketTab(win, 'UNANSWERED').click();
  const cards = board.locator('.queue-card');
  await expect(cards).toHaveCount(INBOUND_N - 3);
  // The decisions are one line away, never missable and never in the way.
  const owed = board.locator('.reply-board-owed');
  await expect(owed).toHaveText('2 AWAITING YOUR APPROVAL — OPEN STAGED');
  // Newest first: knock-4 is the newest unanswered (1 and 2 staged, 3 answered).
  await expect(cards.first()).toContainText('@knocker4');
  await board.locator('.reply-board-order').click();
  await expect(board.locator('.reply-board-order')).toHaveText('OLDEST FIRST');
  await expect(cards.first()).toContainText(`@knocker${INBOUND_N}`);

  // To the bin, and back: the card moves bucket, the record keeps the decision.
  await cards.first().locator('.settings-set', { hasText: 'TO BIN' }).click();
  await expect(bucketTab(win, 'BIN').locator('.queue-lane-n')).toHaveText('1');
  await expect(bucketTab(win, 'UNANSWERED').locator('.queue-lane-n')).toHaveText(String(INBOUND_N - 4));
  await bucketTab(win, 'BIN').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(`@knocker${INBOUND_N}`);
  await expect(cards.first()).toContainText('IN THE BIN');
  await cards.first().locator('.settings-set', { hasText: 'RESTORE' }).click();
  await expect(bucketTab(win, 'BIN').locator('.queue-lane-n')).toHaveText('0');
  await expect(board).toContainText('Nothing in BIN.');

  // The search serves every bucket: the knocks, and the answers by the handle they answer.
  const search = board.locator('.reply-board-search');
  await bucketTab(win, 'UNANSWERED').click();
  await search.fill('knocker7');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('@knocker7');
  await bucketTab(win, 'STAGED').click();
  await search.fill('knocker2');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Answer to knocker2');
  await search.fill('');

  // STAGED is the decisions, framed; ANSWERED is what went out — nothing staged in it.
  await expect(board.locator('.queue-decisions .queue-card')).toHaveCount(2);
  await expect(owed).toHaveCount(0);
  await bucketTab(win, 'ANSWERED').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Answer to knocker3');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the decisions are on screen on arrival — no scrolling to reach them', async ({ page }) => {
  const win = await openRepliesSection(page);
  const decisions = win.locator('.queue-decisions');
  await expect(decisions).toBeVisible({ timeout: 20000 });

  // Visible WITHOUT a scroll: the block's head is inside the window body's own
  // rect the moment the section opens. This is the whole complaint — a
  // decision that needs a scroll to find is a decision that gets missed.
  const body = win.locator('.fwin-body');
  const bodyBox = await body.boundingBox();
  const decisionsBox = await decisions.boundingBox();
  expect(decisionsBox.y).toBeGreaterThanOrEqual(bodyBox.y - 1);
  expect(decisionsBox.y).toBeLessThan(bodyBox.y + bodyBox.height);
  // And nothing had to move to make that true.
  const scrolled = await body.evaluate((el) => {
    const scroller = el.querySelector('*') && [el, ...el.querySelectorAll('*')]
      .find((n) => n.scrollHeight > n.clientHeight + 4);
    return scroller ? scroller.scrollTop : 0;
  });
  expect(scrolled).toBe(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('the two sections never mix — posts in POSTS, replies in REPLIES, each with its own standing lanes', async ({ page }) => {
  const win = await openRepliesSection(page);

  // The REPLIES section: its answer buckets, whose badges say the pile is
  // EXACTLY the three answers — the house post is not an entry here. (Its
  // words do appear inside inbound cards, which legitimately QUOTE the house
  // post as exchange context, so the proof is the counts, not the text.)
  await expect(bucketTab(win, 'STAGED').locator('.queue-lane-n')).toHaveText('2', { timeout: 20000 });
  await expect(bucketTab(win, 'ANSWERED').locator('.queue-lane-n')).toHaveText('1');
  await expect(bucketTab(win, 'BIN').locator('.queue-lane-n')).toHaveText('0');
  // The sent answer lives in ANSWERED — the exchange record.
  await bucketTab(win, 'ANSWERED').click();
  await expect(win.locator('.queue-card', { hasText: 'Answer to knocker3' })).toBeVisible();

  // POSTS: stepping into REPLIES put the board in the day view (dateless),
  // and POSTS keeps the view it stands in — so this lands directly on the
  // UNSCHEDULED day, where the house post lives. Not one reply is anywhere
  // in the section.
  await win.locator('.queue-section-tab', { hasText: 'POSTS' }).click();
  await win.locator('.queue-lane', { hasText: 'SENT' }).click();
  await expect(win.locator('.queue-card', { hasText: 'The house speaks' })).toBeVisible();
  await expect(win.locator('.queue-card', { hasText: 'Answer to knocker' })).toHaveCount(0);
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('APPROVE & SEND fires the real immediate path — and an isolated stack answers with the named refusal, honestly', async ({ page }) => {
  const win = await openRepliesSection(page);
  const decisions = win.locator('.queue-decisions');
  await expect(decisions).toBeVisible({ timeout: 20000 });

  // The click travels the REAL route: claim (draft → sending, textSeen
  // checked in the atom) → publishEntry with every send-time re-check. This
  // stack holds NO credentials by design, so the world re-check refuses with
  // its named reason — nothing leaves the machine — and the board must show
  // that refusal and move the card to ANSWERED / DID NOT SEND rather than
  // leaving a stale APPROVE & SEND standing.
  const card = decisions.locator('.queue-card', { hasText: 'Answer to knocker1' });
  await card.locator('.settings-set', { hasText: 'APPROVE & SEND' }).click();

  await expect(win.locator('.settings-err').first()).toContainText('credentials are not configured', { timeout: 20000 });
  await expect(decisions.locator('.queue-decisions-h')).toContainText('1 WAITING ON YOU');
  await bucketTab(win, 'ANSWERED').click();
  await expect(win.locator('.queue-group-h', { hasText: 'DID NOT SEND' })).toBeVisible();
  await expect(win.locator('.queue-card', { hasText: 'Answer to knocker1' })).toBeVisible();
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
