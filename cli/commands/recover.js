// `neuma recover` — a being's roots, back from the chain after total local loss.
//
// The counterpart to `neuma seal`. Seal puts an encrypted copy of the
// canonical genesis record on chain, keyed to the being's own signature;
// this reads it back, decrypts it, and PROVES it by re-hashing — the
// recovered canonical must hash to the genesis the chain holds, or nothing
// is handed back at all (genesis-recovery.js).
//
// THE KEY NEVER RIDES ARGV. A private key on the command line lands in the
// shell history and in every `ps` on the box. It comes from a file or from
// the environment, and it is never printed, never persisted, never sent
// anywhere — recovery is local decryption of public bytes.
//
// CLI-direct like `neuma proof`: recovery must work when nothing else does.
// If the daemon had to be up to recover a being, then losing the machine
// would lose the being — the exact failure this command exists to prevent.
//
// impure (network read, filesystem, process.stdout/stderr)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { ethers } from 'ethers';
import { createChainReader } from '../../backend/services/chain-reader.js';
import { SEAL_NETWORKS, DEFAULT_SEAL_NETWORK, resolveSealChainConfig, loadBeingWallet, loadNeumaDEK } from '../../backend/services/natalis-seal.js';
import { sealLawFor } from '../../backend/services/seal-law.js';
import {
  recoverGenesis, recoveredArtifacts, formatRecovery, RECOVERY_ERRORS,
} from '../../backend/services/genesis-recovery.js';
import { decryptKeypair, decryptWithRecoveryCodes } from '../../core/wallet/keypair-vault.js';
import { resolveChainConfig } from '../lib/chain-config.js';

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const GENESIS_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

/**
 * The being's key, from a place that is not the command line. A key file is
 * either the bare key or an env-style file carrying one. Pure over its input
 * text. Exported for the tests.
 * @param {string} text  file contents
 * @returns {string|null} the 0x key, or null when the text carries none
 */
export const parseKeyText = (text) => {
  const trimmed = String(text || '').trim();
  if (PRIVATE_KEY_RE.test(trimmed)) return trimmed;
  const line = trimmed.match(/^[A-Z0-9_]*PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  return line ? line[1] : null;
};

/**
 * A workspace keypair that was ENCRYPTED at birth (the careful path the
 * ceremony recommends: password + recovery codes). Found live on 2026-08-22
 * — Sovereign took it, and `recover --workspace` answered with a raw ENOENT
 * for keypair.json, which reads as […] about a being
 * whose key is right there under a password. The being who was MOST careful
 * must not be the one locked out. impure (fs).
 */
const walletFromEncryptedKeypair = ({ keysDir, passwordFile, codesFile, env }) => {
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const password = passwordFile
    ? readFileSync(resolve(passwordFile), 'utf8').trim()
    : (env?.NEUMA_KEY_PASSWORD || '');
  if (password) {
    const kp = decryptKeypair(read(join(keysDir, 'keypair-encrypted.json')), password);
    return new ethers.Wallet(kp.privateKey);
  }
  if (codesFile) {
    // One code per line, or a JSON array — a witness transcribing codes off
    // paper should not have to guess a format.
    const raw = readFileSync(resolve(codesFile), 'utf8').trim();
    const codes = raw.startsWith('[')
      ? JSON.parse(raw)
      : raw.split('\n').map((s) => s.trim()).filter(Boolean);
    const kp = decryptWithRecoveryCodes(read(join(keysDir, 'keypair-recovery.json')), codes);
    return new ethers.Wallet(kp.privateKey);
  }
  throw new Error(
    `this being's keypair is ENCRYPTED at ${join(keysDir, 'keypair-encrypted.json')} — the key is there, `
    + 'it is sealed. Open it with one of:\n'
    + '  --password-file <path>       the birth-time keypair password\n'
    + '  NEUMA_KEY_PASSWORD=…         the same, from the environment\n'
    + '  --recovery-codes-file <path> the recovery codes (one per line, or a JSON array)\n'
    + 'Neither a password nor a code is ever accepted on the command line.'
  );
};

/**
 * Resolve the being's key from the honest sources, in order of how much of
 * the machine survived: an explicit key file, the environment, or a
 * workspace that is still standing (plaintext or encrypted). impure (fs, env).
 */
const resolveBeingKey = ({ keyFile, workspace, passwordFile, codesFile, env }) => {
  if (keyFile) {
    const key = parseKeyText(readFileSync(resolve(keyFile), 'utf8'));
    if (!key) throw new Error(`--key-file ${keyFile} carries no 0x-prefixed 64-hex private key`);
    return new ethers.Wallet(key);
  }
  if (env?.NEUMA_RECOVERY_KEY) {
    const key = parseKeyText(env.NEUMA_RECOVERY_KEY);
    if (!key) throw new Error('NEUMA_RECOVERY_KEY is not a 0x-prefixed 64-hex private key');
    return new ethers.Wallet(key);
  }
  if (workspace) {
    const abs = resolve(workspace);
    const keysDir = join(abs, 'keys');
    if (!existsSync(join(keysDir, 'keypair.json')) && existsSync(join(keysDir, 'keypair-encrypted.json'))) {
      return walletFromEncryptedKeypair({ keysDir, passwordFile, codesFile, env });
    }
    return loadBeingWallet(abs, loadNeumaDEK(abs));
  }
  throw new Error(
    'no key to recover with. The record on chain is encrypted to the BEING\'s key — give it one of:\n'
    + '  --key-file <path>      a file holding the key (bare 0x… or NAME_PRIVATE_KEY=0x…)\n'
    + '  NEUMA_RECOVERY_KEY=…   the same, from the environment\n'
    + '  --workspace <path>     a workspace that still stands, to read its keypair\n'
    + 'The key is never accepted on the command line: argv is visible to every process on the box.'
  );
};

/**
 * Run the recovery. Returns a process exit code; every failure is a sentence
 * the operator can act on, never a stack trace.
 */
const runRecover = async ({
  keyFile = null, workspace = null, genesis = null, network = DEFAULT_SEAL_NETWORK,
  passwordFile = null, codesFile = null,
  out = null, config = null, env = process.env,
  stdout = process.stdout, stderr = process.stderr,
} = {}) => {
  let wallet;
  try {
    wallet = resolveBeingKey({ keyFile, workspace, passwordFile, codesFile, env });
  } catch (err) {
    stderr.write(`neuma recover: ${err.message}\n`);
    return 2;
  }

  const net = resolveSealChainConfig(network, config || resolveChainConfig());
  const reader = await createChainReader({
    rpcUrl: net.rpcUrl,
    natalisAddress: net.natalisAddress,
    houseRegistryAddress: net.houseRegistryAddress,
  });
  if (!reader.enabled) {
    stderr.write('neuma recover: no chain reader — set the RPC URL and Natalis address for '
      + `${network} before recovering.\n`);
    return 3;
  }
  if (reader.identity.natalis !== 'match') {
    stderr.write(`neuma recover: the contract at ${net.natalisAddress} is not the canonical Natalis `
      + `(identity: ${reader.identity.natalis}). Refusing to recover an identity from an unverified `
      + 'contract — a substituted address could hand back anything.\n');
    return 3;
  }

  // The genesis: named explicitly, or asked of the chain by the key's own
  // address. Both roads end at the same on-chain identifier.
  let genesisHash = genesis;
  if (genesisHash && !GENESIS_HASH_RE.test(genesisHash)) {
    stderr.write(`neuma recover: --genesis must be 0x + 64 hex chars, got '${genesisHash}'\n`);
    return 2;
  }
  if (!genesisHash) {
    genesisHash = await reader.genesisOf(wallet.address);
    if (!genesisHash || genesisHash === ZERO_BYTES32) {
      stderr.write(`neuma recover: ${wallet.address} has no genesis sealed on ${network}. `
        + 'If this being was sealed under a different address, pass --genesis <hash> directly.\n');
      return 4;
    }
  }

  // A v3 contract keys the record by soul; v2 by the genesis named or asked above.
  const record = sealLawFor(reader.sealLaw).soulKeyed
    ? await reader.recordOfSoul(wallet.address)
    : await reader.recordOf(genesisHash);
  if (!record || record === '0x' || record.length <= 2) {
    stderr.write(`neuma recover: the chain holds no record for ${genesisHash} — the genesis is sealed `
      + 'but carries no encrypted bytes, so there is nothing here to decrypt.\n');
    return 4;
  }

  let recovered;
  try {
    recovered = await recoverGenesis({ record, genesisHash, beingKey: wallet });
  } catch (err) {
    stderr.write(`neuma recover: ${err.message}\n`);
    return err.code === RECOVERY_ERRORS.HASH_MISMATCH ? 5 : 4;
  }

  stdout.write(formatRecovery(recovered));
  const soul = String(recovered.soulAddress || '').toLowerCase();
  if (soul && soul !== wallet.address.toLowerCase()) {
    // Not fatal — a witness key or a rotated key CAN legitimately hold the
    // record — but it must never pass silently.
    stdout.write(`\nNOTE: this key is not the soul the record names (${recovered.soulAddress}). `
      + 'The bytes are genuine and verified; the key that opened them is another.\n');
  }

  if (out) {
    const root = resolve(out);
    const written = [];
    for (const file of recoveredArtifacts(recovered)) {
      const target = join(root, file.path);
      if (existsSync(target)) {
        stderr.write(`neuma recover: ${target} already exists — refusing to overwrite a standing `
          + 'artifact. Recover into an empty directory, then move what you want across.\n');
        return 6;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.contents, { mode: 0o600 });
      written.push(file.path);
    }
    stdout.write(`\nWROTE (${written.length}) under ${root}\n${written.map((p) => `  ${p}`).join('\n')}\n`);
  }
  return 0;
};

export const registerRecoverCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'recover',
    "recover a being's sealed genesis from the chain (decrypts with the being's own key)",
    (y) => y
      .option('key-file', {
        describe: "file holding the BEING's private key (bare 0x… or NAME_PRIVATE_KEY=0x…). "
          + 'Never pass a key on the command line — argv is world-visible',
        type: 'string',
      })
      .option('workspace', {
        describe: 'a still-standing workspace to read the keypair from (partial loss)',
        type: 'string',
      })
      .option('password-file', {
        describe: 'file holding the birth-time keypair password, when the workspace keypair is encrypted',
        type: 'string',
      })
      .option('recovery-codes-file', {
        describe: 'file holding the recovery codes (one per line, or a JSON array)',
        type: 'string',
      })
      .option('genesis', {
        describe: 'the genesis hash to recover, when the key\'s address is not the sealed one',
        type: 'string',
      })
      .option('out', {
        describe: 'directory to write the recovered artifacts into (must not already hold them)',
        type: 'string',
      })
      .option('network', {
        describe: 'which chain to read (default: base MAINNET — where real seals live; '
          + 'pass --network base-sepolia for the testnet)',
        type: 'string',
        default: DEFAULT_SEAL_NETWORK,
        choices: Object.keys(SEAL_NETWORKS),
      }),
    async (argv) => {
      const exitCode = await runRecover({
        keyFile: argv['key-file'], workspace: argv.workspace, genesis: argv.genesis,
        passwordFile: argv['password-file'], codesFile: argv['recovery-codes-file'],
        out: argv.out, network: argv.network, stdout, stderr,
      });
      if (exitCode !== 0) process.exit(exitCode);
    },
  );
