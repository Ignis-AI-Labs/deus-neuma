import fs from 'node:fs/promises';
import http from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import fetch from 'node-fetch';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, POOL, USDC } from '../helpers/umbrae-stand-in.js';
import { installLpManager, installLpPool } from '../helpers/lp-chain-kit.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { runSend } from '../../backend/services/umbrae-lp/lp-trade.js';
import { runLpAction } from '../../backend/services/umbrae-lp/lp-run.js';
import { writeLpCapitalControls } from '../../backend/services/umbrae-lp/lp-capital-controls.js';
import { clearMarketCache } from '../../backend/services/market-map/market-data.js';

const LANE = 'capital-a';
const OTHER = 'capital-b';
let anvil; let provider; let root; let originalRoot; let umbrae; let connections; let lp;
let priorPrivate;
const options = () => ({ provider, receiptProvider: provider, receiptConfirmations: 1, pollMs: 50 });
const nonce = async () => Number(await provider.send('eth_getTransactionCount', [lp, 'latest']));
const send = (amount = '1') => runSend(LANE, { to: OTHER, token: 'USDC', amount }, options());
const controls = (patch) => writeLpCapitalControls(LANE, patch);

const startRelay = async (chainId = 8453) => {
  let broadcasts = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const rpc = JSON.parse(raw);
    if (rpc.method === 'eth_chainId') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: ethers.toQuantity(chainId) }));
      return;
    }
    if (rpc.method === 'eth_sendRawTransaction') broadcasts += 1;
    const upstream = await fetch(anvil.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    res.writeHead(200, { 'content-type': 'application/json' }).end(await upstream.text());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    broadcasts: () => broadcasts,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

const reserveInChild = ({ lane, day, amount, cap }) => new Promise((resolve, reject) => {
  const childFile = new URL('../helpers/lp-notional-child.mjs', import.meta.url).pathname;
  let output = ''; let errors = '';
  const child = spawn(process.execPath, [childFile], {
    env: {
      ...process.env,
      DNA_ENCRYPTION_KEY: 'test-encryption-key-32-characters!',
      NOTIONAL_WORKSPACE_ROOT: root,
      NOTIONAL_LANE: lane,
      NOTIONAL_DAY: day,
      NOTIONAL_AMOUNT: String(amount),
      NOTIONAL_CAP: String(cap),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
});

beforeAll(async () => {
  priorPrivate = process.env.NEUMA_BASE_PRIVATE_RPC_URL;
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
  root = await createTempDir('lp-capital-controls');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  const owner = ethers.Wallet.createRandom().address;
  for (const lane of [LANE, OTHER]) {
    await workspace.create(lane);
    await claimOwner(root, lane, owner);
    await workspace.writeEncryptedKeypair(lane, { address: ethers.Wallet.createRandom().address });
  }
  lp = (await openLpWallet(LANE)).address;
  await openLpWallet(OTHER);
  await provider.send('anvil_setBalance', [lp, ethers.toQuantity(ethers.parseEther('1'))]);
  await provider.send('anvil_setCode', [USDC, '0x600660005260206000f3']);
  await installLpManager(provider, UMBRAE_BASE.positionManager);
  await installLpPool(provider, POOL);
  umbrae = await startUmbraeStandIn({ provider });
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  provider?.destroy();
  await anvil?.stop();
  if (priorPrivate === undefined) delete process.env.NEUMA_BASE_PRIVATE_RPC_URL;
  else process.env.NEUMA_BASE_PRIVATE_RPC_URL = priorPrivate;
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  umbrae.reset();
  clearMarketCache();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity', 'market-data']);
  delete process.env.NEUMA_BASE_PRIVATE_RPC_URL;
  await controls({ maxActionUsd: 25_000, dailyNotionalUsd: 50_000, privateBroadcastRequired: false, paused: false });
  const config = `${workspace._path(LANE)}/config`;
  await fs.rm(`${config}/lp-notional`, { recursive: true, force: true });
  await fs.rm(`${config}/lp-executions`, { recursive: true, force: true });
});

test('independently priced sends execute under the default caps', async () => {
  const out = await send('1');
  expect(out.ok, JSON.stringify(out)).toBe(true);
  expect(out.txHashes).toHaveLength(1);
});

test('one manipulated price source refuses before anything is signed', async () => {
  umbrae.state.dexPriceUsd = 1.05;
  const before = await nonce();
  const out = await send('1');
  expect(out.ok).toBe(false);
  expect(out.reason).toMatch(/prices are unavailable or disagree/);
  expect(await nonce()).toBe(before);
});

test('the per-action cap refuses without signing or consuming the daily allowance', async () => {
  await controls({ maxActionUsd: 2, dailyNotionalUsd: 5 });
  const before = await nonce();
  expect((await send('2.01')).reason).toMatch(/per-action capital limit/);
  expect(await nonce()).toBe(before);
  expect((await send('2')).ok).toBe(true);
});

test('raising the capital limits requires private broadcast', async () => {
  await expect(controls({ maxActionUsd: 1_000_000, privateBroadcastRequired: false })).rejects.toThrow(/requires private broadcast/);
  await expect(controls({ dailyNotionalUsd: 1_000_000, privateBroadcastRequired: false })).rejects.toThrow(/requires private broadcast/);
  const accepted = await controls({ maxActionUsd: 1_000_000, dailyNotionalUsd: 1_000_000, privateBroadcastRequired: true });
  expect(accepted).toMatchObject({ maxActionUsd: 1_000_000, dailyNotionalUsd: 1_000_000, privateBroadcastRequired: true });
});

test('daily notional survives the first confirmed action and stops the next over-cap action', async () => {
  await controls({ maxActionUsd: 10, dailyNotionalUsd: 5 });
  expect((await send('3')).ok).toBe(true);
  const before = await nonce();
  expect((await send('3')).reason).toMatch(/daily capital-movement limit/);
  expect(await nonce()).toBe(before);
});

test('concurrent processes cannot oversubscribe the daily cap and a restarted process inherits it', async () => {
  const day = '2026-11-15';
  const lane = 'notional-race';
  const results = await Promise.all([
    reserveInChild({ lane, day, amount: 60_000_000, cap: 100_000_000 }),
    reserveInChild({ lane, day, amount: 60_000_000, cap: 100_000_000 }),
  ]);
  expect(results.filter((result) => result.reserved !== null)).toHaveLength(1);
  expect(results.filter((result) => result.reserved === null)).toHaveLength(1);
  const remainingFits = await reserveInChild({ lane, day, amount: 1, cap: 100_000_000 });
  expect(remainingFits.reserved).not.toBeNull();
  const afterRestart = await reserveInChild({ lane, day, amount: 50_000_000, cap: 100_000_000 });
  expect(afterRestart.reserved).toBeNull();
});

test('a higher accepted ticket still counts after a later over-cap ticket is refused', async () => {
  const day = '2026-11-16';
  const lane = 'notional-high-ticket';
  expect((await reserveInChild({ lane, day, amount: 20_000_000, cap: 100_000_000 })).reserved).toBe(0);
  expect((await reserveInChild({ lane, day, amount: 90_000_000, cap: 100_000_000 })).reserved).toBeNull();
  expect((await reserveInChild({ lane, day, amount: 70_000_000, cap: 100_000_000 })).reserved).toBe(1);
  expect((await reserveInChild({ lane, day, amount: 10_000_001, cap: 100_000_000 })).reserved).toBeNull();
});

test('pause blocks a new deposit and send but a claim still executes', async () => {
  await controls({ paused: true });
  expect((await send('1')).reason).toMatch(/paused by the operator/);
  const deposit = await runLpAction(LANE, { type: 'open', pool: POOL, amountY: '1' }, options());
  expect(deposit.reason).toMatch(/paused by the operator/);
  const claim = await runLpAction(LANE, { type: 'claim', pool: POOL, tokenId: '42' }, options());
  expect(claim.ok, JSON.stringify(claim)).toBe(true);
});

test('missing private relay aborts without a stuck execution and an honest relay sends', async () => {
  await controls({ privateBroadcastRequired: true });
  const before = await nonce();
  const refused = await send('1');
  expect(refused.ok).toBe(false);
  expect(refused.uncertain).not.toBe(true);
  expect(await nonce()).toBe(before);

  const relay = await startRelay();
  try {
    process.env.NEUMA_BASE_PRIVATE_RPC_URL = relay.url;
    const out = await send('1');
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(relay.broadcasts()).toBe(1);
    expect(await nonce()).toBe(before + 1);
  } finally {
    await relay.close();
  }
});

test('a wrong-chain private relay is refused before any broadcast', async () => {
  await controls({ privateBroadcastRequired: true });
  const relay = await startRelay(1);
  try {
    process.env.NEUMA_BASE_PRIVATE_RPC_URL = relay.url;
    const before = await nonce();
    const out = await send('1');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not on Base/);
    expect(relay.broadcasts()).toBe(0);
    expect(await nonce()).toBe(before);
  } finally {
    await relay.close();
  }
});

test('an offline private relay never falls back to public broadcast', async () => {
  const relay = await startRelay();
  const url = relay.url;
  await relay.close();
  await controls({ privateBroadcastRequired: true });
  process.env.NEUMA_BASE_PRIVATE_RPC_URL = url;
  const before = await nonce();
  const out = await send('1');
  expect(out.ok).toBe(false);
  expect(out.uncertain).not.toBe(true);
  expect(await nonce()).toBe(before);
});
