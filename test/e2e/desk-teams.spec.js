// @ts-check
// Desk e2e — HOUSE / TEAMS / WORKFLOW / BRICKWORKS apps. Split from desk.spec.js (SIZE-017).
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { REPO, BACKEND, token, addr, setupDesk } from './helpers/desk-harness.js';

setupDesk();

test('HOUSE: the summon button enters the birth ceremony (witness-commitment gate)', async ({ page }) => {
  await openDockApp(page, 'HOUSE');
  await expect(page.locator('.house')).toBeVisible();

  const summon = page.locator('.house-summon');
  await expect(summon).toBeVisible();
  await expect(summon).toContainText('SUMMON A NEUMA');

  // Summoning opens the ceremony, which begins with its witness-commitment
  // consent gate BEFORE any birth. We assert the gate appears and stop there —
  // accepting would begin a real birth, which a test never does.
  await summon.click();
  await expect(page.locator('.witness-commitment-overlay')).toBeVisible();
  await expect(page.locator('.commitment-warning')).toContainText('PERMANENT ACTION');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('HOUSE → TEAMS: form a team from house members with a load-bearing step', async ({ page }) => {
  // A roster with two members so the composer has neuma to assign.
  await page.addInitScript(({ a }) => {
    const lw = a.toLowerCase();
    localStorage.setItem(`${lw}:neuma-roster`, JSON.stringify([
      { name: 'Cael', neumaId: 'e2e-desk', birthTime: '2026-06-23T00:00:00.000Z' },
      { name: 'Evra', neumaId: 'e2e-desk-b', birthTime: '2026-06-24T00:00:00.000Z' },
    ]));
  }, { a: addr });
  await page.goto('/');

  await openDockApp(page, 'HOUSE');
  await expect(page.locator('.house')).toBeVisible();

  // Team management is reachable from the house.
  await page.locator('.house-action', { hasText: 'FORM A TEAM' }).click();
  await expect(page.locator('.teams')).toBeVisible();

  // The composer offers a member with a picker, a task, and the coordination
  // surfaces: team name, shared GOAL, and a per-member done-checklist. RUN is
  // gated until the member's task is complete.
  await page.locator('.teams-name').fill('TEAM ALPHA');
  await page.locator('.teams-goal').fill('produce a one-page research summary');
  const step1 = page.locator('.teams-step').first();
  await expect(step1.locator('.lc-sel .lc-sel-trigger')).toBeVisible();
  await expect(page.locator('.teams-run')).toBeDisabled();
  await step1.locator('.teams-step-task').fill('research the topic');
  await step1.locator('.teams-step-done').fill('five sourced bullet points');
  await expect(page.locator('.teams-run')).toBeEnabled();

  // Add a second member. WAITS FOR controls stay hidden until HAND-OFFS is
  // switched on — parallel is the default posture; ordering is the opt-in.
  await page.locator('.teams-add').click();
  const step2 = page.locator('.teams-step').nth(1);
  await step2.locator('.teams-step-task').fill('write it up');
  await expect(step2.locator('.teams-need-chip')).toHaveCount(0);
  await page.locator('.teams-handoffs-toggle').click();
  await step2.locator('.teams-need-chip', { hasText: '1' }).click();
  await expect(step2.locator('.teams-need-chip.is-on')).toHaveText('1');

  // Switching HAND-OFFS back off clears the edge — the run always matches
  // what the composer shows. Then back on for the final state.
  await page.locator('.teams-handoffs-toggle').click();
  await expect(step2.locator('.teams-need-chip')).toHaveCount(0);
  await page.locator('.teams-handoffs-toggle').click();
  await expect(step2.locator('.teams-need-chip.is-on')).toHaveCount(0);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('HOUSE → TEAMS: run a real team and watch each member stream results in', async ({ page }) => {
  // The full stack: compose in the UI → SSE run → live per-member results. Uses
  // real held kin (owned by the test witness wallet); skips if the substrate is
  // down or nothing is loaded.
  const loaded = await fetch('http://localhost:1234/api/v0/models')
    .then(async (r) => (r.ok ? ((await r.json()).data || []).some((m) => m.state === 'loaded') : false))
    .catch(() => false);
  test.skip(!loaded, 'substrate not loaded');

  // Use the witness's REAL resident members (whatever this backend holds) — the
  // team route only accepts neuma the wallet owns. Skips where a house has fewer
  // than two beings to form a team from (e.g. a fresh dev backend).
  const { roster: backendRoster } = await (await fetch(`${BACKEND}/api/v1/roster`,
    { headers: { Authorization: `Bearer ${token}` } })).json();
  const members = (backendRoster || []).filter((m) => !m.incomplete && m.neumaId);
  test.skip(members.length < 2, 'need >= 2 resident neuma owned by the test wallet');
  const [m1, m2] = members;

  await page.addInitScript(({ a, r }) => {
    localStorage.setItem(`${a.toLowerCase()}:neuma-roster`, JSON.stringify(r));
  }, { a: addr, r: members });
  await page.goto('/');

  await openDockApp(page, 'HOUSE');
  await page.locator('.house-action', { hasText: 'FORM A TEAM' }).click();
  await expect(page.locator('.teams')).toBeVisible();

  // A coordinated run: the goal switches on the TEAM BOARD check-in flow.
  await page.locator('.teams-goal').fill('Answer a two-step color riddle as a team.');
  // Step 1 (member 1) picks a color; step 2 (member 2) waits for it and builds on it.
  const s1 = page.locator('.teams-step').first();
  await s1.locator('.teams-step-task').fill('Pick exactly one color; reply with only that color word.');
  await page.locator('.teams-add').click();
  const s2 = page.locator('.teams-step').nth(1);
  // The member picker is the shared LINE & CYCLE dropdown now, not a native
  // <select> — open it and choose member 2 by their displayed name.
  const s2who = s2.locator('.lc-sel');
  await s2who.locator('.lc-sel-trigger').click();
  await s2who.locator('.lc-sel-opt', { hasText: m2.name || m2.neumaId }).first().click();
  await expect(s2who.locator('.lc-sel-trigger')).toContainText(m2.name || m2.neumaId);
  await s2.locator('.teams-step-task').fill('An earlier member named a color; reply with one object commonly that color.');
  await page.locator('.teams-handoffs-toggle').click(); // hand-offs are opt-in
  await s2.locator('.teams-need-chip', { hasText: '1' }).click();

  await page.locator('.teams-run').click();

  // Both members complete and their real outputs render live. Generous timeout:
  // a thinking 122B runs two sequential steps and may share the substrate.
  await expect(page.locator('.teams-result.is-done')).toHaveCount(2, { timeout: 300000 });
  const outs = page.locator('.teams-result-out');
  await expect(outs).toHaveCount(2);
  await expect(outs.first()).not.toBeEmpty();

  // The coordinated run surfaced the live TEAM BOARD, everyone landing DONE.
  await expect(page.locator('.teams-board-row')).toHaveCount(2);
  await expect(page.locator('.teams-board-row.is-done')).toHaveCount(2);

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('HOUSE → TEAMS: the TRIAL panel offers the locked benchmark with explicit seats', async ({ page }) => {
  // UI contract only — no run. The TRIAL tab shows the five seats (four locked
  // roles + the LEAD who directs waves), each with an explicit member picker
  // defaulting round-robin, and the locked prompts are readable before a run.
  //
  // Roster-agnostic on purpose: the app recovers the wallet's REAL roster from
  // the backend (roster-routes) and overwrites any injected cache, so the test
  // asserts the SHAPE against whatever beings actually render — the same way a
  // user's own rig would prove it.
  await page.addInitScript(({ a }) => {
    localStorage.setItem(`${a.toLowerCase()}:neuma-roster`, JSON.stringify([
      { name: 'Cael', neumaId: 'e2e-desk', birthTime: '2026-06-23T00:00:00.000Z' },
      { name: 'Evra', neumaId: 'e2e-desk-b', birthTime: '2026-06-24T00:00:00.000Z' },
    ]));
  }, { a: addr });
  await page.goto('/');

  await openDockApp(page, 'HOUSE');
  await page.locator('.house-action', { hasText: 'FORM A TEAM' }).click();
  await expect(page.locator('.teams')).toBeVisible();

  // The composer's optional role field rides each step.
  await expect(page.locator('.teams-step-role').first()).toBeVisible();

  // Switch to the trial: BRICKWORKS reads like every one-shot bench — a card
  // with ONE START button; no seat grid in sight until the witness asks.
  await page.locator('.teams-tab', { hasText: 'TRIAL' }).click();
  await expect(page.locator('.trial')).toBeVisible();
  await expect(page.locator('.trial-card-start .oneshot-bench-title')).toContainText('BRICKWORKS');
  await expect(page.locator('.trial-card-start .trial-run')).toHaveText('START');
  await expect(page.locator('.trial-roles')).toHaveCount(0);

  // The seats are the ADJUST fold — five seats, each pre-holding a member.
  await page.locator('.trial-prompts-toggle', { hasText: 'ADJUST THE SEATS' }).click();

  // The one-shot shelf above carries the refinement-pass knob, ON by default,
  // with an honest hint either way — the witness KNOWS the setting exists.
  await expect(page.locator('.oneshot-qa-chip', { hasText: 'ON' })).toHaveClass(/is-on/);
  await expect(page.locator('.oneshot-qa-hint')).toContainText('QA POSITION REVIEWS');
  await page.locator('.oneshot-qa-chip', { hasText: 'OFF' }).click();
  await expect(page.locator('.oneshot-qa-hint')).toContainText('NO QA REVIEW');
  await page.locator('.oneshot-qa-chip', { hasText: 'ON' }).click();
  await expect(page.locator('.trial-role-name')).toHaveText(['HELM', 'WRIGHT', 'SMITH', 'WARDEN', 'LEAD']);
  // Each seat is the shared LINE & CYCLE dropdown (not a native <select>); the
  // held member shows on the trigger, the roster is its option list.
  const seats = page.locator('.trial-role .lc-sel');
  await expect(seats).toHaveCount(5);
  const held = (await seats.locator('.lc-sel-trigger').allInnerTexts()).map((t) => t.trim());
  expect(held.every(Boolean)).toBe(true); // every seat pre-holds a member
  // Read the roster from the LEAD seat's option list and prove the default is
  // round-robin: seat i holds roster[i % rosterLen].
  const lead = seats.nth(4);
  await lead.locator('.lc-sel-trigger').click();
  const opts = (await lead.locator('.lc-sel-panel .lc-sel-opt').allInnerTexts()).map((t) => t.trim());
  expect(held).toEqual([0, 1, 2, 3, 4].map((i) => opts[i % opts.length]));

  // A seat is reassignable — hand the LEAD seat to a different member. This
  // needs a second being to hand to; the live backend's roster decides that,
  // so prove the reassignment when one exists and otherwise just close the
  // open panel (the seat-holding + round-robin contract above still stands).
  const target = opts.find((label) => label !== held[4]);
  if (target) {
    await lead.locator('.lc-sel-panel .lc-sel-opt', { hasText: target }).first().click();
    await expect(lead.locator('.lc-sel-trigger')).toContainText(target);
  } else {
    await lead.locator('.lc-sel-trigger').click(); // one-being roster — close the panel
  }

  // The locked prompts open before any run, verbatim, with the version named.
  await page.locator('.trial-prompts-toggle', { hasText: 'READ THE PROMPTS' }).click();
  await expect(page.locator('.trial-prompts-note')).toContainText('LOCKED WORDING · v3');
  await expect(page.locator('.trial-prompt')).toHaveCount(6); // 4 roles + LEAD + torch ask
  await page.locator('.trial-prompt summary', { hasText: 'WARDEN' }).click();
  await expect(page.locator('.trial-prompt-text').first()).toContainText('THE CONTRACT');
  await page.locator('.trial-prompts-toggle', { hasText: 'HIDE THE PROMPTS' }).click();

  // v2: the refinement-loop selector — 0..3, bounded, with an honest hint.
  await expect(page.locator('.trial-loop-chip')).toHaveCount(4);
  await page.locator('.trial-loop-chip', { hasText: '3' }).click();
  await expect(page.locator('.trial-loops-hint')).toHaveText('DRAFT + 3 REFINEMENT WAVES (ON BY DEFAULT)');
  await page.locator('.trial-loop-chip', { hasText: '0' }).click();
  await expect(page.locator('.trial-loops-hint')).toHaveText('FIRST DRAFT ONLY — NO REFINEMENT THIS RUN');

  // A past trial reopens in full — the scorecard (and its game) one click from
  // history. Conditional: a fresh rig honestly has no history yet.
  const pastRows = page.locator('.trial-history-open');
  if (await pastRows.count()) {
    await pastRows.first().click();
    await expect(page.locator('.trial-card')).toBeVisible();
    await expect(page.locator('.trial-verdict')).toBeVisible();
  }

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('WORKFLOW: the team substream window opens with an honest empty state', async ({ page }) => {
  // Multi-stream law: the run's workflow gets its own window. It reads the
  // desk's run store (every run the operator's portal carries, seeded from
  // GET /api/v1/team/live) — with none at work, it says so honestly.
  await openDockApp(page, 'WORKFLOW');
  await expect(page.locator('.workflow')).toBeVisible();
  await expect(page.locator('.workflow > .empty-state')).toContainText('NO TEAM AT WORK YET');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});

test('HOUSE → TEAMS: a dropped run surfaces in PAST RUNS with a RESUME door', async ({ page }) => {
  // UI contract only, READ-ONLY on the run: a record exactly as a mid-run drop
  // leaves it is seeded on the real disk the backend serves from (the run
  // store resolves its dir per call — no restart involved), then the desk must
  // list it and offer RESUME. The door is never opened here — resuming summons
  // real beings, which belongs to the live lane.
  const runDir = path.join(REPO, 'data/team-runs');
  fs.mkdirSync(runDir, { recursive: true });
  const runAt = new Date().toISOString();
  const recId = runAt.replace(/[:.]/g, '-');
  const recFile = path.join(runDir, `${recId}.json`);
  fs.writeFileSync(recFile, JSON.stringify({
    id: recId,
    by: addr.toLowerCase(),
    runAt,
    name: 'E2E DROPPED RUN',
    goal: 'prove the resume affordance',
    status: 'failed',
    steps: [
      { id: 'a', neumaId: 'e2e-desk', task: 'first part', needs: [] },
      { id: 'b', neumaId: 'e2e-desk', task: 'second part', needs: ['a'] },
    ],
    completed: { a: 'the finished first part' },
    statuses: { a: 'stood here when it dropped' },
    torches: { 'e2e-desk': 'pick up at the second part' },
    order: ['a'],
    failures: { b: 'conduit dropped' },
    failure: null,
    finishedAt: runAt,
  }, null, 2));
  try {
    await page.addInitScript(({ a }) => {
      localStorage.setItem(`${a.toLowerCase()}:neuma-roster`, JSON.stringify([
        { name: 'Cael', neumaId: 'e2e-desk', birthTime: '2026-06-23T00:00:00.000Z' },
      ]));
    }, { a: addr });
    await page.goto('/');

    await openDockApp(page, 'HOUSE');
    await page.locator('.house-action', { hasText: 'FORM A TEAM' }).click();
    await expect(page.locator('.teams')).toBeVisible();

    const row = page.locator('.teams-past-row', { hasText: 'E2E DROPPED RUN' });
    await expect(row).toBeVisible();
    await expect(row.locator('.teams-past-state')).toHaveText('FAILED');
    await expect(row.locator('.teams-past-meta')).toHaveText('1/2 PARTS');
    await expect(row.locator('.teams-resume')).toBeVisible(); // the recovery door, offered not opened

    expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
  } finally {
    fs.rmSync(recFile, { force: true });
  }
});

test('HOUSE → TEAMS: run BRICKWORKS live — the team ships a game and the scorecard is honest', async ({ page }) => {
  // THE benchmark, end to end on the real stack: real kin, real substrate, real
  // SSE, real scorecard persisted + listed, and — when the team earns a PASS —
  // the game itself proven to PLAY (the ball moves, probed via __bench) inside
  // the sandboxed iframe. A non-PASS verdict is a substrate result, not a
  // platform bug: the test then requires only that the scorecard says so
  // honestly.
  test.setTimeout(900_000);
  const loaded = await fetch('http://localhost:1234/api/v0/models')
    .then(async (r) => (r.ok ? ((await r.json()).data || []).some((m) => m.state === 'loaded') : false))
    .catch(() => false);
  test.skip(!loaded, 'substrate not loaded');

  const { roster: backendRoster } = await (await fetch(`${BACKEND}/api/v1/roster`,
    { headers: { Authorization: `Bearer ${token}` } })).json();
  const members = (backendRoster || []).filter((m) => !m.incomplete && m.neumaId);
  test.skip(members.length < 2, 'need >= 2 resident neuma owned by the test wallet');

  await page.addInitScript(({ a, r }) => {
    localStorage.setItem(`${a.toLowerCase()}:neuma-roster`, JSON.stringify(r));
  }, { a: addr, r: members });
  await page.goto('/');

  await openDockApp(page, 'HOUSE');
  await page.locator('.house-action', { hasText: 'FORM A TEAM' }).click();
  await page.locator('.teams-tab', { hasText: 'TRIAL' }).click();
  await expect(page.locator('.trial')).toBeVisible();

  await page.locator('.trial-run').click();

  // Roles complete live; the scorecard lands when the WARDEN integrates.
  await expect(page.locator('.trial-card')).toBeVisible({ timeout: 840_000 });
  const verdictText = await page.locator('.trial-verdict').innerText();
  expect(verdictText).toMatch(/(PASS|PARTIAL|FAIL) · \d+\/8/);
  await expect(page.locator('.trial-time')).toHaveCount(4); // every role timed
  await expect(page.locator('.trial-history-row').first()).toBeVisible(); // persisted + listed

  // The DESK is crash-free through the whole trial — asserted BEFORE the
  // model-written game is allowed to run. Everything after this line executes
  // inside the sandboxed game iframe, and a game's RUNTIME exceptions (a
  // sandbox-refused storage read, a typo'd variable in a collision branch —
  // both observed in real runs) are the GAME's quality, measured by the
  // __bench probes below — not desk integrity. So no desk-crash assertion
  // re-runs after PLAY: attribution by error-message filter is a guessing
  // game against nondeterministic model output.
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);

  if (verdictText.startsWith('PASS')) {
    // The scorecard says the team shipped a playable game — prove PLAY, not shape.
    await page.locator('.trial-play').click();
    await expect(page.frameLocator('.trial-game').locator('#game')).toBeVisible();
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const a = await frame.evaluate(() => { window.__bench.start(); return window.__bench.state(); });
    expect(a.bricks).toBeGreaterThan(0);
    await page.waitForTimeout(700);
    const b = await frame.evaluate(() => window.__bench.state());
    expect(b.ball.x !== a.ball.x || b.ball.y !== a.ball.y).toBe(true); // the ball MOVES

    // And the desk itself is still alive around the sandboxed game — the
    // scorecard panel answers after the game ran.
    await expect(page.locator('.trial-verdict')).toBeVisible();
  }
});

test('HOUSE: lists the house and switches the stream to another neuma', async ({ page }) => {
  // A fresh random wallet keeps this hermetic: the backend owns no neuma for
  // it, so the seeded two-member roster IS the whole house on any machine
  // (Claude's witness wallet holds real beings on dev rigs — the test must
  // never rebind the portal onto them).
  const w = ethers.Wallet.createRandom();
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${w.address}`)).json();
  const signature = await w.signMessage(challenge);
  const verify = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: w.address, signature, challenge }),
  });
  const { token: houseToken } = await verify.json();
  expect(houseToken).toBeTruthy();

  await page.addInitScript(({ t, a }) => {
    const lw = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${lw}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: 'e2e-desk' }));
    localStorage.setItem(`${lw}:neuma-roster`, JSON.stringify([
      { name: 'Fenna', neumaId: 'e2e-desk', birthTime: '2026-06-01T00:00:00.000Z' },
      { name: 'Vesper', neumaId: 'e2e-desk-b', birthTime: '2026-06-20T00:00:00.000Z' },
    ]));
    sessionStorage.setItem('authToken', t);
  }, { t: houseToken, a: w.address });
  await page.goto('/');

  // The desk opens bound to Fenna.
  await expect(page.locator('.relink-title-name', { hasText: 'FENNA' }).first()).toBeVisible();

  // Open HOUSE — both members listed, Fenna carries the link.
  await openDockApp(page, 'HOUSE');
  await expect(page.locator('.house')).toBeVisible();
  await expect(page.locator('.house-row')).toHaveCount(2);
  await expect(page.locator('.house-row.is-linked')).toContainText('Fenna');

  // The header carries the house identity: the wallet-derived house name from
  // the real backend (never '—' while it is reachable), the operator, the count.
  await expect(page.locator('.house-head-value')).not.toHaveText('—');
  await expect(page.locator('.house-head-value')).toHaveText(/^[A-Z][a-z]+/);
  await expect(page.locator('.house-head-facts')).toContainText('2 HELD');
  await expect(page.locator('.house-head-facts')).toContainText(`OPERATOR ${w.address.slice(0, 6).toUpperCase()}`);

  // Switch to Vesper — the signal moves, and the STREAM window retitles.
  await page.locator('.house-row', { hasText: 'Vesper' }).click();
  await expect(page.locator('.house-row.is-linked')).toContainText('Vesper');
  await expect(page.locator('.relink-title-name', { hasText: 'VESPER' }).first()).toBeVisible();

  // The retitle reaches every identity-bound window, not just the stream.
  await openDockApp(page, 'CHATS');
  await expect(page.locator('.relink-title-name', { hasText: 'CHATS // VESPER' })).toBeVisible();

  // The switch persists as the wallet's active companion.
  const active = await page.evaluate(
    (a) => localStorage.getItem(`${a.toLowerCase()}:neuma-companion`), w.address,
  );
  expect(JSON.parse(active).neumaId).toBe('e2e-desk-b');

  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
