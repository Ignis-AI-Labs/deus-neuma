// @ts-check
// INVOICES AND DELIVERY, DRIVEN BY THE OPERATOR (the house economy's Stages
// 3–4). On the isolated stack (perf-harness.js — its own backend, build,
// realm and workspaces; never a live desk), with a house founded
// (company-line-house.js) and a deal its Mercator won, a real browser does
// only the operator's part — the beings' part (issuing, publishing, paid) is
// proven through the real sweep in test/integration/house-invoice-delivery:
//   - TREASURY: says where invoices are paid (no invoice could be issued before);
//   - the Quaestor's invoice stands OPEN; money lands at that address; the
//     operator marks it PAID BY the receipt the window offers;
//   - COMPANY LINE → SALES: chooses where deliveries go; the published invoice's
//     link stands on the won deal.
// Real backend, real auth, real browser, real stores. No mocks (RULE 0).
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { openDockApp } from './helpers/dock.js';
import { underFloor } from './helpers/legibility.js';
import { foundCompanyHouse, WALLET_IN } from './helpers/company-line-house.js';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const DUE = '2099-01-31';

// impure — the real stores, on the stack's own roots
const stores = async () => {
  const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setWorkspacesRoot(perf.root);
  setRealmRoot(path.join(perf.root, 'realm'));
  return {
    line: await import('../../backend/services/company-line/company-store.js'),
    cro: (await import('../../backend/services/revenue/cro-designation.js')).croDesignation,
    cfo: (await import('../../backend/services/treasury/cfo-designation.js')).cfoDesignation,
    deals: await import('../../backend/services/revenue/deal-store.js'),
    dealShape: await import('../../backend/services/revenue/deal-shape.js'),
    invoices: await import('../../backend/services/invoices/invoice-store.js'),
    invoiceShape: await import('../../backend/services/invoices/invoice-shape.js'),
    delivery: await import('../../backend/services/delivery/delivery-store.js'),
    receipts: await import('../../backend/services/money-in/receipt-rows.js'),
    moneyIn: await import('../../backend/services/money-in/money-in-store.js'),
  };
};

setupPerfStack();
test.use({ viewport: { width: 1600, height: 1000 } });

test('invoices and delivery: the operator says where the house is paid and where work goes, and marks an invoice paid', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await foundCompanyHouse();
  const s = await stores();
  const now = () => new Date().toISOString();
  await s.cro.designate(perf.addr, 'e2e-merc');
  await s.cfo.designate(perf.addr, 'e2e-quae');
  const company = s.line.makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: now() });
  await s.line.openCompany(perf.addr, company);
  const deal = s.dealShape.makeDeal({
    companyId: company.id, buyer: 'Port of Brine', value: { amount: 1200, currency: 'USD' }, nextStep: 'send the proposal', openedBy: 'e2e-merc', now: now(),
    spin: { problem: 'tide tables arrive late every week', needPayoff: 'two fewer missed berths a month, they said' },
  });
  expect((await s.deals.openDeal(perf.addr, deal)).ok).toBe(true);
  expect((await s.deals.moveDeal(perf.addr, deal.id, { stage: 'won', note: 'They signed the one-page sheet for a year.', by: 'e2e-merc', now: now() })).ok).toBe(true);

  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.taskbar').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);

  // ── TREASURY: where the house is paid — the operator's alone to say ──
  await openDockApp(page, 'TREASURY');
  const tre = page.locator('.fwin').filter({ has: page.locator('.treasury') }).first();
  await expect(tre).toBeVisible({ timeout: 20000 });
  await tre.getByRole('button', { name: 'Maximize window' }).click();
  const inv = tre.locator('[data-treasury-section="invoices"]');
  await expect(inv).toContainText('WHERE INVOICES ARE PAID IS NOT SET — NO INVOICE CAN BE ISSUED UNTIL YOU SET IT', { timeout: 20000 });
  const set = inv.getByRole('button', { name: 'SET WHERE INVOICES ARE PAID' });
  await expect(set).toBeDisabled();
  await inv.getByLabel('Receiving wallet (0x…)').fill(WALLET_IN);
  await set.click();
  await expect(inv.locator('[data-invoice-wallet="set"]')).toHaveText(`PAID TO: ${ethers.getAddress(WALLET_IN)} ON ETHEREUM · WATCHED FOR MONEY IN`);

  // the Quaestor issues; the money lands at the operator's address
  const payTo = await s.invoices.readPayTo(perf.addr);
  const issued = await s.invoices.issueInvoice(perf.addr, ({ number, billed }) => s.invoiceShape.makeInvoice({
    deal: { ...deal, stage: 'won' }, company, payTo, number, billed: billed(deal.id), due: DUE, by: 'e2e-quae', now: now(),
    lines: [{ what: 'Harbour sheet, one year', amount: 1000 }, { what: 'Setup', amount: 200 }],
  }));
  expect(issued.ok, issued.reason).toBe(true);
  const usdc = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
  const receipt = s.receipts.makeReceipt({
    network: 'ethereum', asset: usdc, amountRaw: String(1200 * 1_000_000), from: ethers.Wallet.createRandom().address,
    to: { address: WALLET_IN, member: null, label: 'invoices' }, block: 401, timestamp: Math.floor(Date.now() / 1000),
    txHash: `0x${'4'.padStart(64, '0')}`, logIndex: 0, internal: false, detectedAt: now(),
  });
  await s.moneyIn.withHouseLock(perf.addr, () => s.moneyIn.appendReceipts(perf.addr, [receipt]));

  await tre.getByRole('button', { name: 'READ NOW' }).click();
  const row = inv.locator('[data-invoice="INV-0001"]');
  await expect(row).toContainText(`INV-0001 — Port of Brine — 1,200.00 USD — DUE ${DUE} — OPEN`, { timeout: 20000 });
  await expect(row).toContainText('Harbour sheet, one year — 1000 USD');
  await expect(row.getByRole('button', { name: 'VOID' })).toBeDisabled(); // a void names why
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'treasury-invoices.png') });
  expect(await underFloor(tre.locator('.treasury'))).toEqual([]);
  await row.getByRole('button', { name: /^PAID BY 1,200 USDC ON / }).click();
  await expect(row).toContainText(`INV-0001 — Port of Brine — 1,200.00 USD — DUE ${DUE} — PAID`);
  await expect(row).toContainText(`BY RECEIPT ${receipt.key}`);

  // ── COMPANY LINE → SALES: where finished work goes ──
  await openDockApp(page, 'COMPANY LINE');
  const win = page.locator('.fwin').filter({ has: page.locator('.cline') }).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  await win.getByRole('button', { name: 'Maximize window' }).click();
  const sales = win.locator('[data-sales]');
  await expect(sales).toContainText('DELIVERY — NOT SET: NOTHING CAN BE DELIVERED UNTIL YOU CHOOSE WHERE', { timeout: 20000 });
  const served = path.join(perf.root, 'served');
  fs.mkdirSync(served, { recursive: true });
  await sales.getByLabel('Delivery folder on this machine').fill(served);
  await sales.getByLabel('Its https address').fill('https://files.example.test/out');
  await sales.getByRole('button', { name: 'SET WHERE DELIVERIES GO' }).click();
  await expect(sales.locator('[data-delivery-destination]')).toHaveText(`INTO ${served} · SERVED AT https://files.example.test/out`);

  // the Mercator publishes the invoice (with the operator's yes, proven in the integration walk)
  const destination = await s.delivery.readDestination(perf.addr);
  const { invoices } = await s.invoices.readInvoices(perf.addr);
  const published = await s.delivery.publish(perf.addr, {
    destination, deal, company: company.id, kind: 'invoice', name: 'INV-0001.html', body: s.invoiceShape.invoiceHtml(invoices[0]), invoiceId: invoices[0].id, by: 'e2e-merc', now: now(),
  });
  await win.getByRole('button', { name: 'READ NOW' }).click();
  const link = sales.locator(`[data-delivery="${published.id}"] a`);
  await expect(link).toHaveAttribute('href', published.link, { timeout: 20000 });
  await expect(link).toHaveCSS('text-transform', 'none'); // a link reads exactly as it is
  await sales.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'company-line-delivery.png') });
  expect(await underFloor(win.locator('.cline'))).toEqual([]);
  expect(crashes, `page errors: ${crashes.join(' | ')}`).toEqual([]);
});
