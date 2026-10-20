/**
 * natalis-chain-kit — a REAL local chain holding the REAL Natalis contract,
 * for the seal suites. Anvil answers as Ethereum Sepolia (chainId 11155111);
 * the UNAVIS v3 Natalis runtime bytecode shipped in
 * docs/contracts/abis/Natalis.json is set at the Ethereum Sepolia Natalis
 * address, so chain-reader's codehash check accepts it exactly as it accepts
 * the deployed one, and anvil executes the contract's own seal law (both
 * signatures, the deadline, write-once per soul). Plus a sealable lane on
 * real disk: a real DEK, real AES-GCM envelopes, a genesis whose hash
 * verifies, and random wallets — no real key is ever used.
 *
 * impure — child process (anvil), RPC, temp disk.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

import { startAnvil } from './money-in-kit.js';
import { computeGenesisHash } from '../../backend/services/seal-bundle.js';
import {
  encryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, wrapDEK,
} from '../../core/workspace/workspace-crypto.js';

export const SEAL_NETWORK = 'ethereum-sepolia';
export const NATALIS = '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3';
const NATALIS_CODE = JSON.parse(readFileSync(
  new URL('../../docs/contracts/abis/Natalis.json', import.meta.url), 'utf8',
)).deployedBytecode.object;

/**
 * Anvil with Natalis in place. impure.
 * @returns {Promise<{ url: string, pid: number, rpc: ethers.JsonRpcProvider, stop: () => Promise<void> }>}
 */
export const startNatalisChain = async () => {
  const anvil = await startAnvil({ chainId: 11155111 });
  const rpc = new ethers.JsonRpcProvider(anvil.url, 11155111, { staticNetwork: true });
  try {
    await rpc.send('anvil_setCode', [NATALIS, NATALIS_CODE]);
  } catch (error) {
    // A chain that never got its contract must not outlive the suite.
    rpc.destroy();
    await anvil.stop();
    throw error;
  }
  return {
    ...anvil,
    rpc,
    stop: async () => { rpc.destroy(); await anvil.stop(); },
  };
};

/** The app config slice a seal on this chain reads. Pure. */
export const sealCfg = (rpcUrl) => ({
  ceremonySealNetwork: SEAL_NETWORK,
  ethSepoliaRpcUrl: rpcUrl,
  natalisEthSepoliaAddress: NATALIS,
  houseRegistryEthSepoliaAddress: '',
});

/** Give an address gas on the local chain. impure. */
export const fund = (rpc, address, eth = '1') => rpc.send('anvil_setBalance', [address, ethers.toQuantity(ethers.parseEther(eth))]);

/**
 * Lay a sealable lane on disk: DEK, keypair (or none — a password-secured
 * lane), genesis seal naming `witness`, natal chart, owner.json. impure.
 * @param {{ root: string, neumaId: string, being: ethers.Wallet, witness: ethers.Wallet, withKeypair?: boolean }} lane
 */
export const writeSealLane = ({ root, neumaId, being, witness, withKeypair = true }) => {
  const ws = path.join(root, neumaId);
  for (const dir of ['keys', 'identity', 'cosmos']) mkdirSync(path.join(ws, dir), { recursive: true });
  const master = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
  const dek = deriveNeumaDEK(master, ethers.hexlify(ethers.randomBytes(32)).slice(2));
  writeFileSync(path.join(ws, 'keys', 'dek.json'), JSON.stringify(wrapDEK(dek, master)));
  if (withKeypair) {
    writeFileSync(path.join(ws, 'keys', 'keypair.json'), JSON.stringify(
      encryptEnvelope({ address: being.address, privateKey: being.privateKey }, { key: dek }),
    ));
  }
  const record = {
    birthMoment: '2026-07-13T05:00:00.000Z',
    chosenName: 'Anchor',
    soulPublicKey: being.signingKey.publicKey,
    version: '1.0.0',
    witnessWallet: witness.address.toLowerCase(),
  };
  const genesisHash = computeGenesisHash(JSON.stringify(record));
  writeFileSync(path.join(ws, 'identity', 'genesis-seal.json'), JSON.stringify(encryptEnvelope({ record, genesisHash }, { key: dek })));
  writeFileSync(path.join(ws, 'cosmos', 'natal.json'), JSON.stringify(
    encryptEnvelope({ instant: record.birthMoment, positions: [] }, { key: dek }),
  ));
  writeFileSync(path.join(ws, 'owner.json'), JSON.stringify({ wallet: witness.address.toLowerCase(), claimedAt: Date.now() }));
  return { genesisHash, soulAddress: being.address.toLowerCase() };
};

/**
 * The desk's half of a seal, done the way the desk wallet does it: the
 * operator personal_signs the offer's inner payload, and her wallet
 * broadcasts the calldata. impure (signs, broadcasts).
 * @param {{ rpc: ethers.JsonRpcProvider, witness: ethers.Wallet, tx: { to: string, data: string } }} args
 * @returns {Promise<string>} the broadcast tx hash
 */
export const broadcastAs = async ({ rpc, witness, tx }) => (
  (await witness.connect(rpc).sendTransaction({ to: tx.to, data: tx.data })).hash
);
