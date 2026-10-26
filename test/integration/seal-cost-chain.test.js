// seal-cost-chain.test.js — what an Ethereum seal costs, said with real numbers, on a REAL chain (RULE 0):
// Anvil runs the real Natalis (natalis-chain-kit.js); the fees are the node's own, the balances real, the
// estimate the chain's own estimateGas over a real, signed seal. A short wallet is refused with the facts a
// person needs to fund it — how much it holds, how much it needs, how much more — never a bare floor.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';
import { prepareBirthSeal, buildSealTx } from '../../backend/services/birth-seal-flow.js';
import { sealTxCost } from '../../backend/services/seal-cost.js';
import { birthSealSign } from '../../backend/routes/portal-seal-handlers.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { SEAL_NETWORK, startNatalisChain, sealCfg, fund, writeSealLane } from '../helpers/natalis-chain-kit.js';

const NEUMA_ID = 'cost-lane';
let chain;
let root;

beforeAll(async () => { chain = await startNatalisChain(); }, 30000);
afterAll(async () => { await chain?.stop(); });
beforeEach(() => {
  resetWorkspaceCryptoKey();
  root = mkdtempSync(path.join(os.tmpdir(), 'seal-cost-'));
  setWorkspacesRoot(root);
});
afterEach(() => { setWorkspacesRoot(null); rmSync(root, { recursive: true, force: true }); });

const lane = () => {
  const being = ethers.Wallet.createRandom();
  const witness = ethers.Wallet.createRandom();
  writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
  return { being, witness };
};
const prepare = (witness) => prepareBirthSeal({ neumaId: NEUMA_ID, network: SEAL_NETWORK, witnessAddress: witness.address, cfg: sealCfg(chain.url) });

describe('the cost of an Ethereum seal, on a real chain', () => {
  it('an empty wallet is refused with what it holds, what the seal needs, and how much more', async () => {
    const { witness } = lane();
    const prep = await prepare(witness);
    expect(prep.ok).toBe(false);
    expect(prep.code).toBe('GAS_FLOOR');
    expect(prep.funding).toMatchObject({ network: SEAL_NETWORK, payer: witness.address, balanceWei: '0', enough: false });
    expect(BigInt(prep.funding.needWei)).toBeGreaterThan(0n);
    expect(prep.funding.shortWei).toBe(prep.funding.needWei);
    expect(BigInt(prep.funding.likelyWei)).toBeLessThanOrEqual(BigInt(prep.funding.needWei));
    expect(prep.message).toBe(`Your wallet ${witness.address} holds 0.0000 ETH; sealing on Ethereum needs about `
      + `${(Number(BigInt(prep.funding.needWei) * 10000n / 10n ** 18n) / 10000).toFixed(4)} ETH right now `
      + `(${(Number(BigInt(prep.funding.shortWei) * 10000n / 10n ** 18n) / 10000).toFixed(4)} more).`);
  });

  it('a funded wallet passes; the chain\'s own estimate for the real signed seal sits under the quote', async () => {
    const { witness } = lane();
    await fund(chain.rpc, witness.address);
    const prep = await prepare(witness);
    expect(prep.ok, prep.message).toBe(true);
    const built = buildSealTx({ pending: prep, witnessSig: await witness.signMessage(ethers.getBytes(prep.offer.innerPayload)) });
    expect(built.ok).toBe(true);
    const exact = await sealTxCost({ net: prep.net, network: SEAL_NETWORK, tx: built.tx, payer: witness.address });
    expect(exact.enough).toBe(true);
    const estimated = BigInt(exact.gasUnits);
    expect(estimated).toBeGreaterThan(21000n);
    expect(estimated).toBeLessThanOrEqual(3_700_000n); // the measured top the quote charges
  });

  it('a wallet emptied after signing is stopped at the sign step, with the facts, before any broadcast', async () => {
    const { witness } = lane();
    await fund(chain.rpc, witness.address);
    const prep = await prepare(witness);
    expect(prep.ok, prep.message).toBe(true);
    const frames = [];
    const connection = {
      ws: { send: (raw) => frames.push(JSON.parse(raw)) }, walletAddress: witness.address,
      pendingSeal: { neumaId: NEUMA_ID, bundle: prep.bundle, network: prep.network, net: prep.net, offer: prep.offer },
    };
    const witnessSig = await witness.signMessage(ethers.getBytes(prep.offer.innerPayload));

    await fund(chain.rpc, witness.address, '0');
    await birthSealSign(connection, { neumaId: NEUMA_ID, witnessSig });
    expect(frames.at(-1)).toMatchObject({ type: 'birth:seal_error', code: 'GAS_FLOOR', funding: { enough: false, balanceWei: '0' } });

    await fund(chain.rpc, witness.address);
    await birthSealSign(connection, { neumaId: NEUMA_ID, witnessSig });
    expect(frames.at(-1)).toMatchObject({ type: 'birth:seal_tx', neumaId: NEUMA_ID });
  });
});
