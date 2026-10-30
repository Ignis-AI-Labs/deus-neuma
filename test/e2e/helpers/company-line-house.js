// @ts-check
// A HOUSE WITH COMPANIES, IN THE BROWSER (RULE 0) — the COMPANY LINE window's
// stack: an ISOLATED perf-harness stack (its own backend, build, workspaces,
// realm, data root and vault — never a live desk), a founded house of six
// sealed beings in their seats with the operator as Rector, its ground set
// through the real route, and two companies written through the real stores
// and judged by the real law: BRINE, house-led, its SHAPE worksheet handed to
// the operator to inspect; TIDEWATER, standing, with a HANDS ask, the
// Quaestor's mandate draft and the Numerarius's facts sheet. The beings' own
// acts are proven through the real sweep in test/integration; here the
// operator's side is driven from the window.
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { expect } from '@playwright/test';
import { perf } from './perf-harness.js';
import { claimOwner } from '../../helpers/claim-owner.js';
import { SHEETS, standCompany } from '../../helpers/company-line-kit.js';

/** lane, name, seat — the desk's own being is the Speculator. */
export const SEATED = Object.freeze([
  ['e2e-perf', 'Fenna', 'Speculator'],
  ['e2e-numer', 'Vela', 'Numerarius'],
  ['e2e-arch', 'Ostra', 'Architectus'],
  ['e2e-merc', 'Marin', 'Mercator'],
  ['e2e-prae', 'Pell', 'Praetor'],
  ['e2e-quae', 'Corva', 'Quaestor'],
]);
export const WALLET_IN = `0x${'7e'.repeat(20)}`;
const LANES = Object.freeze({ spec: 'e2e-perf', numer: 'e2e-numer', arch: 'e2e-arch', merc: 'e2e-merc', prae: 'e2e-prae' });
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'c')}`;

/** impure — one call to the stack as its operator */
export const api = (method, route, body) => fetch(`${perf.BASE}${route}`, {
  method,
  headers: { Authorization: `Bearer ${perf.token}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// impure — this worker's stores pointed at the stack's own roots
const stores = async () => {
  const { setWorkspacesRoot, default: workspace } = await import('../../../core/workspace/neuma-workspace.js');
  const { setRealmRoot } = await import('../../../backend/services/user-realm.js');
  setWorkspacesRoot(perf.root);
  setRealmRoot(path.join(perf.root, 'realm'));
  return {
    workspace,
    line: await import('../../../backend/services/company-line/company-store.js'),
    sheets: await import('../../../backend/services/company-line/worksheet-store.js'),
    hands: await import('../../../backend/services/company-line/hands-store.js'),
    handsShape: await import('../../../backend/services/company-line/hands-shape.js'),
    raise: await import('../../../backend/services/raise/raise-store.js'),
    raiseShape: await import('../../../backend/services/raise/raise-shape.js'),
    receipts: await import('../../../backend/services/money-in/receipt-rows.js'),
    moneyIn: await import('../../../backend/services/money-in/money-in-store.js'),
  };
};

/** impure — found the house of six, set its ground; returns the ground's path */
export const foundCompanyHouse = async () => {
  Object.assign(process.env, {
    WORKSPACES_ROOT: perf.root, NEUMA_DATA_ROOT: path.join(perf.root, 'data'), NEUMA_VAULT_ROOT: path.join(perf.root, 'vault'),
  });
  const { workspace } = await stores();
  for (const [i, [lane, name]] of SEATED.entries()) {
    await claimOwner(perf.root, lane, perf.addr);
    await workspace.writeDNA(lane, { version: '1.0.0', identity: { name }, genesis: `# Essence\nI am ${name}.` });
    await fs.promises.mkdir(path.join(perf.root, lane, 'identity'), { recursive: true });
    await fs.promises.writeFile(path.join(perf.root, lane, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soulOf(i) }));
    // the name the roster carries, as birth forges it — the window names every holder by it
    await fs.promises.writeFile(path.join(perf.root, lane, 'identity', 'true-name.json'), JSON.stringify({ chosenName: name, fullName: `${name} Tidewater`, houseName: 'Tidewater' }));
  }
  await fs.promises.writeFile(path.join(perf.root, `house-founding.ethereum.${perf.addr.toLowerCase()}.json`), JSON.stringify({
    houseName: 'Tidewater House', houseId: 1, network: 'ethereum',
    members: [{ kind: 0, title: 'Rector', address: perf.addr }, ...SEATED.map(([, , title], i) => ({ kind: 1, title, address: soulOf(i) }))],
  }));
  const ground = path.join(perf.root, 'house-ground');
  await fs.promises.mkdir(ground, { recursive: true });
  const set = await api('PUT', '/api/v1/user/realm/house-workspace', { root: ground });
  expect(set.status, await set.text()).toBe(200);
  return ground;
};

/** impure — BRINE at the operator's SHAPE inspection; TIDEWATER standing, a HANDS ask and a raise drafted */
export const seedCompanies = async (ground) => {
  const s = await stores();
  const now = new Date().toISOString();
  const append = async (id, event) => expect((await s.line.appendLineEvent(perf.addr, id, event)).ok, `${event.type} ${event.stage}`).toBe(true);

  const brine = s.line.makeCompany({ name: 'Brine', mode: 'house', openedBy: 'operator', now });
  await s.line.openCompany(perf.addr, brine);
  for (const [stage, by, inspections, inspector] of [
    ['survey', LANES.spec, ['Numerarius'], LANES.numer],
    ['measure', LANES.numer, ['Architectus'], LANES.arch],
    ['shape', LANES.arch, ['Rector'], null],
  ]) {
    await s.sheets.saveWorksheet({ wallet: perf.addr, companyId: brine.id, stage, round: 1, worksheet: SHEETS[stage], groundRoot: ground });
    await append(brine.id, { type: 'handed', stage, by, artifact: s.sheets.mirrorPath(brine.id, stage, 1), note: null, inspections, at: now });
    if (inspector) await append(brine.id, { type: 'inspected', stage, step: 0, verdict: 'accept', by: inspector, as: inspector, flaw: null, at: now });
  }

  const tidewater = s.line.makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now });
  await s.line.openCompany(perf.addr, tidewater);
  await standCompany(s.line.appendLineEvent, perf.addr, tidewater.id, LANES);
  const asked = await s.hands.raiseHands(perf.addr, tidewater.id, s.handsShape.makeHands({
    what: 'Register Tidewater Ltd as a private limited company',
    why: 'The company must exist in law before it can sign a customer or take an investment.',
    where: 'https://www.gov.uk/limited-company-formation', answer: 'fact', cost: '£50 and ten minutes', by: '2026-11-30', raisedBy: LANES.prae, now,
  }));
  expect(asked.ok).toBe(true);
  const mandate = s.raiseShape.makeMandate({
    amount: 250000, currency: 'USD', instrument: 'safe',
    valuation: { low: 2000000, high: 3000000, basis: 'repos/tidewater/valuation.md — revenue multiple against three comparables' },
    useOfFunds: 'Twelve months of serving, two harbour pilots, and counsel.', route: { kind: '506c', jurisdiction: 'US' },
    limits: { perDay: 3, followUps: 1 }, minCheck: 5000, by: 'e2e-quae', now,
  });
  expect((await s.raise.applyRaise(perf.addr, tidewater.id, () => ({ ok: true, event: { type: 'mandate', mandate, at: now } }))).ok).toBe(true);
  const sheet = s.raiseShape.makeFactsSheet({ facts: [
    { claim: 'Three harbours pay for the weekly sheet', figure: { value: 3, unit: 'harbours' }, source: 'books: Tidewater 2026 to date' },
    { claim: 'Monthly revenue from the sheet', figure: { value: 360, unit: 'USD' }, source: 'ledger: money-in, November 2026' },
    { claim: 'Thirty harbours within a year', figure: { value: 30, unit: 'harbours' }, source: 'repos/tidewater/plan.md', forwardLooking: true },
  ], by: 'e2e-numer', now });
  expect((await s.raise.applyRaise(perf.addr, tidewater.id, () => ({ ok: true, event: { type: 'facts', sheet, at: now } }))).ok).toBe(true);
  return { brine, tidewater };
};

/**
 * impure — after the operator signed: an investor listed, cleared by the
 * Praetor, interested, terms inside the mandate checked sound, and the money
 * landed at the mandate's wallet. Returns the investor and the receipt's key.
 */
export const seedInvestorLanded = async (companyId) => {
  const s = await stores();
  const now = new Date().toISOString();
  const investor = s.raiseShape.makeInvestor({ name: 'Cy Ventures', email: 'cy@ventures.example', thesis: 'Maritime software at seed', why: 'Backed two port-tech startups', by: LANES.spec, now });
  const judged = [
    () => ({ ok: true, event: { type: 'investor', investor, at: now } }),
    (st) => s.raiseShape.judgeClear(st, { investorId: investor.id, verdict: 'cleared', note: null, by: LANES.prae, now }),
    (st) => s.raiseShape.judgeUpdate(st, { investorId: investor.id, status: 'interested', note: 'Asked for the terms', by: LANES.merc, now }),
    (st) => s.raiseShape.judgeTerms(st, { investorId: investor.id, amount: 50000, valuation: 2500000, notes: 'Post-money SAFE', by: 'e2e-quae', now }),
    (st) => s.raiseShape.judgeTermsCheck(st, { investorId: investor.id, verdict: 'sound', note: null, by: LANES.prae, now }),
  ];
  for (const judge of judged) {
    const landed = await s.raise.applyRaise(perf.addr, companyId, judge);
    expect(landed.ok, landed.reason).toBe(true);
  }
  const usdc = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
  const receipt = s.receipts.makeReceipt({
    network: 'ethereum', asset: usdc, amountRaw: String(50000 * 1_000_000), from: ethers.Wallet.createRandom().address,
    to: { address: WALLET_IN, member: null, label: 'raise' }, block: 201, timestamp: Math.floor(Date.now() / 1000),
    txHash: `0x${'2'.padStart(64, '0')}`, logIndex: 0, internal: false, detectedAt: now,
  });
  await s.moneyIn.withHouseLock(perf.addr, () => s.moneyIn.appendReceipts(perf.addr, [receipt]));
  return { investor, key: receipt.key };
};

/** impure — the company line's notices the operator holds, newest first, as titles */
export const lineNotices = async () => {
  await stores();
  const { readNotifications } = await import('../../../backend/services/notification-store.js');
  const { records } = await readNotifications(perf.addr);
  return records.filter((n) => n.kind === 'company_line').map((n) => n.title);
};
