// @ts-check
// THE COST METER ON THE TREASURY WINDOW, DRIVEN BY ITS OPERATOR (the house
// economy's Stage 3: what the house costs to run). On the isolated stack
// (perf-harness.js — its own backend, build, realm and workspaces; never a
// live desk), a real browser opens TREASURY from the launcher and the
// operator does only what is theirs:
//   - sets the electricity rate with its source (the meter was off, and said so);
//   - the meter's real minute reads the GPU (the real tick, on the stack's own
//     roots) and the month counts it;
//   - enters the rig as hardware paid off over 36 months, and an API bill;
//   - voids a wrong entry with why.
// Real backend, real auth, real browser, real stores, real nvidia-smi. No mocks (RULE 0).
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openDockApp } from './helpers/dock.js';
import { underFloor } from './helpers/legibility.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const MONTH = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();

// impure — the meter's real minute, run on the stack's own roots
const meterMinute = async () => {
  const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setWorkspacesRoot(perf.root);
  setRealmRoot(path.join(perf.root, 'realm'));
  const { costMeterTick } = await import('../../backend/services/cost-meter/cost-meter-scheduler.js');
  return costMeterTick();
};

setupPerfStack();
test.use({ viewport: { width: 1600, height: 1000 } });

test('the cost meter: the operator sets the rate, the minute reads the GPU, hardware and a bill are entered, a wrong one voided', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);

  await openDockApp(page, 'TREASURY');
  const win = page.locator('.fwin').filter({ has: page.locator('.treasury') }).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  await win.getByRole('button', { name: 'Maximize window' }).click();
  const costs = win.locator('[data-treasury-section="costs"]');
  await expect(costs).toContainText('THE METER IS OFF — SET YOUR ELECTRICITY RATE TO START IT', { timeout: 20000 });
  await expect(costs).toContainText('MISSING: the meter is off');

  // ── the rate, with where it comes from ──
  const setup = costs.locator('[data-cost-form="setup"]');
  const setRate = setup.getByRole('button', { name: 'SET THE RATE' });
  await setup.getByLabel('Currency').fill('USD');
  await setup.getByLabel('Your rate per kWh').fill('0.2');
  await expect(setRate).toBeDisabled(); // no rate without its source
  await setup.getByLabel('Where the rate comes from').fill('bill: Metro Power, September 2026');
  await setRate.click();
  await expect(costs.locator('[data-cost-meter="on"]')).toHaveText("METER ON — 0.2 USD PER kWh · 100% OF THIS MACHINE IS THIS HOUSE'S");
  await expect(costs).toContainText('RATE FROM: bill: Metro Power, September 2026');

  // ── the meter's minute: the GPU's real draw, counted in the month ──
  const tick = await meterMinute();
  expect(tick.houses).toBe(1);
  expect(tick.watts).toBeGreaterThan(0);
  await win.getByRole('button', { name: 'READ NOW' }).click();
  const month = costs.locator(`[data-cost-month="${MONTH}"]`);
  await expect(month).toContainText(/GPU ENERGY — [\d.]+ kWh × 0\.2 USD = [\d.,]+ USD · READ 1 MIN OF THE \d+ MIN THE METER STOOD ON/);
  await expect(costs.locator(`[data-cost-month]`).nth(1)).toContainText('GPU ENERGY — THE METER WAS NOT ON THIS MONTH');
  await expect(costs).toContainText('CHANGE THE RATE — IT HOLDS FROM THIS MINUTE ON');

  // ── the rig, as hardware over 36 months ──
  const cost = costs.locator('[data-cost-form="cost"]');
  await cost.getByLabel('What it is').fill('the rig');
  await cost.getByLabel('What it cost').fill('3600');
  await cost.getByLabel('Paid off over (months)').fill('36');
  await cost.getByLabel('Currency').fill('USD');
  await cost.getByLabel('Bought in').fill(MONTH);
  await cost.getByLabel('Its receipt or bill').fill('receipt: Micro Center, 2026-01-04');
  await cost.getByRole('button', { name: 'ADD THE COST' }).click();
  await expect(month).toContainText('the rig — 100.00 USD (MONTH 1 OF 36 OF ITS PRICE)');
  await expect(cost.getByLabel('What it is')).toHaveValue(''); // the draft clears once it lands

  // ── an API bill, entered twice by mistake ──
  const bill = costs.locator('[data-cost-form="bill"]');
  for (let i = 0; i < 2; i += 1) {
    await bill.getByLabel('Provider').fill('Anthropic');
    await bill.getByLabel('For the month').fill(MONTH);
    await bill.getByLabel('Amount').fill('12.5');
    await bill.getByLabel('Currency').fill('USD');
    await bill.getByLabel('The bill itself').fill('invoice: INV-2026-1182');
    await bill.getByRole('button', { name: 'ADD THE BILL' }).click();
    await expect(costs.locator('[data-cost-entry^="i-"]')).toHaveCount(i + 1);
  }
  await expect(costs).toContainText('ON THE RECORD — 3 ENTRIES');
  await expect(month.getByText('Anthropic API BILL — 12.50 USD')).toHaveCount(2);

  // ── the wrong one voided, with why ──
  const wrong = costs.locator('[data-cost-entry^="i-"]').last();
  const voidIt = wrong.getByRole('button', { name: 'VOID' });
  await expect(voidIt).toBeDisabled(); // a void names why
  await wrong.getByPlaceholder('why this entry is wrong').fill('entered twice');
  await voidIt.click();
  await expect(costs.locator('[data-cost-entry^="i-"]')).toHaveCount(1);
  await expect(month.getByText('Anthropic API BILL — 12.50 USD')).toHaveCount(1);
  await expect(costs).toContainText('ON THE RECORD — 2 ENTRIES');
  await expect(costs.locator('.tre-exact').first()).toHaveCSS('text-transform', 'none'); // a source reads as entered

  await costs.locator('[data-cost-meter]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'treasury-cost-meter.png') });
  await costs.locator('.tre-cost-entry').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'treasury-cost-meter-record.png') });
  expect(await underFloor(win.locator('.treasury'))).toEqual([]); // the whole window, not only RUNNING COSTS
  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
