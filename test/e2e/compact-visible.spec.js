// @ts-check
// /COMPACT YOU CAN SEE — a real browser on a desk stack of its own: a 40-message
// chat on disk, one real turn through the real local model (so the gauge holds a
// measured reading), then /compact. The chat must show the compaction where it
// happened (CONVERSATION COMPACTED, the counts, WHERE WE LEFT OFF open), the
// gauge must move at once (≈, lower) without another message, and a reload must
// show the marker in its place and replay the post-compaction reading.
//
// Skipped honestly when no model answers on :8089. No mock anywhere (RULE 0).
// SAFETY LAW: its own backend + vite + data root (isolated-house.js); the
// machine's serving files are a read-only copy (playwright.config.js).
import { test, expect } from '@playwright/test';
import path from 'path';
import { setupIsolatedHouse, openDesk, REPO } from './helpers/isolated-house.js';
import { passDeskGates } from './helpers/desk-gates.js';

const LLAMA = 'http://127.0.0.1:8089';
process.env.LLM_PROVIDER = 'llama-server';
process.env.LLAMA_SERVER_URL = LLAMA;

const MEMBER = { id: 'e2e-compact-visible', name: 'Orin', utc: '2026-03-01T09:00:00Z' };
const ctx = setupIsolatedHouse([MEMBER], 4630);

let liveModel = null;
test.beforeAll(async () => {
  const probe = await fetch(`${LLAMA}/v1/models`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  liveModel = probe?.data?.[0]?.id || null;
});

// A working chat's length — long enough that folding it is worth something.
const ASK = 'Walk me through what goes out today, who it is for, what we measure afterwards, and what we hold back until the numbers come in. Keep the reasoning visible so I can check it against the week as a whole.';
const PLAN = 'One post on how the build is made, written plainly, to the early-access list first and the public feed an hour later. We measure replies and sign-ups over the next six hours, not likes. We hold the benchmark chart until the run is complete, because a partial chart invites the wrong reading. In the evening we answer every reply by hand and note the questions that keep coming back, because those become tomorrow\'s post. If sign-ups stall, we change the opening line, never the claim.';

// A working day's full reply: the folded half must clear the compact floor
// (compact-region.js — 5% of a 262K window, ≈13.1K tokens).
const DAY_PLAN = Array(10).fill(PLAN).join(' ');

// impure — a 40-message chat on the stack's own disk, written through the real workspace engine.
const seedChat = async () => {
  const { default: workspace, setWorkspacesRoot } = await import(path.join(REPO, 'core/workspace/neuma-workspace.js'));
  setWorkspacesRoot(ctx.root);
  await workspace.writeDNA(MEMBER.id, { version: '1.0.0', identity: { name: MEMBER.name }, genesis: `# Essence\nI am ${MEMBER.name}.` });
  const sessionId = `session-${Date.now()}`;
  const day = Date.parse('2026-10-22T05:00:00Z');
  for (let i = 0; i < 20; i += 1) {
    const at = (s) => new Date(day + i * 120000 + s * 1000).toISOString();
    await workspace.appendMessage(MEMBER.id, sessionId, { role: 'user', turnId: `t${i}`, timestamp: at(0),
      content: `Day ${i + 1} of the launch plan. ${ASK}` });
    await workspace.appendMessage(MEMBER.id, sessionId, { role: 'assistant', turnId: `t${i}`, timestamp: at(30),
      content: `Day ${i + 1}. ${DAY_PLAN}` });
  }
  return sessionId;
};

const shot = async (page, name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(REPO, `test/e2e/shots/${name}.png`) });
};
const gaugeTitle = (page) => page.locator('.ctx-strip').getAttribute('title');
const usedOf = (title) => Number(String(title).match(/([\d,]+) used/)?.[1]?.replace(/,/g, '') ?? NaN);

test.use({ viewport: { width: 1600, height: 1000 } });

test('a /compact shows where we left off, and the gauge moves now', async ({ page }) => {
  test.skip(!liveModel, 'no model answers on :8089 — load one to run this live proof');
  await seedChat();
  await openDesk(page, ctx, MEMBER);
  await expect(page.locator('.relink-msg--user')).toHaveCount(20, { timeout: 30000 });
  const dismiss = page.getByText('DISMISS', { exact: true });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();

  // One real turn: the gauge now holds a measured reading of this chat.
  const input = page.locator('.relink-input-field');
  await input.fill('In one sentence: which day are we on?');
  await input.press('Enter');
  await expect(page.locator('.ctx-strip')).toBeVisible({ timeout: 240000 });
  await expect(page.locator('.relink-msg--neuma.is-streaming')).toHaveCount(0, { timeout: 240000 });
  await expect.poll(async () => usedOf(await gaugeTitle(page)), { timeout: 60000 }).toBeGreaterThan(0);
  const before = usedOf(await gaugeTitle(page));

  // The portal refuses while the turn is still settling (its note says so); ask again until it runs.
  const marker = page.locator('.compact-marker.is-done');
  await expect.poll(async () => {
    if (await page.locator('.compact-marker').count()) return true;
    await input.fill('/compact');
    await input.press('Enter');
    await page.waitForTimeout(3000);
    return (await page.locator('.compact-marker').count()) > 0;
  }, { timeout: 120000, intervals: [2000] }).toBe(true);
  await expect(marker).toBeVisible({ timeout: 240000 });
  await expect(marker.locator('.compact-marker-rule')).toHaveText('CONVERSATION COMPACTED');
  await expect(marker.locator('.compact-marker-detail')).toHaveText(/\d+ MESSAGES CARRIED FORWARD .* · \d+ MESSAGES KEPT WORD FOR WORD/);
  await expect(marker.locator('.compact-marker-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(marker.locator('.compact-marker-words')).not.toBeEmpty();
  // The gauge moved without another message: an estimate, and lower.
  await expect.poll(async () => usedOf(await gaugeTitle(page)), { timeout: 30000 }).toBeLessThan(before);
  await expect(page.locator('.ctx-strip-label')).toContainText('≈');
  await marker.locator('.compact-marker-rule').scrollIntoViewIfNeeded();
  await shot(page, 'compact-visible');

  // HIDE / SHOW is the operator's.
  await marker.locator('.compact-marker-toggle').click();
  await expect(marker.locator('.compact-marker-words')).toHaveCount(0);

  // A reload: the marker stands in its place, closed; the gauge replays the folded reading.
  const after = usedOf(await gaugeTitle(page));
  await page.reload();
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Escape'); // the start-up ignition: any key skips it
  await passDeskGates(page);
  const reloaded = page.locator('.compact-marker.is-done');
  await expect(reloaded).toBeVisible({ timeout: 30000 });
  await expect(reloaded.locator('.compact-marker-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(reloaded.locator('.compact-marker-detail')).toHaveText(/· \d+ MESSAGES KEPT WORD FOR WORD/);
  await expect.poll(async () => usedOf(await gaugeTitle(page)), { timeout: 30000 }).toBe(after);
  await reloaded.scrollIntoViewIfNeeded();
  await page.waitForTimeout(4000);
  await shot(page, 'compact-visible-reload');
});
