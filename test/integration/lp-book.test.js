/**
 * The earnings book, the watch and the rewards of a house member's LP wallet
 * (backend/services/umbrae-lp/lp-book.js, lp-watch.js, lp-rewards.js) over
 * REAL parts (RULE 0): real claimed workspaces (a house of two members), a
 * real chain node (anvil as chain 8453) holding a real token contract at
 * USDC's address, and a real HTTP listener in Umbrae's place whose WETH price
 * the test moves. Money "arrives" the way it does on Base: the node's own
 * balance and the token's own storage change outside any act of the member.
 *
 * NOT proven here: a wake turn the model takes (house-wake tests own the
 * queue and the turn); the watch's signals are caught at the wake sink.
 */
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil, miniErc20Initcode, MINI_ERC20_ABI } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, USDC, WETH, POOL } from '../helpers/umbrae-stand-in.js';
import { installLpPool } from '../helpers/lp-chain-kit.js';
import { binIdFor } from '../../core/wallet/pool-policy.js';
import { clearMarketCache } from '../../backend/services/market-map/market-data.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setWakeSink } from '../../backend/services/house-clock/wake-signal.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { readLpView } from '../../backend/services/umbrae-lp/lp-view.js';
import { runSend } from '../../backend/services/umbrae-lp/lp-trade.js';
import { readBook } from '../../backend/services/umbrae-lp/lp-book.js';
import { watchLpTick, writeLpPace } from '../../backend/services/umbrae-lp/lp-watch.js';
import { setGoal, requestReward, answerReward, readGoals } from '../../backend/services/umbrae-lp/lp-rewards.js';
import { handleLpRead } from '../../backend/services/umbrae-lp/lp-being-tools.js';

const OPERATOR = ethers.Wallet.createRandom().address;
let anvil, provider, root, originalRoot, umbrae, connections, signals;
const priorRpc = process.env.BASE_MAINNET_RPC_URL;
const lp = {};
const token = () => new ethers.Contract(USDC, MINI_ERC20_ABI, provider);
const fundUsdc = (address, whole) => provider.send('anvil_setStorageAt', [USDC, ethers.zeroPadValue(address, 32), ethers.toBeHex(ethers.parseUnits(String(whole), 6), 32)]);
const view = async (lane) => (await readLpView(lane)).book;
const setWethPrice = async (usd) => {
  umbrae.state.wethPrice = usd;
  umbrae.state.marketWethPrice = usd;
  clearMarketCache();
  await installLpPool(provider, POOL, 5000, WETH, USDC, 25, binIdFor(usd, 25));
};
const resetUmbrae = async () => {
  umbrae.reset();
  await setWethPrice(3200);
};

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  // A real ERC20 (transfer, balanceOf, decimals 6), deployed once and its code placed at USDC's address.
  const deployer = await provider.getSigner(0);
  const made = await (await deployer.sendTransaction({ data: miniErc20Initcode(0n) })).wait();
  await provider.send('anvil_setCode', [USDC, await provider.getCode(made.contractAddress)]);
  root = await createTempDir('lp-book');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  for (const lane of ['tenekom', 'rugevil']) {
    await workspace.create(lane);
    await claimOwner(root, lane, OPERATOR);
    await workspace.writeEncryptedKeypair(lane, { address: ethers.Wallet.createRandom().address });
    lp[lane] = (await openLpWallet(lane)).address;
  }
  umbrae = await startUmbraeStandIn({ provider });
  // The app's Base node is this anvil (the chain registry reads it at call time).
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  await setWethPrice(3200);
}, 30000);

afterAll(async () => {
  setWakeSink(null);
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
  signals = [];
  setWakeSink((s) => { signals.push(s); });
});

describe('the book', () => {
  test('what arrives from outside is FUNDED, priced on arrival; earned starts at zero', async () => {
    await resetUmbrae();
    await provider.send('anvil_setBalance', [lp.tenekom, ethers.toQuantity(ethers.parseEther('1'))]);
    await fundUsdc(lp.tenekom, 500);
    const book = await view('tenekom');
    expect(book).toMatchObject({ valueUsd: 3696.84, fundedUsd: 3696.84, earnedUsd: 0, freeUsd: 0 });
  }, 60000);

  test('a price move is earned (or lost); the arrival keeps its price', async () => {
    await setWethPrice(3520);
    expect(await view('tenekom')).toMatchObject({ valueUsd: 4020, fundedUsd: 3696.84, earnedUsd: 323.16, freeUsd: 323.16 });
  }, 60000);

  test('a send to a housemate is money handed on: the sender\'s earned holds (less gas), the receiver is FUNDED', async () => {
    await setWethPrice(3520);
    const out = await runSend('tenekom', { to: 'rugevil', token: 'USDC', amount: '100', why: 'Rugevil needs working capital' }, { provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(out.ok).toBe(true);
    expect(out.walletChangeUsd).toBeLessThan(-100); // 100 USDC and a little gas left the wallet
    const sender = await view('tenekom');
    expect(sender.returnedUsd).toBe(100);
    expect(sender.earnedUsd).toBeGreaterThan(319); // only gas came off
    expect(sender.earnedUsd).toBeLessThan(323.17);
    expect(await view('rugevil')).toMatchObject({ fundedUsd: 100, earnedUsd: 0 });
    const book = await readBook('tenekom');
    expect(book.journal.at(-1)).toMatchObject({ act: 'send', why: 'Rugevil needs working capital' });
    expect(book.journal.at(-1).what).toMatch(/^sent 100 USDC to rugevil \(liquidity\) — wallet moved -0\.\d+ ETH, -100 USDC; cost beyond the amount −\$0\.\d\d\. Gas: 0\.0\dM units, \$0\.\d\d\.$/);
    // gas is told apart, from the receipts
    expect(book.journal.at(-1).gasUnits).toBeGreaterThan(21000);
    // what it did is in its own journal, in its own terms
    const memory = (await workspace.readJournal('tenekom')).filter((e) => e.type === 'lp-trade');
    expect(memory.at(-1).content).toMatch(/^My LP wallet: sent 100 USDC.*Why I did it: Rugevil needs working capital/);
  }, 60000);
});

describe('rewards, paid only from what it earned', () => {
  test('a goal it has not earned, or cannot pay in USDC, is refused; the operator is never asked', async () => {
    await setWethPrice(3520);
    const big = await setGoal('tenekom', { what: 'Its own server', costUsd: 5000, why: 'run around the clock without sharing the house GPU' });
    expect((await requestReward('tenekom', big.goal.id)).reason).toMatch(/earned \$32\d\.\d\d free to spend; "Its own server" costs \$5000\.00/);
    const gpu = await setGoal('rugevil', { what: 'A GPU', costUsd: 10, why: 'a bigger model' });
    expect((await requestReward('rugevil', gpu.goal.id)).reason).toMatch(/earned \$0\.00 free to spend/);
    expect((await readGoals('tenekom')).find((g) => g.id === big.goal.id).status).toBe('working');
  }, 60000);

  test('earned and held in USDC: asked; APPROVE pays the operator from its wallet; a second press pays nothing', async () => {
    await setWethPrice(3520);
    const gpu = (await setGoal('tenekom', { what: 'A new GPU', costUsd: 300, why: 'faster turns on every round' })).goal;
    const asked = await requestReward('tenekom', gpu.id);
    expect(asked.ok).toBe(true);
    expect((await readGoals('tenekom')).find((g) => g.id === gpu.id).status).toBe('requested');
    // A housemate that goes by the seat's word takes no reward: it is paid to the owner record's wallet (PR600 P6-22).
    await workspace.writeDNA('rugevil', { neumaId: 'rugevil', identity: { name: 'Operator' } });
    const rugevilHeld = await token().balanceOf(lp.rugevil);
    const paid = await answerReward('tenekom', gpu.id, 'approved', { note: 'ordering it tonight', provider, receiptProvider: provider, receiptConfirmations: 1 });
    expect(paid.ok).toBe(true);
    expect(await token().balanceOf(OPERATOR)).toBe(ethers.parseUnits('300', 6));
    expect(await token().balanceOf(lp.rugevil)).toBe(rugevilHeld);
    expect((await answerReward('tenekom', gpu.id, 'approved', { provider })).reason).toMatch(/not waiting/);
    expect(await token().balanceOf(OPERATOR)).toBe(ethers.parseUnits('300', 6));
    const book = await view('tenekom');
    expect(book.rewardsUsd).toBe(300);
    expect(book.earnedUsd).toBeGreaterThan(319); // a reward is spent from earnings, not lost
    expect(book.freeUsd).toBeLessThan(23);
    expect(signals.find((s) => s.ref === `reward-${gpu.id}-approved`)).toMatchObject({ seat: 'tenekom', reason: 'lp', detail: { event: 'reward-answered', answer: 'approved' } });
    expect((await answerReward('tenekom', gpu.id, 'delivered', { note: 'installed' })).goal.status).toBe('delivered');
    expect((await workspace.readJournal('tenekom')).some((e) => e.type === 'lp-reward' && /My reward arrived: A new GPU/.test(e.content))).toBe(true);
  }, 60000);

  test('DECLINE pays nothing, keeps the goal, and tells it why', async () => {
    const goal = (await setGoal('tenekom', { what: 'A bigger model', costUsd: 5, why: 'sharper reads' })).goal;
    const requested = await requestReward('tenekom', goal.id);
    expect(requested.ok, requested.reason).toBe(true);
    const before = await token().balanceOf(OPERATOR);
    const out = await answerReward('tenekom', goal.id, 'declined', { note: 'not this month' });
    expect(out.goal).toMatchObject({ status: 'working', note: 'not this month' });
    expect(await token().balanceOf(OPERATOR)).toBe(before);
    expect(signals.at(-1).detail).toMatchObject({ event: 'reward-answered', answer: 'declined', note: 'not this month' });
  }, 60000);
});

describe('what the member reads: lp_book', () => {
  test('its book, its last acts with why, and its goals with progress', async () => {
    await setWethPrice(3520);
    const r = await handleLpRead({ toolName: 'lp_book' }, null, { neumaId: 'tenekom' }, { last: 5 });
    expect(r).toMatchObject({ tool: 'wallet/lp_book', status: 'ok' });
    expect(r.content).toMatch(/^YOUR BOOK/);
    expect(r.content).toMatch(/Given to you \$3696\.84 · sent on to the house \$100\.00 · rewards paid \$300\.00/);
    expect(r.content).toMatch(/EARNED \+\$32\d\.\d\d/);
    expect(r.content).toMatch(/paid a reward: 300\.00 USDC to operator.*\(why: reward: A new GPU\)/);
    expect(r.content).toMatch(/YOUR GOALS/);
    // free $19-ish against a $5 goal: earned, and told to ask
    expect(r.content).toMatch(/A bigger model: \$5\.00 · EARNED: ask for it \(lp\/reward\) · last answer: "not this month"/);
    expect(r.content).toMatch(/Earned before:\n    A new GPU \(\$300\.00\) delivered/);
  }, 60000);
});

describe('the watch, round the clock', () => {
  test('one look wakes a funded member for: money that arrived, a position that left its range, a spread that opened, its round', async () => {
    await setWethPrice(3520);
    await fundUsdc(lp.rugevil, 250); // rugevil held 100 USDC; 150 more arrives from outside
    umbrae.state.positions = [{ lbPairAddress: POOL, poolInfo: { name: 'WETH-USDC', tokenXPriceUsd: 3520, tokenYPriceUsd: 1 }, positions: { activeBin: { binId: 9000 }, userPositions: [{ publicKey: '77', positionData: { lowerBinId: 8000, upperBinId: 8100, totalXAmount: '0', totalYAmount: '0', feeX: '0', feeY: '0' } }] } }];
    // rugevil signs in to Umbrae only when it first acts; give it a key so its positions are read
    await (await import('../../backend/services/umbrae-lp/lp-wallet.js')).saveUmbraeKey('rugevil', 'umbr_testkey_watch');
    const raised = await watchLpTick(Date.UTC(2026, 10, 13, 12, 0));
    const events = (raised.rugevil ?? []).map((w) => w.detail.event).sort();
    // two arrivals no wake has told of yet: Tenekom's send (booked when the desk read Rugevil's wallet) and these 150
    expect(events).toEqual(['arrived', 'arrived', 'out-of-range', 'round', 'spread']);
    expect(raised.rugevil.filter((w) => w.detail.event === 'arrived').map((w) => w.detail)).toEqual([
      expect.objectContaining({ usd: 100, moved: '100 USDC' }), expect.objectContaining({ usd: 150, moved: '150 USDC' })]);
    expect(raised.rugevil.find((w) => w.detail.event === 'spread').detail).toMatchObject({ pair: 'WETH-USDC', pct: 5 });
    expect(signals.filter((s) => s.seat === 'rugevil' && s.reason === 'lp')).toHaveLength(5);
    expect((await readBook('rugevil')).fundedUsd).toBe(250);
  }, 60000);

  test('the next look stays quiet about what it already told; the round comes once per pace window; pace 0 stops rounds', async () => {
    await setWethPrice(3520);
    umbrae.state.positions = [{ lbPairAddress: POOL, poolInfo: { name: 'WETH-USDC', tokenXPriceUsd: 3520, tokenYPriceUsd: 1 }, positions: { activeBin: { binId: 9000 }, userPositions: [{ publicKey: '77', positionData: { lowerBinId: 8000, upperBinId: 8100 } }] } }];
    const again = await watchLpTick(Date.UTC(2026, 10, 13, 12, 5));
    expect((again.rugevil ?? []).map((w) => w.detail.event)).toEqual(['round']);
    expect(again.rugevil[0].ref).toBe((await watchLpTick(Date.UTC(2026, 10, 13, 12, 10))).rugevil[0].ref);
    await writeLpPace('rugevil', 0);
    expect((await watchLpTick(Date.UTC(2026, 10, 13, 12, 15))).rugevil).toBeUndefined();
    await expect(writeLpPace('rugevil', 7)).rejects.toThrow(/0, 30, 60, 120, 240, 480/);
  }, 60000);

  test('with the connection off the watch does not look', async () => {
    connections.restore();
    connections = connectionsOn([]);
    expect(await watchLpTick()).toEqual({});
  });
});

describe('a book priced the old way is brought to independently verified prices once', () => {
  const oldBook = async (lane, journal, arrivals = []) => {
    await workspace.create(lane);
    await workspace.writeEncryptedKeypair(lane, { address: ethers.Wallet.createRandom().address });
    const address = (await openLpWallet(lane)).address;
    await provider.send('anvil_setBalance', [address, ethers.toQuantity(ethers.parseEther('0.1'))]);
    // the shape a book had before pricing 2: no `pricing`, funded at a thinner pool's price
    await workspace._writeJSON(path.join(workspace._path(lane), 'config', 'lp-book.json'), {
      version: 1, openedAt: '2026-11-13T12:00:00.000Z', held: { ETH: ethers.parseEther('0.1').toString() }, fundedUsd: 999,
      returnedUsd: 0, rewardsUsd: 0, days: {}, journal, arrivals, pools: {}, ranges: {},
    });
  };

  test('with only money that arrived, what it was given is re-counted: earned stays 0, never the price fix as a loss', async () => {
    await resetUmbrae();
    await oldBook('oldfunded', [{ at: '2026-11-13T12:00:00.000Z', act: 'arrived', what: 'arrived from outside: 0.1 ETH', deltaUsd: 999 }]);
    expect(await view('oldfunded')).toMatchObject({ valueUsd: 319.68, fundedUsd: 319.68, earnedUsd: 0 });
    const book = await readBook('oldfunded');
    expect(book.pricing).toBe(3);
    expect(book.journal.at(-1)).toMatchObject({ act: 'repriced', what: "prices now use independent markets checked against the on-chain active bin; what you were given is re-counted at them: $319.68" });
    expect((await view('oldfunded')).fundedUsd).toBe(319.68); // once
  }, 60000);

  const traded = [
    { at: '2026-11-13T12:00:00.000Z', act: 'arrived', what: 'arrived from outside: 0.1 ETH', deltaUsd: 999 },
    { at: '2026-11-13T12:05:00.000Z', act: 'swap', what: 'round trip', deltaUsd: 0.1 },
  ];

  test('with acts behind it, each arrival is re-counted from its own token amounts at the right price', async () => {
    await resetUmbrae();
    await oldBook('oldtrader', traded, [{ at: '2026-11-13T12:00:00.000Z', usd: 999, moved: [{ symbol: 'ETH', amount: 0.1, usd: 999 }] }]);
    expect(await view('oldtrader')).toMatchObject({ fundedUsd: 319.68, earnedUsd: 0 });
    const book = await readBook('oldtrader');
    expect(book.arrivals[0].usd).toBeCloseTo(319.68, 2);
    expect(book.journal.at(-1).what).toBe("prices now use independent markets checked against the on-chain active bin; what you were given is re-counted at them: $319.68 (was $999.00)");
  }, 60000);

  test('with acts and no arrival on record to re-count, the figures stand and a line says why they may shift', async () => {
    await resetUmbrae();
    await oldBook('oldnoarrivals', traded);
    const figures = await view('oldnoarrivals');
    expect(figures.fundedUsd).toBe(999);
    expect(figures.earnedUsd).toBeCloseTo(-679.32, 2);
    expect((await readBook('oldnoarrivals')).journal.at(-1).what).toMatch(/figures from here may shift/);
  }, 60000);
});


describe('P6-21 reward approval is atomic across processes and uncertainty', () => {
  test('two independent processes cannot both pay one requested goal', async () => {
    await setWethPrice(3520);
    const goal = (await setGoal('tenekom', { what: 'A backup disk', costUsd: 5, why: 'keep sovereign memory safe' })).goal;
    expect((await requestReward('tenekom', goal.id)).ok).toBe(true);
    const before = await token().balanceOf(OPERATOR);
    const source = `import { ethers } from 'ethers';
import { answerReward } from './backend/services/umbrae-lp/lp-rewards.js';
const provider = new ethers.JsonRpcProvider(${JSON.stringify(anvil.url)}, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
const out = await answerReward('tenekom', ${JSON.stringify(goal.id)}, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1 });
console.log(JSON.stringify(out));
provider.destroy();`;
    const runChild = () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], {
      cwd: process.cwd(), env: { ...process.env, WORKSPACES_ROOT: root }, maxBuffer: 1024 * 1024,
    });
    const results = await Promise.all([runChild(), runChild()]);
    const answers = results.map(({ stdout }) => JSON.parse(stdout.trim().split('\n').at(-1)));
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toHaveLength(1);
    expect(await token().balanceOf(OPERATOR) - before).toBe(ethers.parseUnits('5', 6));
    expect((await readGoals('tenekom')).find((g) => g.id === goal.id).status).toBe('paid');
  }, 60000);

  test('an accepted send with a lost response stays paying and cannot be approved again', async () => {
    await setWethPrice(3520);
    const goal = (await setGoal('tenekom', { what: 'A spare fan', costUsd: 5, why: 'keep the house hardware healthy' })).goal;
    expect((await requestReward('tenekom', goal.id)).ok).toBe(true);
    const listeners = [];
    const makeLostResponseProxy = async () => {
      const server = http.createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const message = JSON.parse(raw);
        const upstream = await globalThis.fetch(anvil.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
        const payload = await upstream.json();
        if (message.method === 'eth_getTransactionReceipt') payload.result = null;
        res.writeHead(message.method === 'eth_sendRawTransaction' ? 500 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(message.method === 'eth_sendRawTransaction'
          ? { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'response lost after acceptance' } }
          : payload));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      listeners.push(server);
      return `http://127.0.0.1:${server.address().port}`;
    };
    const first = new ethers.JsonRpcProvider(await makeLostResponseProxy(), ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50, batchMaxCount: 1 });
    const second = new ethers.JsonRpcProvider(await makeLostResponseProxy(), ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50, batchMaxCount: 1 });
    const before = await token().balanceOf(OPERATOR);
    try {
      const out = await answerReward('tenekom', goal.id, 'approved', { provider: first, receiptProvider: second, receiptConfirmations: 1, receiptTimeoutMs: 50 });
      expect(out).toMatchObject({ ok: false, uncertain: true });
      expect((await readGoals('tenekom')).find((g) => g.id === goal.id)).toMatchObject({ status: 'paying', paymentUncertain: true });
      expect(await token().balanceOf(OPERATOR) - before).toBe(ethers.parseUnits('5', 6));
      const reconciled = await answerReward('tenekom', goal.id, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1 });
      expect(reconciled).toMatchObject({ ok: true, goal: { status: 'paid', paymentUncertain: false } });
      expect(await token().balanceOf(OPERATOR) - before).toBe(ethers.parseUnits('5', 6));
      const retry = await answerReward('tenekom', goal.id, 'approved', { provider, receiptProvider: provider, receiptConfirmations: 1 });
      expect(retry.reason).toMatch(/not waiting/);
      expect(await token().balanceOf(OPERATOR) - before).toBe(ethers.parseUnits('5', 6));
    } finally {
      first.destroy();
      second.destroy();
      await Promise.all(listeners.map((server) => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
      }));
    }
  }, 60000);
});
