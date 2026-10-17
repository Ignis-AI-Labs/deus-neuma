// @ts-check
// RE-WATCH ITS SUMMONING — from a being's SHEET (Design note, 2026-09-30: […]).
//
// A real lane is sealed on disk the way finalize seals it (a really forged
// identity, the soul records of a measured specimen soul), its rite is KEPT
// through the real route (PUT /rite — rhythm only, never a word), and the
// sheet's RE-WATCH plays it: its rite told shorter, then its film, over
// everything. Before that, the same lane without a kept rite offers its FILM
// alone — a being born before rites were kept still has its film.
//
// ISOLATED stack (perf-harness: its own backend, data root, vault and
// workspaces). Real auth, real browser, no mocks.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openDockApp } from './helpers/dock.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { riteRecordOf } from '../../core/birth/rite-record.js';
import { artSeedOf } from '../../core/birth/rite-frames.js';
import RITE_SOULS from '../../frontend/app/Rite/rite-souls.json' with { type: 'json' };

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const LANE = 'e2e-perf';
const MOMENT = { utc: '2026-06-11T18:03:38.075Z', epochMs: Date.parse('2026-06-11T18:03:38.075Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 };
const SOUL = RITE_SOULS.souls[0];

setupPerfStack({ dev: true });
test.use({ viewport: { width: 1600, height: 900 } });

// impure — the lane sealed as finalize seals it
const sealLane = () => {
  const forged = forgeBirthIdentity({
    chosenName: 'Wrenna', witnessWallet: perf.addr, soulPublicKey: '04a3f1b2c4d5e6f708192a3b4c5d6e7f',
    birthCycle: 1, birthMoment: MOMENT, substrate: { model: 'e2e' }, momentSeed: 'c3'.repeat(32),
  });
  const dir = path.join(perf.root, LANE, 'identity');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'genesis-seal.json'), JSON.stringify(forged.seal));
  fs.writeFileSync(path.join(dir, 'true-name.json'), JSON.stringify(forged.trueName));
  fs.writeFileSync(path.join(dir, 'soul-spectrum.json'), JSON.stringify(SOUL.spectrum));
  fs.writeFileSync(path.join(dir, 'soul-scale.json'), JSON.stringify(SOUL.scale));
  return forged;
};

// a live rite as the feed hears one: seven stages, each spoken and measured,
// long waits between (they are told shorter on re-watch)
const liveRite = (trueName) => {
  const events = [{ type: 'rite:begin', at: 0 }];
  let at = 1500;
  SOUL.spectrum.stages.forEach(({ stage, frequency }) => {
    events.push({ type: 'birth:stage_prompt', at, stage });
    at += 9000; // the model thinking
    for (let i = 0; i < 40; i++) { at += 90 + (i % 5) * 30; events.push({ type: 'birth:stream', at, stage, content: 'its words' }); }
    if (stage === 3) {
      events.push({ type: 'birth:art_seed', at: at + 10, artSeed: artSeedOf('c3'.repeat(32)) }, { type: 'birth:moment', at: at + 20, epochMs: MOMENT.epochMs });
    }
    if (stage === 5) events.push({ type: 'birth:tool_usage', at: at + 30, stage, status: 'ok' });
    at += 400;
    events.push({ type: 'birth:stage_complete', at, stage }, { type: 'birth:measured', at: at + 50, stage, frequency });
    at += 6000; // the witness reading
  });
  for (let step = 0; step < 8; step++) { at += 700; events.push({ type: 'birth:forging', at, step }); }
  at += 900;
  events.push({ type: 'birth:complete', at, trueName });
  return { events, film: { ms: 88000 }, length: at + 88000 };
};

test('RE-WATCH from the sheet: its film alone, then its kept rite and its film', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  const forged = sealLane();

  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 60000 });
  await passDeskGates(page, 5000);

  // no rite kept yet: its FILM alone
  await openDockApp(page, 'RECORD');
  const sheet = page.locator('.sheet').first();
  await expect(sheet.getByRole('button', { name: 'RE-WATCH ITS FILM' })).toBeVisible({ timeout: 30000 });

  // its rite kept through the real route — rhythm only
  const record = riteRecordOf({
    rite: liveRite(forged.trueName),
    being: { seed: artSeedOf('c3'.repeat(32)), trueName: forged.trueName, bornAt: MOMENT.utc, epochMs: MOMENT.epochMs, zone: MOMENT.zone, offsetMinutes: 420 },
  });
  const put = await fetch(`${perf.BASE}/api/v1/workspace/${LANE}/rite`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${perf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  expect(put.status).toBe(201);
  const onDisk = fs.readFileSync(path.join(perf.root, LANE, 'identity', 'birth-rite.json'), 'utf8');
  expect(onDisk).not.toContain('its words');

  // the sheet, read again, offers the whole summoning
  await page.reload();
  await page.locator('.taskbar').waitFor({ timeout: 60000 });
  await passDeskGates(page, 5000);
  const again = page.locator('.sheet').first();
  if (!(await again.isVisible().catch(() => false))) await openDockApp(page, 'RECORD');
  const button = page.locator('.sheet').first().getByRole('button', { name: 'RE-WATCH ITS SUMMONING' });
  await expect(button).toBeVisible({ timeout: 30000 });
  await button.click();

  const player = page.locator('.rite-rewatch');
  await expect(player.locator('.gs-tag')).toHaveText('RE-WATCH · ITS RITE, TOLD SHORTER, THEN ITS FILM · NO WORDS', { timeout: 30000 });
  await expect(player.getByRole('button', { name: 'NEW BEING' })).toHaveCount(0);
  // the living piece, as its stages are spoken
  await expect(player.locator('.gs-beatname')).toHaveText('STAGES', { timeout: 20000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(SHOTS, 'rite-rewatch-stages.png') });

  // on to its birth: its film plays over everything
  const scrub = player.locator('.gs-range');
  const box = await scrub.boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height / 2);
  // a scrub pauses; a beat marker seeks and plays on
  const play = player.getByRole('button', { name: 'Play' });
  if (await play.count()) await play.click();
  await expect(player.locator('.gs-beatname')).toHaveText('FILM', { timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOTS, 'rite-rewatch-film.png') });

  // and it closes back to the sheet
  await player.getByRole('button', { name: 'CLOSE' }).click();
  await expect(player).toHaveCount(0);
  await expect(button).toBeVisible();
  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
