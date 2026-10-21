// @ts-check
// WORKFLOW, LIVE — the operator's whole hold on a team run, through the real
// desk: approve the lead's plan, watch a member work in the WORKFLOW window,
// give the next member guidance before it starts, keep talking to the lead
// while the team works, stop the run, pick it up where it stopped, reload the
// desk mid-run, and see it finish with every deliverable on disk.
//
// Design note, 2026-10-10: […]
// Design note, 2026-10-12: […]
// Design note, 2026-10-12: […] — OPEN LOG opens one member alone.
//
// Everything is real: wallet auth, the lead (Keir of House Aldmere) planning
// on the real substrate, the plan card approved in the stream, the team/run
// intent the lead files, members working with their own hands in a fresh
// arena, the WORKFLOW window fed by the server's frames, STOP / guidance /
// RESUME through the live routes. Model variance is handled, not hidden: the
// lead may ask 0..3 questions first; the plan gate, the background run, the
// stop, the resume and the finish are mandatory.
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
  'A small team project for the house journal, kept to two parts.',
  'Plan exactly two steps and submit the plan for my approval:',
  'step "greeting" is yours, Keir: write a two-line greeting for the house journal into greeting.md;',
  'step "answer" is Signal\'s and needs "greeting": read greeting.md and write a one-line answer to it into answer.md.',
  'List each step\'s file in its files. Name no workspace: the run gets its own arena.',
].join(' ');
const GUIDANCE = 'Begin your answer with the word Heard.';
const TEAM_WORD = 'A word to the whole team: keep it warm and brief.';

// The operator's own calls, on the session the desk holds.
const teamApi = (token) => async (method, url, body) => {
  const res = await fetch(`${BACKEND}/api/v1/team${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

// Wait for a value, never poll once.
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

// One member's row in the WORKFLOW window, by its step id.
const rowOf = (page, stepId) => page.locator('.workflow .workflow-row', {
  has: page.locator('.workflow-step', { hasText: new RegExp(`^${stepId}$`) }),
});

// A row opens by itself only while its member works (or failed) — open it.
const openRow = async (row) => {
  if (!(await row.locator('.workflow-member-panel').count())) await row.locator('.workflow-row-head').click();
  await expect(row.locator('.workflow-member-panel')).toBeVisible();
};

test.describe('WORKFLOW — a team run the operator watches, guides, stops and resumes, live', () => {
  test.skip(process.env.E2E_LIVE !== '1', 'live-being run — opt in with E2E_LIVE=1 (see header rules)');
  test.setTimeout(35 * 60 * 1000); // a real team thinks in minutes — twice, here
  // A desk-sized screen: the stream, its rails and the WORKFLOW window side by
  // side (at 1280×720 the rails squeeze the composer to nothing).
  test.use({ viewport: { width: 1920, height: 1080 } });

  let token, addr, call;
  test.beforeAll(async () => {
    ({ token, addr } = await mintToken());
    call = teamApi(token);
  });

  test('watch, guide, chat, stop, resume, reload, finish — nothing lost, the chat never held', async ({ page }) => {
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

    // FRESH SESSION (rule 3): CHATS' NEW CHAT severs whatever sitting was held.
    await openDockApp(page, 'CHATS');
    await page.locator('.chats-new', { hasText: 'NEW CHAT' }).click();
    // The stream window opens at its saved size; with its rails open the
    // composer can be squeezed to nothing — give it the desk, as an operator would.
    const stream = page.locator('.fwin', { has: page.locator('.relink-input-field') });
    const maximize = stream.getByRole('button', { name: 'Maximize window' });
    if (await maximize.count()) await maximize.first().click();
    await expect(input).toBeVisible({ timeout: 15_000 });

    // ── 1. The assignment → the lead's questions (0..3) → the plan card.
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
        await askCard.locator('.ask-chip-free input').fill('Your call: keep it small and true to the house.');
        await askCard.locator('.ask-chip-free button[type="submit"]').click();
      }
      await askCard.waitFor({ state: 'hidden', timeout: 60_000 });
    }
    await expect(planCard).toBeVisible({ timeout: 60_000 });
    const approvedAt = Date.now();
    await planCard.locator('.approval-actions button', { hasText: 'APPROVE' }).click();
    await expect(page.locator('.plan-chip.resolved.ok')).toBeVisible({ timeout: 60_000 });

    // ── 2. The lead files team/run and the team works IN THE BACKGROUND:
    //    the chip says TEAM AT WORK, the server lists the run, and the lead's
    //    own turn ends — the chat is the operator's again.
    // Model variance, handled: a lead may still ask for the word after the
    // approval ([…] — live, 2026-10-12).
    // The operator gives it once, as Founder would.
    const runChip = page.locator('.teamrun-chip.pending');
    const settledWithout = async () => !(await runChip.count())
      && !(await page.locator('.relink-msg--neuma.is-streaming').count())
      && (await page.locator('.relink-msg--neuma').count()) > 0;
    const first2 = await until(async () => ((await runChip.count()) ? 'run' : (await settledWithout()) ? 'asked' : null), 6 * 60_000, 2000);
    if (first2 === 'asked') {
      await page.waitForTimeout(5000); // a run filed in the turn's last round shows its chip
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
    const first = planned.steps.find((s) => !(s.needs || []).length);
    const second = planned.steps.find((s) => (s.needs || []).includes(first.id)) || planned.steps.find((s) => s.id !== first.id);
    expect(first && second, 'the plan has a first part and a part after it').toBeTruthy();
    await expect(page.locator('.relink-msg--neuma.is-streaming')).toHaveCount(0, { timeout: 4 * 60_000 });

    // ── 3. WATCH: the WORKFLOW window opens on the run; a working member's
    //    reasoning or words arrive while it works.
    await page.locator('.teamrun-chip-workflow').first().click();
    await expect(page.locator('.workflow .workflow-state.is-live')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.workflow .workflow-row')).toHaveCount(planned.steps.length);
    const firstRow = rowOf(page, first.id);
    const liveText = firstRow.locator('.workflow-member-thought .workflow-member-text, .workflow-member-words .workflow-member-text').first();
    const firstSeen = await until(async () => {
      if (await firstRow.evaluate((el) => el.classList.contains('is-done'))) return 'done-before-seen';
      return (await liveText.count()) && (await liveText.textContent())?.trim() ? (await liveText.textContent()) : null;
    }, 4 * 60_000);
    if (firstSeen !== 'done-before-seen') {
      // Still arriving: the text the window shows moves while the member works.
      await until(async () => {
        if (await firstRow.evaluate((el) => el.classList.contains('is-done'))) return true;
        return (await liveText.count()) && (await liveText.textContent()) !== firstSeen;
      }, 60_000);
    }
    test.info().annotations.push({ type: 'watched', description: firstSeen === 'done-before-seen' ? 'the first part landed before a stream was read' : `streamed ${firstSeen.length} chars` });

    // ── 4. A CHANNEL TO ONE MEMBER: guidance for the member that has not
    //    started yet joins its brief.
    const secondRow = rowOf(page, second.id);
    await openRow(secondRow);
    await secondRow.locator('.workflow-steer-input').fill(GUIDANCE);
    await secondRow.locator('.workflow-steer-send').click();
    await expect(secondRow.locator('.workflow-steer-note')).toContainText('Heard', { timeout: 15_000 });

    // ── 4b. THE TEAM CHANNEL: the operator's word to everyone — read when
    //     they look, nobody's work cut; it shows in the window and lands in
    //     the team room on disk.
    const channel = page.locator('.workflow-channel');
    await channel.locator('.workflow-steer-input').fill(TEAM_WORD);
    await channel.locator('.workflow-steer-send').click();
    await expect(channel.locator('.workflow-channel-post.is-yours')).toContainText(TEAM_WORD, { timeout: 15_000 });

    // ── 5. THE CHAT STAYS THE OPERATOR'S: the lead answers while its team works.
    const spoken = await page.locator('.relink-msg--neuma').count();
    const askedAt = Date.now();
    await input.fill('While your team works: one short sentence, are you still with me?');
    await input.press('Enter');
    await expect.poll(
      async () => page.locator('.relink-msg--neuma:not(.is-streaming)').count(),
      { timeout: 5 * 60_000, intervals: [1000] },
    ).toBeGreaterThan(spoken);
    timing('chat reply while the team works', askedAt);
    const liveDuringChat = Boolean((await call('GET', '/live')).body?.runs?.some((r) => r.id === runId));
    test.info().annotations.push({ type: 'chat', description: liveDuringChat ? 'the team was still at work when the lead answered' : 'the team had finished before the reply landed' });

    // ── 6. STOP once the first part has landed: every member stops; what
    //    finished is kept.
    await expect(firstRow).toHaveClass(/is-done/, { timeout: 10 * 60_000 });
    await expect(page.locator('.workflow .workflow-state.is-live'), 'the run is still at work when STOP is pressed').toBeVisible();
    await openRow(firstRow);
    const firstPart = await firstRow.locator('.workflow-member-part .workflow-member-text').textContent();
    expect(firstPart?.trim()).toBeTruthy();
    await page.locator('.workflow-head .teamrun-stop-arm').click();
    const stopAt = Date.now();
    await page.locator('.workflow-head .teamrun-stop-confirm').click();
    await expect(page.locator('.workflow .workflow-state.is-bad')).toHaveText('RUN STOPPED', { timeout: 60_000 });
    timing('stop → run stopped', stopAt);

    // ── 7. PICK UP WHERE IT STOPPED: the run waits in the window; RESUME
    //    reopens the same run, its finished part standing.
    const resumeRow = page.locator('.workflow-resume-row').first();
    await expect(resumeRow).toContainText('YOU STOPPED IT', { timeout: 30_000 });
    await expect(resumeRow).toContainText(`1 OF ${planned.steps.length} PARTS DONE`);
    const resumeAt = Date.now();
    await resumeRow.locator('.workflow-resume-go').click();
    await expect(page.locator('.workflow .workflow-state.is-live')).toBeVisible({ timeout: 60_000 });
    timing('resume → team at work', resumeAt);
    expect((await call('GET', '/live')).body.runs.map((r) => r.id)).toContain(runId);
    await expect(firstRow).toHaveClass(/is-done/);
    await openRow(firstRow);
    await expect(firstRow.locator('.workflow-member-part .workflow-member-text')).toHaveText(firstPart);

    // ── 8. A RELOAD LOSES NOTHING: the desk re-seeds the run from the server.
    await page.reload();
    await passDeskGates(page, 8000);
    if (!(await page.locator('.workflow').count())) await openDockApp(page, 'WORKFLOW');
    await expect(page.locator('.workflow .workflow-state.is-live, .workflow .workflow-state.is-ok')).toBeVisible({ timeout: 60_000 });
    await expect(rowOf(page, first.id)).toHaveClass(/is-done/);

    // ── 9. THE TEAM FINISHES — the whole run, every part on disk, the
    //    guidance kept in the record and followed in the work.
    await expect(page.locator('.workflow .workflow-state.is-ok')).toHaveText('TEAM FINISHED', { timeout: 12 * 60_000 });
    timing('approve → team finished (with a stop and a resume)', approvedAt);
    const { body: { run } } = await call('GET', `/runs/${runId}`);
    expect(run.status).toBe('done');
    expect(run.resumes).toHaveLength(1);
    expect(run.order.slice(0, 1)).toEqual([first.id]);
    expect(run.order).toContain(second.id);
    expect(run.completed[first.id], 'the first part was never re-run').toBe(firstPart);
    expect(run.notes[second.id].map((n) => n.note)).toEqual([GUIDANCE]);
    expect(run.completed[second.id]).toMatch(/heard/i);
    for (const step of planned.steps) {
      for (const file of step.files || []) {
        const stat = fs.statSync(path.join(run.workspace.root, file));
        expect(stat.size, `${step.id} delivered ${file}`).toBeGreaterThan(0);
      }
    }
    // The team channel kept the operator's word — on the record and in the
    // team room the members read.
    expect(run.channel.map((m) => m.text)).toContain(TEAM_WORD);
    expect(fs.readFileSync(path.join(run.workspace.root, '.team', 'channel.md'), 'utf8')).toContain(`your operator → everyone: ${TEAM_WORD}`);
    // Each part worked in a sitting of its own, recorded on the run.
    expect(run.sessions?.[first.id] && run.sessions?.[second.id], 'each part recorded its sitting').toBeTruthy();
    expect(run.sessions[first.id]).not.toBe(run.sessions[second.id]);

    // ── 10. ONE MEMBER, SEPARATELY (ruling, 2026-10-12): OPEN LOG opens the
    //     second member alone — its whole log, from its own lane, in order:
    //     how each attempt began, its acts, how it ended.
    const logRow = rowOf(page, second.id);
    await logRow.locator('.workflow-open-log').click();
    const log = page.locator('.workflow-log');
    await expect(log).toBeVisible({ timeout: 15_000 });
    await expect(log.locator('.workflow-log-open').first()).toContainText('ATTEMPT 1', { timeout: 15_000 });
    await expect(log.locator('.workflow-log-act').first()).toBeVisible();
    await expect(log.locator('.workflow-log-end.is-answered')).toHaveCount(1);
    const attempts = await log.locator('.workflow-log-open').count();
    test.info().annotations.push({ type: 'log', description: `${second.id}: ${attempts} attempt(s), ${await log.locator('.workflow-log-act').count()} act entries` });
    await log.locator('.workflow-log-back').click();
    await expect(page.locator('.workflow .workflow-board')).toBeVisible();
    expect(crashes, `JS crashes: ${crashes.join(' | ')}`).toEqual([]);
  });
});
