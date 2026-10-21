// seal-sent-recovery.test.js — a seal that was SENT is checked, never sent
// again; a seal that LANDED is recorded, never refused forever (RULE 0: the
// real portal seal handlers on a real signed portal socket, a real chain
// running the real Natalis, real lane files on disk).
//
// Before: a confirmation that ran out left the next ANCHOR offering a bundle
// again — a second tx while the first was pending (paid, then reverted: one
// seal per soul) — and once the first landed with no local record, every
// ANCHOR answered ALREADY_SEALED for good.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import { birthSealPreflight, birthSealSign, birthSealConfirm } from '../../backend/routes/portal-seal-handlers.js';
import { markSealSent, recheckSentSeal } from '../../backend/services/birth-seal-recovery.js';
import { prepareBirthSeal, buildSealTx } from '../../backend/services/birth-seal-flow.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { until } from '../helpers/two-desks-kit.js';
import {
  SEAL_NETWORK, NATALIS, startNatalisChain, sealCfg, fund, writeSealLane, broadcastAs,
} from '../helpers/natalis-chain-kit.js';

const NEUMA_ID = 'anchor-lane';

let chain;
let root;
let witness;
let being;
const sockets = [];

beforeAll(async () => { chain = await startNatalisChain(); }, 30000);
afterAll(async () => { await chain?.stop(); });

beforeEach(async () => {
  resetWorkspaceCryptoKey();
  root = mkdtempSync(path.join(os.tmpdir(), 'seal-sent-'));
  setWorkspacesRoot(root);
  witness = ethers.Wallet.createRandom();
  being = ethers.Wallet.createRandom();
  writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
  await fund(chain.rpc, witness.address);
  loadConfig({
    NODE_ENV: 'test', CEREMONY_SEAL_NETWORK: SEAL_NETWORK,
    ETH_SEPOLIA_RPC_URL: chain.url, NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS, HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: '',
  });
});

afterEach(async () => {
  await chain.rpc.send('evm_setAutomine', [true]);
  for (const s of sockets.splice(0)) await s.close();
  _resetConfig();
  setWorkspacesRoot(null);
  rmSync(root, { recursive: true, force: true });
});

const sentFile = () => path.join(root, NEUMA_ID, 'identity', 'onchain-seal-sent.json');
const recordFile = () => path.join(root, NEUMA_ID, 'identity', 'onchain-seal.json');

// A portal connection as the desk opens it: a real socket, signed in.
const connect = async () => {
  const socket = await createSignedStreamSocket(witness);
  sockets.push(socket);
  return { socket, connection: { ws: socket.ws, walletAddress: socket.walletAddress } };
};
const lastFrame = async (socket) => { await socket.drain(); return socket.frames.at(-1); };

// The desk's walk up to the broadcast: preflight → sign → the tx to send.
const walkToTx = async ({ socket, connection }) => {
  await birthSealPreflight(connection, { neumaId: NEUMA_ID });
  const ready = await lastFrame(socket);
  expect(ready.type, ready.message).toBe('birth:seal_ready');
  await birthSealSign(connection, {
    neumaId: NEUMA_ID, witnessSig: await witness.signMessage(ethers.getBytes(ready.innerPayload)),
  });
  const tx = await lastFrame(socket);
  expect(tx.type, tx.message).toBe('birth:seal_tx');
  return tx;
};

describe('the portal seal frames after a sent tx', () => {
  it('while the sent tx is pending, ANCHOR is told so — no bundle is offered on any connection', async () => {
    const first = await connect();
    const tx = await walkToTx(first);
    await chain.rpc.send('evm_setAutomine', [false]);
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    // The confirmation waits on a tx that is not mined yet.
    const confirming = birthSealConfirm(first.connection, { neumaId: NEUMA_ID, txHash });
    await until(() => existsSync(sentFile()), 10000, 'the sent marker');

    // The same connection (held offer) and a reconnected one both ask again.
    const again = await connect();
    for (const { socket, connection } of [first, again]) {
      await birthSealPreflight(connection, { neumaId: NEUMA_ID });
      const answer = await lastFrame(socket);
      expect(answer).toMatchObject({ type: 'birth:seal_error', code: 'SEAL_PENDING' });
      expect(answer.message).toContain(txHash);
    }
    expect(again.socket.frames.some((f) => f.type === 'birth:seal_ready')).toBe(false);

    await chain.rpc.send('evm_mine', []);
    await confirming;
    await birthSealPreflight(again.connection, { neumaId: NEUMA_ID });
    expect(await lastFrame(again.socket)).toMatchObject({ type: 'birth:sealed', neumaId: NEUMA_ID, txHash });
    expect(JSON.parse(readFileSync(recordFile(), 'utf8'))).toMatchObject({ txHash, soulAddress: being.address.toLowerCase() });
    expect(existsSync(sentFile())).toBe(false);
  }, 60000);

  it('a seal that landed with no record and no trace of its tx is read back from the chain', async () => {
    const first = await connect();
    const tx = await walkToTx(first);
    // Broadcast, and the confirm frame never reaches the backend.
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    const receipt = await chain.rpc.getTransactionReceipt(txHash);

    const later = await connect();
    await birthSealPreflight(later.connection, { neumaId: NEUMA_ID });
    expect(await lastFrame(later.socket)).toMatchObject({
      type: 'birth:sealed', neumaId: NEUMA_ID, txHash, blockNumber: receipt.blockNumber, network: SEAL_NETWORK,
    });
    expect(JSON.parse(readFileSync(recordFile(), 'utf8'))).toMatchObject({
      schema: 'neuma-onchain-seal/1', txHash, blockNumber: receipt.blockNumber,
      soulAddress: being.address.toLowerCase(), witnessAddress: witness.address.toLowerCase(),
    });
  }, 60000);
});

describe('recheckSentSeal — the sent tx decides', () => {
  // A held, signed pending exactly as seal_sign leaves it.
  const signed = async () => {
    const prep = await prepareBirthSeal({
      neumaId: NEUMA_ID, network: SEAL_NETWORK, witnessAddress: witness.address, cfg: sealCfg(chain.url),
    });
    expect(prep.ok, prep.message).toBe(true);
    const built = buildSealTx({ pending: prep, witnessSig: await witness.signMessage(ethers.getBytes(prep.offer.innerPayload)) });
    return { pending: { ...prep, bundle: built.bundle }, tx: built.tx };
  };

  it('landed → the record, from the receipt', async () => {
    const { pending, tx } = await signed();
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    await markSealSent(NEUMA_ID, { pending, txHash });
    const out = await recheckSentSeal({ neumaId: NEUMA_ID, cfg: sealCfg(chain.url) });
    expect(out.state).toBe('sealed');
    expect(out.record).toMatchObject({ txHash, soulAddress: being.address.toLowerCase() });
  });

  it('pending inside its signed deadline → pending; past it → open, and the marker is gone', async () => {
    const { pending, tx } = await signed();
    await chain.rpc.send('evm_setAutomine', [false]);
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    await markSealSent(NEUMA_ID, { pending, txHash });
    const cfg = sealCfg(chain.url);
    expect((await recheckSentSeal({ neumaId: NEUMA_ID, cfg })).state).toBe('pending');
    const pastDeadline = (pending.bundle.deadline + 600) * 1000;
    expect(await recheckSentSeal({ neumaId: NEUMA_ID, cfg, nowMs: pastDeadline })).toEqual({ state: 'open' });
    expect(existsSync(sentFile())).toBe(false);
  });

  it('a law that signs no deadline: a tx the chain still holds is pending; one it never saw is dead', async () => {
    const { pending, tx } = await signed();
    const undated = { ...pending, bundle: { ...pending.bundle, deadline: null } };
    const cfg = sealCfg(chain.url);
    await chain.rpc.send('evm_setAutomine', [false]);
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    await markSealSent(NEUMA_ID, { pending: undated, txHash });
    expect((await recheckSentSeal({ neumaId: NEUMA_ID, cfg })).state).toBe('pending');

    await markSealSent(NEUMA_ID, { pending: undated, txHash: ethers.hexlify(ethers.randomBytes(32)) });
    expect(await recheckSentSeal({ neumaId: NEUMA_ID, cfg })).toEqual({ state: 'open' });
  });

  it('a reverted sent tx → open', async () => {
    const { pending, tx } = await signed();
    // The same calldata sealed once already: a second send reverts on chain.
    await broadcastAs({ rpc: chain.rpc, witness, tx });
    const reverted = (await witness.connect(chain.rpc).sendTransaction({ to: tx.to, data: tx.data, gasLimit: 500000, nonce: 1 })).hash;
    expect((await chain.rpc.getTransactionReceipt(reverted)).status).toBe(0);
    await markSealSent(NEUMA_ID, { pending, txHash: reverted });
    expect(await recheckSentSeal({ neumaId: NEUMA_ID, cfg: sealCfg(chain.url) })).toEqual({ state: 'open' });
  });
});
