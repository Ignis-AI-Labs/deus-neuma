#!/usr/bin/env node
/**
 * A BENCHMARK LAUNCHED FROM THE HARNESS CHAT AND WATCHED TO ITS END, in the
 * real desktop app — a proof run, not a test: the bench plane refuses to launch
 * while any test runner is alive (a run must never measure under a test run),
 * so the proof itself cannot live inside one. (Design note, 2026-10-15: […].)
 *
 * Real everything: the app on a temp realm, a harness lane on the model server
 * on :8089, the real model, THIS machine's benchmarks repository and runner.
 *   1. […] → the
 *      ask-first card; ALLOW ONCE launches it.
 *   2. The composer's BENCHMARK chip shows it running, and the launch's own card
 *      in the chat reads it RUNNING.
 *   3. The chip opens the BENCH window on its LIVE tab (the tab wears its dot);
 *      the live arm's bar fills with items done of total.
 *   4. The set ends: the chip goes, LIVE reads LAST SET, the chat's card says
 *      it finished with every arm's mark and score — in the conversation that
 *      started it — and the operator holds a BENCHMARK DONE card.
 *   5. THE WATCH the launch set fires: the chat shows a WATCH line with the
 *      result and the model takes a NEW turn answering it — its row on the
 *      record marked origin 'watch', never the operator's.
 *   6. THE REPORT: the set's branded report is pressed (HTML + PDF), the model
 *      hands its path over in the chat, and the card offers OPEN REPORT.
 * Screens land in test/e2e/shots-bench-watch/. Run it ALONE (it refuses itself
 * when a benchmark already runs), on a built frontend:
 *   xvfb-run -a -s '-screen 0 1920x1080x24' node scripts/bench-watch-proof.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LLAMA, getJson, bootHarnessDesk, enterHarnessDesk, widenDesk, waitFor, liveRunCell,
} from '../test/e2e/helpers/harness-desk.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(REPO, 'test/e2e/shots-bench-watch');
const MINUTE = 60 * 1000;

const log = (m) => console.log(`[bench-watch] ${m}`);
if (!(await getJson(`${LLAMA}/v1/models`))?.data?.length) { console.log('FAIL — no model server on :8089'); process.exit(1); }
if (liveRunCell()) { console.log(`FAIL — ${liveRunCell()} is already running; run this proof alone`); process.exit(1); }

const desk = await bootHarnessDesk({ shots: SHOTS, dnaKey: 'bench-watch-proof-key-long-enough-for-the-law' });
const { page } = desk;
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const done = async (ok, line) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${line}`);
  if (!ok) await shot('fail');
  await desk.close();
  process.exit(ok ? 0 : 1);
};

try {
  await enterHarnessDesk(desk);
  await widenDesk(desk);
  log(`desk entered — lane ${desk.laneId} on ${desk.served}`);

  // 1. the ask, the card, the allow
  const field = page.locator('.relink-input-field').first();
  await field.fill('Run the smoke benchmark now, on its bare and harness arms.');
  await field.press('Enter');
  // every card the turn raises is allowed once (the operator's click), until the run stands
  const chip = page.getByTestId('bench-run-chip');
  const allow = page.getByRole('button', { name: 'ALLOW ONCE' });
  await waitFor('the launch, through its card', async () => {
    if (await chip.isVisible().catch(() => false)) return true;
    if (await allow.first().isVisible().catch(() => false)) {
      const card = (await allow.first().locator('xpath=ancestor::*[contains(@class,"chip")][1]').innerText().catch(() => '')).split('\n')[0];
      await shot('01-card');
      await allow.first().click();
      log(`ALLOW ONCE — ${card || 'a card'}`);
    }
    return false;
  }, { timeout: 8 * MINUTE, every: 1000 });

  // 2. the chip under the chat
  const label = await chip.innerText();
  if (!/BENCHMARK · smoke/.test(label)) await done(false, `the chip read "${label}"`);
  log(`chip: ${label}`);
  const card = page.getByTestId('bench-run-card');
  await waitFor('the chat card reading RUNNING', async () => /RUNNING/.test(await card.innerText()), { timeout: 2 * MINUTE });
  log(`chat card: ${(await card.innerText()).replace(/\n/g, ' · ')}`);
  await shot('02-chip');

  // 3. the chip opens BENCH on LIVE; the live arm fills with items
  await chip.click();
  const panel = page.locator('.bl-live');
  const liveTab = page.getByRole('tab', { name: /LIVE/ });
  await waitFor('the BENCH window on its LIVE tab', async () => (await liveTab.getAttribute('aria-selected')) === 'true'
    && /RUNNING NOW/.test(await panel.innerText()) && /smoke/i.test(await panel.innerText()), { timeout: MINUTE });
  if (!/●/.test(await liveTab.innerText())) await done(false, 'the LIVE tab wears no dot while a run is live');
  // the bar moves with real items — wait for one to land, logging every reading
  const seen = new Set();
  const items = await waitFor('an item to land on the live arm', async () => {
    const text = (await page.locator('.bl-stage-items').first().innerText().catch(() => '')).trim();
    if (text && !seen.has(text)) { seen.add(text); log(`live arm reads ${text}`); }
    return /^[1-5]\/5$/.test(text) ? text : null;
  }, { timeout: 15 * MINUTE, every: 1000 });
  await shot('03-bench-watch');

  // 4. the set ends — the chip goes, the window settles, the operator is told
  await waitFor('the set to end', async () => !(await chip.isVisible().catch(() => false)), { timeout: 30 * MINUTE, every: 5000 });
  await waitFor('LAST SET on LIVE', async () => /LAST SET/.test(await panel.innerText()), { timeout: MINUTE });
  await shot('04-bench-settled');
  // the conversation that started it is told: its card settles with every arm
  const settled = await waitFor('the chat card settled', async () => {
    const text = (await card.innerText()).replace(/\n/g, ' · ');
    return /SETTLED/.test(text) && /finished · bare ✓ [\d.]+ · harness ✓ [\d.]+/.test(text) ? text : null;
  }, { timeout: 2 * MINUTE, every: 2000 });
  log(`chat card: ${settled}`);
  // the operator is told: the BENCHMARK DONE card in their notifications (a pop-up, or the tray)
  const { readNotifications } = await import('../backend/services/notification-store.js');
  const notice = await waitFor('the BENCHMARK DONE card', async () => {
    const card = (await readNotifications(desk.seeded.address)).records.find((c) => c.kind === 'bench_done');
    return card ? `${card.title} · ${card.detail}` : null;
  }, { timeout: MINUTE });
  log(`notice: ${notice}`);
  await shot('05-chat-settled');

  // 5. the watch: a WATCH line in the chat, then the model's own turn about the result
  const watchLine = page.locator('.relink-watch-line').last();
  await watchLine.waitFor({ state: 'visible', timeout: 3 * MINUTE });
  const watchText = (await watchLine.innerText()).replace(/\n/g, ' ');
  log(`watch line: ${watchText}`);
  const told = await waitFor('the model answering the watch', async () => {
    // the record: the watch's row, marked as the platform's, then the model's answer after it
    const rows = await desk.laneRows();
    const at = rows.findIndex((r) => r.role === 'user' && r.origin === 'watch');
    const answer = at === -1 ? null : rows.slice(at + 1).find((r) => r.role === 'assistant');
    return answer ? { marked: rows[at], answer: String(answer.content) } : null;
  }, { timeout: 5 * MINUTE, every: 2000 });
  log(`the model, told: ${told.answer.slice(0, 300).replace(/\n/g, ' ')}`);
  await shot('06-watch-answered');
  if (!/bare ✓ [\d.]+ · harness ✓ [\d.]+/.test(told.marked.content)) await done(false, `the watch row carried no result: ${told.marked.content}`);

  // 6. the report: pressed, handed over by the model, one click from the card
  const reportPath = told.marked.content.match(/`([^`]+\.html)`/)?.[1];
  if (!reportPath || !fs.existsSync(reportPath)) await done(false, `no pressed report on disk: ${reportPath}`);
  if (!told.answer.includes(reportPath)) await done(false, 'the model did not hand the report path over');
  if (!(await page.getByTestId('bench-run-report').isVisible())) await done(false, 'the card offers no OPEN REPORT');
  log(`report: ${reportPath}${fs.existsSync(reportPath.replace(/\.html$/, '.pdf')) ? ' (+ PDF)' : ''}`);
  await done(/bare ✓ · harness ✓/.test(notice), `chip "${label}" · live arm ${[...seen].join(' → ')} · chat "${settled}" · notice "${notice}" · watch "${watchText}" · told "${told.answer.slice(0, 160).replace(/\n/g, ' ')}" · report ${reportPath}`);
} catch (err) {
  await done(false, err.message);
}
