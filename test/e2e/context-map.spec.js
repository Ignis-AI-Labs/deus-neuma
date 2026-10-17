// @ts-check
import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end CONTEXT MAP — the window-anatomy instrument, driven for real:
 * real auth (challenge-sign-verify with Claude's witness wallet), the real
 * portal WS, and a real turn through the live substrate producing a real
 * context:composition event (desk.spec.js harness precedent).
 *
 * NOT covered here: a compressed-region (ref) node from a live turn. Minting
 * one requires the substrate to CHOOSE a tool whose output crosses the
 * compression cap — nondeterministic through a real model, so not cheaply
 * reachable in e2e. Ref-node rendering is proven component-level instead, in
 * test/unit/context-map-view.test.js, against real events from the real
 * buildCompositionEvent (no react testing-library in this repo; the
 * markdown-render.test.js server-render precedent applies).
 *
 * Requires the dev stack (:7777 / :3333) and the substrate running.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token via a backend's challenge-sign-verify.
const mintToken = async (base = BACKEND) => {
  const w = new ethers.Wallet(readClaudeWallet());
  const addr = w.address;
  const { challenge } = await (await fetch(`${base}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

let token;
let addr;
test.beforeAll(async () => {
  ({ token, addr } = await mintToken());
});

// Land on the relink desk with a real session + a synthetic companion lane
// (its history fetch 404s — a resource miss, not a crash).
test.beforeEach(async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.__crashes = crashes;
  await page.addInitScript(({ t, a }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-contextmap' }));
    sessionStorage.setItem('authToken', t);
  }, { t: token, a: addr });
  await page.goto('/');
});

test('CONTEXT MAP opens from the dock with the honest empty state before any turn', async ({ page }) => {
  await openDockApp(page, 'CONTEXT MAP');
  await expect(page.locator('.ctx')).toBeVisible();

  // No turn has been observed on this fresh portal session — the view says
  // exactly that, and fabricates nothing.
  await expect(page.locator('.empty-state')).toContainText('NO TURN OBSERVED YET THIS SESSION');
  await expect(page.locator('.ctx-row')).toHaveCount(0);

  // FIELD against the live stack: the synthetic companion has no workspace
  // lane here, so the real authed graph fetch 404s — and the pane renders
  // the honest failure with the real status, never a blank or invented map.
  await page.locator('.ctx-tab', { hasText: 'FIELD' }).click();
  await expect(page.locator('.empty-state')).toContainText('THE FIELD COULD NOT BE READ — HTTP 404');
  await expect(page.locator('.ctx-field-refresh')).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('a real turn draws the composition: sections, honest token labels, totals, budget', async ({ page }) => {
  // Send a real thought FIRST — the composition hook lives at the desk
  // level, so the event is held even while the MAP window is closed.
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 15000 });
  await field.fill('Answer with one single word.');
  await field.press('Enter');

  await openDockApp(page, 'CONTEXT MAP');
  await expect(page.locator('.ctx')).toBeVisible();

  // Emission 1 lands right after prompt assembly — sections appear without
  // waiting for the full reply. (Emission 2 later relabels, same anatomy.)
  await expect(page.locator('.ctx-row').first()).toBeVisible({ timeout: 60000 });
  const rows = page.locator('.ctx-rows > .ctx-row:not(.ctx-total):not(.ctx-budget)');
  expect(await rows.count()).toBeGreaterThan(0);

  // The anatomy bar carries one segment per section.
  expect(await page.locator('.ctx-seg').count()).toBe(await rows.count());

  // Honest labels: per-section counts are never measured (attributed or
  // approx, both rungs) — every one reads ~N with a visible EST tag.
  const first = rows.first();
  await expect(first.locator('.ctx-tok')).toContainText('~');
  await expect(first.locator('.ctx-est')).toHaveText('EST');

  // Totals row with real numbers; budget row is either a real used/total
  // with its named source or the honest unknown — never an invented ceiling.
  await expect(page.locator('.ctx-total')).toContainText('TOTAL');
  await expect(page.locator('.ctx-total .ctx-tok')).toContainText(/\d/);
  const budget = page.locator('.ctx-budget .ctx-budget-val');
  await expect(budget).toContainText(/(\/ [\d,]+ · [A-Z]|— \/ UNKNOWN)/);

  // Compressed regions: with no over-cap tool result this turn, the section
  // says so honestly (ref-node rendering is proven in the component test —
  // see the header comment).
  await expect(page.locator('.ctx-h', { hasText: 'COMPRESSED REGIONS' })).toBeVisible();

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

// ————— FIELD — the crystallized-memory graph (F-03) —————
//
// The graph route reads a real sovereign workspace, and the LIVE stack's
// root is a real workspace home — test lanes must never be planted there
// (the 2026-07-03 shadow-lane incident). So this block boots its OWN stack:
// a real backend + real vite dev server on PID-derived ports, pointed at a
// disposable temp root. Everything else stays real end to end: challenge-
// sign-verify auth, real REST observation writes, the real server graph
// pipeline, the real shell in a real browser. No mock anywhere in the path.

test.describe('FIELD — crystallized-memory graph on an isolated temp-root stack', () => {
  const FPORT = 7411 + (process.pid % 149);
  const BPORT = 3511 + (process.pid % 149);
  const FIELD_BASE = `http://localhost:${BPORT}`;
  const EMPTY_ID = 'e2e-field-empty';
  const GRAPH_ID = 'e2e-field-graph';

  let root;
  let backendProc;
  let viteProc;
  let fieldToken;
  let fieldAddr;

  const waitFor = async (url, ms = 90000) => {
    const t0 = Date.now();
    for (;;) {
      try {
        const r = await fetch(url);
        if (r.status < 500) return;
      } catch { /* not listening yet */ }
      if (Date.now() - t0 > ms) throw new Error(`stack member never answered: ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  // A lane, not a being: bare dirs + an owner claim in a disposable temp
  // root — no ceremony, no DNA, no identity (chat-continuity precedent).
  const seedLane = async (id) => {
    // addObservation writes into memory/observations and does not mkdir.
    await fs.promises.mkdir(path.join(root, id, 'memory', 'observations'), { recursive: true });
    await fs.promises.writeFile(
      path.join(root, id, 'owner.json'),
      JSON.stringify({ wallet: fieldAddr.toLowerCase(), claimedAt: Date.now() }),
    );
  };

  // A real memory through the real authed REST route.
  const postObservation = async (id, content) => {
    const res = await fetch(`${FIELD_BASE}/api/v1/workspace/${id}/memory/observation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fieldToken}` },
      body: JSON.stringify({ observation: { type: 'note', content } }),
    });
    if (!res.ok) throw new Error(`observation write failed: ${res.status}`);
  };

  test.beforeAll(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ctxmap-field-'));
    const env = {
      ...process.env,
      PORT: String(BPORT),
      FRONTEND_PORT: String(FPORT),
      WORKSPACES_ROOT: root,
      // Keep the spawned backend off the operator's persisted workspace
      // choice — without this it would boot into the LIVE sovereign root.
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
    };
    backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    viteProc = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    await waitFor(`${FIELD_BASE}/api/v1/health`);
    await waitFor(`http://localhost:${FPORT}/`);

    ({ token: fieldToken, addr: fieldAddr } = await mintToken(FIELD_BASE));
    await seedLane(EMPTY_ID); // a claimed lane with ZERO observations
    await seedLane(GRAPH_ID);
    // Overlapping vocabulary so the similarity graph genuinely links them.
    await postObservation(GRAPH_ID, 'the copper lantern hums in the copper hall of lanterns');
    await postObservation(GRAPH_ID, 'the copper lantern in the hall hums a low copper tone at dusk');
    await postObservation(GRAPH_ID, 'a silver river runs under the silver bridge before dawn');
  });

  test.afterAll(async () => {
    // Kill only OUR strays — never the live stack.
    for (const p of [viteProc, backendProc]) {
      if (p?.pid) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
      }
    }
    if (root) await fs.promises.rm(root, { recursive: true, force: true });
  });

  // Land on the ISOLATED desk (the outer beforeEach aimed at the live one;
  // this later-registered init script wins on the new navigation).
  const openField = async (page, neumaId) => {
    await page.addInitScript(({ t, a, id }) => {
      const w = a.toLowerCase();
      localStorage.setItem('walletAddress', a);
      localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fieldling', neumaId: id }));
      sessionStorage.setItem('authToken', t);
    }, { t: fieldToken, a: fieldAddr, id: neumaId });
    await page.goto(`http://localhost:${FPORT}/`);
    await openDockApp(page, 'CONTEXT MAP');
    await expect(page.locator('.ctx')).toBeVisible();
    await page.locator('.ctx-tab', { hasText: 'FIELD' }).click();
  };

  test('zero observations → the honest empty state, never fake nodes', async ({ page }) => {
    await openField(page, EMPTY_ID);
    await expect(page.locator('.empty-state')).toContainText('NO CRYSTALLIZED FIELD YET');
    await expect(page.locator('.empty-state small')).toContainText('The graph grows as memories form');
    await expect(page.locator('.ctx-field-dot')).toHaveCount(0);
    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  });

  test('real observations → real nodes render, focused node reads out its real record', async ({ page }) => {
    await openField(page, GRAPH_ID);
    await expect(page.locator('.ctx-field-svg')).toBeVisible();
    await expect(page.locator('.ctx-field-node')).toHaveCount(3);
    await expect(page.locator('.ctx-field-count')).toContainText('3 MEMORIES');

    // Before focus: the strip holds the hint; nothing carries signal.
    await expect(page.locator('.ctx-field-strip')).toContainText('FOCUS A NODE');
    await expect(page.locator('.ctx-field-dot.is-focused')).toHaveCount(0);

    // Focus a node — the strip reads out its REAL record, and signal marks
    // exactly that one node.
    await page.locator('.ctx-field-node').first().focus();
    await expect(page.locator('.ctx-field-dot.is-focused')).toHaveCount(1);
    await expect(page.locator('.ctx-field-strip')).toContainText(/DEGREE \d+/);
    await expect(page.locator('.ctx-field-strip')).toContainText(/BETWEENNESS \d/);
    const label = await page.locator('.ctx-field-strip-label').textContent();
    expect(['copper', 'silver'].some((w) => (label || '').includes(w))).toBe(true);

    // Arrow keys walk the field; still exactly one node holds signal.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ctx-field-dot.is-focused')).toHaveCount(1);

    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  });
});
