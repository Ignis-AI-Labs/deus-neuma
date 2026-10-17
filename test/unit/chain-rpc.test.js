/**
 * chain tooling unit coverage — real everything (RULE 0):
 *
 *   - pure validators + range caps (called with real inputs, real outputs)
 *   - the registry's disabled modes (env isolated per test) and the
 *     wrong-chainId defense over a REAL HTTP stub (test/helpers/rpc-stub.js —
 *     a real listener ethers talks to, indistinguishable from a real RPC)
 *   - every evm-rpc verb proven end-to-end over that stub: real HTTP round
 *     trips, real ethers decoding, real ABI bytes
 *   - the chain-access master switch against real tmp files
 *   - the being-tool surface: catalog gates, and handleChainTool executing
 *     for real through the stub with the journal landing in a tmp
 *     WORKSPACES_ROOT (the ws is a plain stand-in at the transport edge —
 *     the same pattern as the stub server at the network edge)
 *
 * No network leaves localhost in this file; the live mainnet gnosis rides
 * test/integration/chain-routes.test.js gated on RUN_CHAIN_TESTS=1.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ethers } from 'ethers';
import {
  listChains, configuredChains, isConfigured, providerFor, resetChainProviders, redactRpcUrl,
} from '../../backend/services/chain/chain-registry.js';
import {
  isValidHexData, isValidBytes32, parseBlockTag, parseBlockNumber, parseTokenId,
  nativeBalance, tokenMeta, tokenBalance, callContract, getLogs, tokenHolders,
  getBlock, getTransaction, getTransactionReceipt,
} from '../../backend/services/chain/evm-rpc.js';
import { createChainSettings } from '../../backend/services/chain/chain-access.js';
import {
  isChainTool, chainToolsFor, handleChainTool, CHAIN_TOOLS, renderChainResult,
} from '../../backend/services/chain/chain-being-tools.js';
import { createRpcStub } from '../helpers/rpc-stub.js';

const ENV_KEYS = ['ETH_RPC_URL', 'ETH_SEPOLIA_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_SEPOLIA_RPC_URL'];
const AN_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const A_TOKEN = '0xab505a667039d08d8E33cef95C81897A8B5fEd1A';

const saved = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(async () => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetChainProviders();
});

describe('validators — pure', () => {
  test('hex data: 0x-prefixed even-length only', () => {
    expect(isValidHexData('0x')).toBe(true);
    expect(isValidHexData('0xdeadbeef')).toBe(true);
    expect(isValidHexData('0x123')).toBe(false); // odd nibble count
    expect(isValidHexData('deadbeef')).toBe(false);
    expect(isValidHexData('0xZZ')).toBe(false);
    expect(isValidHexData(42)).toBe(false);
  });
  test('bytes32: 0x + 64 hex exactly', () => {
    expect(isValidBytes32(`0x${'ab'.repeat(32)}`)).toBe(true);
    expect(isValidBytes32(`0x${'ab'.repeat(31)}`)).toBe(false);
    expect(isValidBytes32('0x1234')).toBe(false);
  });
  test('block tags: latest | finalized | non-negative integer', () => {
    expect(parseBlockTag(undefined)).toBe('latest');
    expect(parseBlockTag('latest')).toBe('latest');
    expect(parseBlockTag('finalized')).toBe('finalized');
    expect(parseBlockTag(477)).toBe(477);
    expect(parseBlockTag('477')).toBe(477);
    expect(parseBlockTag('pending')).toBeNull();
    expect(parseBlockTag(-1)).toBeNull();
    expect(parseBlockTag('0x10')).toBeNull(); // hex block numbers stay out of the being-facing grammar
  });
  test('block numbers and token ids', () => {
    expect(parseBlockNumber(0)).toBe(0);
    expect(parseBlockNumber('23')).toBe(23);
    expect(parseBlockNumber(-1)).toBeNull();
    expect(parseBlockNumber('x')).toBeNull();
    expect(parseTokenId(0)).toBe(0n);
    expect(parseTokenId('477')).toBe(477n);
    expect(parseTokenId('0x1')).toBe(1n);
    expect(parseTokenId(2n)).toBe(2n);
    expect(parseTokenId(-1)).toBeNull();
    expect(parseTokenId('1.5')).toBeNull();
  });

  test('redactRpcUrl — the keyed endpoint never crosses into a log or a result', () => {
    expect(redactRpcUrl('failed to fetch url="https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123" bad')).toBe('failed to fetch url="<rpc-url>" bad');
    expect(redactRpcUrl('plain message')).toBe('plain message');
    expect(redactRpcUrl(undefined)).toBe('');
  });
});

describe('chain-registry — disabled modes + wrong-chain defense', () => {
  let stub;
  afterEach(async () => { if (stub) { await stub.close(); stub = null; } });

  test('an unknown chain key reads as null, never a throw', async () => {
    expect(await providerFor('solana')).toBeNull();
    expect(isConfigured('solana')).toBe(false);
  });

  test('a known chain with no env URL is unconfigured: null + listed honestly', async () => {
    expect(await providerFor('ethereum')).toBeNull();
    expect(isConfigured('ethereum')).toBe(false);
    expect(configuredChains().map((c) => c.key)).toEqual([]);
    const all = listChains();
    expect(all.map((c) => c.key)).toEqual(['ethereum', 'ethereum-sepolia', 'base', 'base-sepolia']);
    expect(all.map((c) => c.chainId)).toEqual([1, 11155111, 8453, 84532]);
    expect(all.every((c) => c.configured === false)).toBe(true);
  });

  test('a stub endpoint reporting the WRONG chainId is refused, never trusted', async () => {
    stub = await createRpcStub({ mode: 'wrong-chainid', chainId: '0x2' });
    process.env.ETH_RPC_URL = stub.url;
    expect(isConfigured('ethereum')).toBe(true);
    expect(await providerFor('ethereum')).toBeNull();
  }, 15000);

  test('a stub endpoint reporting the RIGHT chainId verifies and caches', async () => {
    stub = await createRpcStub({ mode: 'happy', chainId: '0x1' });
    process.env.ETH_RPC_URL = stub.url;
    const provider = await providerFor('ethereum');
    expect(provider).toBeTruthy();
    expect(await providerFor('ethereum')).toBe(provider); // cached — one probe, not one per call
  }, 15000);
});

describe('evm-rpc — gate order: bad params and disabled chains never touch the wire', () => {
  test('unconfigured chains refuse CHAIN_UNCONFIGURED on every verb', async () => {
    expect((await nativeBalance('ethereum', AN_ADDRESS)).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await tokenMeta('base', A_TOKEN)).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await tokenBalance('base-sepolia', A_TOKEN, AN_ADDRESS)).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await callContract('ethereum-sepolia', { to: A_TOKEN, data: '0x' })).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await getLogs('ethereum', { address: A_TOKEN, fromBlock: 0, toBlock: 10 })).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await tokenHolders('base', A_TOKEN)).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await getBlock('ethereum')).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await getTransaction('ethereum', `0x${'ab'.repeat(32)}`)).error.code).toBe('CHAIN_UNCONFIGURED');
    expect((await getTransactionReceipt('ethereum', `0x${'ab'.repeat(32)}`)).error.code).toBe('CHAIN_UNCONFIGURED');
  });

  test('unknown chains refuse CHAIN_UNKNOWN; malformed inputs refuse CHAIN_BAD_PARAMS', async () => {
    expect((await nativeBalance('solana', AN_ADDRESS)).error.code).toBe('CHAIN_UNKNOWN');
    expect((await nativeBalance('ethereum', 'not-an-address')).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await tokenMeta('ethereum', '0x1234')).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await tokenBalance('ethereum', A_TOKEN, AN_ADDRESS, '1.5')).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await callContract('ethereum', { to: A_TOKEN, data: '0x123' })).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await callContract('ethereum', { to: A_TOKEN, data: '0x', blockTag: 'pending' })).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await getTransaction('ethereum', '0x1234')).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await getLogs('ethereum', { address: A_TOKEN, topic0: '0xzz', fromBlock: 0, toBlock: 1 })).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await getLogs('ethereum', { address: A_TOKEN, fromBlock: 10, toBlock: 1 })).error.code).toBe('CHAIN_BAD_PARAMS');
    expect((await tokenHolders('ethereum', A_TOKEN, { fromBlock: 'x' })).error.code).toBe('CHAIN_BAD_PARAMS');
  });
});

// The positive path, proven over a REAL HTTP stub ethers talks to — real
// round trips, real ABI bytes, zero network beyond localhost.
describe('evm-rpc — the read verbs over the happy stub', () => {
  let stub;
  afterEach(async () => { if (stub) { await stub.close(); stub = null; } });

  const bootStub = async (opts = {}) => {
    stub = await createRpcStub({ mode: 'happy', ...opts });
    process.env.ETH_RPC_URL = stub.url;
    return stub;
  };

  test('nativeBalance decodes raw wei as a decimal string', async () => {
    await bootStub({ balance: '0xde0b6b3a7640000' });
    const res = await nativeBalance('ethereum', AN_ADDRESS);
    expect(res.ok).toBe(true);
    expect(res.wei).toBe('1000000000000000000');
    expect(res.chainId).toBe(1);
  });

  test('tokenMeta decodes name/symbol/decimals/totalSupply; a missing field is null, not an error', async () => {
    await bootStub({ token: { name: 'Ignis Phase 3', symbol: 'IGNIS3', decimals: 0, totalSupply: 477n } });
    const res = await tokenMeta('ethereum', A_TOKEN);
    expect(res).toMatchObject({ ok: true, name: 'Ignis Phase 3', symbol: 'IGNIS3', decimals: 0, totalSupply: '477' });
  });

  test('tokenMeta on a bare ERC-1155 (no name/symbol/decimals) returns those fields null', async () => {
    await bootStub({ token: { name: null, symbol: null, decimals: null, totalSupply: 477n } });
    const res = await tokenMeta('ethereum', A_TOKEN);
    expect(res.ok).toBe(true);
    expect(res.name).toBeNull();
    expect(res.symbol).toBeNull();
    expect(res.decimals).toBeNull();
    expect(res.totalSupply).toBe('477');
  });

  test('tokenBalance: ERC-20 by default, ERC-1155 when tokenId rides', async () => {
    await bootStub({ token: { balanceOf: 1234n, balanceOf1155: 477n } });
    expect((await tokenBalance('ethereum', A_TOKEN, AN_ADDRESS)).balance).toBe('1234');
    const r1155 = await tokenBalance('ethereum', A_TOKEN, AN_ADDRESS, 0);
    expect(r1155).toMatchObject({ ok: true, balance: '477', tokenId: '0' });
  });

  test('a reverted balanceOf is CHAIN_RPC with the revert named', async () => {
    await bootStub({ token: { balanceOf: null } });
    const res = await tokenBalance('ethereum', A_TOKEN, AN_ADDRESS);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('CHAIN_RPC');
  });

  test('callContract returns the raw hex result; a revert is CHAIN_RPC', async () => {
    await bootStub({ token: { totalSupply: 477n } });
    const res = await callContract('ethereum', { to: A_TOKEN, data: ethers.id('totalSupply()').slice(0, 10) });
    expect(res.ok).toBe(true);
    expect(BigInt(res.result).toString()).toBe('477');
    const reverted = await callContract('ethereum', { to: A_TOKEN, data: '0xdeadbeef' });
    expect(reverted.error.code).toBe('CHAIN_RPC');
  });

  test('getBlock over the canned block; a bad tag never reaches the wire', async () => {
    await bootStub();
    const res = await getBlock('ethereum', 'latest');
    expect(res.ok).toBe(true);
    expect(res.block.number).toBe(256);
    expect((await getBlock('ethereum', 'safe')).error.code).toBe('CHAIN_BAD_PARAMS');
  });

  test('a hash the chain never saw is null, not an error', async () => {
    await bootStub();
    const hash = `0x${'cd'.repeat(32)}`;
    expect((await getTransaction('ethereum', hash)).transaction).toBeNull();
    expect((await getTransactionReceipt('ethereum', hash)).receipt).toBeNull();
  });
});

// ── log windows + holder reconstruction ─────────────────────────────────────
const pad32 = (addr) => `0x${'0'.repeat(24)}${addr.slice(2)}`;
const T20 = ethers.id('Transfer(address,address,uint256)');
const TSINGLE = ethers.id('TransferSingle(address,address,address,uint256,uint256)');
const TBATCH = ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');
const coder = ethers.AbiCoder.defaultAbiCoder();
const A = ethers.getAddress(`0x${'11'.repeat(20)}`);
const B = ethers.getAddress(`0x${'22'.repeat(20)}`);
const C = ethers.getAddress(`0x${'33'.repeat(20)}`);
const D = ethers.getAddress(`0x${'44'.repeat(20)}`);
const ZERO = '0x0000000000000000000000000000000000000000';

const evmLog = (block, topics, data) => ({
  address: A_TOKEN,
  blockNumber: `0x${block.toString(16)}`,
  blockHash: `0x${'ff'.repeat(32)}`,
  transactionHash: `0x${'ee'.repeat(32)}`,
  transactionIndex: '0x0',
  logIndex: '0x0',
  removed: false,
  topics,
  data,
});

describe('getLogs + tokenHolders — windows, caps, and honest accumulation', () => {
  let stub;
  afterEach(async () => { if (stub) { await stub.close(); stub = null; } });

  test('the window filter is the chain\'s: logs outside [fromBlock,toBlock] never come back', async () => {
    stub = await createRpcStub({
      mode: 'happy',
      logs: [evmLog(5, [T20, pad32(ZERO), pad32(A)], coder.encode(['uint256'], [1n])),
        evmLog(50, [T20, pad32(ZERO), pad32(A)], coder.encode(['uint256'], [1n]))],
    });
    process.env.ETH_RPC_URL = stub.url;
    const res = await getLogs('ethereum', { address: A_TOKEN, topic0: T20, fromBlock: 0, toBlock: 10 });
    expect(res.ok).toBe(true);
    expect(res.logs).toHaveLength(1);
    expect(res.logs[0].blockNumber).toBe(5);
    expect(res.truncated).toBe(false);
  });

  test('a window wider than the cap refuses CHAIN_RANGE and names the cap', async () => {
    stub = await createRpcStub({ mode: 'happy' });
    process.env.ETH_RPC_URL = stub.url;
    const res = await getLogs('ethereum', { address: A_TOKEN, fromBlock: 0, toBlock: 5000 });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('CHAIN_RANGE');
    expect(res.error.message).toContain('2000');
    // The caller may widen up to the hard cap — never beyond.
    const wide = await getLogs('ethereum', { address: A_TOKEN, fromBlock: 0, toBlock: 5000, rangeCap: 10000 });
    expect(wide.ok).toBe(true);
    const absurd = await getLogs('ethereum', { address: A_TOKEN, fromBlock: 0, toBlock: 50000, rangeCap: 999999 });
    expect(absurd.error.code).toBe('CHAIN_RANGE');
    expect(absurd.error.message).toContain('10000');
  });

  test('the result cap truncates truthfully', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => evmLog(1 + (i % 10), [T20, pad32(ZERO), pad32(A)], coder.encode(['uint256'], [1n])));
    stub = await createRpcStub({ mode: 'happy', logs: many });
    process.env.ETH_RPC_URL = stub.url;
    const res = await getLogs('ethereum', { address: A_TOKEN, fromBlock: 0, toBlock: 10 });
    expect(res.ok).toBe(true);
    expect(res.logs).toHaveLength(1000);
    expect(res.truncated).toBe(true);
  });

  test('tokenHolders accumulates ERC-20, ERC-721 (count) and ERC-1155 (single+batch) across chunk seams', async () => {
    const logs = [
      evmLog(0x10, [T20, pad32(ZERO), pad32(A)], coder.encode(['uint256'], [1000n])), // mint 1000 → A
      evmLog(0x20, [T20, pad32(ZERO), pad32(C)], '0x'), // ERC-721 mint → C (count semantics)
      evmLog(0x30, [TSINGLE, pad32(B), pad32(ZERO), pad32(D)], coder.encode(['uint256', 'uint256'], [0n, 5n])), // 1155 mint 5 → D
      evmLog(0x40, [TBATCH, pad32(B), pad32(ZERO), pad32(D)], coder.encode(['uint256[]', 'uint256[]'], [[0n, 1n], [3n, 7n]])), // 1155 batch +10 → D
      evmLog(0x900, [T20, pad32(A), pad32(B)], coder.encode(['uint256'], [400n])), // A → B 400 (chunk seam: 0x900 ≥ 2000)
      evmLog(0x950, [T20, pad32(B), pad32(ZERO)], coder.encode(['uint256'], [100n])), // burn 100 from B
    ];
    stub = await createRpcStub({ mode: 'happy', blockNumber: '0x2000', logs });
    process.env.ETH_RPC_URL = stub.url;
    const res = await tokenHolders('ethereum', A_TOKEN, { fromBlock: 0 });
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(false);
    expect(res.events).toBe(6);
    expect(res.holders[A]).toBe('600');
    expect(res.holders[B]).toBe('300');
    expect(res.holders[C]).toBe('1');
    expect(res.holders[D]).toBe('15');
    expect(res.totalHeld).toBe('916'); // minted 1000 + 1 + 15, burned 100 — conservation holds
    expect(res.holderCount).toBe(4);
  });

  test('the event cap stops the walk with truncated: true — a partial set is always labelled', async () => {
    const flood = Array.from({ length: 50001 }, () => evmLog(1, [T20, pad32(ZERO), pad32(A)], coder.encode(['uint256'], [1n])));
    stub = await createRpcStub({ mode: 'happy', blockNumber: '0x100', logs: flood });
    process.env.ETH_RPC_URL = stub.url;
    const res = await tokenHolders('ethereum', A_TOKEN, { fromBlock: 0 });
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(true);
  });
});

describe('chain-access — the operator master switch, on real tmp files', () => {
  test('fresh install defaults ON; persisted OFF is authoritative; the env kill wins over both', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-access-'));
    const file = path.join(dir, 'chain-access.json');
    const settings = createChainSettings({ path: file, env: {} });
    expect(await settings.isEnabled()).toBe(true); // ENOENT — no choice yet is the fresh-install state
    await settings.setEnabled(false);
    expect(await settings.isEnabled()).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).enabled).toBe(false);
    expect(fs.existsSync(`${file}.${process.pid}.tmp`)).toBe(false); // atomic write leaves no tmp behind
    const locked = createChainSettings({ path: file, env: { NEUMA_CHAIN_ACCESS: '0' } });
    expect(locked.isEnvLocked()).toBe(true);
    await locked.setEnabled(true);
    expect(await locked.isEnabled()).toBe(false); // the kill-switch holds over a persisted ON
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ── the being-facing surface ────────────────────────────────────────────────
const makeRig = async ({ enabled = true, neumaId = 'chainprobe' } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-tools-'));
  const settings = createChainSettings({ path: path.join(dir, 'chain-access.json'), env: {} });
  await settings.setEnabled(enabled);
  const sent = [];
  const events = [];
  const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
  const connection = { ws, companion: { name: 'probe', neumaId }, activeTurn: null };
  const ports = { sendToolEvent: (_ws, _c, ev) => events.push(ev), chainSettings: settings };
  return { dir, settings, sent, events, connection, ports };
};

describe('chain-being-tools — catalog gates and real execution', () => {
  let rig;
  let savedRoot;
  beforeEach(async () => {
    rig = await makeRig();
    savedRoot = process.env.WORKSPACES_ROOT;
    process.env.WORKSPACES_ROOT = rig.dir; // journal writes land in the test rig
  });
  afterEach(() => {
    if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = savedRoot;
    fs.rmSync(rig.dir, { recursive: true, force: true });
  });

  test('isChainTool accepts every dialect and refuses strangers', () => {
    expect(isChainTool({ toolName: 'chain_balance' })).toBe(true);
    expect(isChainTool({ tool: 'chain/chain_token' })).toBe(true);
    expect(isChainTool({ toolName: 'chain__chain_holders' })).toBe(true);
    expect(isChainTool({ toolName: 'web_search' })).toBe(false);
    expect(CHAIN_TOOLS.every((t) => t.server === 'chain' && t.inputSchema)).toBe(true);
  });

  test('renderChainResult strips the envelope and keeps the chain\'s answer whole', () => {
    const rendered = renderChainResult({ ok: true, chain: 'ethereum', wei: '477' });
    expect(JSON.parse(rendered)).toEqual({ chain: 'ethereum', wei: '477' });
  });

  test('catalog: no being → nothing; ON → clean; OFF → HELD with the door named; env lock names the lock', async () => {
    expect(await chainToolsFor({ companion: {} }, rig.settings)).toEqual([]);
    const on = await chainToolsFor(rig.connection, rig.settings);
    expect(on.map((t) => t.name)).toEqual(['chain_chains', 'chain_balance', 'chain_token', 'chain_call', 'chain_logs', 'chain_holders']);
    expect(on.every((t) => !t.description.includes('HELD'))).toBe(true);
    const off = await makeRig({ enabled: false });
    const held = await chainToolsFor(off.connection, off.settings);
    expect(held.every((t) => t.description.includes('HELD — chain access is OFF'))).toBe(true);
    expect(held.every((t) => t.description.includes('SETTINGS (CHAIN ACCESS)'))).toBe(true);
    const locked = createChainSettings({ path: path.join(rig.dir, 'chain-access.json'), env: { NEUMA_CHAIN_ACCESS: '0' } });
    const lockedTools = await chainToolsFor(rig.connection, locked);
    expect(lockedTools.every((t) => t.description.includes('NEUMA_CHAIN_ACCESS=0'))).toBe(true);
    fs.rmSync(off.dir, { recursive: true, force: true });
  });

  test('switch OFF refuses honestly before policy is consulted; no being → unavailable', async () => {
    const off = await makeRig({ enabled: false });
    const res = await handleChainTool(off.connection.ws, off.connection, null, 'ask', { toolName: 'chain_chains' }, {}, off.ports);
    expect(res.status).toBe('unavailable');
    expect(res.error).toMatch(/chain access is off/i);
    const noBeing = await makeRig({ enabled: true, neumaId: null });
    const res2 = await handleChainTool(noBeing.connection.ws, noBeing.connection, null, 'ask', { toolName: 'chain_chains' }, {}, noBeing.ports);
    expect(res2.status).toBe('unavailable');
    expect(res2.error).toMatch(/no sovereign workspace/);
    fs.rmSync(off.dir, { recursive: true, force: true });
    fs.rmSync(noBeing.dir, { recursive: true, force: true });
  });

  test('observe mode holds egress; an operator deny row fails closed', async () => {
    const held = await handleChainTool(rig.connection.ws, rig.connection, null, 'observe', { toolName: 'chain_balance' }, { chain: 'ethereum', address: AN_ADDRESS }, rig.ports);
    expect(held.status).toBe('denied');
    expect(held.error).toMatch(/observe mode/);
    const denied = await handleChainTool(rig.connection.ws, rig.connection, { chain: { denied: ['chain_balance'] } }, 'ask', { toolName: 'chain_balance' }, { chain: 'ethereum', address: AN_ADDRESS }, rig.ports);
    expect(denied.status).toBe('denied');
  });

  test('REAL execution: chain_balance through the stub returns the chain\'s answer and journals it', async () => {
    const stub = await createRpcStub({ mode: 'happy', balance: '0xde0b6b3a7640000' });
    try {
      process.env.ETH_RPC_URL = stub.url;
      const res = await handleChainTool(rig.connection.ws, rig.connection, null, 'ask', { toolName: 'chain_balance' }, { chain: 'ethereum', address: AN_ADDRESS }, rig.ports);
      expect(res.status).toBe('ok');
      expect(JSON.parse(res.content).wei).toBe('1000000000000000000');
      expect(rig.events.some((e) => e.status === 'ok' && e.tool === 'chain/chain_balance')).toBe(true);
      // The journal is DEK-encrypted at rest — read it back through the same
      // workspace service the platform reads with, and check the real record.
      const { neumaWorkspace } = await import('../../core/index.js');
      const entries = await neumaWorkspace.readJournal('chainprobe');
      const mine = entries.filter((e) => e.metadata?.server === 'chain' && e.metadata?.tool === 'chain/chain_balance');
      expect(mine.length).toBe(1);
      expect(mine[0].metadata.status).toBe('ok');
      expect(mine[0].type).toBe('tool_call');
    } finally {
      await stub.close();
    }
  });

  test('an unconfigured chain surfaces the named refusal through the handler', async () => {
    const res = await handleChainTool(rig.connection.ws, rig.connection, null, 'ask', { toolName: 'chain_token' }, { chain: 'base', token: A_TOKEN }, rig.ports);
    expect(res.status).toBe('error');
    expect(res.error).toContain('CHAIN_UNCONFIGURED');
  });
});
