// The wallet's network layer (2026-07-11 network-switch slice):
//   1. networks.cjs — the selectable-chain registry + persisted selection.
//      Real fs against a temp dir; corrupt/unknown state must resolve to
//      MAINNET (a wallet never boots onto a testnet by accident).
//   2. tx chainId PINNING — every outgoing transaction binds the SELECTED
//      network's chain, so an RPC serving (or lying about) another chain
//      fails safe instead of obtaining a signature valid on its chain.
//      Proven against a REAL HTTP JSON-RPC stub (no mocks): the honest arm
//      broadcasts and the raw signed tx carries the pinned chainId; the
//      lying arm (RPC claims mainnet while the wallet targets Sepolia) is
//      REFUSED before any broadcast reaches the wire.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { NETWORKS, DEFAULT_NETWORK_KEY, createNetworkStore } = require('../../electron/wallet/networks.cjs');
const { createWalletService } = require('../../electron/wallet/wallet-service.cjs');
const { ethers } = require('ethers');

describe('networks.cjs — registry + persisted selection', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-net-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('defaults to Ethereum MAINNET on a fresh wallet dir (home since 2026-10-04)', () => {
    const store = createNetworkStore({ walletDir: dir });
    expect(store.get()).toBe(DEFAULT_NETWORK_KEY);
    expect(store.resolve()).toMatchObject({ chainId: 1, testnet: false });
  });

  it('set/get round-trips and resolve() carries the full network', () => {
    const store = createNetworkStore({ walletDir: dir });
    expect(store.set('base-sepolia')).toEqual({ ok: true, network: 'base-sepolia' });
    expect(store.get()).toBe('base-sepolia');
    expect(store.resolve()).toMatchObject({
      chainId: 84532, testnet: true, publicRpc: 'https://sepolia.base.org',
    });
  });

  it('unknown keys are refused; corrupt or hostile file content resolves to mainnet', () => {
    const store = createNetworkStore({ walletDir: dir });
    expect(store.set('dogechain').ok).toBe(false);
    fs.writeFileSync(path.join(dir, 'network.json'), 'not json at all {');
    expect(store.get()).toBe(DEFAULT_NETWORK_KEY);
    fs.writeFileSync(path.join(dir, 'network.json'), JSON.stringify({ network: 'evil-l2' }));
    expect(store.get()).toBe(DEFAULT_NETWORK_KEY);
  });

  it('the registry itself pins Ethereum (home) and Base (reachable), each with its testnet, and is frozen', () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(['base', 'base-sepolia', 'ethereum', 'ethereum-sepolia']);
    expect(NETWORKS['ethereum'].chainId).toBe(1);
    expect(NETWORKS['ethereum-sepolia'].chainId).toBe(11155111);
    expect(NETWORKS['base'].chainId).toBe(8453);
    expect(NETWORKS['base-sepolia'].chainId).toBe(84532);
    expect(Object.isFrozen(NETWORKS)).toBe(true);
  });
});

describe('sendTransaction pins the SELECTED chainId — real JSON-RPC stub, no mocks', () => {
  const PASSTHROUGH = { available: false };
  const CHEAP = { N: 1024, r: 8, p: 1, dkLen: 32 };
  const PW = 'a-strong-witness-passphrase';

  let dir; let server; let port;
  let claimedChainId;      // what the stub RPC claims to be
  let broadcasts;          // raw txs that actually reached the wire

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-pin-'));
    broadcasts = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const hex = (n) => '0x' + n.toString(16);
        // ethers v6 batches JSON-RPC calls — the stub must answer objects AND arrays.
        const answer = ({ id, method, params }) => {
          const result = (() => {
            switch (method) {
              case 'eth_chainId': return hex(claimedChainId);
              case 'eth_blockNumber': return '0x1';
              case 'eth_getTransactionCount': return '0x0';
              case 'eth_estimateGas': return '0x5208';
              case 'eth_gasPrice': return '0x3b9aca00';
              case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
              case 'eth_getBlockByNumber': return {
                number: '0x1', baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380',
                gasUsed: '0x0', difficulty: '0x0', nonce: '0x' + '00'.repeat(8),
                miner: '0x' + '00'.repeat(20), extraData: '0x',
                timestamp: '0x0', hash: '0x' + '11'.repeat(32), parentHash: '0x' + '22'.repeat(32),
                transactions: [],
              };
              case 'eth_sendRawTransaction':
                broadcasts.push(params[0]);
                return ethers.keccak256(params[0]);
              default: return null;
            }
          })();
          return { jsonrpc: '2.0', id, result };
        };
        const parsed = JSON.parse(body);
        const out = Array.isArray(parsed) ? parsed.map(answer) : answer(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeService = (pinnedChainId) => createWalletService({
    walletDir: dir,
    outerSeal: PASSTHROUGH,
    scryptParams: CHEAP,
    confirm: async () => true,
    getRpcProvider: async () => new ethers.JsonRpcProvider(
      `http://127.0.0.1:${port}`, undefined, { staticNetwork: false },
    ),
    getChainId: () => pinnedChainId,
  });

  it('honest RPC: the raw signed tx carries the PINNED chainId (Sepolia)', async () => {
    claimedChainId = 84532; // stub agrees with the selected network
    const svc = makeService(84532);
    svc.create(PW);
    const hash = await svc.sendTransaction({ to: '0x' + 'ab'.repeat(20), value: '0x1' });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(broadcasts.length).toBe(1);
    const parsed = ethers.Transaction.from(broadcasts[0]);
    expect(parsed.chainId).toBe(84532n);
  });

  it('lying RPC (claims mainnet while the wallet targets Sepolia): REFUSED, nothing broadcast', async () => {
    claimedChainId = 8453; // the stub pretends to be Base mainnet
    const svc = makeService(84532);
    svc.create(PW);
    await expect(
      svc.sendTransaction({ to: '0x' + 'ab'.repeat(20), value: '0x1' }),
    ).rejects.toThrow();
    expect(broadcasts.length).toBe(0); // the signature never reached the wire
  });

  it('legacy default (no getChainId): tx follows the provider chain — unchanged behavior', async () => {
    claimedChainId = 8453;
    const svc = createWalletService({
      walletDir: dir, outerSeal: PASSTHROUGH, scryptParams: CHEAP,
      confirm: async () => true,
      getRpcProvider: async () => new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`),
    });
    svc.create(PW);
    await svc.sendTransaction({ to: '0x' + 'ab'.repeat(20), value: '0x1' });
    expect(ethers.Transaction.from(broadcasts[0]).chainId).toBe(8453n);
  });
});
