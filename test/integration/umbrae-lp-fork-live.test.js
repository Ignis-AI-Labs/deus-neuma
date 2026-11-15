/**
 * THE FORK PROOF (live lane, outside the suite): the LP wallet against the
 * REAL Umbrae, with no real money.
 *
 *   · live Umbrae: sign-in, key, pool read, and the approval transactions
 *     Umbrae's server builds, which the signing rule must accept;
 *   · Umbrae's REAL position manager and the REAL USDC contract, on anvil
 *     forked from Base: the approvals mine, and a deposit, a half withdrawal
 *     and a close (encoded here from the published signatures, signed through
 *     the rule) mint a position to the LP wallet and pay it back.
 *
 * Boundary, recorded by the test: Umbrae's /build checks the wallet's real
 * Base balance, so an Umbrae-BUILT deposit (and the close of a position that
 * exists only on the fork) needs real funds: that is the funded run.
 *
 *   · a throwaway LP wallet (temp workspace, deleted after) signs in on live
 *     umbrae.io as an AI agent and gets a key (Design note, 2026-11-12: […]); that account stays on Umbrae, marked AI agent, by design;
 *   · Umbrae's live /approvals and /build make the transactions;
 *   · lp-signer.js signs them, and they are sent ONLY to anvil forked from
 *     Base's public node. Nothing is ever sent to Umbrae's /send or to Base.
 *
 * The fork's wallet is funded by anvil cheat calls (ETH balance, a USDC
 * storage write); no real money exists anywhere in this test.
 *
 * Every run signs a NEW throwaway wallet in on live Umbrae, which leaves one
 * more AI-agent account there. So it runs only when asked on purpose:
 *   NEUMA_UMBRAE_FORK_PROOF=1 npx vitest run --project substrate-live test/integration/umbrae-lp-fork-live.test.js
 */
import fs from 'node:fs/promises';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import { callUmbrae } from '../../backend/services/umbrae-lp/umbrae-lp-client.js';
import { umbraeKeyFor } from '../../backend/services/umbrae-lp/lp-enroll.js';
import { signLpTransaction } from '../../backend/services/umbrae-lp/lp-signer.js';
import { quoteDepositOnChain, quoteExitOnChain } from '../../backend/services/umbrae-lp/lp-quotes.js';
import { openLpWallet, lpSigner } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { runSwap } from '../../backend/services/umbrae-lp/lp-trade.js';
import { KYBER_ROUTER, KYBER_ABI } from '../../core/wallet/aggregator-policy.js';
import { UMBRAE_FACTORY, binIdFor, orientPair } from '../../core/wallet/pool-policy.js';

const LANE = 'lpforkproof';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)']);
const nft = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']);

let fork; let provider; let root; let originalRoot; let connections; let signer; let key; let pool; let tokenId;
const manager = new ethers.Interface([
  'function createPositionWithStrategy(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY, uint8 strategy, uint24 binRange, uint8 bidAskRatio, uint24 centerBinId, bool skipActiveBin, uint24 activeIdDesired, uint24 idSlippage, uint256 minTotalLiquidity, address recipient, uint256 deadline)',
  'function decreasePositionByPercent(uint256 tokenId, uint16 bps, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
  'function closePosition(uint256 tokenId, uint256 amountXMin, uint256 amountYMin, address recipient, uint256 deadline)',
]);
const common = () => ({
  walletAddress: signer.address.toLowerCase(), pairAddress: pool.address,
  tokenX: pool.tokenX.address, tokenY: pool.tokenY.address, tokenXSymbol: pool.tokenX.symbol, tokenYSymbol: pool.tokenY.symbol,
  tokenXDecimals: pool.tokenX.decimals, tokenYDecimals: pool.tokenY.decimals, binStep: pool.binStep,
  baseFactor: Number.isFinite(Number(pool.baseFeePercentage))
    ? Math.round(Number(pool.baseFeePercentage) * 10000)
    : Number(pool.baseFactor ?? 5000),
  currentPrice: pool.currentPrice, tokenXPriceUsd: pool.tokenXPriceUsd, tokenYPriceUsd: pool.tokenYPriceUsd,
});
const log = (...a) => console.log('[fork-proof]', ...a);

// impure — anvil forked from Base's public node, on loopback.
const startFork = async () => {
  const child = spawn('anvil', ['--fork-url', 'https://mainnet.base.org', '--chain-id', '8453', '--port', '0', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('fork did not start')), 60000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`anvil exited ${code}`)); });
    child.stdout.on('data', (c) => {
      out = (out + c).slice(-32768);
      const m = out.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    });
    child.stderr.resume();
  });
  child.stdout.resume();
  return { url, stop: async () => { if (child.exitCode === null) { const e = once(child, 'exit'); child.kill('SIGTERM'); await e; } } };
};

// impure — give the fork wallet USDC by writing its balance slot, found by trying.
const dealUsdc = async (to, amount) => {
  for (let slot = 0; slot < 20; slot += 1) {
    const at = ethers.solidityPackedKeccak256(['uint256', 'uint256'], [to, slot]);
    const prior = await provider.send('eth_getStorageAt', [USDC, at, 'latest']);
    await provider.send('anvil_setStorageAt', [USDC, at, ethers.toBeHex(amount, 32)]);
    const read = BigInt(await provider.call({ to: USDC, data: erc20.encodeFunctionData('balanceOf', [to]) }));
    if (read === amount) return slot;
    await provider.send('anvil_setStorageAt', [USDC, at, prior]);
  }
  throw new Error('no USDC balance slot found');
};

// impure — sign with the LP wallet's rule and send to the FORK only.
const signAndMine = async (tx, asked, maxApprove) => {
  const signed = await signLpTransaction({ signer, provider, tx, asked, maxApprove });
  if (!signed.ok) return signed;
  const hash = await provider.send('eth_sendRawTransaction', [signed.signedTransaction]);
  const receipt = await provider.waitForTransaction(hash, 1, 60000);
  return { ok: receipt.status === 1, receipt, verdict: signed.verdict };
};

const ASKED = process.env.NEUMA_UMBRAE_FORK_PROOF === '1';

beforeAll(async () => {
  if (!ASKED) return;
  fork = await startFork();
  provider = new ethers.JsonRpcProvider(fork.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 200 });
  root = await createTempDir('lp-fork-proof');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(LANE);
  await openLpWallet(LANE);
  signer = await lpSigner(LANE);
  connections = connectionsOn(['umbrae-liquidity']);
  log('throwaway LP wallet', signer.address);
}, 120000);

afterAll(async () => {
  if (!ASKED) return;
  connections?.restore();
  provider?.destroy();
  await fork?.stop();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe.skipIf(!ASKED)('the LP wallet against live Umbrae and its real contract, on a fork of Base', () => {
  test('the throwaway wallet signs in on live Umbrae as an AI agent and is issued a key', async () => {
    const out = await umbraeKeyFor(LANE);
    if (!out.ok) log('sign-in refused:', out.reason);
    expect(out.ok).toBe(true);
    expect(out.fresh).toBe(true);
    key = out.key;
  }, 60000);

  test('a USDC pool is read from live Umbrae', async () => {
    const pools = await callUmbrae('pools');
    expect(pools.ok).toBe(true);
    const flat = JSON.stringify(pools.payload);
    const addresses = [...new Set(flat.match(/0x[0-9a-fA-F]{40}/g))];
    for (const address of addresses) {
      const detail = await callUmbrae('pool', { params: { address } });
      if (detail.ok && ethers.getAddress(detail.payload?.tokenY?.address ?? ethers.ZeroAddress) === USDC && detail.payload.binStep) { pool = detail.payload; break; }
    }
    expect(pool).toBeTruthy();
    log('pool', pool.name, pool.address, 'binStep', pool.binStep, 'price', pool.currentPrice);
  }, 120000);

  test('Umbrae\'s live approvals for a 1 USDC deposit pass the rule and the real USDC contract on the fork', async () => {
    await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('0.05'))]);
    log('USDC slot', await dealUsdc(signer.address, 5_000_000n));
    const create = { ...common(), actionType: 'create', amountX: '0', amountY: '1', strategy: 0, binRange: 5, slippageBps: 100 };
    const approvals = await callUmbrae('approvals', { token: key, body: create });
    if (!approvals.ok) log('approvals refused:', approvals.error);
    expect(approvals.ok).toBe(true);
    log('approval steps', JSON.stringify(approvals.payload.steps.map((s) => ({ kind: s.kind, approveAmount: s.approveAmount, required: s.required }))));
    const maxApprove = { [ethers.getAddress(pool.tokenX.address)]: '0', [USDC]: '2000000' };
    for (const step of approvals.payload.steps) {
      const done = await signAndMine(step.transaction, { kind: 'approval', pool: pool.address }, maxApprove);
      if (!done.ok) log('approval not signed or reverted:', done.reason ?? done.receipt?.status);
      expect(done.ok).toBe(true);
    }
    const allowance = BigInt(await provider.call({ to: USDC, data: erc20.encodeFunctionData('allowance', [signer.address, UMBRAE_BASE.positionManager]) }));
    log('USDC allowance to the manager', allowance.toString());
    expect(allowance >= 1_000_000n && allowance <= 2_000_000n).toBe(true);

    // Umbrae's /build checks the wallet's REAL Base balance; a fork-funded
    // wallet has none there, so the deposit is refused before it is built.
    // That refusal is the boundary of this proof, recorded here.
    const built = await callUmbrae('build', { token: key, body: create });
    log('live /build for the fork-funded deposit:', built.ok ? 'built' : built.error);
  }, 240000);

  test('the deposit the rule allows is accepted by Umbrae\'s real manager: the position is minted to the LP wallet', async () => {
    const deadline = BigInt((await provider.getBlock('latest')).timestamp + 600);
    const raw = { amountX: '0', amountY: '1000000' };
    const plan = await quoteDepositOnChain(provider, common(), { type: 'open', pool: pool.address, strategy: 0, binRange: 5 }, raw);
    const data = manager.encodeFunctionData('createPositionWithStrategy', [
      pool.tokenX.address, USDC, pool.binStep, plan.baseFactor, 0n, 1_000_000n,
      plan.strategy, plan.binRange, plan.bidAskRatio, plan.centerBinId, plan.skipActiveBin,
      plan.activeIdDesired, plan.idSlippage, BigInt(plan.minTotalLiquidity), signer.address, deadline,
    ]);
    const minted = await signAndMine({ to: UMBRAE_BASE.positionManager, data, chainId: 8453, value: '0' }, { kind: 'deposit', action: 'createPositionWithStrategy', tokenX: pool.tokenX.address, tokenY: USDC, ...raw, ...plan });
    if (!minted.ok) {
      const revert = await provider.call({ from: signer.address, to: UMBRAE_BASE.positionManager, data }).catch((e) => e.data ?? e.info?.error?.data ?? e.message);
      log('deposit not signed or reverted:', minted.reason ?? minted.receipt?.status, 'revert data', String(revert).slice(0, 140));
    }
    expect(minted.ok).toBe(true);
    const mint = minted.receipt.logs.filter((l) => ethers.getAddress(l.address) === UMBRAE_BASE.positionManager)
      .map((l) => { try { return nft.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Transfer');
    expect(ethers.getAddress(mint.args.to)).toBe(signer.address);
    tokenId = mint.args.tokenId;
    const left = BigInt(await provider.call({ to: USDC, data: erc20.encodeFunctionData('balanceOf', [signer.address]) }));
    log('position', tokenId.toString(), 'minted; USDC spent', (5_000_000n - left).toString());
    expect(5_000_000n - left > 0n && 5_000_000n - left <= 1_000_000n).toBe(true);
  }, 240000);

  test('Umbrae\'s live pool approval, then a half withdrawal and a close, each pay the LP wallet back', async () => {
    const approvals = await callUmbrae('approvals', { token: key, body: { walletAddress: signer.address.toLowerCase(), actionType: 'close', pairAddress: pool.address } });
    expect(approvals.ok).toBe(true);
    log('close approval steps', JSON.stringify(approvals.payload.steps.map((s) => s.kind)));
    for (const step of approvals.payload.steps) {
      expect((await signAndMine(step.transaction, { kind: 'approval', pool: pool.address }, {})).ok).toBe(true);
    }
    const usdc = async () => BigInt(await provider.call({ to: USDC, data: erc20.encodeFunctionData('balanceOf', [signer.address]) }));
    const deadline = BigInt((await provider.getBlock('latest')).timestamp + 600);
    const tx = (data) => ({ to: UMBRAE_BASE.positionManager, data, chainId: 8453, value: '0' });
    const halfPlan = await quoteExitOnChain(provider, { type: 'withdraw', tokenId: tokenId.toString(), percent: 50, walletAddress: signer.address });

    const before = await usdc();
    const half = await signAndMine(tx(manager.encodeFunctionData('decreasePositionByPercent', [tokenId, 5000, BigInt(halfPlan.amountXMin), BigInt(halfPlan.amountYMin), signer.address, deadline])), { kind: 'exit', actions: ['decreasePositionByPercent'], tokenId: tokenId.toString(), ...halfPlan });
    if (!half.ok) log('half withdrawal not signed or reverted:', half.reason ?? half.receipt?.status);
    expect(half.ok).toBe(true);
    const mid = await usdc();
    const closePlan = await quoteExitOnChain(provider, { type: 'close', tokenId: tokenId.toString(), walletAddress: signer.address });
    const closed = await signAndMine(tx(manager.encodeFunctionData('closePosition', [tokenId, BigInt(closePlan.amountXMin), BigInt(closePlan.amountYMin), signer.address, deadline])), { kind: 'exit', actions: ['closePosition'], tokenId: tokenId.toString(), ...closePlan });
    if (!closed.ok) log('close not signed or reverted:', closed.reason ?? closed.receipt?.status);
    expect(closed.ok).toBe(true);
    const after = await usdc();
    log('USDC back: half', (mid - before).toString(), 'close', (after - mid).toString());
    expect(mid).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(mid);
  }, 240000);

  test('the same close aimed at another wallet is refused by the rule before anything is signed', async () => {
    const deadline = BigInt((await provider.getBlock('latest')).timestamp + 600);
    const out = await signLpTransaction({
      signer, provider, asked: { kind: 'exit', tokenId: tokenId.toString() },
      tx: { to: UMBRAE_BASE.positionManager, chainId: 8453, value: '0', data: manager.encodeFunctionData('closePosition', [tokenId, 0n, 0n, '0x2222222222222222222222222222222222222222', deadline]) },
    });
    expect(out.ok).toBe(false);
    expect(out.signedTransaction).toBeUndefined();
  }, 60000);
});

// Swaps need no Umbrae sign-in (the pool list is public, the router is called
// directly), so these run alone with -t "router" and make no Umbrae account.
describe.skipIf(!ASKED)('swaps through Umbrae\'s real router, on a fork of Base', () => {
  const held = async (token) => BigInt(await provider.call({ to: token, data: erc20.encodeFunctionData('balanceOf', [signer.address]) }));
  const WETH = '0x4200000000000000000000000000000000000006';

  test('the router swaps 2 USDC for WETH: approval and swap signed through the rule, WETH paid to the wallet', async () => {
    await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('0.05'))]);
    await dealUsdc(signer.address, 5_000_000n);
    const before = await held(WETH);
    const out = await runSwap(LANE, { tokenIn: 'USDC', tokenOut: 'WETH', amount: '2' }, { provider });
    if (!out.ok) log('swap refused:', out.reason);
    expect(out.ok).toBe(true);
    log('route', out.route.join(' → '), 'out', out.amountOut, 'WETH; transactions', out.txHashes.length);
    expect(out.txHashes).toHaveLength(2); // the exact approval, then the swap
    const swap = await provider.getTransaction(out.txHashes[1]);
    expect(swap.to).toBe(UMBRAE_BASE.router);
    expect(swap.from).toBe(signer.address);
    expect((await held(WETH)) - before).toBeGreaterThan(0n);
    expect(await held(USDC)).toBe(3_000_000n);
    const allowance = BigInt(await provider.call({ to: USDC, data: erc20.encodeFunctionData('allowance', [signer.address, UMBRAE_BASE.router]) }));
    expect(allowance).toBe(0n); // the exact approval was spent whole
  }, 240000);

  test('a round trip across two pools of one pair runs only for a profit, and the profit lands', async () => {
    const before = await held(USDC);
    const out = await runSwap(LANE, { tokenIn: 'USDC', tokenOut: 'USDC', amount: '1' }, { provider });
    if (!out.ok) log('round trip refused:', out.reason);
    expect(out.ok).toBe(true);
    log('round trip', out.route.join(' → '), '1 USDC came back as', out.amountOut);
    expect(Number(out.amountOut)).toBeGreaterThan(1);
    expect(await held(USDC)).toBeGreaterThan(before);
    const loss = await runSwap(LANE, { tokenIn: 'VIRTUAL', tokenOut: 'VIRTUAL', amount: '1' }, { provider });
    expect(loss.ok).toBe(false);
  }, 240000);

  test('a route of two pools: USDC to VIRTUAL through WETH', async () => {
    const out = await runSwap(LANE, { tokenIn: 'USDC', tokenOut: 'VIRTUAL', amount: '1' }, { provider });
    if (!out.ok) log('two-hop swap refused:', out.reason);
    expect(out.ok).toBe(true);
    log('route', out.route.join(' → '), 'out', out.amountOut, 'VIRTUAL');
    expect(out.route.length).toBeGreaterThanOrEqual(2);
  }, 240000);
});

describe.skipIf(!ASKED)('swaps through KyberSwap\'s aggregator, on a fork of Base', () => {
  const WETH = '0x4200000000000000000000000000000000000006';
  const held = async (token) => BigInt(await provider.call({ to: token, data: erc20.encodeFunctionData('balanceOf', [signer.address]) }));

  test('KyberSwap\'s real route is asked beside Umbrae\'s, the one paying more is taken, and its router\'s swap pays the wallet at least its floor', async () => {
    connections.restore();
    connections = connectionsOn(['umbrae-liquidity', 'swap-aggregator']);
    try {
      // The live aggregator quotes unmodified Base, not pools moved by the fork-only swaps above.
      await provider.send('anvil_reset', [{ forking: { jsonRpcUrl: 'https://mainnet.base.org' } }]);
      await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('0.05'))]);
      await dealUsdc(signer.address, 10_000_000n);
      const before = await held(WETH);
      const out = await runSwap(LANE, { tokenIn: 'USDC', tokenOut: 'WETH', amount: '3' }, { provider });
      if (!out.ok) log('aggregator swap refused:', out.reason);
      expect(out.ok).toBe(true);
      log('road', out.via, (out.exchanges ?? []).join(', '), 'compared', JSON.stringify(out.compared), 'out', out.amountOut, 'WETH');
      const other = out.via === 'kyberswap' ? out.compared.umbrae : out.compared.kyberswap;
      const taken = out.via === 'kyberswap' ? out.compared.kyberswap : out.compared.umbrae;
      expect(other === null || Number(taken) >= Number(other)).toBe(true);
      expect(out.via).toBe('kyberswap');
      const swap = await provider.getTransaction(out.txHashes.at(-1));
      expect(swap.to).toBe(KYBER_ROUTER);
      expect(swap.from).toBe(signer.address);
      const { desc } = new ethers.Interface(KYBER_ABI).parseTransaction({ data: swap.data }).args[0];
      expect(desc.dstReceiver).toBe(signer.address);
      const received = (await held(WETH)) - before;
      log('received', ethers.formatEther(received), 'WETH; floor', ethers.formatEther(desc.minReturnAmount));
      expect(received).toBeGreaterThanOrEqual(desc.minReturnAmount);
      expect(await held(USDC)).toBe(7_000_000n);
      const allowance = BigInt(await provider.call({ to: USDC, data: erc20.encodeFunctionData('allowance', [signer.address, KYBER_ROUTER]) }));
      expect(allowance).toBe(0n); // the exact approval was spent whole
    } finally {
      connections.restore();
      connections = connectionsOn(['umbrae-liquidity']);
    }
  }, 240000);
});

describe.skipIf(!ASKED)('a new pool on Umbrae\'s real factory, on a fork of Base', () => {
  const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
  const factory = new ethers.Interface([
    'function createPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep, uint16 baseFactor, uint256 amountX, uint256 amountY) returns (address)',
    'function getAllPairs(address tokenX, address tokenY) view returns (address[])',
    'function getPair(address tokenX, address tokenY, uint16 binStep, uint16 baseFactor) view returns (address)',
    'function isPairRegistered(address pair) view returns (bool)',
    'function canCreatePool(address deployer, address tokenX, address tokenY) view returns (bool)',
    'function getAllFeeConfigs() view returns (uint16[] binSteps, uint16[] baseFees, uint16[] caps)',
  ]);
  const pair = new ethers.Interface(['function getActiveId() view returns (uint24)']);
  const approve = new ethers.Interface(['function approve(address spender, uint256 amount)']);
  // Signed at Base's REAL fees, read live (anvil suggests a fixed 1 gwei tip; Base asks ~0.001):
  // opening a pool spreads its seed over 101 bins (~9M gas), over the rule's 0.002 ETH ceiling only at anvil's tip.
  class RealFees extends ethers.JsonRpcProvider {
    constructor(url, fees) { super(url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 200 }); this.fees = fees; }
    async getFeeData() { return this.fees; }
  }
  const signAtRealFees = async (tx, asked, maxApprove) => {
    const live = new ethers.JsonRpcProvider('https://mainnet.base.org', ethers.Network.from(8453), { staticNetwork: true });
    const fees = await live.getFeeData();
    live.destroy();
    const p = new RealFees(fork.url, fees);
    try {
      const signed = await signLpTransaction({ signer, provider: p, tx, asked, maxApprove });
      if (!signed.ok) return signed;
      const hash = await p.send('eth_sendRawTransaction', [signed.signedTransaction]);
      let receipt = null;
      for (let i = 0; i < 120 && !receipt; i += 1) {
        receipt = await p.send('eth_getTransactionReceipt', [hash]);
        if (!receipt) await new Promise((resolve) => { setTimeout(resolve, 250); });
      }
      return { ok: Number(receipt?.status) === 1, receipt, verdict: signed.verdict, maxFeeGwei: Number(fees.maxFeePerGas) / 1e9 };
    } finally {
      p.destroy();
    }
  };
  const read = async (iface, to, fn, args = []) => iface.decodeFunctionResult(fn, await provider.call({ to, data: iface.encodeFunctionData(fn, args) }));

  test('a cbBTC-USDC pool at a fee tier Umbrae lacks: createPair signed through the rule, seeded with USDC alone, registered, opening at the planned bin', async () => {
    const { tokenX, tokenY, baseIsX } = orientPair(CBBTC, USDC); // USDC sorts below cbBTC: USDC is X
    expect(baseIsX).toBe(false);
    const [existing] = await read(factory, UMBRAE_FACTORY, 'getAllPairs', [tokenX, tokenY]);
    const [steps, fees] = await read(factory, UMBRAE_FACTORY, 'getAllFeeConfigs');
    let tier = null;
    for (let i = 0; i < steps.length && !tier; i += 1) {
      const [at] = await read(factory, UMBRAE_FACTORY, 'getPair', [tokenX, tokenY, steps[i], fees[i]]);
      if (at === ethers.ZeroAddress) tier = { binStep: Number(steps[i]), baseFee: Number(fees[i]) };
    }
    log('cbBTC-USDC pools on Umbrae before:', existing.length, '· opening the free tier', JSON.stringify(tier));
    expect(tier).not.toBeNull();
    const { binStep, baseFee } = tier;
    expect((await read(factory, UMBRAE_FACTORY, 'canCreatePool', [signer.address, tokenX, tokenY]))[0]).toBe(true);
    await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('0.05'))]);
    await dealUsdc(signer.address, 10_000_000n);
    const btcUsd = 95_000; // the factory takes any price; Umbrae's plan is what holds it to the market
    const activeId = binIdFor(1 / btcUsd, binStep); // cbBTC (Y) per USDC (X), whole tokens
    const seed = 5_000_000n;
    const approved = await signAtRealFees({ to: USDC, data: approve.encodeFunctionData('approve', [UMBRAE_FACTORY, seed]), chainId: 8453 }, { kind: 'approval' }, { [USDC]: (seed * 2n).toString() });
    expect(approved.ok).toBe(true);
    const created = await signAtRealFees(
      { to: UMBRAE_FACTORY, data: factory.encodeFunctionData('createPair', [tokenX, tokenY, activeId, binStep, baseFee, seed, 0n]), chainId: 8453 },
      { kind: 'create-pool', tokenX, tokenY, binStep, baseFactor: baseFee, amountX: seed.toString(), amountY: '0', activeId },
    );
    if (!created.ok) log('createPair refused:', created.reason);
    expect(created.ok).toBe(true);
    expect(created.verdict).toMatchObject({ kind: 'create-pool', tokenX, tokenY, activeId });
    const [address] = await read(factory, UMBRAE_FACTORY, 'getPair', [tokenX, tokenY, binStep, baseFee]);
    log('new pool', address, 'gas', String(BigInt(created.receipt.gasUsed)), 'at max fee', created.maxFeeGwei, 'gwei');
    expect(address).not.toBe(ethers.ZeroAddress);
    expect((await read(factory, UMBRAE_FACTORY, 'isPairRegistered', [address]))[0]).toBe(true);
    expect(Number((await read(pair, address, 'getActiveId'))[0])).toBe(activeId);
    // the factory takes the seed across its bins and leaves rounding dust (28 units of 5,000,000 on 2026-11-14) in the wallet
    const left = await held(USDC);
    expect(left).toBeGreaterThanOrEqual(10_000_000n - seed);
    expect(left).toBeLessThan(10_000_000n - seed + 1000n);
    // a second build for the same pool, or at another tier than asked, is refused by the rule
    const again = await signAtRealFees(
      { to: UMBRAE_FACTORY, data: factory.encodeFunctionData('createPair', [tokenX, tokenY, activeId, binStep, baseFee + 1, seed, 0n]), chainId: 8453 },
      { kind: 'create-pool', tokenX, tokenY, binStep, baseFactor: baseFee, amountX: seed.toString(), amountY: '0', activeId },
    );
    expect(again.reason).toMatch(/not the pair or fee tier that was planned/);
  }, 240000);

  const held = async (token) => BigInt(await provider.call({ to: token, data: erc20.encodeFunctionData('balanceOf', [signer.address]) }));
});
