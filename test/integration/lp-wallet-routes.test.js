/**
 * The operator's LP wallet routes (backend/routes/lp-wallet-routes.js) over
 * REAL parts (RULE 0): the real router behind a real Express app, real signed
 * session tokens, a real claimed workspace, a real chain node (anvil as chain
 * 8453) and a real HTTP listener in Umbrae's place.
 */
import process from 'node:process';
import fs from 'node:fs/promises';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { installLpManager, installLpPool } from '../helpers/lp-chain-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, POOL } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { _resetConfig } from '../../backend/config.js';
import { runLpAction } from '../../backend/services/umbrae-lp/lp-run.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import lpRouter from '../../backend/routes/lp-wallet-routes.js';

const NEUMA_ID = 'lproutesecho';
let app, root, originalRoot, anvil, provider, umbrae, connections, operator, operatorToken, strangerToken;
const priorRpc = process.env.BASE_MAINNET_RPC_URL;
const as = (token) => (req) => req.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  _resetConfig();
  resetChainProviders();
  root = await createTempDir('lp-routes');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(NEUMA_ID);
  operator = ethers.Wallet.createRandom();
  await claimOwner(root, NEUMA_ID, operator.address);
  operatorToken = createSessionToken(operator.address);
  strangerToken = createSessionToken(ethers.Wallet.createRandom().address);
  umbrae = await startUmbraeStandIn({ provider });
  await installLpManager(provider, UMBRAE_BASE.positionManager);
  await installLpPool(provider, POOL);
  for (const [token, units] of [['0x4200000000000000000000000000000000000006', 18], ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6]]) {
    await provider.send('anvil_setCode', [token, returnContract({ fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]) })]);
  }
  app = express();
  app.use(express.json());
  app.use('/api/v1/neuma', lpRouter);
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
  _resetConfig();
  resetChainProviders();
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  umbrae.reset();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
});

const base = `/api/v1/neuma/${NEUMA_ID}/lp`;

describe('the operator\'s LP wallet routes', () => {
  test('before it is opened there is no LP wallet; opening makes one, once, and gives its address to fund', async () => {
    expect((await as(operatorToken)(request(app).get(base))).body).toEqual({ neumaId: NEUMA_ID, lp: null, goals: [], clock: null });
    const first = await as(operatorToken)(request(app).post(`${base}/open`));
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(ethers.isAddress(first.body.address)).toBe(true);
    const again = await as(operatorToken)(request(app).post(`${base}/open`));
    expect(again.body).toEqual({ neumaId: NEUMA_ID, address: first.body.address, created: false });
    expect(JSON.stringify(again.body)).not.toMatch(/0x[0-9a-f]{64}/);
  });

  test('another signed-in wallet, or no sign-in, is refused', async () => {
    expect((await as(strangerToken)(request(app).post(`${base}/open`))).status).toBe(403);
    expect((await as(strangerToken)(request(app).get(base))).status).toBe(403);
    expect((await request(app).put(`${base}/budget`).send({ budgetUsd: 1000 })).status).toBe(401);
  });

  test('the budget is set in dollars; nonsense is refused', async () => {
    const set = await as(operatorToken)(request(app).put(`${base}/budget`)).send({ budgetUsd: 50.555 });
    expect(set.body).toEqual({ neumaId: NEUMA_ID, budgetUsd: 50.56 });
    for (const budgetUsd of [-1, 'lots', null, 2_000_000]) {
      expect((await as(operatorToken)(request(app).put(`${base}/budget`)).send({ budgetUsd })).status).toBe(400);
    }
    expect((await as(operatorToken)(request(app).get(base))).body.lp.budgetUsd).toBe(50.56);
  });

  test('a deposit past the budget shows as waiting; the operator\'s yes runs it on Base; a second answer finds nothing', async () => {
    const { body: { address } } = await as(operatorToken)(request(app).post(`${base}/open`));
    await provider.send('anvil_setBalance', [address, ethers.toQuantity(ethers.parseEther('1'))]);
    const waited = await runLpAction(NEUMA_ID, { type: 'open', pool: POOL, amountY: '100' }, { provider, pollMs: 50 });
    expect(waited.pending).toBe(true);

    const view = (await as(operatorToken)(request(app).get(base))).body.lp;
    expect(view.pending.map((r) => r.id)).toEqual([waited.requestId]);
    expect(view.pending[0].reason).toMatch(/past the \$50\.56 budget/);

    const yes = await as(operatorToken)(request(app).post(`${base}/pending/${waited.requestId}/approve`));
    expect(yes.status).toBe(200);
    expect(yes.body).toMatchObject({ ok: true, type: 'open', tokenId: '77' });
    expect((await provider.getTransactionReceipt(yes.body.txHashes[0])).from).toBe(address);

    const twice = await as(operatorToken)(request(app).post(`${base}/pending/${waited.requestId}/decline`));
    expect(twice.status).toBe(404);
    expect((await as(operatorToken)(request(app).get(base))).body.lp.pending).toEqual([]);
  }, 60000);

  test('a declined deposit is ended and nothing is sent', async () => {
    const waited = await runLpAction(NEUMA_ID, { type: 'open', pool: POOL, amountY: '100' }, { provider, pollMs: 50 });
    umbrae.reset();
    const no = await as(operatorToken)(request(app).post(`${base}/pending/${waited.requestId}/decline`));
    expect(no.body).toMatchObject({ ok: true, declined: true });
    expect(umbrae.seen).toEqual([]);
  }, 60000);
});
