/**
 * The neuma wallet balance names the network it was read on, and an RPC that
 * does not answer reads as "could not read" (null), never as an empty wallet.
 *
 * RULE 0: the real router, the real wallet service, a real workspace on tmp
 * disk, real session tokens, and REAL JSON-RPC nodes on loopback ports
 * (test/helpers/local-base-rpc.js) that the service's own ethers provider
 * really talks to — one answering as Base, one returning HTTP 503. The RPC
 * url reaches the service the way production sets it: BASE_MAINNET_RPC_URL
 * through the real loadConfig.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startLocalBaseRpc } from '../helpers/local-base-rpc.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { createSessionToken } from '../../backend/services/auth.js';
import walletRouter from '../../backend/routes/neuma-wallet-routes.js';

const NEUMA_ID = 'balance-being';
const ONE_ETH_HEX = '0x' + (10n ** 18n).toString(16);

let app, node, being, witnessToken, previousRoot;

const readWallet = (network) => request(app)
  .get(`/api/v1/neuma/${NEUMA_ID}/wallet?network=${network}`)
  .set('Authorization', `Bearer ${witnessToken}`);

/** Point the real config at a real local node, the way the env does in production. */
const serveFrom = async (opts) => {
  node = await startLocalBaseRpc(opts);
  loadConfig({ BASE_MAINNET_RPC_URL: node.url });
};

beforeEach(async () => {
  being = ethers.Wallet.createRandom();
  const witness = ethers.Wallet.createRandom();
  if (previousRoot === undefined) previousRoot = neumaWorkspace.root;
  const wsRoot = await createTempDir('neuma-wallet-balance');
  setWorkspacesRoot(wsRoot);
  await neumaWorkspace.create(NEUMA_ID);
  await claimOwner(wsRoot, NEUMA_ID, witness.address);
  await neumaWorkspace.writeEncryptedKeypair(NEUMA_ID, { address: being.address });
  witnessToken = createSessionToken(witness.address);

  app = express();
  app.use(express.json());
  app.use('/api/v1/neuma', walletRouter);
});

afterEach(async () => {
  _resetConfig();
  if (node) await node.close();
  node = null;
});

afterAll(() => {
  if (previousRoot !== undefined) setWorkspacesRoot(previousRoot);
});

describe('GET /:neumaId/wallet — the balance and the network it was read on', () => {
  it('a desk on Ethereum gets the Base balance labelled as Base, never as Ethereum', async () => {
    await serveFrom({ ethBalance: ONE_ETH_HEX });
    const res = await readWallet('ethereum');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ neumaId: NEUMA_ID, address: being.address, network: 'base', balance: '1.0' });
    // The number really came from the Base node, for this being's address.
    const read = node.calls.find((c) => c.method === 'eth_getBalance');
    expect(read.params[0].toLowerCase()).toBe(being.address.toLowerCase());
  });

  it('a desk on Base is read on Base and says so', async () => {
    await serveFrom({ ethBalance: ONE_ETH_HEX });
    const res = await readWallet('base');
    expect(res.body.network).toBe('base');
    expect(res.body.balance).toBe('1.0');
  });

  it('an RPC that does not answer gives balance null - "could not read", never "0"', async () => {
    await serveFrom({ status: 503 });
    const res = await readWallet('ethereum');
    expect(res.status).toBe(200);
    expect(res.body.balance).toBeNull();
    expect(res.body.network).toBe('base');
    expect(res.body.address).toBe(being.address);
  });
});
