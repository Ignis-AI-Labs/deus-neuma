// @ts-check
// THE COMPANY LINE WINDOW, DRIVEN BY ITS OPERATOR (Design note, 2026-10-29: the house
// forms and runs its own company; one stage, one master; money out is the
// operator's). On the isolated stack (helpers/company-line-house.js — a house
// of six sealed beings, the operator as Rector), a real browser opens the
// window from the launcher and the operator does only what is theirs:
//   - inspects BRINE's SHAPE (the worksheet whole on the window) and accepts it;
//   - masters CHOOSE as Rector (why this gap, and the line that stops it):
//     handing it on is the floor's yes, END THE GAP its no, on one screen —
//     the line moves straight to PROVE, the Mercator's by name;
//   - answers TIDEWATER's HANDS ask with the fact it wanted;
//   - signs the Quaestor's mandate (the receiving wallet entered here, never
//     by a being; counsel's choice of route confirmed) and records counsel's
//     approval of the facts sheet;
//   - signs an investor's close on money that landed at the mandate's wallet.
// Real backend, real auth, real browser, real stores. No mocks (RULE 0).
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openDockApp } from './helpers/dock.js';
import { underFloor } from './helpers/legibility.js';
import { foundCompanyHouse, seedCompanies, seedInvestorLanded, lineNotices, WALLET_IN } from './helpers/company-line-house.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');

setupPerfStack();
test.use({ viewport: { width: 1600, height: 1000 } });

test('the COMPANY LINE window: the operator inspects, masters, answers, signs the mandate and the close', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  const ground = await foundCompanyHouse();
  const { brine, tidewater } = await seedCompanies(ground);
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);

  await openDockApp(page, 'COMPANY LINE');
  const win = page.locator('.fwin').filter({ has: page.locator('.cline') }).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  await win.getByRole('button', { name: 'Maximize window' }).click();
  const tile = (label) => win.locator('.cline-tile', { hasText: label }).locator('.cline-tile-n');
  await expect(tile('WAITING ON YOU')).toHaveText('2'); // BRINE's inspection and TIDEWATER's HANDS ask
  await expect(tile('BEING FOUNDED')).toHaveText('1');
  await expect(tile('STANDING')).toHaveText('1');

  // ── BRINE · SHAPE: the operator inspects the Architectus's worksheet, whole ──
  const move = win.locator(`[data-company-move="${brine.id}"]`);
  await expect(move).toContainText('Brine · SHAPE — YOUR INSPECTION');
  await expect(move).toContainText('a one-page weekly harbour sheet'); // the ERRC grid's CREATE
  await expect(move).toContainText('Your harbour, your tides, one page.');
  const card = win.locator(`[data-company-line="${brine.id}"]`);
  await expect(card).toContainText('UP: YOU — TO INSPECT AS RECTOR');
  await expect(card.locator('.cline-stage.is-done')).toHaveCount(2);
  await move.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200); // the window's raise settles before the eye reads it
  await page.screenshot({ path: path.join(SHOTS, 'company-line-inspection.png') });
  expect(await underFloor(win.locator('.cline'))).toEqual([]);
  await expect(move.getByRole('button', { name: 'RETURN' })).toBeDisabled(); // a return names its flaw
  await move.getByRole('button', { name: 'ACCEPT' }).click();

  // ── BRINE · CHOOSE: the operator's own stage — their yes or no on one screen ──
  await expect(move).toContainText('Brine · CHOOSE — YOUR YES OR NO');
  await expect(move).toContainText('Handing it on is your yes — nothing comes back to you for a second look.');
  const endGap = move.getByRole('button', { name: 'END THE GAP' });
  await expect(endGap).toBeDisabled(); // the no names why
  await expect(move.getByLabel('A note for the inspector')).toHaveCount(0); // no inspector follows their own yes
  await move.getByLabel('Why this gap ends here').fill('three funded rivals');
  await expect(endGap).toBeEnabled();
  await move.getByLabel('Why this gap ends here').fill('');
  await expect(move).toContainText('THE GAP SHAPED: Tide tables for small harbours');
  const handOn = move.getByRole('button', { name: 'HAND ON' });
  await expect(handOn).toBeDisabled();
  await move.getByLabel('Why this gap is ours').fill('Nobody serves the one-page local sheet, and three harbour masters asked for it unprompted.');
  await move.getByLabel('We stop if').fill('fewer than three of ten harbours take a free month');
  await expect(handOn).toBeEnabled();
  await move.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'company-line-choose.png') });
  expect(await underFloor(win.locator('.cline'))).toEqual([]);
  await handOn.click();
  // nothing is approved twice: the hand-on was the floor's yes — no inspection of their own words follows
  await expect(move).toHaveCount(0);
  await expect(card).toContainText('UP: MARIN — TO MASTER');
  await expect(card.locator('.cline-stage.is-done')).toHaveCount(4);
  await expect(card.locator('.cline-stage.is-in-hand')).toContainText('MARIN');

  // ── TIDEWATER's HANDS ask: the fact the house wanted, answered ──
  const hands = win.locator('[data-hands-id]');
  await expect(hands).toHaveCount(1);
  await expect(hands).toContainText('Register Tidewater Ltd as a private limited company');
  await expect(hands).toContainText('ASKED BY PELL');
  await expect(hands).toContainText('DO IT AT WWW.GOV.UK');
  await expect(hands.locator('.cline-link')).toHaveCSS('text-transform', 'none'); // the link as it is, its site shown plainly
  await expect(hands.getByRole('button', { name: 'DONE' })).toBeDisabled(); // the fact first
  await hands.getByLabel('The fact the house asked for').fill('Registered on 2026-11-02 — the certificate is in repos/tidewater/papers');
  await hands.getByRole('button', { name: 'DONE' }).click();
  await expect(hands).toHaveCount(0);
  await expect(win.getByText('THE HOUSE ASKS NOTHING OF YOUR HANDS')).toBeVisible();
  await expect(tile('WAITING ON YOU')).toHaveText('0');

  // ── THE RAISE ROOM: the operator signs the Quaestor's mandate ──
  const room = win.locator(`[data-raise="${tidewater.id}"]`);
  await expect(room).toContainText('Tidewater — MANDATE UNSIGNED');
  await expect(room).toContainText('250,000 USD BY SAFE · VALUATION 2,000,000–3,000,000 · 506C IN US');
  const sign = room.getByRole('button', { name: 'SIGN', exact: true });
  await expect(sign).toBeDisabled();
  await room.getByRole('radio', { name: 'WALLET' }).click();
  await room.getByLabel('Receiving wallet (0x…)').fill(WALLET_IN);
  await expect(sign).toBeDisabled(); // counsel's choice of route, confirmed, before any signature
  await room.getByText('COUNSEL CHOSE THIS ROUTE').click();
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect(room).toContainText('Tidewater — MANDATE ACTIVE');
  await expect(room).toContainText(`MONEY LANDS AT: WALLET ${WALLET_IN} (ethereum)`);
  await expect(room.getByRole('button', { name: 'PAUSE' })).toBeVisible();
  await expect(room.getByRole('button', { name: 'END THE RAISE' })).toBeVisible(); // never a bare CLOSE beside an investor's close
  // the receiving wallet reads exactly as entered — never uppercased by the label it sits in
  await expect(room.locator('.cline-exact')).toHaveCSS('text-transform', 'none');
  await expect(room.locator('[data-raise-sign]')).toHaveCount(0);

  // counsel's review of the facts sheet, recorded by the operator
  await expect(room).toContainText('FACTS SHEET — 3 FACTS · WAITING FOR COUNSEL');
  await expect(room).toContainText('Thirty harbours within a year (30 harbours) — FORWARD-LOOKING');
  await room.getByRole('button', { name: 'COUNSEL APPROVED' }).click();
  await expect(room).toContainText('FACTS SHEET — 3 FACTS · APPROVED BY COUNSEL');

  // ── THE CLOSE: terms the Praetor checked sound, money landed at the mandate's wallet ──
  const { investor, key } = await seedInvestorLanded(tidewater.id);
  await win.getByRole('button', { name: 'READ NOW' }).click();
  const close = room.locator(`[data-raise-close="${investor.id}"]`);
  await expect(close).toContainText('CLOSE Cy Ventures — 50,000 USD AT A 2,500,000 VALUATION — ONLY YOU SIGN', { timeout: 20000 });
  await expect(tile('WAITING ON YOU')).toHaveText('0'); // the close waits in WAITING ON YOU, not on the line
  const signClose = close.getByRole('button', { name: 'SIGN THE CLOSE' });
  await close.getByText('THE PAPERS ARE SIGNED').click();
  await close.getByLabel('The money-in receipt').fill(key);
  await expect(signClose).toBeDisabled(); // a 506(c) close asks the investor verified accredited
  await close.getByText('THE INVESTOR IS VERIFIED ACCREDITED').click();
  await close.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'company-line-close.png') });
  expect(await underFloor(win.locator('.cline'))).toEqual([]);
  await signClose.click();
  await expect(close).toHaveCount(0);
  await expect(room.locator(`[data-investor-id="${investor.id}"]`)).toContainText(`Cy Ventures — CLOSED — 50,000 IN, UNDER ${key}`);

  // the operator's own moves told the operator nothing — they saw each next move on the desk
  expect(await lineNotices()).toEqual([]);

  // the dial: the charter's stop, PARTNER until one is approved
  await expect(win.locator('.cline-dial')).toContainText('YOUR DIAL — PARTNER');
  await room.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'company-line-raise.png') });
  expect(await underFloor(win.locator('.cline'))).toEqual([]);
  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
