/**
 * Shared fixture for the house-founding suites:
 *   test/integration/house-founding-prepare.test.js
 *   test/integration/house-founding-record.test.js
 *
 * Real disk + real crypto: temp sovereign lanes with real DEKs, real AES-GCM
 * keypair envelopes, real ethers wallets — plus the scripted
 * ContractRunner/provider both suites inject at the flow's provider seam.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import { foundingInnerPayload, loadHouseRegistryAbi } from '../../backend/services/house-founding-flow.js';
import {
  encryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, wrapDEK,
  resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

// RANDOM per run (#309): the live gas-floor leg asserts this wallet is unfunded, and the fixed `0x22…` key it replaced is a WELL-KNOWN address that collects real faucet dust (0.005997 ETH vs the 0.005 floor, 2026-08-13). Every use derives from it, so nothing depended on the literal key.
export const WITNESS = ethers.Wallet.createRandom();
export const BEING_A = new ethers.Wallet('0x' + '11'.repeat(32));
export const BEING_B = new ethers.Wallet('0x' + '44'.repeat(32));
export const MASTER_SECRET = 'house-founding-flow-test-master-secret-long-enough';
export const SEPOLIA_REGISTRY = '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276';

export const cfg = (over = {}) => ({
  houseFoundNetwork: 'base-sepolia',
  baseSepoliaRpcUrl: 'http://127.0.0.1:1',
  natalisAddress: '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3',
  houseRegistryAddress: SEPOLIA_REGISTRY,
  baseMainnetRpcUrl: 'http://127.0.0.1:2',
  natalisMainnetAddress: '0x88a7229afeb4deba8c27edad788ac723697dde78',
  houseRegistryMainnetAddress: '0x526c6a062db774997955816c03df49b60260b883',
  ...over,
});

export const iface = new ethers.Interface(loadHouseRegistryAbi());
const natalisIface = new ethers.Interface(['function isNeuma(address) view returns (bool)']);

/**
 * A scripted ContractRunner/provider at the flow's injection seam. Every
 * view answer is REAL abi-encoded through the contract's own Interface —
 * only the chain behind it is scripted. The foundingDigest answer is
 * computed by the SAME wrap law the live legs prove against the deployed
 * contract, so a drift in foundingInnerPayload fails the live leg, not this.
 */
export const scriptedProvider = ({
  chainId = 84532, registryAddress = SEPOLIA_REGISTRY,
  houseStatus = 0, houseName = '', members = [], memberInfoByAddr = {},
  quorum = 0, balance = ethers.parseEther('1'), unsealed = [],
} = {}) => ({
  getNetwork: async () => ({ chainId: BigInt(chainId) }),
  getBalance: async () => balance,
  // The fee the founding is quoted at (seal-cost.js) — scripted like the balance; the quote's own law runs on a
  // real chain in seal-cost-chain.test.js. 1 gwei: 800k gas costs 0.0008 ETH, under the 0.005 floor.
  getFeeData: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 0n, gasPrice: 1_000_000_000n }),
  getBlock: async () => ({ baseFeePerGas: 1_000_000_000n }),
  call: async (tx) => {
    // Natalis.isNeuma — every being is sealed on this chain unless named in `unsealed`.
    if (tx.data.startsWith(natalisIface.getFunction('isNeuma').selector)) {
      const [addr] = natalisIface.decodeFunctionData('isNeuma', tx.data);
      const out = !unsealed.some((u) => u.toLowerCase() === addr.toLowerCase());
      return natalisIface.encodeFunctionResult('isNeuma', [out]);
    }
    const parsed = iface.parseTransaction({ data: tx.data });
    switch (parsed.name) {
      case 'houseIdOf':
        return iface.encodeFunctionResult('houseIdOf', [
          ethers.keccak256(ethers.toUtf8Bytes(String(parsed.args[0]).toLowerCase())),
        ]);
      case 'getHouse':
        return iface.encodeFunctionResult('getHouse', [houseName, houseStatus, 0, 0, 0, 0, 0]);
      case 'getMembers':
        return iface.encodeFunctionResult('getMembers', [members]);
      case 'memberInfo': {
        const m = memberInfoByAddr[String(parsed.args[1]).toLowerCase()] || { active: false, kind: 0, title: '' };
        return iface.encodeFunctionResult('memberInfo', [m.active, m.kind, m.title]);
      }
      case 'quorumOf':
        return iface.encodeFunctionResult('quorumOf', [quorum]);
      case 'foundingDigest': {
        const [name, mem, kinds, titles] = parsed.args;
        const inner = foundingInnerPayload({
          chainId, registryAddress,
          houseName: name, members: [...mem], kinds: [...kinds].map(Number), titles: [...titles],
        });
        return iface.encodeFunctionResult('foundingDigest', [ethers.hashMessage(ethers.getBytes(inner))]);
      }
      default:
        throw new Error(`scripted provider has no answer for ${parsed.name}`);
    }
  },
});

// A real sovereign lane on temp disk: owner record, real DEK, real AES-GCM
// keypair envelope — exactly what loadBeingWallet decrypts in production.
export const writeLane = (root, neumaId, wallet, { ownerWallet = WITNESS.address, locked = false } = {}) => {
  const ws = path.join(root, neumaId);
  mkdirSync(path.join(ws, 'keys'), { recursive: true });
  writeFileSync(path.join(ws, 'owner.json'), JSON.stringify({ wallet: ownerWallet.toLowerCase() }));
  const master = deriveKeyFromSecret(MASTER_SECRET);
  const dek = deriveNeumaDEK(master, 'cd'.repeat(32));
  writeFileSync(path.join(ws, 'keys', 'dek.json'), JSON.stringify(wrapDEK(dek, master)));
  if (!locked) {
    writeFileSync(
      path.join(ws, 'keys', 'keypair.json'),
      JSON.stringify(encryptEnvelope({ address: wallet.address, privateKey: wallet.privateKey }, { key: dek })),
    );
  }
};

export const fullTitles = () => ({ witness: 'Rector', ember: 'Faber', sable: 'Curator' });

// impure — the suites' shared beforeEach body: crypto key pinned, temp root
// raised with the ember + sable lanes standing.
export const raiseFoundingRoot = () => {
  const savedKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = MASTER_SECRET;
  resetWorkspaceCryptoKey();
  const root = mkdtempSync(path.join(os.tmpdir(), 'house-founding-'));
  setWorkspacesRoot(root);
  writeLane(root, 'ember', BEING_A);
  writeLane(root, 'sable', BEING_B);
  return { root, savedKey };
};

// impure — the suites' shared afterEach body.
export const tearDownFoundingRoot = ({ root, savedKey }) => {
  if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = savedKey;
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(null);
  rmSync(root, { recursive: true, force: true });
};
