// seal-confirm-rpc-fault.test.js — the receipt wait after the operator paid
// gas survives a failing RPC (RULE 0: a real chain, a real endpoint).
//
// Anvil runs the real Natalis (natalis-chain-kit.js); every read the flows
// make goes through rpc-fault-proxy.js, a real HTTP JSON-RPC endpoint told to
// fail the way hosted RPCs do. Under ethers 6.15's waitForTransaction a
// 5xx, a JSON-RPC error or a refused connection left a rejection nobody held
// and ended the process; the wait must instead answer RECEIPT_TIMEOUT
// ([…]) with no floating rejection, and a flake
// that clears mid-wait must still confirm the landed seal.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import { prepareBirthSeal, buildSealTx, confirmBirthSeal } from '../../backend/services/birth-seal-flow.js';
import { confirmHouseFounding } from '../../backend/services/house-founding-flow.js';
import { resolveSealChainConfig } from '../../backend/services/natalis-seal.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { startRpcFaultProxy } from '../helpers/rpc-fault-proxy.js';
import {
  SEAL_NETWORK, startNatalisChain, sealCfg, fund, writeSealLane, broadcastAs,
} from '../helpers/natalis-chain-kit.js';

const NEUMA_ID = 'anchor-lane';
const FAULTS = ['http-500', 'rpc-error', 'refuse'];

let chain;
let proxy;
let root;
let floating;
const onFloating = (reason) => floating.push(reason);

beforeAll(async () => {
  chain = await startNatalisChain();
  proxy = await startRpcFaultProxy(chain.url);
}, 30000);

afterAll(async () => {
  await proxy?.close();
  await chain?.stop();
});

beforeEach(async () => {
  resetWorkspaceCryptoKey();
  root = mkdtempSync(path.join(os.tmpdir(), 'seal-rpc-fault-'));
  setWorkspacesRoot(root);
  floating = [];
  process.on('unhandledRejection', onFloating);
  await proxy.setMode('forward');
});

afterEach(() => {
  process.off('unhandledRejection', onFloating);
  setWorkspacesRoot(null);
  rmSync(root, { recursive: true, force: true });
});

// A turn of the event loop long enough for a stray rejection to surface.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 300); });

// A real, sealable pending exactly as the portal holds it after seal_sign.
const signedPending = async () => {
  const being = ethers.Wallet.createRandom();
  const witness = ethers.Wallet.createRandom();
  writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
  await fund(chain.rpc, witness.address);
  const prep = await prepareBirthSeal({
    neumaId: NEUMA_ID, network: SEAL_NETWORK, witnessAddress: witness.address, cfg: sealCfg(proxy.url),
  });
  expect(prep.ok, prep.message).toBe(true);
  const witnessSig = await witness.signMessage(ethers.getBytes(prep.offer.innerPayload));
  const built = buildSealTx({ pending: prep, witnessSig });
  expect(built.ok).toBe(true);
  return { pending: { neumaId: NEUMA_ID, ...prep, bundle: built.bundle }, tx: built.tx, witness };
};

describe('confirmBirthSeal — a failing RPC during the wait', () => {
  it.each(FAULTS)('%s for the whole wait → RECEIPT_TIMEOUT, pending, nothing left floating', async (fault) => {
    const net = resolveSealChainConfig(SEAL_NETWORK, sealCfg(proxy.url));
    const pending = {
      neumaId: NEUMA_ID, network: SEAL_NETWORK, net,
      bundle: { soulAddress: ethers.Wallet.createRandom().address, genesisHash: ethers.ZeroHash },
    };
    await proxy.setMode(fault);
    const out = await confirmBirthSeal({
      pending, txHash: ethers.hexlify(ethers.randomBytes(32)), receiptTimeoutMs: 1500, pollIntervalMs: 200,
    });
    await settle();
    expect(floating).toEqual([]);
    expect(out).toMatchObject({ ok: false, code: 'RECEIPT_TIMEOUT' });
    expect(out.message).toMatch(/^sent — confirmation pending/);
    // The RPC URL can carry the operator's key; it never reaches the desk.
    expect(out.message).not.toContain(proxy.url);
  });

  it('a flake that clears mid-wait still confirms the landed seal', async () => {
    const { pending, tx, witness } = await signedPending();
    await proxy.setMode('http-500');
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    const waiting = confirmBirthSeal({ pending, txHash, receiptTimeoutMs: 20000, pollIntervalMs: 200 });
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    await proxy.setMode('forward');
    const out = await waiting;
    await settle();
    expect(out.ok, out.message).toBe(true);
    expect(out.record).toMatchObject({ txHash, network: SEAL_NETWORK, soulAddress: pending.bundle.soulAddress });
    expect(floating).toEqual([]);
  }, 40000);
});

describe('confirmHouseFounding — a failing RPC during the wait', () => {
  const registry = ethers.Wallet.createRandom().address;
  const foundingPending = (witness) => ({
    network: SEAL_NETWORK,
    net: { ...resolveSealChainConfig(SEAL_NETWORK, sealCfg(proxy.url)), houseRegistryAddress: registry },
    houseName: 'test-house', houseId: ethers.id('test-house'), witnessAddress: witness.address,
    members: [witness.address], kinds: [0], titles: ['Operator'],
  });

  it.each(FAULTS)('%s for the whole wait → RECEIPT_TIMEOUT, nothing left floating', async (fault) => {
    await proxy.setMode(fault);
    const out = await confirmHouseFounding({
      pending: foundingPending(ethers.Wallet.createRandom()),
      txHash: ethers.hexlify(ethers.randomBytes(32)), receiptTimeoutMs: 1500, pollIntervalMs: 200,
    });
    await settle();
    expect(floating).toEqual([]);
    expect(out).toMatchObject({ ok: false, code: 'RECEIPT_TIMEOUT' });
    expect(out.message).toMatch(/^sent — confirmation pending/);
  });

  it('a flake that clears mid-wait still reaches the landed receipt', async () => {
    // A real tx to the registry address lands with status 1; nothing is
    // deployed there, so the readback honestly cannot find the house —
    // VERIFY_LAG proves the wait got past the flake to the receipt.
    const witness = ethers.Wallet.createRandom();
    await fund(chain.rpc, witness.address);
    await proxy.setMode('rpc-error');
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx: { to: registry, data: '0x' } });
    const waiting = confirmHouseFounding({
      pending: foundingPending(witness), txHash,
      receiptTimeoutMs: 20000, pollIntervalMs: 200, readbackAttempts: 1, readbackDelayMs: 0,
    });
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    await proxy.setMode('forward');
    const out = await waiting;
    await settle();
    expect(out).toMatchObject({ ok: false, code: 'VERIFY_LAG' });
    expect(floating).toEqual([]);
  }, 40000);
});
