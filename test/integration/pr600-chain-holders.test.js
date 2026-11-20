import { createServer } from 'node:http';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { ethers } from 'ethers';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { tokenHolders } from '../../backend/services/chain/evm-rpc.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { GLOBAL_DEFAULTS, checkToolAccess, resolvePolicy } from '../../backend/services/tool-policy.js';

const TOKEN = ethers.getAddress('0x1000000000000000000000000000000000000000');
const HOLDER = ethers.getAddress('0x2000000000000000000000000000000000000000');
const ZERO = '0x0000000000000000000000000000000000000000';
const TOPIC = ethers.id('Transfer(address,address,uint256)');
const pad = (address) => ethers.zeroPadValue(address, 32);
let server; let url; let getLogs; let delayMs; let priorRpc;

const startRpc = async () => {
  getLogs = [];
  delayMs = 0;
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const items = Array.isArray(body) ? body : [body];
      const answers = items.map((item) => {
        if (item.method === 'eth_chainId') return { jsonrpc: '2.0', id: item.id, result: '0x1' };
        if (item.method === 'net_version') return { jsonrpc: '2.0', id: item.id, result: '1' };
        if (item.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: item.id, result: '0x5000' };
        if (item.method === 'eth_getLogs') {
          const filter = item.params[0];
          getLogs.push(filter);
          const logs = Number(filter.toBlock) >= 20479 && Number(filter.fromBlock) <= 20479 ? [{
            address: TOKEN, blockNumber: '0x4fff', blockHash: `0x${'2'.repeat(64)}`, transactionHash: `0x${'1'.repeat(64)}`, transactionIndex: '0x0', logIndex: '0x0', removed: false,
            topics: [TOPIC, pad(ZERO), pad(HOLDER)], data: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [100n]),
          }] : [];
          return { jsonrpc: '2.0', id: item.id, result: logs };
        }
        return { jsonrpc: '2.0', id: item.id, result: null };
      });
      if (delayMs) await new Promise((resolve) => { setTimeout(resolve, delayMs); });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(body) ? answers : answers[0]));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
};

beforeEach(async () => {
  priorRpc = process.env.ETH_RPC_URL;
  await startRpc();
  process.env.ETH_RPC_URL = url;
  resetChainProviders();
});

afterEach(async () => {
  resetChainProviders();
  if (priorRpc === undefined) delete process.env.ETH_RPC_URL; else process.env.ETH_RPC_URL = priorRpc;
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('P6-130 — bounded, cancellable holder reconstruction', () => {
  test('the default is one recent 2000-block window with real transfer accounting', async () => {
    const result = await tokenHolders('ethereum', TOKEN);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.fromBlock).toBe(18481);
    expect(result.toBlock).toBe(20480);
    expect(result.requests).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.holders[HOLDER]).toBe('100');
    expect(getLogs).toHaveLength(1);
  });

  test('an old range stops at eight actual log requests with an exact continuation', async () => {
    const result = await tokenHolders('ethereum', TOKEN, { fromBlock: 0 });
    expect(result.ok).toBe(true);
    expect(result.requests).toBe(8);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('request-cap');
    expect(result.nextFromBlock).toBe(16000);
    expect(getLogs).toHaveLength(8);
    const continued = await tokenHolders('ethereum', TOKEN, { fromBlock: result.nextFromBlock });
    expect(continued.ok, JSON.stringify(continued)).toBe(true);
    expect(continued.requests).toBe(3);
    expect(continued.truncated).toBe(false);
    expect(continued.holders[HOLDER]).toBe('100');
  });

  test('abort during a real delayed RPC response stops the walk with no later request', async () => {
    delayMs = 75;
    const controller = new globalThis.AbortController();
    const pending = tokenHolders('ethereum', TOKEN, { fromBlock: 0, signal: controller.signal });
    while (getLogs.length === 0) await new Promise((resolve) => { setTimeout(resolve, 5); });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('CHAIN_ABORTED');
    expect(getLogs).toHaveLength(1);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(getLogs).toHaveLength(1);
  });

  test('the real policy resolver requires an operator card for chain_holders', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS);
    expect(checkToolAccess(policy, 'chain', 'chain_holders')).toBe('approval_required');
    expect(checkToolAccess(policy, 'chain', 'chain_logs')).toBe('allowed');
  });
});
