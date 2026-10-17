// @ts-check
// TEAM RUN CLOCKS, LIVE (#577) — a run where one part works under a clock and
// one works with none, the operator's hands on both, and the eye watching.
//
// Design note, 2026-10-13: […]
//
// Everything is real: wallet auth, Keir of House Aldmere leading on the real
// substrate, the plan approved in the stream, members working with their own
// hands. The operator, from the WORKFLOW window: narrows the run to one part
// at a time (AT ONCE −), sets the essay's own clock (SET ITS CLOCK → NOTIFY),
// and asks for check-ins every minute (the route — the window offers 30 min
// and up). Then: the clock passes in WORKING time, the operator is told (the
// tray's «NOTICE» TEAM RUN) and the essay keeps working to its end; the eye's
// TEAM CHECK-IN arrives while the run works; the answer part, with no clock,
// works until done. Model variance is handled, not hidden (the lead's
// questions, the word after approval, a clock of its own on the plan).
//
// ⚠ LIVE-BEING RULES (the 2026-07-06 incident — team-project-live.spec.js):
//   1. OPT-IN ONLY: E2E_LIVE=1.
//   2. Vite and the backend carry the SAME non-canonical PORT (never :3333):
//      PORT=<p> FRONTEND_PORT=<f> for the stack AND for this spec.
//   3. FRESH SESSION: NEW CHAT first — never append to a held conversation.
//   4. Coordinate with any session working the same house before running.

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BACKEND, mintToken } from './helpers/desk-harness.js';
import { openDockApp } from './helpers/dock.js';
import { passDeskGates } from './helpers/desk-gates.js';

const LEAD = Object.freeze({ name: 'Keir', neumaId: 'keir' });
const ASSIGNMENT = [
  'A team project for the house journal, kept to two parts.',
  'Plan exactly two steps and submit the plan for my approval:',
  'step "essay" is yours, Keir: write an essay of about 1500 words on the house\'s first winter into essay.md;',
  'step "answer" is Signal\'s and needs "essay": read essay.md and write a one-line answer to it into answer.md.',
  'List each step\'s file in its files. Name no workspace: the run gets its own arena.',
  'Set no clock on either step — I will set the clocks myself while you work.',
].join(' ');
// A quarter-minute of WORKING time: the clock passes while the essay is still
// being written, wherever in its work the operator's hand lands.
const ESSAY_CLOCK_MINUTES = '0.25';

const teamApi = (token) => async (method, url, body) => {
  const res = await fetch(`${BACKEND}/api/v1/team${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const until = async (read, ms, every = 500) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error('the condition never held');
    await new Promise((r) => setTimeout(r, every));
  }
};

const timing = (label, since) => test.info().annotations.push({
  type: 'timing', description: `${label}: ${((Date.now() - since) / 1000).toFixed(1)}s`,
});

const rowOf = (page, stepId) => page.locator('.workflow .workflow-row', {
  has: page.locator('.workflow-step', { hasText: new RegExp(`^${stepId}$`) }),
});

const openRow = async (row) => {
  if (!(await row.locator('.workflow-member-panel').count())) await row.locator('.workflow-row-head').click();
  await expect(row.locator('.workflow-member-panel')).toBeVisible();
};

// The tray's cards, newest first — the panel opens on the bell.
const trayCards = async (page) => {
  if (!(await page.locator('.ntray-panel').count())) await page.locator('.ntray-bell').click();
  return page.locator('.ntray-panel-list .ntray-card-head .ntray-card-kind').allTextContents();
};

test.describe('TEAM RUN CLOCKS — a clocked part and an unclocked one, the eye on both, live', () => {
  test.skip(process.env.E2E_LIVE !== '1', 'live-being run — opt in with E2E_LIVE=1 (see header rules)');
  test.setTimeout(35 * 60 * 1000);
  test.use({ viewport: { width: 1920, height: 1080 } });

  let token, addr, call;
  test.beforeAll(async () => {
    ({ token, addr } = await mintToken());
    call = teamApi(token);
  });

  test('a clock on working time notifies and the part works on; no clock works until done; check-ins arrive', async ({ page }) => {
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    await page.addInitScript(({ t, a, companion }) => {
      localStorage.setItem('walletAddress', a);
      localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify(companion));
      sessionStorage.setItem('authToken', t);
    }, { t: token, a: addr, companion: LEAD });
    await page.goto('/');
    await passDeskGates(page, 8000);
    const input = page.locator('.relink-input-field');
    await expect(input).toBeEnabled({ timeout: 60_000 });

    await openDockApp(page, 'CHATS');
    await page.locator('.chats-new', { hasText: 'NEW CHAT' }).click();
    const stream = page.locator('.fwin', { has: page.locator('.relink-input-field') });
    const maximize = stream.getByRole('button', { name: 'Maximize window' });
    if (await maximize.count()) await maximize.first().click();
    await expect(input).toBeVisible({ timeout: 15_000 });

    // ── 1. The assignment → the lead's questions (0..3) → the plan card → approve.
    await input.fill(ASSIGNMENT);
    await input.press('Enter');
    const planCard = page.locator('.plan-chip.pending');
    for (let round = 0; round < 3; round += 1) {
      const askCard = page.locator('.ask-chip.pending');
      const which = await Promise.race([
        planCard.waitFor({ state: 'visible', timeout: 8 * 60_000 }).then(() => 'plan', () => null),
        askCard.waitFor({ state: 'visible', timeout: 8 * 60_000 }).then(() => 'ask', () => null),
      ]);
      if (which !== 'ask') break;
      const option = askCard.locator('.ask-chip-options button').first();
      if (await option.count()) await option.click();
      else {
        await askCard.locator('.ask-chip-free input').fill('Your call: keep it true to the house.');
        await askCard.locator('.ask-chip-free button[type="submit"]').click();
      }
      await askCard.waitFor({ state: 'hidden', timeout: 60_000 });
    }
    await expect(planCard).toBeVisible({ timeout: 60_000 });
    const approvedAt = Date.now();
    await planCard.locator('.approval-actions button', { hasText: 'APPROVE' }).click();
    await expect(page.locator('.plan-chip.resolved.ok')).toBeVisible({ timeout: 60_000 });

    const runChip = page.locator('.teamrun-chip.pending');
    const settledWithout = async () => !(await runChip.count())
      && !(await page.locator('.relink-msg--neuma.is-streaming').count())
      && (await page.locator('.relink-msg--neuma').count()) > 0;
    // Model variance, handled as the operator would: a lead that reaches
    // past its arena before filing (live 2026-10-14: fs/read of /tmp) is
    // denied — the run brings its own arena.
    const stray = page.locator('.approval-chip.pending');
    const filed = await until(async () => {
      if (await runChip.count()) return 'run';
      if (await stray.count()) {
        test.info().annotations.push({ type: 'variance', description: `the lead asked to ${(await stray.first().locator('.tool-chip-name').textContent())?.trim()} before filing — denied` });
        await stray.first().locator('.approval-deny').click();
        await stray.first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
        return null;
      }
      return (await settledWithout()) ? 'asked' : null;
    }, 6 * 60_000, 2000);
    if (filed === 'asked') {
      await page.waitForTimeout(5000);
      if (!(await runChip.count())) {
        test.info().annotations.push({ type: 'variance', description: 'the lead asked for the word after the approval — given once' });
        await input.fill('Yes — file team/run now.');
        await input.press('Enter');
      }
    }
    await expect(runChip).toBeVisible({ timeout: 6 * 60_000 });
    timing('approve → team at work', approvedAt);
    const started = await until(async () => (await call('GET', '/live')).body?.runs?.find((r) => r.laneId === LEAD.neumaId), 30_000);
    const runId = started.id;
    const { body: { run: planned } } = await call('GET', `/runs/${runId}`);
    const essay = planned.steps.find((s) => !(s.needs || []).length);
    const answer = planned.steps.find((s) => (s.needs || []).includes(essay.id)) || planned.steps.find((s) => s.id !== essay.id);
    expect(essay && answer, 'the plan has a first part and a part after it').toBeTruthy();
    if (planned.clock || Object.keys(planned.clocks || {}).length) {
      test.info().annotations.push({ type: 'variance', description: `the lead set a clock anyway: ${JSON.stringify({ clock: planned.clock, clocks: planned.clocks })}` });
    }

    // A clean tray: only what this run tells the operator counts below.
    await page.locator('.ntray-bell').click();
    const clear = page.locator('.ntray-panel-action', { hasText: 'CLEAR' });
    if (await clear.isEnabled()) await clear.click();
    await expect(page.locator('.ntray-panel-list .ntray-card-kind')).toHaveCount(0, { timeout: 15_000 });
    await page.locator('.ntray-bell').click();

    // ── 2. THE OPERATOR'S HANDS, from the WORKFLOW window.
    await page.locator('.teamrun-chip-workflow').first().click();
    await expect(page.locator('.workflow .workflow-state.is-live')).toBeVisible({ timeout: 30_000 });
    const govern = page.locator('.workflow-govern');
    await expect(govern).toBeVisible();
    // No clock unless someone chose one — the run's own reads so.
    if (!planned.clock) await expect(govern.locator('.workflow-govern-clock').first()).toContainText('no clock');

    // 2a. The essay's own clock: a quarter-minute of working time, then NOTIFY.
    const essayRow = rowOf(page, essay.id);
    await openRow(essayRow);
    const essayDone = await essayRow.evaluate((el) => el.classList.contains('is-done'));
    test.skip(essayDone, 'variance: the essay landed before the operator could set its clock — re-run');
    await essayRow.locator('.workflow-clock .workflow-tune-btn', { hasText: 'SET ITS CLOCK' }).click();
    const editor = essayRow.locator('.workflow-clock-editor');
    await editor.locator('input.workflow-clock-input').first().fill(ESSAY_CLOCK_MINUTES);
    await editor.locator('select.workflow-clock-input').selectOption('notify');
    const clockSetAt = Date.now();
    await editor.locator('.workflow-tune-btn', { hasText: 'SET CLOCK' }).click();
    await expect(editor).toBeHidden({ timeout: 15_000 });

    // 2b. One part at a time — the plan's width, refined live.
    const width = govern.locator('.workflow-govern-value');
    const fewer = govern.getByRole('button', { name: 'fewer parts at once' });
    for (let i = 0; i < 8 && (await fewer.isEnabled()); i += 1) await fewer.click();
    await expect(width).toContainText(/^1\b/, { timeout: 15_000 });

    // 2c. Check-ins every minute (the window's choices start at 30 min; the
    //     route takes any cadence — the same hand the CoS has).
    const tuned = await call('POST', `/live/${runId}/tune`, { checkIn: 1 });
    expect(tuned.status, JSON.stringify(tuned.body)).toBe(200);
    await expect(govern.getByLabel('check-in cadence')).toHaveValue('1', { timeout: 15_000 });

    // ── 3. THE CLOCK PASSES IN WORKING TIME: the operator is told, the essay
    //    keeps working (NOTIFY never cuts it).
    const alertSeen = await until(async () => {
      const kinds = await trayCards(page);
      if (kinds.some((k) => k.includes('TEAM RUN'))) return 'alert';
      if (await essayRow.evaluate((el) => el.classList.contains('is-done'))) return 'done-first';
      return null;
    }, 6 * 60_000, 2000);
    timing('clock set → operator told', clockSetAt);
    test.info().annotations.push({ type: 'clock', description: alertSeen === 'alert' ? 'the clock passed while the essay worked — the operator was told' : 'the essay landed before its clock passed' });

    // ── 4. THE EYE: a check-in while the run works (or the run finished first).
    const checkInSeen = await until(async () => {
      const kinds = await trayCards(page);
      if (kinds.some((k) => k.includes('TEAM CHECK-IN'))) return 'check-in';
      if (await page.locator('.workflow .workflow-state.is-ok').count()) return 'finished-first';
      return null;
    }, 4 * 60_000, 3000);
    test.info().annotations.push({ type: 'eye', description: checkInSeen });

    // ── 5. THE TEAM FINISHES — the clocked essay whole (notify kept it
    //    working), the unclocked answer worked until done.
    await expect(page.locator('.workflow .workflow-state.is-ok')).toHaveText('TEAM FINISHED', { timeout: 15 * 60_000 });
    timing('approve → team finished', approvedAt);
    const { body: { run } } = await call('GET', `/runs/${runId}`);
    expect(run.status).toBe('done');
    expect(run.clocks?.[essay.id]?.then).toBe('notify');
    expect(run.clocks?.[answer.id] ?? null, 'the answer carried no clock of its own').toBeNull();
    expect(run.checkIn).toBe(1);
    expect(run.concurrency).toBe(1);
    expect(run.worked?.[essay.id], 'the essay\'s working time is on the record').toBeGreaterThan(0);
    if (alertSeen === 'alert') {
      expect(run.clockState?.[essay.id], 'the clock that acted is on the record').toBeTruthy();
      expect(run.completed[essay.id]).not.toMatch(/^\[PARTIAL/);
    }
    for (const step of planned.steps) {
      for (const file of step.files || []) {
        const stat = fs.statSync(path.join(run.workspace.root, file));
        expect(stat.size, `${step.id} delivered ${file}`).toBeGreaterThan(0);
      }
    }
    expect(alertSeen, 'the clock passed while the essay worked').toBe('alert');
    expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
  });
});
