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
import { runSend, runSwap, quoteSwap } from '../../backend/services/umbrae-lp/lp-trade.js';
import { preflightCreatePool } from '../../backend/services/umbrae-lp/lp-pool.js';
import { resolveToken, tokenLabel } from '../../backend/services/umbrae-lp/lp-tokens.js';
import { UMBRAE_ROUTER } from '../../core/wallet/trade-policy.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { startLyingRpc } from '../helpers/lying-rpc.js';

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
  umbrae = await startUmbraeStandIn({ provider, receiptProvider: provider, receiptConfirmations: 1 });
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
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
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

  test('a member that goes by "Operator" never answers to that word, and a name two members answer to names neither (PR600 P6-22)', async () => {
    await workspace.create('mallory');
    await claimOwner(root, 'mallory', OPERATOR);
    await workspace.writeEncryptedKeypair('mallory', { address: ethers.Wallet.createRandom().address });
    lp.mallory = (await openLpWallet('mallory')).address;
    await workspace.writeDNA('mallory', { neumaId: 'mallory', identity: { name: 'Operator' } });
    const house = await houseRecipients('tenekom');
    expect(house.filter((r) => r.lane === 'mallory').map((r) => r.name)).toEqual(['mallory', 'mallory']);
    // The list as it read before the fix, with the word on the member's wallets: the role still wins.
    const worded = house.map((r) => (r.lane === 'mallory' ? { ...r, name: 'Operator' } : r));
    for (const list of [house, worded]) {
      expect(resolveRecipient(list, 'operator')).toMatchObject({ address: ethers.getAddress(OPERATOR), wallet: 'operator' });
      expect(resolveRecipient(list, 'Operator')).toMatchObject({ address: ethers.getAddress(OPERATOR), wallet: 'operator' });
    }
    const [operatorBefore, malloryBefore] = [await balance(OPERATOR), await balance(lp.mallory)];
    const out = await runSend('tenekom', { to: 'operator', amount: '0.002' }, { provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out).toMatchObject({ ok: true, to: ethers.getAddress(OPERATOR), name: 'operator' });
    expect((await balance(OPERATOR)) - operatorBefore).toBe(ethers.parseEther('0.002'));
    expect(await balance(lp.mallory)).toBe(malloryBefore);

    await workspace.writeDNA('mallory', { neumaId: 'mallory', identity: { name: 'Rugevil' } });
    const doubled = await houseRecipients('tenekom');
    expect(resolveRecipient(doubled, 'rugevil')).toBeNull();
    expect(resolveRecipient(doubled, 'rugevil main')).toBeNull();
    expect(resolveRecipient(doubled, 'mallory')).toMatchObject({ address: lp.mallory, wallet: 'liquidity' });
    expect(resolveRecipient(doubled, main.rugevil)).toMatchObject({ address: main.rugevil, wallet: 'main' });
    await workspace.writeDNA('mallory', { neumaId: 'mallory', identity: { name: 'Mallory' } });
    expect(resolveRecipient(await houseRecipients('tenekom'), 'rugevil')).toMatchObject({ address: lp.rugevil });
  }, 60000);
});

describe('sends', () => {
  test('ETH to another member by name lands in that member\'s liquidity wallet, mined from this one', async () => {
    const before = await balance(lp.rugevil);
    const out = await runSend('tenekom', { to: 'Rugevil', amount: '0.01' }, { provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out).toMatchObject({ ok: true, to: lp.rugevil, name: 'rugevil (liquidity)' });
    expect((await provider.getTransactionReceipt(out.txHashes[0])).from).toBe(lp.tenekom);
    expect((await balance(lp.rugevil)) - before).toBe(ethers.parseEther('0.01'));
  }, 60000);

  test('ETH to a member\'s main wallet and to the operator also lands', async () => {
    const out = await runSend('tenekom', { to: 'rugevil main', amount: '0.001' }, { provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out.to).toBe(main.rugevil);
    expect(await balance(main.rugevil)).toBe(ethers.parseEther('0.001'));
    expect((await runSend('tenekom', { to: 'operator', amount: '0.001' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).ok).toBe(true);
  }, 60000);

  test('a pool token is sent by symbol to a house wallet', async () => {
    const out = await runSend('tenekom', { to: 'rugevil', token: 'USDC', amount: '2.5' }, { provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out.ok).toBe(true);
    const tx = await provider.getTransaction(out.txHashes[0]);
    expect(tx.to).toBe(USDC);
    expect(new ethers.Interface(['function transfer(address,uint256)']).decodeFunctionData('transfer', tx.data).toArray()).toEqual([lp.rugevil, 2_500_000n]);
  }, 60000);

  test('outside the house nothing is signed: another house\'s member, a stranger\'s address, a token no pool trades', async () => {
    const before = await nonce(lp.tenekom);
    expect((await runSend('tenekom', { to: 'far', amount: '0.01' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/not a wallet of the house/);
    expect((await runSend('tenekom', { to: lp.far, amount: '0.01' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/not a wallet of the house/);
    expect((await runSend('tenekom', { to: OUTSIDER, amount: '0.01' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/not a wallet of the house/);
    expect((await runSend('tenekom', { to: 'rugevil', token: 'SCAM', amount: '1' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/ETH or a token Umbrae's pools trade/);
    expect((await runSend('tenekom', { to: 'rugevil', amount: 'lots' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/plain decimal/);
    expect(await nonce(lp.tenekom)).toBe(before);
  }, 60000);
});

describe('swaps (the refusals a plain node can show)', () => {
  test('a token no pool trades, a bad slippage, more than the wallet holds, or no live route: nothing is signed', async () => {
    const before = await nonce(lp.tenekom);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'SCAM', amount: '1' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/tokens Umbrae's pools trade: WETH, USDC/);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '1', slippagePct: 20 }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/between 0\.05 and 5 percent/);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '7' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/holds 0\.000006 USDC/);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '0.000001' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/No Umbrae pool route/);
    expect(await nonce(lp.tenekom)).toBe(before);
  }, 60000);

  test('with the connection off there is no pool list, so no swap', async () => {
    connections.restore();
    connections = connectionsOn([]);
    expect((await runSwap('tenekom', { tokenIn: 'USDC', tokenOut: 'WETH', amount: '1' }, { provider, receiptProvider: provider, receiptConfirmations: 1 })).reason).toMatch(/pool list did not answer/);
  }, 60000);
});

describe('a token named by symbol is one address, never the first match (P6-14)', () => {
  // A look-alike listed FIRST under WETH's symbol, and one symbol two listed tokens share.
  const FAKE_WETH = ethers.getAddress('0x5555555555555555555555555555555555555555');
  const DUP_A = ethers.getAddress('0x6666666666666666666666666666666666666666');
  const DUP_B = ethers.getAddress('0x7777777777777777777777777777777777777777');
  const pair = (address, x, y) => ({ address, mint_x: x, mint_y: y, bin_step: 25, liquidity: '9000000' });
  beforeEach(() => {
    umbrae.state.leadGroups = [
      { name: 'WETH-DUP', mint_x: FAKE_WETH, mint_y: DUP_A, tokenX: 'WETH', tokenY: 'DUP', tokenXPrice: 1, tokenYPrice: 1, pairs: [pair('0x8888888888888888888888888888888888888888', FAKE_WETH, DUP_A)] },
      { name: 'DUP-USDC', mint_x: DUP_B, mint_y: USDC, tokenX: 'DUP', tokenY: 'USDC', tokenXPrice: 1, tokenYPrice: 1, pairs: [pair('0x9999999999999999999999999999999999999999', DUP_B, USDC)] },
    ];
  });

  test('"WETH" sends Base\'s own WETH though a look-alike is listed first, and the answer names the address', async () => {
    const out = await runSend('tenekom', { to: 'rugevil', token: 'WETH', amount: '0.000002' }, { provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out).toMatchObject({ ok: true, token: WETH });
    expect((await provider.getTransaction(out.txHashes[0])).to).toBe(WETH);
    const quoted = await quoteSwap({ tokenIn: 'WETH', tokenOut: 'USDC', amount: '1' }, { provider });
    expect(quoted.reason ?? '').not.toMatch(/tokens Umbrae's pools trade/);
  }, 60000);

  test('a symbol two listed tokens share is refused with both addresses; nothing is signed, for a send, a swap, a quote or a new pool', async () => {
    const before = await nonce(lp.tenekom);
    const opts = { provider, receiptProvider: provider, receiptConfirmations: 1 };
    const both = new RegExp(`"DUP" names 2 different tokens in Umbrae's pools \\((${DUP_A}, ${DUP_B}|${DUP_B}, ${DUP_A})\\)\\. Name the one you mean by its address`, 'i');
    expect((await runSend('tenekom', { to: 'rugevil', token: 'DUP', amount: '1' }, opts)).reason).toMatch(both);
    expect((await runSwap('tenekom', { tokenIn: 'dup', tokenOut: 'USDC', amount: '1' }, opts)).reason).toMatch(both);
    expect((await quoteSwap({ tokenIn: 'USDC', tokenOut: 'DUP', amount: '1' }, { provider })).reason).toMatch(both);
    expect((await preflightCreatePool({ baseToken: '0x3333333333333333333333333333333333333333', quoteToken: 'DUP', check: true }, { provider })).reason).toMatch(both);
    expect(await nonce(lp.tenekom)).toBe(before);
  }, 60000);

  test('the rule itself: a pinned symbol is its pinned contract or nothing, and a look-alike is shown with its address', () => {
    const listed = [[FAKE_WETH, 'WETH'], [DUP_A, 'DUP'], [USDC, 'usdc']];
    expect(resolveToken(listed, 'weth')).toMatchObject({ ok: false, ambiguous: false });
    expect(resolveToken([...listed, [WETH, 'WETH']], 'weth')).toEqual({ ok: true, address: WETH });
    expect(resolveToken(listed, 'USDC')).toEqual({ ok: true, address: USDC });
    expect(resolveToken(listed, FAKE_WETH.toLowerCase())).toEqual({ ok: true, address: FAKE_WETH });
    expect(resolveToken(listed, 'DUP')).toEqual({ ok: true, address: DUP_A });
    expect(tokenLabel(WETH, 'anything')).toBe('WETH');
    expect(tokenLabel(FAKE_WETH, 'WETH')).toBe('WETH@0x5555…5555');
    expect(tokenLabel(DUP_A, 'DUP')).toBe('DUP');
  });
});

describe('a swap\'s price is two Base nodes\' word, not one (P6-11)', () => {
  const QUOTE = new ethers.Interface(['function getDetailedSwapQuote(uint256 amountIn, address[] path, uint16[] binSteps, address[] pools) view returns (uint256 amountOut, uint256 consumedAmountIn, uint256[] feesPerHop, uint256 priceImpact, uint256[] amountsPerHop, uint24[] activeBinsPerPair, bool liquidityExhausted)']);
  const SWAP = new ethers.Interface(['function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, uint16[] binSteps, address[] pools, address to, uint256 deadline)']);
  const selector = QUOTE.getFunction('getDetailedSwapQuote').selector;
  const quoteOf = (amountOut) => QUOTE.encodeFunctionResult('getDetailedSwapQuote', [amountOut, 1n, [], 0n, [], [], false]);
  const ask = { tokenIn: 'USDC', tokenOut: 'WETH', amount: '0.000001' };
  let liar;
  let lying;
  let lie = () => undefined;

  beforeAll(async () => {
    // A router that quotes 1,000,000 out for any route and takes any swap: the real node's word.
    await provider.send('anvil_setCode', [UMBRAE_ROUTER, returnContract({ fallback: ethers.ZeroHash, routes: { [selector]: quoteOf(1_000_000n) } })]);
    lying = await startLyingRpc(anvil.url, (request, honest) => lie(request, honest));
    liar = new ethers.JsonRpcProvider(lying.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  });
  afterAll(async () => {
    liar?.destroy();
    await lying?.close();
    await provider.send('anvil_setCode', [UMBRAE_ROUTER, '0x']);
  });
  beforeEach(() => { lie = () => undefined; });

  test('two nodes that agree: the swap is signed with its floor under the price both gave', async () => {
    const out = await runSwap('tenekom', ask, { provider: liar, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out).toMatchObject({ ok: true, via: 'umbrae', tokens: { in: USDC, out: WETH } });
    const tx = (await Promise.all(out.txHashes.map((hash) => provider.getTransaction(hash)))).find((sent) => sent.to === UMBRAE_ROUTER);
    expect(SWAP.decodeFunctionData('swapExactTokensForTokens', tx.data).amountOutMin).toBe(990_000n);
  }, 60000);

  test('a node that quotes almost nothing, so the floor it would sign is almost nothing: refused, nothing signed', async () => {
    lie = (request) => (request.method === 'eth_call' && String(request.params[0]?.data ?? request.params[0]?.input).startsWith(selector) ? quoteOf(2n) : undefined);
    const before = await nonce(lp.tenekom);
    const out = await runSwap('tenekom', ask, { provider: liar, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Two Base nodes disagree about what this swap would pay, so nothing was signed/);
    expect(await nonce(lp.tenekom)).toBe(before);
  }, 60000);

  test('a node that names a gas figure the second node does not: refused, nothing signed; the send goes out when they agree', async () => {
    const send = (amount) => runSend('tenekom', { to: 'operator', amount }, { provider: liar, receiptProvider: provider, receiptConfirmations: 1 });
    const honest = await provider.estimateGas({ from: lp.tenekom, to: lp.tenekom, value: 1n });
    lie = (request) => (request.method === 'eth_estimateGas' ? ethers.toQuantity(honest * 3n) : undefined);
    const before = await nonce(lp.tenekom);
    const out = await send('0.0001');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/Two Base nodes disagree about the gas this transaction needs, so nothing was signed/);
    expect(await nonce(lp.tenekom)).toBe(before);
    lie = () => undefined;
    // another amount: the client keeps a node's answer to the very same question for a moment
    expect(await send('0.0002')).toMatchObject({ ok: true });
    expect(await nonce(lp.tenekom)).toBe(before + 1);
  }, 60000);

  test('a node that takes the signed bytes and keeps them: the second node still gets the transaction', async () => {
    lie = (request) => (request.method === 'eth_sendRawTransaction' ? ethers.keccak256(request.params[0]) : undefined);
    const before = await balance(lp.rugevil);
    const out = await runSend('tenekom', { to: 'Rugevil', amount: '0.003' }, { provider: liar, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out.ok).toBe(true);
    expect((await balance(lp.rugevil)) - before).toBe(ethers.parseEther('0.003'));
  }, 60000);
});
