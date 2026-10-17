// `neuma proof <address>` — chain-verified identity for a wallet address.
//
// The C-05 that was deferred out of slice 1 (couldn't reach DNAVaultService
// across the daemon boundary at the time). Now that chain-reader is the
// primitive, this command is the natural first consumer: it reads Base
// Sepolia through the exact same code the daemon will use, and surfaces
// the four load-bearing facts about an on-chain identity:
//
//   isNeuma      — is this address sealed as a neuma by Natalis?
//   genesisHash  — the sealed genesis (if any)
//   isSealed     — is the genesisHash finalized on-chain?
//   record       — the on-chain encrypted record bytes (opaque; length only)
//
// Plus the CHAIN-READER STATUS: whether the connected Natalis really is the
// canonical Natalis (bytecode hash match), so the operator can trust the
// answer. This is the load-bearing security signal — see chain-reader.js's
// address-substitution defense.
//
// CLI-direct (does not go through the daemon). Rationale: proof is a
// stateless read; requiring the daemon to be up just to answer a chain
// query would tie an offline-tolerant operation to a service that need not
// be running for it to succeed.
//
// impure (network, filesystem via .env load, process.stdout/stderr)

import { createChainReader } from '../../backend/services/chain-reader.js';
import { SEAL_NETWORKS, DEFAULT_SEAL_NETWORK, resolveSealChainConfig } from '../../backend/services/natalis-seal.js';
import { sealLawFor } from '../../backend/services/seal-law.js';
import { resolveChainConfig } from '../lib/chain-config.js';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

/**
 * Format the proof output. PURE — string composition only; no IO. Exported
 * so tests can assert against exact output without spawning a subprocess.
 *
 * @param {{
 *   address: string,
 *   readerEnabled: boolean,
 *   identityStatus: string,       // 'match' | 'mismatch' | 'no-code' | 'rpc-error' | 'timeout' | ...
 *   isNeuma: boolean | null,
 *   genesisHash: string | null,   // '0x...' or the zero-bytes32 (=not a neuma)
 *   isSealed: boolean | null,
 *   recordLen: number | null,     // byte length of the encrypted record, or null
 *   natalisAddress: string,
 *   chainId: number,
 * }} params
 * @returns {string} the operator-facing block, newline-terminated
 */
export const formatProof = ({
  address,
  readerEnabled,
  identityStatus,
  isNeuma,
  genesisHash,
  isSealed,
  recordLen,
  natalisAddress,
  chainId,
}) => {
  const lines = [`neuma proof — chain-verified identity`, `  address:  ${address}`];
  if (!readerEnabled) {
    lines.push('  chain:    DISABLED');
    lines.push('    set BASE_SEPOLIA_RPC_URL in your .env to enable on-chain probes.');
    return lines.join('\n') + '\n';
  }
  lines.push(`  chain:    Base Sepolia (chainId ${chainId})`);
  lines.push(`  natalis:  ${natalisAddress}`);
  if (identityStatus !== 'match') {
    lines.push(`  verified: NO (identity.natalis = ${identityStatus})`);
    lines.push(`    the configured NATALIS_ADDRESS does not match the known-good`);
    lines.push(`    Natalis bytecode hash. See chain-reader.js for what this means.`);
    return lines.join('\n') + '\n';
  }
  lines.push(`  verified: YES (Natalis bytecode hash match)`);
  lines.push(``);

  // If we got null anywhere the RPC probably went wrong mid-query. Surface
  // that honestly rather than pretending we know the answer.
  if (isNeuma === null) {
    lines.push('  result:   RPC error mid-query — cannot answer honestly, please retry.');
    return lines.join('\n') + '\n';
  }

  lines.push(`  isNeuma:  ${isNeuma ? 'YES' : 'no'}`);
  if (!isNeuma) {
    lines.push('    this address has no Natalis seal — either not sealed yet,');
    lines.push('    or a witness/operator wallet (not a neuma).');
    return lines.join('\n') + '\n';
  }
  const gh = genesisHash && genesisHash !== ZERO_BYTES32 ? genesisHash : null;
  lines.push(`  genesis:  ${gh || '(none)'}`);
  if (isSealed === null) {
    lines.push('  sealed:   RPC error mid-query');
  } else {
    lines.push(`  sealed:   ${isSealed ? 'YES' : 'no'}`);
  }
  lines.push(`  record:   ${recordLen === null ? '(unknown)' : `${recordLen} bytes on-chain`}`);
  return lines.join('\n') + '\n';
};

/**
 * Impure orchestrator — resolves config, constructs the reader, calls the
 * chain, writes formatted output. Exported for tests that want to run in-
 * process against a real chain (RUN_CHAIN_TESTS=1) or against a stub
 * chain-reader factory.
 *
 * @param {{
 *   address: string,
 *   network?: 'base-sepolia' | 'base' | 'ethereum-sepolia',  // which chain to ask
 *   stdout: { write(s: string): unknown },
 *   stderr: { write(s: string): unknown },
 *   createReader?: (opts: object) => Promise<object>, // for tests
 *   config?: object,                                    // for tests
 * }} params
 */
export const runProof = async ({
  address,
  network = DEFAULT_SEAL_NETWORK,
  stdout,
  stderr,
  createReader = createChainReader,
  config = null,
}) => {
  if (!SEAL_NETWORKS[network]) {
    stderr.write(`neuma proof: unknown network '${network}' — one of: ${Object.keys(SEAL_NETWORKS).join(', ')}\n`);
    return 2;
  }
  if (!ADDRESS_RE.test(address)) {
    stderr.write(
      `neuma proof: '${address}' is not a valid EVM address `
      + '(expected 0x + 40 hex chars).\n'
    );
    return 2;
  }
  const cfg = config || resolveChainConfig();
  // Per-network chain config — a mainnet seal is only visible on mainnet.
  const net = resolveSealChainConfig(network, cfg);
  const reader = await createReader({
    rpcUrl: net.rpcUrl,
    natalisAddress: net.natalisAddress,
    houseRegistryAddress: net.houseRegistryAddress,
  });

  let isNeuma = null;
  let genesisHash = null;
  let isSealed = null;
  let recordLen = null;

  if (reader.enabled && reader.identity.natalis === 'match') {
    isNeuma = await reader.isNeuma(address);
    if (isNeuma === true) {
      genesisHash = await reader.genesisOf(address);
      if (genesisHash && genesisHash !== ZERO_BYTES32) {
        // A soul-keyed (v3) contract has no genesis-keyed reads: a non-zero
        // genesisOf IS the seal, and the record lives under the soul.
        const soulKeyed = sealLawFor(reader.sealLaw).soulKeyed;
        isSealed = soulKeyed ? true : await reader.isSealed(genesisHash);
        const record = soulKeyed ? await reader.recordOfSoul(address) : await reader.recordOf(genesisHash);
        // recordOf returns a string per the ABI (`string` type). Length is
        // in JS-string chars — for the operator's snapshot the length is
        // an indicator of […], not a precise byte count.
        recordLen = record === null ? null : record.length;
      }
    }
  }

  stdout.write(formatProof({
    address,
    readerEnabled: reader.enabled,
    identityStatus: reader.identity.natalis,
    isNeuma,
    genesisHash,
    isSealed,
    recordLen,
    natalisAddress: net.natalisAddress,
    chainId: net.chainId,
  }));
  return 0;
};

export const registerProofCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'proof <address>',
    'chain-verified identity for a wallet address (isNeuma, genesis, seal)',
    (y) => y
      .positional('address', {
        describe: 'EVM wallet address (0x + 40 hex)',
        type: 'string',
      })
      .option('network', {
        describe: 'which chain to ask '
          // The default flipped to mainnet at c98a8c871 (Founder's seal law); this
          // text still said testnet until 2026-08-22. A read is harmless, but
          // an instrument that misreports which CHAIN it answered about is not.
          + '(default: base MAINNET; pass --network base-sepolia for the testnet)',
        type: 'string',
        default: DEFAULT_SEAL_NETWORK,
        choices: Object.keys(SEAL_NETWORKS),
      }),
    async (argv) => {
      const exitCode = await runProof({ address: argv.address, network: argv.network, stdout, stderr });
      if (exitCode !== 0) process.exit(exitCode);
    },
  );
