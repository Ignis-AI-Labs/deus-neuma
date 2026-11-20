import fs from 'node:fs/promises';
import path from 'node:path';
import { ethers } from 'ethers';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { makeReceipt } from '../../backend/services/money-in/receipt-rows.js';
import { appendReceipts, readExternalReceipts, withHouseLock } from '../../backend/services/money-in/money-in-store.js';
import { claimReceipt } from '../../backend/services/money-in/receipt-consumption.js';
import { houseWatchSet } from '../../backend/services/money-in/watch-set.js';
import { makeCompany, openCompany, companyPath } from '../../backend/services/company-line/company-store.js';
import { makeInvoice, judgePaid, foldInvoices } from '../../backend/services/invoices/invoice-shape.js';
import { issueInvoice, recordPaid } from '../../backend/services/invoices/invoice-store.js';
import { makeMandate, makeInvestor, judgeCloseInvestor } from '../../backend/services/raise/raise-shape.js';
import { applyRaise } from '../../backend/services/raise/raise-store.js';
import { appendJsonLine } from '../../backend/services/jsonl-append.js';
import { makeEntry } from '../../backend/services/accounts/books-shape.js';
import { bookEntry } from '../../backend/services/accounts/books-store.js';
import { houseReceipts, matchedFigures } from '../../backend/services/accounts/house-receipts.js';
import { accountsBoard } from '../../backend/services/accounts/accounts-board.js';

const HOUSE = ethers.Wallet.createRandom().address;
const PAY_TO = ethers.Wallet.createRandom().address;
const NOW = '2026-11-17T12:00:00.000Z';
const USDC = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
let root; let realm; let priorRoot; let priorRealm; let company; let invoice; let external; let internal;

const receipt = (n, over = {}) => makeReceipt({
  network: 'ethereum', asset: USDC, amountRaw: '100000000', from: ethers.Wallet.createRandom().address,
  to: { address: PAY_TO, member: null, label: 'invoices' }, block: 100 + n, timestamp: 1_763_400_000 + n,
  txHash: `0x${String(n).padStart(64, '0')}`, logIndex: 0, internal: false, detectedAt: NOW, ...over,
});

beforeAll(async () => {
  root = await createTempDir('pr600-receipts-workspaces');
  realm = await createTempDir('pr600-receipts-realm');
  priorRoot = getWorkspacesRoot();
  priorRealm = getRealmRoot();
  setWorkspacesRoot(root);
  setRealmRoot(realm);
  await workspace.create('lane-a');
  await fs.writeFile(path.join(root, 'lane-a', 'owner.json'), JSON.stringify({ wallet: HOUSE, claimedAt: NOW, name: 'Keir' }));
  await fs.mkdir(path.join(root, 'lane-a', 'identity'), { recursive: true });
  await fs.writeFile(path.join(root, 'lane-a', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: PAY_TO }));
  company = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: NOW });
  await openCompany(HOUSE, company);
  external = receipt(1);
  internal = receipt(2, { internal: true });
  await withHouseLock(HOUSE, () => appendReceipts(HOUSE, [external, internal]));
  const issued = await issueInvoice(HOUSE, ({ number, billed }) => makeInvoice({
    deal: { id: 'deal-1', stage: 'won', buyer: 'Harbour Ltd', value: { amount: 100, currency: 'USD' } },
    company, lines: [{ what: 'Pilot services', amount: 100 }], due: '2026-11-30', payTo: { address: PAY_TO, network: 'ethereum' }, number, billed, by: 'quae', now: NOW,
  }));
  invoice = issued.invoice;
});

afterAll(async () => {
  setWorkspacesRoot(priorRoot);
  setRealmRoot(priorRealm);
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (realm) await fs.rm(realm, { recursive: true, force: true });
});

describe('P6-49 — public watch set and payment eligibility', () => {
  test('LP creation-audit and vault addresses join without any private key file', async () => {
    const lp = ethers.Wallet.createRandom().address;
    const agent = ethers.Wallet.createRandom().address;
    const safe = ethers.Wallet.createRandom().address;
    await workspace.audit('lane-a', 'LP_WALLET_CREATED', { address: lp });
    await workspace._writeJSON(path.join(workspace._path('lane-a'), 'config', 'agent-vault.json'), {
      version: 1, safe, roles: ethers.Wallet.createRandom().address, treasury: HOUSE, agent,
      rolesDeployedBlock: 10, rolesInitializedBlock: 11,
    });
    const watched = await houseWatchSet(HOUSE);
    expect(watched.watched.map((row) => row.address)).toEqual(expect.arrayContaining([PAY_TO, lp, agent, safe]));
    expect(await fs.access(path.join(root, 'lane-a', 'keys', 'lp-wallet.json')).then(() => true, () => false)).toBe(false);
  });

  test('internal transfers never reach the payment-eligibility reader', async () => {
    const rows = await readExternalReceipts(HOUSE);
    expect(rows.map((row) => row.key)).toContain(external.key);
    expect(rows.map((row) => row.key)).not.toContain(internal.key);
    expect(judgePaid(foldInvoices([{ type: 'issued', invoice }]).invoices, { invoiceId: invoice.id, receipt: internal, by: 'operator', now: NOW }).reason).toMatch(/house-internal/);
    expect((await recordPaid(HOUSE, { invoiceId: invoice.id, receiptKey: internal.key, by: 'operator', now: NOW })).ok).toBe(false);
  });
});

describe('P6-49 — one receipt, one house-wide consumer', () => {
  test('invoice success blocks the real raise and book paths; internal rows stay out of available receipts', async () => {
    expect((await recordPaid(HOUSE, { invoiceId: invoice.id, receiptKey: external.key, by: 'operator', now: NOW })).ok).toBe(true);
    const entry = makeEntry({
      receipt: { kind: 'money-in', ref: external.key },
      matched: { direction: 'in', amount: 100, currency: 'USDC', date: external.timestamp }, category: 'revenue', memo: 'Pilot services', by: 'logi', now: NOW,
    });
    expect((await bookEntry(HOUSE, company.id, entry)).reason).toMatch(/one receipt, one consumer/);

    const mandate = makeMandate({
      amount: 1000, currency: 'USD', instrument: 'safe', valuation: { low: 10000, high: 20000, basis: 'Harbour comparables, two reviewed transactions' },
      useOfFunds: 'Twelve months of customer pilot delivery.', route: { kind: '506c', jurisdiction: 'US' }, limits: { perDay: 2, followUps: 1 }, minCheck: 10, by: 'quae', now: NOW,
    });
    const investor = makeInvestor({ name: 'Ann Fund', email: 'ann@fund.example', thesis: 'Maritime software at seed', why: 'Backed port-tech before', by: 'spec', now: NOW });
    const file = companyPath(HOUSE, company.id, 'raise.jsonl');
    const events = [
      { type: 'mandate', mandate, at: NOW }, { type: 'signed', id: mandate.id, account: { kind: 'wallet', address: PAY_TO, network: 'ethereum' }, by: 'operator', at: NOW },
      { type: 'investor', investor, at: NOW }, { type: 'cleared', id: investor.id, verdict: 'cleared', note: null, by: 'prae', at: NOW },
      { type: 'update', id: investor.id, status: 'interested', note: 'Wants the deck', by: 'merc', at: NOW },
      { type: 'terms', id: investor.id, amount: 50, valuation: 15000, notes: null, by: 'quae', at: NOW },
      { type: 'terms-check', id: investor.id, verdict: 'sound', note: null, by: 'prae', at: NOW },
    ];
    for (const event of events) await appendJsonLine(file, event);
    const { readRaise } = await import('../../backend/services/raise/raise-store.js');
    expect(judgeCloseInvestor(await readRaise(HOUSE, company.id), {
      investorId: investor.id, signedPapers: true, accreditedVerified: true, receipt: internal, reference: null, now: NOW,
    }).reason).toMatch(/house-internal/);
    const close = applyRaise(HOUSE, company.id, (state) => judgeCloseInvestor(state, {
      investorId: investor.id, signedPapers: true, accreditedVerified: true, receipt: external, reference: null, now: NOW,
    }));
    expect((await close).reason).toMatch(/one receipt, one consumer/);
    expect((await accountsBoard(HOUSE, Date.now())).unbooked.some((row) => row.ref === external.key)).toBe(false);
    expect((await houseReceipts(HOUSE)).some((row) => row.ref === internal.key)).toBe(false);
  });

  test('a different valid receipt closes the raise, then cannot be booked; concurrent claims have one winner', async () => {
    const second = receipt(3);
    await withHouseLock(HOUSE, () => appendReceipts(HOUSE, [second]));
    const { readRaise } = await import('../../backend/services/raise/raise-store.js');
    const raise = await readRaise(HOUSE, company.id);
    const investor = raise.investors[0];
    const closed = await applyRaise(HOUSE, company.id, (state) => judgeCloseInvestor(state, {
      investorId: investor.id, signedPapers: true, accreditedVerified: true, receipt: second, reference: null, now: NOW,
    }));
    expect(closed.ok).toBe(true);
    const entry = makeEntry({
      receipt: { kind: 'money-in', ref: second.key },
      matched: { direction: 'in', amount: 100, currency: 'USDC', date: second.timestamp }, category: 'investment', memo: 'Ann Fund investment', by: 'logi', now: NOW,
    });
    expect((await bookEntry(HOUSE, company.id, entry)).reason).toMatch(/one receipt, one consumer/);

    const third = receipt(4);
    await withHouseLock(HOUSE, () => appendReceipts(HOUSE, [third]));
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => claimReceipt(HOUSE, { kind: 'money-in', ref: third.key }, { kind: 'book', index })));
    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.ok).every((attempt) => attempt.reason.includes('one receipt, one consumer'))).toBe(true);

    const fourth = receipt(5);
    await withHouseLock(HOUSE, () => appendReceipts(HOUSE, [fourth]));
    const available = await houseReceipts(HOUSE);
    const matched = matchedFigures(available, 'money-in', fourth.key);
    expect(matched).toMatchObject({ amount: 100, currency: 'USDC', direction: 'in' });
    const validEntry = makeEntry({ receipt: { kind: 'money-in', ref: fourth.key }, matched, category: 'revenue', memo: 'Separate valid receipt', by: 'logi', now: NOW });
    expect((await bookEntry(HOUSE, company.id, validEntry)).ok).toBe(true);
    expect((await accountsBoard(HOUSE, Date.now())).unbooked.some((row) => row.ref === fourth.key)).toBe(false);
  });
});
