/**
 * money-in detection against a REAL chain node (RULE 0): anvil on loopback
 * answering as Base (8453), a minimal ERC-20 and a forwarder assembled in
 * test/helpers/money-in-kit.js and EXECUTED by anvil, real native and token
 * transfers to a house's watched addresses, and the real scan reading them
 * through chain-registry's verified provider over HTTP. Nothing is stubbed:
 * every balance, nonce, block, receipt and log the ledger sees is anvil's.
 *
 * What it proves:
 *   - native ETH and token receipts land once each, with exact amounts,
 *     the right member, block, time and tx;
 *   - house-to-house money is marked internal and stays out of the totals;
 *   - ETH that arrives by an internal call becomes a GAP with its exact
 *     delta, never a guessed receipt;
 *   - a rescan, and a rescan from a rewound cursor, land nothing twice;
 *   - the chain-access switch off means no scan at all.
 *
 * No public network is touched: ETH_RPC_URL is unset (ethereum is skipped
 * and named so), and the price feed is pinned to a closed loopback port, so
 * rows stay honestly unpriced.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';
import { startAnvil, miniErc20Initcode, forwarderInitcode, MINI_ERC20_ABI } from '../helpers/money-in-kit.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot } from '../../core/index.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { createChainSettings } from '../../backend/services/chain/chain-access.js';
import { scanHouse } from '../../backend/services/money-in/money-in-scan.js';
import { readReceipts, readScanState, writeScanState, putExtra, withHouseLock } from '../../backend/services/money-in/money-in-store.js';
import { summarizeMoneyIn } from '../../backend/services/money-in/money-in-summary.js';
import { moneyInTick } from '../../backend/services/money-in/money-in-scheduler.js';

const ENV_KEYS = ['ETH_RPC_URL', 'ETH_SEPOLIA_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_SEPOLIA_RPC_URL', 'NEUMA_COINGECKO_URL', 'NEUMA_CHAIN_ACCESS_PATH', 'NEUMA_CHAIN_ACCESS'];
const saved = {};
let anvil;
let provider;
let deployer;
let token;
let forwarder;
let switchPath;
let firstState; // the checkpoints the watch began at
const HOUSE = ethers.Wallet.createRandom().address.toLowerCase();
const SOUL = ethers.Wallet.createRandom().address; // lane-a's public soul anchor
const EXTRA = ethers.Wallet.createRandom().address; // the operator's declared address

// Base's pinned table, with the token swapped for the one anvil runs: the
// production addresses have no code on a fresh local chain.
const table = () => [{
  network: 'base',
  confirmations: 2,
  assets: [
    { symbol: 'ETH', kind: 'native', decimals: 18, priceId: 'ethereum' },
    { symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', issuance: 'issuer', address: ethers.getAddress(token.target) },
  ],
}, {
  network: 'ethereum',
  confirmations: 12,
  assets: [{ symbol: 'ETH', kind: 'native', decimals: 18, priceId: 'ethereum' }],
}];

const mine = (n) => provider.send('anvil_mine', [ethers.toQuantity(n)]);

beforeAll(async () => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  useTempRealm();
  const root = await createTempDir('money-in-workspaces');
  setWorkspacesRoot(root);
  await fs.mkdir(path.join(root, 'lane-a', 'identity'), { recursive: true });
  await fs.writeFile(path.join(root, 'lane-a', 'owner.json'), JSON.stringify({ wallet: HOUSE, claimedAt: Date.now(), name: 'Keir' }));
  await fs.writeFile(path.join(root, 'lane-a', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: SOUL }));
  // An unsealed lane: its address lives only in keys/, so it must be named unwatched.
  await fs.mkdir(path.join(root, 'lane-b'), { recursive: true });
  await fs.writeFile(path.join(root, 'lane-b', 'owner.json'), JSON.stringify({ wallet: HOUSE, claimedAt: Date.now() }));
  switchPath = path.join(await createTempDir('money-in-switch'), 'chain-access.json');
  process.env.NEUMA_CHAIN_ACCESS_PATH = switchPath;
  process.env.NEUMA_COINGECKO_URL = 'http://127.0.0.1:9/api/v3'; // discard port: nothing answers

  anvil = await startAnvil({ chainId: 8453 });
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  provider = new ethers.JsonRpcProvider(anvil.url);
  deployer = await provider.getSigner(0); // anvil's unlocked dev account — no key is read
  const t = await (await deployer.sendTransaction({ data: miniErc20Initcode(1_000_000n * 10n ** 6n) })).wait();
  token = new ethers.Contract(t.contractAddress, MINI_ERC20_ABI, deployer);
  const f = await (await deployer.sendTransaction({ data: forwarderInitcode() })).wait();
  forwarder = f.contractAddress;
  await putExtra(HOUSE, { address: EXTRA, label: 'tips jar', member: null, by: HOUSE, at: new Date().toISOString() });
}, 60_000);

afterAll(async () => {
  await anvil?.stop();
  resetChainProviders();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('money-in on a real chain', () => {
  test('the switch off means no scan: the scan refuses and the tick reads nothing', async () => {
    await createChainSettings().setEnabled(false);
    expect(await scanHouse(HOUSE, { table: table() })).toMatchObject({ ok: false, code: 'CHAIN_ACCESS_OFF' });
    expect(await moneyInTick()).toEqual({ skipped: 'chain access off', houses: 0 });
    expect((await readScanState(HOUSE)).lastScan).toBeNull();
    await createChainSettings().setEnabled(true);
  });

  test('first sight starts the watch at the head and records nothing before it', async () => {
    await (await deployer.sendTransaction({ to: SOUL, value: ethers.parseEther('9') })).wait(); // before watching
    await mine(3);
    const first = await scanHouse(HOUSE, { table: table() });
    expect(first.ok).toBe(true);
    expect(first.watched).toBe(2);
    expect(first.unwatched).toEqual([expect.objectContaining({ member: 'lane-b' })]);
    expect(first.appended).toEqual([]);
    expect(first.networks.find((n) => n.network === 'ethereum')).toEqual({ network: 'ethereum', skipped: 'unconfigured' });
    firstState = await readScanState(HOUSE);
    expect(firstState.native[`base:${SOUL.toLowerCase()}`].wei).toBe(ethers.parseEther('9').toString());
  });

  test('native and token receipts land once each, exact; internal money and internal calls are told apart', async () => {
    const native1 = await (await deployer.sendTransaction({ to: SOUL, value: ethers.parseEther('1.25') })).wait();
    const native2 = await (await deployer.sendTransaction({ to: EXTRA, value: ethers.parseEther('0.5') })).wait();
    const tok1 = await (await token.transfer(SOUL, 42_500_000n)).wait();
    const tok2 = await (await token.transfer(EXTRA, 7_000_000n)).wait();
    // House money moving: the extra address pays the soul (impersonated — anvil signs, no key exists).
    await provider.send('anvil_impersonateAccount', [EXTRA]);
    const extraSigner = await provider.getSigner(EXTRA);
    const internal = await (await new ethers.Contract(token.target, MINI_ERC20_ABI, extraSigner).transfer(SOUL, 1_000_000n)).wait();
    await provider.send('anvil_stopImpersonatingAccount', [EXTRA]);
    // The blind spot: ETH through a contract's internal call.
    const viaContract = await (await deployer.sendTransaction({ to: forwarder, value: ethers.parseEther('0.3'), data: ethers.zeroPadValue(SOUL, 32) })).wait();
    await mine(3);

    const scan = await scanHouse(HOUSE, { table: table() });
    expect(scan.ok).toBe(true);
    const rows = await readReceipts(HOUSE);
    const pick = (hash) => rows.filter((r) => r.txHash === hash.toLowerCase());
    expect(rows).toHaveLength(5);
    expect(pick(native1.hash)).toEqual([expect.objectContaining({
      network: 'base', asset: 'ETH', amountRaw: ethers.parseEther('1.25').toString(), amount: '1.25',
      to: SOUL, member: 'lane-a', from: await deployer.getAddress(), block: native1.blockNumber, logIndex: null, internal: false, usd: null,
    })]);
    expect(pick(native2.hash)).toEqual([expect.objectContaining({ asset: 'ETH', amount: '0.5', to: EXTRA, member: null, memberLabel: 'tips jar' })]);
    expect(pick(tok1.hash)).toEqual([expect.objectContaining({ asset: 'USDC', amountRaw: '42500000', amount: '42.5', to: SOUL, logIndex: 0, internal: false })]);
    expect(pick(tok2.hash)).toEqual([expect.objectContaining({ asset: 'USDC', amount: '7.0', to: EXTRA })]);
    expect(pick(internal.hash)).toEqual([expect.objectContaining({ asset: 'USDC', amount: '1.0', from: EXTRA, to: SOUL, internal: true })]);
    const block = await provider.getBlock(native1.blockNumber);
    expect(pick(native1.hash)[0].timestamp).toBe(new Date(block.timestamp * 1000).toISOString());

    const { gaps } = await readScanState(HOUSE);
    expect(gaps).toEqual([expect.objectContaining({
      kind: 'native-unexplained', network: 'base', address: SOUL, member: 'lane-a',
      fromBlock: viaContract.blockNumber, deltaWei: ethers.parseEther('0.3').toString(), explainedWei: '0',
    })]);

    const sum = summarizeMoneyIn(rows);
    expect(sum.internalExcluded).toBe(1);
    expect(sum.perAsset['base:ETH']).toMatchObject({ amount: '1.75', count: 2 });
    expect(sum.perAsset['base:USDC']).toMatchObject({ amountRaw: '49500000', amount: '49.5', count: 2 });
    expect(sum.unpriced).toBe(4);
    expect(sum.usdTotal).toBe(0);
  });

  test('a rescan, and a rescan from a rewound cursor, land nothing twice', async () => {
    await mine(2);
    expect((await scanHouse(HOUSE, { table: table() })).appended).toEqual([]);
    await withHouseLock(HOUSE, async () => {
      const state = await readScanState(HOUSE);
      // Back to where watching began: every receipt and gap is re-read.
      await writeScanState(HOUSE, { ...state, networks: firstState.networks, native: firstState.native });
    });
    const again = await scanHouse(HOUSE, { table: table() });
    expect(again.appended).toEqual([]);
    expect(await readReceipts(HOUSE)).toHaveLength(5);
    expect((await readScanState(HOUSE)).gaps).toHaveLength(1);
  });
});
