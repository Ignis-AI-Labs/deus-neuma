/**
 * THE COMMERCE LEG OF THE LEGAL WATCH through the real stack (RULE 0): a
 * house on a temp realm with its CLO seated, a deal won and invoiced through
 * the real stores, the real legal watch run, the real matter ledger and the
 * operator's real notice. The public sanctions list is served by a loopback
 * server standing where treasury.gov stands (the X reply listener's
 * precedent), holding the US Treasury's own lines (test/fixtures/ofac).
 *
 * Under proof: with the Sanctions list connection off, nothing is fetched
 * and the ledger says the screen is off; on, the list is fetched once a day,
 * a buyer on it is a critical matter the operator is told of, and the
 * commerce matters land once — a second run refreshes them, never doubles.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import process from 'node:process';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { runLegalWatch } from '../../backend/services/legal/legal-scheduler.js';
import { matterLedgerFor } from '../../backend/services/legal/matter-ledger.js';
import { makeCompany, openCompany } from '../../backend/services/company-line/company-store.js';
import { makeDeal } from '../../backend/services/revenue/deal-shape.js';
import { openDeal, moveDeal } from '../../backend/services/revenue/deal-store.js';
import { setPayTo, issueInvoice } from '../../backend/services/invoices/invoice-store.js';
import { makeInvoice } from '../../backend/services/invoices/invoice-shape.js';
import { readNotifications } from '../../backend/services/notification-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIOR_ROOT = getWorkspacesRoot();
const DOORS = ['NEUMA_SANCTIONS_ROOT', 'NEUMA_DATA_ROOT'];

describe('the commerce leg of the legal watch', () => {
  let me, server, hits, saved, company, switches;
  const matters = async () => (await (await matterLedgerFor(me.address)).load()).filter((m) => m.area === 'commerce');
  const winDeal = async (buyer) => {
    const now = new Date().toISOString();
    const deal = makeDeal({ companyId: company.id, buyer, value: { amount: 900, currency: 'USD' }, nextStep: 'send the proposal', openedBy: 'merc', now,
      spin: { problem: 'tide tables arrive late every week', needPayoff: 'two fewer missed berths a month, they said' } });
    expect((await openDeal(me.address, deal)).ok).toBe(true);
    expect((await moveDeal(me.address, deal.id, { stage: 'won', note: 'Signed the one-page sheet for a year.', by: 'merc', now })).ok).toBe(true);
    return deal;
  };

  beforeAll(async () => {
    saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
    useTempRealm();
    const tmp = await createTempDir('commerce-review');
    process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    for (const laneId of ['clo', 'merc']) {
      await workspace.create(laneId);
      await fs.writeFile(path.join(workspace.pathFor(laneId), 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    }
    await cloDesignation.designate(me.address, 'clo');
    company = makeCompany({ name: 'Tidewater', mode: 'field', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, company);
    const deal = await winDeal('Port of Brine');
    expect((await setPayTo(me.address, { address: `0x${'7e'.repeat(20)}`, by: 'operator', now: new Date().toISOString() })).ok).toBe(true);
    const payTo = { address: `0x${'7e'.repeat(20)}`, network: 'ethereum' };
    expect((await issueInvoice(me.address, ({ number, billed }) => makeInvoice({
      deal: { ...deal, stage: 'won' }, company, payTo, number, billed: billed(deal.id), lines: [{ what: 'Harbour sheet', amount: 900 }], due: '2099-01-31', by: 'quae', now: new Date().toISOString(),
    }))).ok).toBe(true);

    hits = [];
    const [sdn, alt] = await Promise.all(['sdn-head.csv', 'alt-head.csv'].map((f) => fs.readFile(path.join(HERE, '../fixtures/ofac', f), 'utf8')));
    server = http.createServer((req, res) => {
      hits.push(req.url);
      const body = req.url === '/sdn.csv' ? sdn : req.url === '/alt.csv' ? alt : null;
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/csv' });
      res.end(body ?? 'not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.NEUMA_SANCTIONS_ROOT = `http://127.0.0.1:${server.address().port}`;
  }, 60000);

  afterAll(() => {
    switches?.restore();
    server?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('off: nothing is fetched, and the ledger says the screen is off beside the terms and the tax', async () => {
    const run = await runLegalWatch({ wallet: me.address, trigger: 'manual' });
    expect(run.commerce).toMatchObject({ matters: 3, sanctions: { off: true } });
    expect(hits).toEqual([]);
    expect((await matters()).map((m) => [m.externalId, m.severity, m.status])).toEqual([
      [`terms:${company.id}`, 'medium', 'new'], [`tax:${company.id}`, 'medium', 'new'], ['sanctions-off', 'low', 'new'],
    ]);
  });

  test('on: the list is fetched, a buyer on it is a critical matter the operator is told of — and nothing doubles', async () => {
    switches = connectionsOn(['sanctions-list']);
    const deal = await winDeal('National Bank of Cuba');
    const run = await runLegalWatch({ wallet: me.address, trigger: 'manual' });
    expect(run.commerce.sanctions).toMatchObject({ fetched: expect.any(Number) });
    expect(hits.sort()).toEqual(['/alt.csv', '/sdn.csv']);
    const hit = (await matters()).find((m) => m.externalId === `sanctions:buyer:${deal.id}`);
    expect(hit).toMatchObject({ severity: 'critical', status: 'new', title: 'Possible sanctions match: National Bank of Cuba (buyer) — listed as NATIONAL BANK OF CUBA, CUBA' });
    const { records } = await readNotifications(me.address);
    expect(records.find((n) => /Legal watch: \d+ new matter/.test(n.title))?.detail).toContain('CRITICAL Possible sanctions match: National Bank of Cuba');

    await runLegalWatch({ wallet: me.address, trigger: 'manual' });
    expect(hits).toHaveLength(2); // a day's copy serves the next run
    const all = await matters();
    expect(all.filter((m) => m.externalId === `sanctions:buyer:${deal.id}`)).toHaveLength(1);
    expect(all.filter((m) => m.externalId === `terms:${company.id}`)).toHaveLength(1);
  });
});
