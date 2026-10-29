/**
 * money-in routes — the operator's REST window, through REAL auth (a
 * generated wallet signs a real challenge; the session token is real), the
 * real router, and real stores on tmp disk (RULE 0: nothing mocked). The
 * house is the caller's wallet: one operator never reads another's ledger.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';
import moneyInRouter from '../../backend/routes/money-in-routes.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot } from '../../core/index.js';
import { createChainSettings } from '../../backend/services/chain/chain-access.js';
import { makeReceipt } from '../../backend/services/money-in/receipt-rows.js';
import { appendReceipts, withHouseLock } from '../../backend/services/money-in/money-in-store.js';
import { scanNote, watchLine } from '../../frontend/app/RelinkShell/house-clock/money-in-view.js';

const USDC = { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
const ADDR = ethers.Wallet.createRandom().address;
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
let app;
let me;
let other;
let savedSwitch;

const receipt = (n, iso, member) => ({
  ...makeReceipt({
    network: 'base', asset: USDC, amountRaw: String(n * 1_000_000), from: ethers.Wallet.createRandom().address,
    to: { address: ADDR, member, label: member }, block: 100 + n, timestamp: Date.parse(iso) / 1000,
    txHash: hash(n), logIndex: 0, internal: false, detectedAt: iso,
  }),
  usd: n,
});

beforeAll(async () => {
  useTempRealm();
  const root = await createTempDir('money-in-routes-ws');
  setWorkspacesRoot(root);
  me = await fullAuth();
  other = await fullAuth();
  await writeOwner(root, 'lane-mine', me.address);
  await writeOwner(root, 'lane-theirs', other.address);
  savedSwitch = process.env.NEUMA_CHAIN_ACCESS_PATH;
  process.env.NEUMA_CHAIN_ACCESS_PATH = path.join(await createTempDir('money-in-routes-switch'), 'chain-access.json');
  await createChainSettings().setEnabled(false);
  await withHouseLock(me.address, () => appendReceipts(me.address, [
    receipt(1, '2026-10-01T10:00:00Z', 'lane-mine'),
    receipt(2, '2026-10-02T10:00:00Z', 'lane-mine'),
    receipt(3, '2026-10-20T10:00:00Z', null),
  ]));
  app = express();
  app.use(express.json());
  app.use('/api/v1/money-in', moneyInRouter);
});

afterAll(() => {
  if (savedSwitch === undefined) delete process.env.NEUMA_CHAIN_ACCESS_PATH;
  else process.env.NEUMA_CHAIN_ACCESS_PATH = savedSwitch;
});

const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);

describe('money-in REST', () => {
  test('no token, no ledger', async () => {
    expect((await request(app).get('/api/v1/money-in/ledger')).status).toBe(401);
  });

  test('the ledger pages newest first and filters; another house sees none of it', async () => {
    const page = await as(me)(request(app).get('/api/v1/money-in/ledger?limit=2'));
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(3);
    expect(page.body.receipts.map((r) => r.amount)).toEqual(['3.0', '2.0']);
    const mine = await as(me)(request(app).get('/api/v1/money-in/ledger?member=lane-mine&from=2026-10-02T00:00:00Z'));
    expect(mine.body.receipts.map((r) => r.amount)).toEqual(['2.0']);
    expect((await as(me)(request(app).get('/api/v1/money-in/ledger?from=yesterday'))).status).toBe(400);
    const theirs = await as(other)(request(app).get('/api/v1/money-in/ledger'));
    expect(theirs.body).toMatchObject({ total: 0, receipts: [] });
  });

  test('totals: the period summary and per-day buckets', async () => {
    const res = await as(me)(request(app).get('/api/v1/money-in/totals?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&granularity=day'));
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ count: 3, usdTotal: 6, unpriced: 0 });
    expect(res.body.summary.perAsset['base:USDC']).toMatchObject({ amountRaw: '6000000', amount: '6.0' });
    expect(res.body.periods.map((p) => p.usdTotal)).toEqual([1, 2, 3]);
    expect((await as(me)(request(app).get('/api/v1/money-in/totals?granularity=hour'))).status).toBe(400);
  });

  test('extra receive addresses: validated, owner-checked, watched, removable', async () => {
    const extra = ethers.Wallet.createRandom().address;
    expect((await as(me)(request(app).put('/api/v1/money-in/addresses/0x123').send({ label: 'x' }))).status).toBe(400);
    expect((await as(me)(request(app).put(`/api/v1/money-in/addresses/${extra}`).send({}))).status).toBe(400);
    expect((await as(me)(request(app).put(`/api/v1/money-in/addresses/${extra}`).send({ label: 'tips', member: 'lane-theirs' }))).status).toBe(403);
    const put = await as(me)(request(app).put(`/api/v1/money-in/addresses/${extra.toLowerCase()}`).send({ label: 'tips', member: 'lane-mine' }));
    expect(put.status).toBe(200);
    expect(put.body.extras).toEqual([expect.objectContaining({ address: extra, label: 'tips', member: 'lane-mine' })]);
    const watch = await as(me)(request(app).get('/api/v1/money-in/watch'));
    expect(watch.body.watched).toEqual([{ address: extra, member: 'lane-mine', label: 'tips', source: 'operator' }]);
    expect(watch.body.unwatched).toEqual([expect.objectContaining({ member: 'lane-mine' })]);
    expect((await as(me)(request(app).delete(`/api/v1/money-in/addresses/${ADDR}`))).status).toBe(404);
    expect((await as(me)(request(app).delete(`/api/v1/money-in/addresses/${extra}`))).body.extras).toEqual([]);
  });

  test('an attribution joins its receipt; an unknown key is refused', async () => {
    const key = `base:${hash(2)}:0`;
    expect((await as(me)(request(app).patch('/api/v1/money-in/attribution').send({ key: 'base:0x1:0', attribution: 'x' }))).status).toBe(404);
    expect((await as(me)(request(app).patch('/api/v1/money-in/attribution').send({ key, attribution: '' }))).status).toBe(400);
    const ok = await as(me)(request(app).patch('/api/v1/money-in/attribution').send({ key, attribution: ' website build, invoice 7 ' }));
    expect(ok.body).toEqual({ key, attribution: 'website build, invoice 7' });
    const ledger = await as(me)(request(app).get('/api/v1/money-in/ledger'));
    expect(ledger.body.receipts.find((r) => r.key === key).attribution).toBe('website build, invoice 7');
    // the other house cannot attribute this house's receipt
    expect((await as(other)(request(app).patch('/api/v1/money-in/attribution').send({ key, attribution: 'mine now' }))).status).toBe(404);
  });

  test('scan-now refuses while chain access is off, and writes no scan state', async () => {
    const res = await as(me)(request(app).post('/api/v1/money-in/scan'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHAIN_ACCESS_OFF');
    const statePath = path.join(process.env.NEUMA_REALM_ROOT, me.address, 'money-in', 'state.json');
    await expect(fs.access(statePath)).rejects.toThrow();
  });

  test('a scan with no RPC set reads no network, and the panel says so - never "scanned, 0 new"', async () => {
    const rpcKeys = ['ETH_RPC_URL', 'BASE_MAINNET_RPC_URL'];
    const savedRpc = Object.fromEntries(rpcKeys.map((k) => [k, process.env[k]]));
    for (const k of rpcKeys) delete process.env[k];
    await createChainSettings().setEnabled(true);
    const extra = ethers.Wallet.createRandom().address;
    try {
      await as(me)(request(app).put(`/api/v1/money-in/addresses/${extra}`).send({ label: 'tips' }));
      const res = await as(me)(request(app).post('/api/v1/money-in/scan'));
      expect(res.status).toBe(200);
      expect(res.body.networks).toEqual([
        { network: 'ethereum', skipped: 'unconfigured' },
        { network: 'base', skipped: 'unconfigured' },
      ]);
      expect(scanNote(res.body)).toBe('NOTHING SCANNED · NOT READ: ETHEREUM — NO RPC SET · BASE — NO RPC SET');
      const watch = await as(me)(request(app).get('/api/v1/money-in/watch'));
      expect(watchLine(watch.body)).toMatch(/LAST SCAN .* · NOT READ: ETHEREUM — NO RPC SET · BASE — NO RPC SET$/);
    } finally {
      await as(me)(request(app).delete(`/api/v1/money-in/addresses/${extra}`));
      await createChainSettings().setEnabled(false);
      for (const k of rpcKeys) if (savedRpc[k] !== undefined) process.env[k] = savedRpc[k];
    }
  });
});
