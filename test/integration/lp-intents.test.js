/**
 * A house member's LP actions as FILED intents (backend/services/intents/lp-acts.js),
 * settled by the REAL sweep (RULE 0): the real policy rows and session-mode
 * gate, a real workspace, the app's own chain registry pointed at a real node
 * (anvil as chain 8453), and a real HTTP listener in Umbrae's place
 * (test/helpers/umbrae-stand-in.js). Also the house member's read of its LP
 * wallet, which the wallet view carries.
 */
import process from 'node:process';
import fs from 'node:fs/promises';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { returnContract } from '../helpers/evm-return-contract.js';
import { installLpManager, installLpPool, registerLpIntegrityPins } from '../helpers/lp-chain-kit.js';
import { startLpReceiptRpc } from '../helpers/lp-receipt-rpc-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { viaIntent, granting } from '../helpers/intent-path.js';
import { startUmbraeStandIn, POOL, USDC } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { _resetConfig } from '../../backend/config.js';
import { intentType } from '../../backend/services/intents/registry.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { listPendingDeposits, writeLpBudget } from '../../backend/services/umbrae-lp/lp-budget.js';
import { readLpView, lpViewLines } from '../../backend/services/umbrae-lp/lp-view.js';
import { lpBase } from '../../backend/services/umbrae-lp/lp-base.js';

const NEUMA_ID = 'lpintentecho';
const BARE_ID = 'lpintentbare';
const connection = (neumaId = NEUMA_ID, extra = {}) => ({ companion: { name: 'Echo', neumaId, ...extra }, sessionId: 's-1', toolMode: 'ask' });

let anvil;
let provider;
let root;
let originalRoot;
let umbrae;
let connections;
let receiptRpc;
let wallet;
const priorRpc = process.env.BASE_MAINNET_RPC_URL;

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  receiptRpc = await startLpReceiptRpc(anvil.url);
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  _resetConfig();
  resetChainProviders();
  root = await createTempDir('lp-intents');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(NEUMA_ID);
  await workspace.create(BARE_ID);
  wallet = (await openLpWallet(NEUMA_ID)).address;
  await provider.send('anvil_setBalance', [wallet, ethers.toQuantity(ethers.parseEther('1'))]);
  umbrae = await startUmbraeStandIn({ provider });
  await installLpManager(provider, '0x362A4AD56E93B71b0dBB28f9Ba1e578E5b077134');
  await installLpPool(provider, POOL);
  await registerLpIntegrityPins(await lpBase());
  for (const [token, units, symbol] of [['0x4200000000000000000000000000000000000006', 18, 'WETH'], [USDC, 6, 'USDC']]) {
    await provider.send('anvil_setCode', [token, returnContract({
      fallback: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0n]),
      routes: {
        [ethers.id('decimals()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint8'], [units]),
        [ethers.id('symbol()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['string'], [symbol]),
      },
    })]);
  }
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  await receiptRpc?.close();
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

const sends = () => umbrae.seen.filter((r) => r.url === '/api/v1/base/send');

describe('the LP intents through the real sweep', () => {
  test('a filed claim needs approval, then Base mines it from the LP wallet', async () => {
    const [held] = await viaIntent(connection(), 'lp/claim', { pool: POOL, tokenId: '42' });
    expect(held.status).toBe('denied');
    expect(sends()).toEqual([]);
    const [receipt] = await viaIntent(connection(), 'lp/claim', { pool: POOL, tokenId: '42', why: 'fees are worth collecting' }, 'ask', granting('lp.claim'));
    expect(receipt.status, receipt.content ?? receipt.error).toBe('ok');
    expect(receipt.content).toMatch(/^Done: lp\/claim on Base in 1 transaction/);
    const hash = receipt.content.match(/0x[0-9a-f]{64}/)[0];
    expect((await provider.getTransactionReceipt(hash)).from).toBe(wallet);
  }, 60000);

  test('an approved open past a $0 cap waits for the operator: nothing is signed', async () => {
    await writeLpBudget(NEUMA_ID, 0);
    const [receipt] = await viaIntent(connection(), 'lp/open', { pool: POOL, amountY: '5' }, 'ask', granting('lp.open'));
    expect(receipt.status, receipt.content ?? receipt.error).toBe('ok');
    expect(receipt.content).toMatch(/past the \$0 budget\. It is waiting for the operator's answer\. Request [0-9a-f-]{36}\./);
    expect(sends()).toEqual([]);
    expect(await listPendingDeposits(NEUMA_ID)).toHaveLength(1);
  }, 60000);

  test('a malformed approved action is a failed act with the reason, and Umbrae hears nothing past the public pool read', async () => {
    const [receipt] = await viaIntent(connection(), 'lp/withdraw', { pool: POOL, tokenId: '42', percent: 250 }, 'ask', granting('lp.withdraw'));
    expect(receipt.status).toBe('error');
    expect(receipt.error).toMatch(/percent to withdraw, from 1 to 100/);
    expect(umbrae.seen).toEqual([]);
  });

  test('approved lp/swap and lp/send answer with the run\'s own reason', async () => {
    const [send] = await viaIntent(connection(), 'lp/send', { to: '0x2222222222222222222222222222222222222222', amount: '0.01' }, 'ask', granting('lp.send'));
    expect(send.status).toBe('error');
    expect(send.error).toMatch(/^lp\/send did not complete: That is not a wallet of the house/);
    const [swap] = await viaIntent(connection(), 'lp/swap', { tokenIn: 'USDC', tokenOut: 'SCAM', amount: '1' }, 'ask', granting('lp.swap'));
    expect(swap.error).toMatch(/^lp\/swap did not complete: Swaps are between tokens Umbrae's pools trade/);
    const [bad] = await viaIntent(connection(), 'lp/swap', { tokenIn: 'USDC' });
    expect(bad.error).toMatch(/needs \{tokenIn, tokenOut, amount\}/);
    expect(sends()).toEqual([]);
  }, 60000);

  test('a witness seat and a house member with no LP wallet are refused before anything runs', async () => {
    const [witness] = await viaIntent(connection(NEUMA_ID, { participantKind: 'witness' }), 'lp/close', { pool: POOL, tokenId: '42' });
    expect(witness.status).not.toBe('ok');
    expect(witness.error).toMatch(/Witness seats hold no LP wallet/);
    const [bare] = await viaIntent(connection(BARE_ID), 'lp/close', { pool: POOL, tokenId: '42' });
    expect(bare.error).toMatch(/no LP wallet yet/);
    expect(umbrae.seen).toEqual([]);
  });

  test('the intents are offered only to a house member with an LP wallet, while the connection is on', async () => {
    const open = intentType('lp/open');
    expect(await open.availableFor({ laneId: NEUMA_ID, connection: connection() })).toEqual({});
    expect(await open.availableFor({ laneId: BARE_ID, connection: connection(BARE_ID) })).toBeNull();
    expect(await open.availableFor({ laneId: NEUMA_ID, connection: connection(NEUMA_ID, { participantKind: 'witness' }) })).toBeNull();
    connections.restore();
    connections = connectionsOn([]);
    expect(await open.availableFor({ laneId: NEUMA_ID, connection: connection() })).toBeNull();
  });
});

describe('the house member\'s read of its LP wallet', () => {
  test('address, balance, budget, positions and what waits, in plain lines', async () => {
    await writeLpBudget(NEUMA_ID, 25);
    umbrae.state.positions = [{ lbPairAddress: POOL, positions: { userPositions: [{ publicKey: '42', positionData: { lowerBinId: 1, upperBinId: 9, totalXAmount: '0.001', totalYAmount: '2', feeX: '0', feeY: '0.01' } }], activeBin: { binId: 5 } }, poolInfo: { name: 'WETH-USDC', tokenXPriceUsd: 3200, tokenYPriceUsd: 1 } }];
    // A contract at USDC's address that answers 6 to every call: balanceOf 6, decimals 6.
    await provider.send('anvil_setCode', [USDC, '0x600660005260206000f3']);
    const view = await readLpView(NEUMA_ID);
    expect(view).toMatchObject({ address: wallet, balanceEth: expect.stringMatching(/^0\.9/), budgetUsd: 25, connectionOn: true });
    const text = lpViewLines(view).join('\n');
    expect(text).toContain(`Address: ${wallet}`);
    expect(text).toContain('Tokens: 0.000006 USDC');
    expect(text).toContain(`    WETH-USDC ${POOL} step 25, $1234.50, 18.2%`);
    expect(text).toContain('Budget: a $25 cap on positions at once; a deposit past it waits for your operator');
    expect(text).toContain("swap at the best of Umbrae's router and KyberSwap (lp/swap); send inside the house (lp/send); open a NEW pool Umbrae lacks");
    expect(text).toContain('House wallets you can send to: none read'); // this test's lane has no owner on record
    expect(text).toContain(`#42 in WETH-USDC (${POOL}): 0.001 WETH + 2 USDC, fees waiting 0 WETH + 0.01 USDC, bins 1..9, pool now at bin 5`);
    expect(text).toMatch(/Deposits waiting for your operator: \n {4}[0-9a-f-]{36}: open in /);
    expect(text).not.toMatch(/privateKey|0x[0-9a-f]{64}/);
  }, 30000);

  test('with the connection off, positions are not read and the line says why; no LP wallet, no lines', async () => {
    connections.restore();
    connections = connectionsOn([]);
    const text = lpViewLines(await readLpView(NEUMA_ID)).join('\n');
    expect(text).toContain('Positions: not read: the Umbrae liquidity connection is off');
    expect(text).toContain('turns it on in Connections');
    expect(umbrae.seen).toEqual([]);
    expect(lpViewLines(await readLpView(BARE_ID))).toEqual([]);
  });
});
