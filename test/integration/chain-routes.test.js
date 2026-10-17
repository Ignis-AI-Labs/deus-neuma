/**
 * Chain routes (/api/v1/chain) — the operator's window onto chain truth, end
 * to end against the REAL registry, the REAL switch store, and REAL auth
 * (RULE 0, #390): a real wallet with a real HMAC token proves every request,
 * and a genuine 401 comes from sending none.
 *
 * Ungated scope (no network): /chains state with env-pointed isolation, the
 * access switch against a tmp settings file, path validation 400s, unknown
 * chain 404s, unconfigured 503s, and a dead-RPC 502 against a real
 * connection-refused (127.0.0.1:1 — no listener, no mock).
 *
 * Gated scope (RUN_CHAIN_TESTS=1, the chain-reader gate): REAL Ethereum
 * mainnet reads through the operator's own keyed RPC — the gnosis target is
 * the Ignis Phase 3 contract + its deployer, the exact pair whose explorer
 * read failed a being with an ambiguous 404. Discovered ground truth
 * (2026-09-23, block ~26,040,508, recorded by the chain-tooling wave's
 * probes): deploy block 19,870,429; totalSupply() === 477 (the being's read
 * was RIGHT); the contract is a bare ERC-1155 — name/symbol/decimals REVERT,
 * and maxSupply in either shape reverts (the site ABI is aspirational);
 * balanceOf(deployer, 0) === 367 — a definite non-zero number; holder
 * reconstruction over 207 Transfer events yields 24 holders summing to
 * exactly 477.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { shouldRunChainTests, resolveEthMainnetRpc } from '../helpers/chain-optin.js';

const ENV_KEYS = ['ETH_RPC_URL', 'ETH_SEPOLIA_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_SEPOLIA_RPC_URL', 'NEUMA_CHAIN_ACCESS_PATH'];

// The gnosis target — full addresses from ignis-site's source of truth
// (src/contracts/addresses.ts), never the screenshot's truncated strings.
const PHASE3 = '0xab505a667039d08d8E33cef95C81897A8B5fEd1A';
const DEPLOYER = '0xdef619cb36E8EEC2C61E2aee06E1b90107A722Df';
const PHASE3_DEPLOY_BLOCK = 19_870_429; // discovered: first block with code (binary search, 2026-09-23)

describe('Chain routes (/api/v1/chain)', () => {
  let app, house, witness;
  const saved = {};

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/chain-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/chain', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    house = await createTempDir('chain-routes');
    process.env.NEUMA_CHAIN_ACCESS_PATH = path.join(house, 'chain-access.json');
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(house, 'chainlane');
    app = await buildApp();
    // Importing the app graph (auth → … → core barrel) executes the natural
    // package's import-time dotenv.config() ONCE per process (CJS cache) —
    // hydrate first, THEN isolate, or the first test reads the operator's
    // .env chains as configured.
    for (const k of ENV_KEYS) { if (k !== 'NEUMA_CHAIN_ACCESS_PATH') delete process.env[k]; }
    const { resetChainProviders } = await import('../../backend/services/chain/chain-registry.js');
    resetChainProviders();
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    const { resetChainProviders } = await import('../../backend/services/chain/chain-registry.js');
    resetChainProviders();
  });

  test('GET /chains — the registry as configured state, env-pointed', async () => {
    process.env.ETH_RPC_URL = 'http://127.0.0.1:1'; // configured means SET — /chains makes no calls
    const res = await request(app).get('/api/v1/chain/chains').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.chains.map((c) => c.key)).toEqual(['ethereum', 'ethereum-sepolia', 'base', 'base-sepolia']);
    expect(res.body.chains.map((c) => c.chainId)).toEqual([1, 11155111, 8453, 84532]);
    expect(res.body.chains.find((c) => c.key === 'ethereum').configured).toBe(true);
    expect(res.body.chains.find((c) => c.key === 'base').configured).toBe(false);
  });

  test('no token is a real 401 on every route', async () => {
    expect((await request(app).get('/api/v1/chain/chains')).status).toBe(401);
    expect((await request(app).get(`/api/v1/chain/balance/ethereum/${DEPLOYER}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/chain/token/ethereum/${PHASE3}`)).status).toBe(401);
    expect((await request(app).get('/api/v1/chain/access')).status).toBe(401);
  });

  test('the access switch: default ON, persisted flip, boolean-validated', async () => {
    const on = await request(app).get('/api/v1/chain/access').set(witness.header);
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ enabled: true, envLocked: false });
    expect((await request(app).put('/api/v1/chain/access').set(witness.header).send({ enabled: 'yes' })).status).toBe(400);
    const off = await request(app).put('/api/v1/chain/access').set(witness.header).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect((await request(app).get('/api/v1/chain/access').set(witness.header)).body.enabled).toBe(false);
  });

  test('validation: bad chain charset 400, unknown chain 404, bad address 400', async () => {
    process.env.ETH_RPC_URL = 'http://127.0.0.1:1';
    const badKey = await request(app).get(`/api/v1/chain/balance/ETHEREUM/${DEPLOYER}`).set(witness.header);
    expect(badKey.status).toBe(400);
    expect(badKey.body.error.code).toBe('CHAIN_BAD_PARAMS');
    const unknown = await request(app).get(`/api/v1/chain/balance/solana/${DEPLOYER}`).set(witness.header);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('CHAIN_UNKNOWN');
    const badAddr = await request(app).get('/api/v1/chain/balance/ethereum/not-an-address').set(witness.header);
    expect(badAddr.status).toBe(400);
    expect(badAddr.body.error.code).toBe('CHAIN_BAD_PARAMS');
    const badToken = await request(app).get(`/api/v1/chain/token/ethereum/0x1234`).set(witness.header);
    expect(badToken.status).toBe(400);
  });

  test('unconfigured chain → 503 CHAIN_UNCONFIGURED (named, never an ambiguous 404)', async () => {
    const res = await request(app).get(`/api/v1/chain/balance/ethereum/${DEPLOYER}`).set(witness.header);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CHAIN_UNCONFIGURED');
    const token = await request(app).get(`/api/v1/chain/token/base/${PHASE3}`).set(witness.header);
    expect(token.status).toBe(503);
  });

  test('a dead RPC → 502 CHAIN_RPC (real connection-refused, never a throw)', async () => {
    process.env.ETH_RPC_URL = 'http://127.0.0.1:1';
    const res = await request(app).get(`/api/v1/chain/balance/ethereum/${DEPLOYER}`).set(witness.header);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CHAIN_RPC');
  }, 30000);
});

// RULE 0 honest end-to-end — the same gate as chain-reader's suite
// (test/helpers/chain-optin.js). Force on with RUN_CHAIN_TESTS=1, off with 0.
const runChainTests = shouldRunChainTests();

describe.skipIf(!runChainTests)('chain routes — REAL Ethereum mainnet, the Phase 3 gnosis target (opt-in)', () => {
  let evm, registry;
  const RPC = resolveEthMainnetRpc();

  beforeEach(async () => {
    vi.resetModules();
    if (RPC) process.env.ETH_RPC_URL = RPC;
    evm = await import('../../backend/services/chain/evm-rpc.js');
    registry = await import('../../backend/services/chain/chain-registry.js');
    registry.resetChainProviders();
  });

  afterEach(() => registry.resetChainProviders());

  test('the ethereum provider proves eth_chainId === 1', async () => {
    const provider = await registry.providerFor('ethereum');
    expect(provider).toBeTruthy();
    const network = await provider.getNetwork();
    // eslint-disable-next-line no-console -- diagnostic, the gnosis record
    console.log(`[chain integration] eth_chainId → ${network.chainId}`);
    expect(Number(network.chainId)).toBe(1);
  }, 30000);

  test('tokenMeta: totalSupply is 477 — and the bare ERC-1155 fields are honestly null', async () => {
    const meta = await evm.tokenMeta('ethereum', PHASE3);
    // eslint-disable-next-line no-console -- diagnostic, the gnosis record
    console.log(`[chain integration] Phase 3 tokenMeta → ${JSON.stringify(meta)}`);
    expect(meta.ok).toBe(true);
    expect(meta.totalSupply).toBe('477'); // the being's read was RIGHT — the explorer's 404 was the lie
    // Bare ERC-1155: name/symbol/decimals are not implemented and REVERT —
    // the chain says "not there" plainly, where the explorer said nothing.
    expect(meta.name).toBeNull();
    expect(meta.symbol).toBeNull();
    expect(meta.decimals).toBeNull();
  }, 30000);

  test('the deployer balance is a definite number — the 404 ambiguity resolved by the chain', async () => {
    const res = await evm.tokenBalance('ethereum', PHASE3, DEPLOYER, 0);
    // eslint-disable-next-line no-console -- diagnostic, the gnosis record
    console.log(`[chain integration] balanceOf(deployer, 0) → ${res.ok ? res.balance : JSON.stringify(res)}`);
    expect(res.ok).toBe(true);
    expect(res.balance).toMatch(/^\d+$/); // definite — zero or not, the chain says which
    expect(Number(res.balance)).toBeGreaterThan(0); // today: 367 — the deployer DOES hold
    // The ERC-20 one-arg shape on this contract REVERTS — a named refusal,
    // not a silent zero.
    const erc20Shape = await evm.tokenBalance('ethereum', PHASE3, DEPLOYER);
    expect(erc20Shape.ok).toBe(false);
    expect(erc20Shape.error.code).toBe('CHAIN_RPC');
  }, 30000);

  test('holder reconstruction from the deploy block sums to the supply, cross-checked two ways', async () => {
    const [meta, deployer] = await Promise.all([
      evm.tokenMeta('ethereum', PHASE3),
      evm.tokenBalance('ethereum', PHASE3, DEPLOYER, 0),
    ]);
    const holders = await evm.tokenHolders('ethereum', PHASE3, {
      fromBlock: PHASE3_DEPLOY_BLOCK, chunkSize: 10_000,
    });
    // eslint-disable-next-line no-console -- diagnostic, the gnosis record
    console.log(`[chain integration] holders → count ${holders.holderCount}, events ${holders.events}, totalHeld ${holders.totalHeld}, truncated ${holders.truncated}, window ${holders.fromBlock}–${holders.toBlock}`);
    expect(holders.ok).toBe(true);
    expect(holders.truncated).toBe(false);
    // CONSERVATION: the reconstructed balances sum to exactly what the
    // contract reports minted — the holder set is consistent with the supply.
    expect(holders.totalHeld).toBe(meta.totalSupply);
    // Cross-verb consistency: the deployer's reconstructed balance equals the
    // direct balanceOf read — two independent paths, one truth.
    expect(holders.holders[DEPLOYER]).toBe(deployer.balance);
    expect(holders.holderCount).toBeGreaterThan(0);
  }, 900000); // the walk is ~617 chunks × one real RPC call each — measured ≈ 7 minutes

  test('operator parity through the real route: /token and /balance?token agree with the module', async () => {
    const { default: router } = await import('../../backend/routes/chain-routes.js');
    const { witnessFor } = await import('../helpers/witness.js');
    const house = await createTempDir('chain-routes-live');
    const witness = await witnessFor(house, 'chainlane');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/chain', router);
    const token = await request(a).get(`/api/v1/chain/token/ethereum/${PHASE3}`).set(witness.header);
    expect(token.status).toBe(200);
    expect(token.body.totalSupply).toBe('477');
    const balance = await request(a)
      .get(`/api/v1/chain/balance/ethereum/${DEPLOYER}?token=${PHASE3}&tokenId=0`)
      .set(witness.header);
    expect(balance.status).toBe(200);
    expect(balance.body.balance).toMatch(/^\d+$/);
    // eslint-disable-next-line no-console -- diagnostic, the gnosis record
    console.log(`[chain integration] route parity → supply ${token.body.totalSupply}, deployer ${balance.body.balance}`);
  }, 60000);
});
