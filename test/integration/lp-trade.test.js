/**
 * Sends and swaps from a house member's LP wallet (backend/services/umbrae-lp/lp-trade.js)
 * over REAL parts (RULE 0): real claimed workspaces (a house of two members,
 * and a member of another operator's house), a real chain node (anvil as chain
 * 8453) that mines every send, and a real HTTP listener in Umbrae's place for
 * the pool list. […] is the node's word;
 * "nothing was signed" is counted by the wallet's nonce.
 *
 * NOT proven here: a swap through Umbrae's real router. Plain anvil has no
 * router code; that is test/integration/umbrae-lp-fork-live.test.js.
 */
import fs from 'node:fs/promises';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, USDC, WETH } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { houseRecipients, resolveRecipient } from '../../backend/services/umbrae-lp/lp-house.js';
import { runSend, runSwap } from '../../backend/services/umbrae-lp/lp-trade.js';

const OPERATOR = ethers.Wallet.createRandom().address;
const STRANGER_OPERATOR = ethers.Wallet.createRandom().address;
const OUTSIDER = '0x2222222222222222222222222222222222222222';
let anvil, provider, root, originalRoot, umbrae, connections;
const lp = {};
const main = {};
// Raw reads: ethers answers a repeat of the same read within 250 ms from its own cache.
const nonce = async (address) => Number(await provider.send('eth_getTransactionCount', [address, 'latest']));
const balance = async (address) => BigInt(await provider.send('eth_getBalance', [address, 'latest']));

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  root = await createTempDir('lp-trade');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  for (const [lane, owner] of [['tenekom', OPERATOR], ['rugevil', OPERATOR], ['far', STRANGER_OPERATOR]]) {
    await workspace.create(lane);
    await claimOwner(root, lane, owner);
    main[lane] = ethers.Wallet.createRandom().address;
    await workspace.writeEncryptedKeypair(lane, { address: main[lane] });
    lp[lane] = (await openLpWallet(lane)).address;
  }
  await provider.send('anvil_setBalance', [lp.tenekom, ethers.toQuantity(ethers.parseEther('1'))]);
  // A token contract that answers every call with 6: decimals 6, and a transfer that returns true.
  await provider.send('anvil_setCode', [USDC, '0x600660005260206000f3']);
  await provider.send('anvil_setCode', [WETH, '0x600660005260206000f3']);
  umbrae = await startUmbraeStandIn({ provider });
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  umbrae.reset();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity']);
});

describe('the house, as the places a send may reach', () => {
  test('every wallet of every member the operator owns, and the operator; never another house, never the wallet itself', async () => {
    const house = await houseRecipients('tenekom');
    const addresses = house.map((r) => r.address);
    expect(addresses).toEqual(expect.arrayContaining([ethers.getAddress(OPERATOR), main.tenekom, main.rugevil, lp.rugevil]));
    expect(addresses).not.toContain(lp.tenekom);
    expect(addresses).not.toContain(lp.far);
    expect(addresses).not.toContain(main.far);
    expect(resolveRecipient(house, 'rugevil')).toMatchObject({ address: lp.rugevil, wallet: 'liquidity' });
    expect(resolveRecipient(house, 'Rugevil main')).toMatchObject({ address: main.rugevil, wallet: 'main' });
    expect(resolveRecipient(house, 'operator')).toMatchObject({ address: ethers.getAddress(OPERATOR) });
    expect(resolveRecipient(house, 'far')).toBeNull();
    expect(resolveRecipient(house, OUTSIDER)).toBeNull();
  });

  test('an address on the operator\'s list joins the house\'s places', async () => {
    await workspace.writeSpendAllowlist('tenekom', { version: 1, entries: [{ address: OUTSIDER, label: 'cold storage', addedAt: new Date().toISOString() }] });
    expect(resolveRecipient(await houseRecipients('tenekom'), 'cold storage')).toMatchObject({ address: ethers.getAddress(OUTSIDER), wallet: 'allowlist' });
    await workspace.writeSpendAllowlist('tenekom', { version: 1, entries: [] });
  });
});

describe('sends', () => {
  test('ETH to another member by name lands in that member\'s liquidity wallet, mined from this one', async () => {
    const before = await balance(lp.rugevil);
    const out = await runSend('tenekom', { to: 'Rugevil', amount: '0.01' }, { provider });
    expect(out).toMatchObject({ ok: true, to: lp.rugevil, name: 'rugevil (liquidity)' });
    expect((await provider.getTransactionReceipt(out.txHashes[0])).from).toBe(lp.tenekom);
    expect((await balance(lp.rugevil)) - before).toBe(ethers.parseEther('0.01'));
  }, 60000);

  test('ETH to a member\'s main wallet and to the operator also lands', async () => {
    const out = await runSend('tenekom', { to: 'rugevil main', amount: '0.001' }, { provider });
    expect(out.to).toBe(main.rugevil);
    expect(await balance(main.rugevil)).toBe(ethers.parseEther('0.001'));
    expect((await runSend('tenekom', { to: 'operator', amount: '0.001' }, { provider })).ok).toBe(true);
  }, 60000);

  test('a pool token is sent by symbol to a house wallet', async () => {
    const out = await runSend('tenekom', { to: 'rugevil', token: 'USDC', amount: '2.5' }, { provider });
    expect(out.ok).toBe(true);
    const tx = await provider.getTransaction(out.txHashes[0]);
    expect(tx.to).toBe(USDC);
    expect(new ethers.Interface(['function transfer(address,uint256)']).decodeFunctionData('transfer', tx.data).toArray()).toEqual([lp.rugevil, 2_500_000n]);
  }, 60000);

  test('outside the house nothing is signed: another house\'s member, a stranger\'s address, a token no pool trades', async () => {
    const before = await nonce(lp.tenekom);
    expect((await runSend('tenekom', { to: 'far', amount: '0.01' }, { provider })).reason).toMatch(/not a wallet of the house/);
    expect((await runSend('tenekom', { to: lp.far, amount: '0.01' }, { provider })).reason).toMatch(/not a wallet of the house/);
    expect((await runSend('tenekom', { to: OUTSIDER, amount: '0.01' }, { provider })).reason).toMatch(/not a wallet of the house/);
    expect((await runSend('tenekom', { to: 'rugevil', token: 'SCAM', amount: '1' }, { provider })).reason).toMatch(/ETH or a token Umbrae's pools trade/);
    expect((await runSend('tenekom', { to: 'rugevil', amount: 'lots' }, { provider })).reason).toMatch(/plain decimal/);
    expect(await nonce(lp.tenekom)).toBe(before);
  }, 60000);
});

describe('swaps (the refusals a plain node can show)', () => {
  test('a token no pool trades, a bad slippage, more than the wallet holds, or no live route: nothing is signed', async () => {
    const before = await nonce(lp.tenekom);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'SCAM', amount: '1' }, { provider })).reason).toMatch(/tokens Umbrae's pools trade: WETH, USDC/);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '1', slippagePct: 20 }, { provider })).reason).toMatch(/between 0\.05 and 5 percent/);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '7' }, { provider })).reason).toMatch(/holds 0\.000006 USDC/);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '0.000001' }, { provider })).reason).toMatch(/No Umbrae pool route/);
    expect(await nonce(lp.tenekom)).toBe(before);
  }, 60000);

  test('with the connection off there is no pool list, so no swap', async () => {
    connections.restore();
    connections = connectionsOn([]);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '1' }, { provider })).reason).toMatch(/pool list did not answer/);
  }, 60000);
});
