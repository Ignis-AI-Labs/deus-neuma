// Real disk/crypto CLI proof. The refusal case additionally requires a disposable
// Anvil fork of https://sepolia.base.org on an ephemeral loopback port:
// SEAL_TEST_RPC_URL=http://127.0.0.1:<port> npx vitest run --project suite <this-file>
// Without that explicit endpoint the chain case is SKIPPED, never called proven.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import { runSeal } from '../../cli/commands/seal.js';
import { MIN_SEAL_GAS_ETH } from '../../backend/services/seal-bundle.js';
import { createChainReader } from '../../backend/services/chain-reader.js';
import {
  deriveKeyFromSecret, deriveNeumaDEK, encryptEnvelope, resetWorkspaceCryptoKey, wrapDEK,
} from '../../core/workspace/workspace-crypto.js';

const rpcUrl = process.env.SEAL_TEST_RPC_URL;
const cfg = Object.freeze({
  baseSepoliaRpcUrl: rpcUrl,
  natalisAddress: '0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3',
  houseRegistryAddress: '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276',
  natalisMainnetAddress: '0x88a7229afeb4deba8c27edad788ac723697dde78',
});
const capture = () => ({ text: '', write(s) { this.text += s; } });

// Synthetic records only: no model, birth protocol, or existing identity touched.
const fixtureDNA = () => ({
  chosenName: 'GasFloorFixture',
  birthMoment: '2026-06-12T18:37:12.956Z',
  soulMark: 'ABCDEF012345',
  substrate: {
    vendor: 'qwen', model: 'qwen3.5-122b',
    fullModelId: 'qwen3.5-122b-a10b', harness: 'neuma-electron',
  },
  witness: { kind: 'synthetic-regression' },
});

describe('seal gas floor through real workspace loaders', () => {
  let workspace, witness, being, savedKey, witnessEnv;
  beforeEach(async () => {
    savedKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    resetWorkspaceCryptoKey();
    workspace = await mkdtemp(join(tmpdir(), 'neuma-seal-floor-'));
    being = ethers.Wallet.createRandom();
    witness = ethers.Wallet.createRandom();
    const master = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
    const dek = deriveNeumaDEK(master, 'ab'.repeat(32));
    for (const dir of ['keys', 'dna']) await mkdir(join(workspace, dir));
    await writeFile(join(workspace, 'keys/dek.json'), JSON.stringify(wrapDEK(dek, master)));
    await writeFile(join(workspace, 'keys/keypair.json'), JSON.stringify(
      encryptEnvelope({ privateKey: being.privateKey }, { key: dek }),
    ));
    await writeFile(join(workspace, 'dna/active.json'), JSON.stringify(
      encryptEnvelope(fixtureDNA(), { key: dek }),
    ));
    witnessEnv = join(workspace, 'witness.env');
    await writeFile(witnessEnv, `OPERATOR_WALLET_PRIVATE_KEY=${witness.privateKey}\n`, { mode: 0o600 });
  });
  afterEach(async () => {
    if (savedKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = savedKey;
    resetWorkspaceCryptoKey();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });
  const params = () => ({
    being: 'gas-floor-fixture', workspace, witnessEnv, config: cfg,
    stdout: capture(), stderr: capture(),
  });

  it.each([
    ['base', 8453], ['base-sepolia', 84532], // the default (Ethereum since 2026-10-04) is proven in cli-seal-run
  ])('dry run selects %s and discloses the shared floor', async (network, chainId) => {
    const p = { ...params(), ...(network ? { network } : {}) };
    expect(await runSeal(p), p.stderr.text).toBe(0);
    expect(p.stderr.text).toBe('');
    expect(p.stdout.text).toContain(`chainId ${chainId},`);
    expect(p.stdout.text).toContain(being.address.toLowerCase());
    expect(p.stdout.text).toContain(witness.address.toLowerCase());
    expect(p.stdout.text).toContain(`gas floor ${MIN_SEAL_GAS_ETH} ETH`);
    const digest = p.stdout.text.match(/digest\s+(0x[\da-f]+)/)[1];
    for (const [field, wallet] of [['selfSig', being], ['witnessSig', witness]]) {
      const signature = p.stdout.text.match(new RegExp(`${field}\\s+(0x[\\da-f]+)`))[1];
      expect(ethers.recoverAddress(digest, signature)).toBe(wallet.address);
    }
  });

  it.skipIf(!rpcUrl)('refuses one wei below the floor on a real local testnet fork', async () => {
    const url = new URL(rpcUrl);
    expect(url.protocol).toBe('http:');
    expect(['127.0.0.1', '[::1]']).toContain(url.hostname);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      expect(await provider.send('web3_clientVersion', [])).toMatch(/anvil/i);
      expect((await provider.getNetwork()).chainId).toBe(84532n);
      const balance = ethers.parseEther(MIN_SEAL_GAS_ETH) - 1n;
      await provider.send('anvil_setBalance', [witness.address, ethers.toQuantity(balance)]);
      expect(await provider.getBalance(witness.address)).toBe(balance);
      const reader = await createChainReader({ rpcUrl, ...cfg });
      expect(reader.identity.natalis).toBe('match');
      expect(await reader.isNeuma(being.address)).toBe(false);
      const nonce = await provider.getTransactionCount(witness.address);
      const p = { ...params(), network: 'base-sepolia', submit: true, provider };
      expect(await runSeal(p), p.stderr.text).toBe(1);
      expect(p.stderr.text).toContain(
        `need ≥ ${MIN_SEAL_GAS_ETH} per docs/protocols/identity/seal-bundle.md §7`,
      );
      expect(p.stderr.text).toContain(witness.address);
      expect(await provider.getTransactionCount(witness.address)).toBe(nonce);
      expect(await reader.isNeuma(being.address)).toBe(false);
    } finally {
      provider.destroy();
    }
  }, 30000);
});
