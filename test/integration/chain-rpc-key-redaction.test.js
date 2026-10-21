// chain-rpc-key-redaction.test.js — a keyed RPC URL never reaches a log line
// (RULE 0: a real HTTP endpoint on loopback that answers like a hosted RPC
// whose app was switched off — HTTP 403 — reached through real ethers; the
// real chain reader; the real portal founding handler on a real signed
// socket; the real logger's failures ring, which the SUBSTRATE window shows).
//
// A hosted RPC URL carries the operator's key in its path, and an ethers
// SERVER_ERROR message embeds the whole request URL. The reader's identity
// probe, its contract reads and the founding preflight each logged that
// message as it came.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { ethers } from 'ethers';

import { createChainReader } from '../../backend/services/chain-reader.js';
import { houseFoundPreflight } from '../../backend/routes/portal-seal-handlers.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { getRecentIssues } from '../../backend/services/logger.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { createTempDir } from '../helpers/temp-fs.js';

const KEY = 'r2KeyInThePath0000000000000000';
const ETH_SEPOLIA = '0xaa36a7';
const NATALIS = '0x' + '5e'.repeat(20);
const REGISTRY = '0x' + '7a'.repeat(20);
const NATALIS_CODE = JSON.parse(readFileSync(
  new URL('../../docs/contracts/abis/Natalis.json', import.meta.url), 'utf8',
)).deployedBytecode.object;
const INACTIVE = { code: -32600, message: 'App is inactive.' };

// Answers the identity probe like the real chain, then refuses every other
// call the way an inactive hosted app does. impure — a listening socket.
const startKeyedRpc = async () => {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const calls = Array.isArray(body) ? body : [body];
      const known = { eth_chainId: ETH_SEPOLIA, eth_getCode: NATALIS_CODE };
      if (!calls.every(({ method }) => method in known)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(calls.map(({ id }) => ({ jsonrpc: '2.0', id, error: INACTIVE }))));
        return;
      }
      const answers = calls.map(({ id, method }) => ({ jsonrpc: '2.0', id, result: known[method] }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(body) ? answers : answers[0]));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}/v2/${KEY}`, close: () => new Promise((r) => server.close(r)) };
};

// A 403 to every request, the identity probe included.
const startDeadRpc = async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: INACTIVE }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}/v2/${KEY}`, close: () => new Promise((r) => server.close(r)) };
};

// The failures ring is bounded, so entries are told apart by identity, not count.
const seen = () => new Set(getRecentIssues(100));
const ringSince = (before) => JSON.stringify(getRecentIssues(100).filter((entry) => !before.has(entry)));

describe('a keyed RPC URL never reaches the logs', () => {
  let keyed, dead, savedRoot;
  beforeAll(async () => {
    keyed = await startKeyedRpc();
    dead = await startDeadRpc();
    savedRoot = getWorkspacesRoot();
  });
  afterAll(async () => {
    await keyed?.close(); await dead?.close();
    setWorkspacesRoot(savedRoot);
    _resetConfig();
  });

  test('the reader\'s identity probe logs the failure, never the URL', async () => {
    const before = seen();
    const reader = await createChainReader({ rpcUrl: dead.url, natalisAddress: NATALIS, identityProbeTimeoutMs: 5000 });
    expect(reader.identity.natalis).toBe('rpc-error');
    const ring = ringSince(before);
    expect(ring).toContain('identity probe failed');
    expect(ring).toContain('403');
    expect(ring).not.toContain(KEY);
  });

  test('a contract read that fails after the identity holds logs the failure, never the URL', async () => {
    const reader = await createChainReader({ rpcUrl: keyed.url, natalisAddress: NATALIS, identityProbeTimeoutMs: 5000 });
    expect(reader.identity.natalis).toBe('match');
    const before = seen();
    expect(await reader.isNeuma(ethers.Wallet.createRandom().address)).toBeNull();
    const ring = ringSince(before);
    expect(ring).toContain('chain call failed');
    expect(ring).not.toContain(KEY);
  });

  test('a founding preflight the RPC refuses logs the error, never the URL', async () => {
    setWorkspacesRoot(path.join(await createTempDir('rpc-key-redaction'), 'lanes'));
    loadConfig({
      NODE_ENV: 'test', HOUSE_FOUND_NETWORK: 'ethereum-sepolia', ETH_SEPOLIA_RPC_URL: dead.url,
      NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS, HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: REGISTRY,
    });
    const socket = await createSignedStreamSocket(ethers.Wallet.createRandom());
    try {
      const before = seen();
      await houseFoundPreflight({ ws: socket.ws, walletAddress: socket.walletAddress }, { probe: true });
      await socket.drain();
      expect(socket.frames.at(-1)).toMatchObject({ type: 'house:found_error', code: 'PREFLIGHT' });
      const ring = ringSince(before);
      expect(ring).toContain('House founding preflight error');
      expect(ring).toContain('403');
      expect(ring).not.toContain(KEY);
    } finally {
      await socket.close();
    }
  });
});
