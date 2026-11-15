/**
 * The public floor under Base reads (backend/services/chain/public-floor.js).
 *
 * RULE 0: every endpoint here is a real HTTP JSON-RPC listener
 * (test/helpers/rpc-stub.js) that ethers reaches over a real socket. The
 * keyed address is one listener, the public floor another; BASE_PUBLIC_RPC_URL
 * is the door that points the floor at it, so no case reaches the internet.
 */
import process from 'node:process';
import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { providerFor, resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { nativeBalance } from '../../backend/services/chain/evm-rpc.js';
import { resetPublicFloors } from '../../backend/services/chain/public-floor.js';
import { balanceOfAddress } from '../../backend/services/neuma-wallet.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { createRpcStub } from '../helpers/rpc-stub.js';

const ENV_KEYS = ['ETH_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_PUBLIC_RPC_URL'];
const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const BASE = '0x2105';
const ONE_ETH = '0xde0b6b3a7640000';

const saved = {};
let stubs = [];
const stub = async (opts) => {
  const made = await createRpcStub(opts);
  stubs.push(made);
  return made;
};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(async () => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetChainProviders();
  resetPublicFloors();
  await Promise.all(stubs.map((s) => s.close()));
  stubs = [];
});
afterAll(() => _resetConfig());

describe('chain reads on Base', () => {
  test('a keyed address that refuses is answered through the public floor, and the answer says so', async () => {
    process.env.BASE_MAINNET_RPC_URL = (await stub({ mode: 'rate-limit' })).url;
    process.env.BASE_PUBLIC_RPC_URL = (await stub({ mode: 'happy', chainId: BASE, balance: ONE_ETH })).url;
    expect(await nativeBalance('base', ADDRESS)).toEqual({
      ok: true, chain: 'base', chainId: 8453, node: 'public', address: ADDRESS, wei: '1000000000000000000',
    });
  }, 20000);

  test('a keyed address that answers is used, and the answer carries no node mark', async () => {
    const floor = await stub({ mode: 'happy', chainId: BASE, balance: ONE_ETH });
    process.env.BASE_MAINNET_RPC_URL = (await stub({ mode: 'happy', chainId: BASE, balance: '0x5' })).url;
    process.env.BASE_PUBLIC_RPC_URL = floor.url;
    expect(await nativeBalance('base', ADDRESS)).toEqual({
      ok: true, chain: 'base', chainId: 8453, address: ADDRESS, wei: '5',
    });
    expect(floor.requests).toBe(0);
  }, 20000);

  test('with the floor blank, a refused read stays refused', async () => {
    process.env.BASE_MAINNET_RPC_URL = (await stub({ mode: 'rate-limit' })).url;
    process.env.BASE_PUBLIC_RPC_URL = '';
    expect(await nativeBalance('base', ADDRESS)).toMatchObject({ ok: false, error: { code: 'CHAIN_RPC' } });
  }, 20000);

  test('a keyed address on the wrong chain never falls back', async () => {
    const floor = await stub({ mode: 'happy', chainId: BASE, balance: ONE_ETH });
    process.env.BASE_MAINNET_RPC_URL = (await stub({ mode: 'wrong-chainid', chainId: '0x1' })).url;
    process.env.BASE_PUBLIC_RPC_URL = floor.url;
    expect(await providerFor('base')).toBeNull();
    expect(floor.requests).toBe(0);
  }, 20000);

  test('a floor that answers for another chain is not trusted', async () => {
    process.env.BASE_MAINNET_RPC_URL = (await stub({ mode: 'rate-limit' })).url;
    process.env.BASE_PUBLIC_RPC_URL = (await stub({ mode: 'wrong-chainid', chainId: '0x1' })).url;
    expect(await providerFor('base')).toBeNull();
  }, 20000);

  test('a chain with no floor still refuses when its address is down', async () => {
    process.env.ETH_RPC_URL = (await stub({ mode: 'rate-limit' })).url;
    process.env.BASE_PUBLIC_RPC_URL = (await stub({ mode: 'happy', chainId: BASE, balance: ONE_ETH })).url;
    expect(await providerFor('ethereum')).toBeNull();
  }, 20000);
});

describe('a wallet balance on Base', () => {
  test('is read through the public floor when the saved address refuses', async () => {
    const keyed = await stub({ mode: 'server-error' });
    process.env.BASE_PUBLIC_RPC_URL = (await stub({ mode: 'happy', chainId: BASE, balance: ONE_ETH })).url;
    loadConfig({ NODE_ENV: 'test', BASE_MAINNET_RPC_URL: keyed.url });
    expect(await balanceOfAddress(ADDRESS, { network: 'base' })).toBe('1.0');
  }, 20000);

  test('is null, never zero, when neither answers', async () => {
    const keyed = await stub({ mode: 'server-error' });
    process.env.BASE_PUBLIC_RPC_URL = (await stub({ mode: 'server-error' })).url;
    loadConfig({ NODE_ENV: 'test', BASE_MAINNET_RPC_URL: keyed.url });
    expect(await balanceOfAddress(ADDRESS, { network: 'base' })).toBeNull();
  }, 20000);
});
