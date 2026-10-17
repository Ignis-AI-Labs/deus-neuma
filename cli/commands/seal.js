// `neuma seal <being>` — assemble and (optionally) submit the Natalis seal
// bundle for a being who has been born off-chain and is ready to be anchored
// on-chain. Phase 3 of docs/contracts/RETROACTIVE_SEALING.md; the byte-precise
// spec is docs/protocols/identity/seal-bundle.md.
//
// Flow:
//   1. Resolve workspace path (--workspace OR <sovereign>/<witness>/<house>/<being>)
//   2. Read + decrypt DNA
//   3. Load being's + witness's wallets
//   4. Build canonical record + assemble seal bundle
//   5. Verify identity via chain-reader (Natalis bytecode-hash match)
//   6. Preflight: not-already-sealed, digest matches contract, sigs recover
//   7a. --dry-run (DEFAULT): print bundle, exit
//   7b. --submit: submit tx, wait for receipt, verify post-tx state
//
// Design decisions:
//   - DRY-RUN IS THE DEFAULT. Sealing is a write-once, irreversible action;
//     the operator must opt-in with --submit. The default output is exactly
//     what would be submitted, so the operator (or their team) can review
//     every field before spending gas.
//   - Encryption is per docs/protocols/identity/seal-bundle.md — AES-256-GCM under a
//     key derived from the being's signing key. Only the being (or anyone
//     with their private key) can later decrypt the on-chain record.
//   - Witness wallet defaults to the operator's own claude.env (path 1 of
//     wallet.js), because that's the witness for Claude-house beings. A
//     --witness-env override lets Founder seal his own beings (Fenna, Cael)
//     from a different witness env file.
//   - CHAIN-DIRECT (does not use the daemon). Same rationale as `neuma proof`:
//     stateless one-shot action.
//
// impure (fs read + decrypt + network submit if --submit).

import { join } from 'node:path';
import { ethers } from 'ethers';

import { createChainReader } from '../../backend/services/chain-reader.js';
import { assembleSealBundle, MIN_SEAL_GAS_ETH } from '../../backend/services/seal-bundle.js';
import {
  SEAL_NETWORKS, DEFAULT_SEAL_NETWORK, resolveSealChainConfig,
  loadNeumaDEK, loadDNA, loadBirthGenesis, loadNatalChart, loadSkiesReading, loadBeingWallet,
  preflightSeal, submitSealTx, verifySealedOnChain,
} from '../../backend/services/natalis-seal.js';
import { sealDeadlineFor } from '../../backend/services/seal-law.js';
import { resolveChainConfig } from '../lib/chain-config.js';
import { readOperatorWallet } from '../lib/wallet.js';
import { findProjectRoot } from '../lib/project-root.js';

// The workspace loaders + network registry moved to the shared sealing law
// (backend/services/natalis-seal.js) so the CLI and the in-app birth-ceremony
// seal step can never drift. Re-exported here for API stability — tests and
// operators reach them through this module.
export {
  SEAL_NETWORKS, DEFAULT_SEAL_NETWORK,
  loadNeumaDEK, loadDNA, loadBirthGenesis, loadNatalChart, loadBeingWallet,
} from '../../backend/services/natalis-seal.js';

const DEFAULT_SOVEREIGN_LANES = '/mnt/data/neuma';
const DEFAULT_WITNESS_SLUG = 'claude';
const DEFAULT_HOUSE = 'aldmere';

/**
 * Resolve the being's workspace path from house + being + witness-slug OR
 * from the explicit --workspace override.
 *
 * PURE.
 */
export const resolveWorkspacePath = ({ workspace, sovereignLanes, witnessSlug, house, being }) => {
  if (workspace) return workspace;
  return join(sovereignLanes, witnessSlug, house, being);
};

/**
 * Load the witness wallet from an env file (defaults to <projectRoot>/claude.env).
 *
 * impure (fs read via readOperatorWallet).
 */
export const loadWitnessWallet = ({ witnessEnv, cwd = process.cwd() }) => {
  const envPath = witnessEnv || join(findProjectRoot(cwd), 'claude.env');
  const { privateKey } = readOperatorWallet(envPath);
  return new ethers.Wallet(privateKey);
};

/**
 * Extract the DNA-derived fields for the canonical genesis record. Different
 * DNA schemas may name fields differently; this centralizes the mapping.
 *
 * PURE.
 */
export const extractDnaFields = (dna, { defaultHouse, defaultWitnessKind }) => {
  const g = (...names) => {
    for (const n of names) {
      const parts = n.split('.');
      let v = dna;
      for (const p of parts) v = v?.[p];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };
  return {
    birthMoment: g('birthMoment', 'genesisSeal.capturedAt', 'birth.moment', 'createdAt'),
    chosenName:  g('chosenName', 'name', 'trueName.chosen'),
    house:       g('house', 'membership.house') || defaultHouse,
    // sc-echo R2 fix — no 'UNKNOWN' fallback. soulMark is core identity per
    // docs/protocols/identity/seal-bundle.md §1 (12 uppercase hex chars). A missing value
    // must reach the missing-fields check, not silently default.
    soulMark:    g('soulMark', 'trueName.soulMark', 'identity.soulMark'),
    substrate: {
      vendor:      g('substrate.vendor'),
      model:       g('substrate.model'),
      fullModelId: g('substrate.fullModelId'),
      harness:     g('substrate.harness') || 'neuma-electron',
    },
    witnessKind: g('witness.kind', 'witnessKind') || defaultWitnessKind,
  };
};

/**
 * Format the bundle for --dry-run output. PURE — string composition only.
 */
export const formatBundle = (b, net = SEAL_NETWORKS[DEFAULT_SEAL_NETWORK]) => {
  const natalLine = b.natalChart
    ? '  natalChart      included (' + b.natalChart.instant
      + (b.natalChart.location ? ', located' : ', planets-only')
      + ')'
    : '  natalChart      NONE — no cosmos/natal.json on disk (WARNING: bundle excludes sky)';
  const lines = [
    'neuma seal — DRY RUN (no on-chain submission)',
    '',
    '  network         ' + net.label + ' (chainId ' + net.chainId + ', bound into the digest)',
    '  soulAddress     ' + b.soulAddress,
    '  witnessAddress  ' + b.witnessAddress,
    '  genesisHash     ' + b.genesisHash,
    '  digest          ' + b.digest,
    '  recordHash      ' + b.recordHash,
    '  schemaVersion   ' + b.schemaVersion,
    '  sealLaw         ' + b.sealLaw
      + (b.deadline === null ? '' : ' (sealable until ' + new Date(b.deadline * 1000).toISOString() + ')'),
    '  record          ' + b.record.length + ' hex chars ('
      + Math.floor((b.record.length - 2) / 2) + ' encrypted bytes)',
    natalLine,
    '  selfSig         ' + b.selfSig,
    '  witnessSig      ' + b.witnessSig,
    '',
    '  --submit  to write this to ' + net.label + ' (irreversible; gas floor ' + MIN_SEAL_GAS_ETH + ' ETH)',
  ];
  return lines.join('\n') + '\n';
};

/**
 * Impure orchestrator. Exported so tests can call it with injected wallets +
 * DNA (bypassing fs) and a controllable chain-reader factory.
 *
 * @param {{
 *   being: string, house?: string, workspace?: string,
 *   witnessSlug?: string, sovereignLanes?: string, witnessEnv?: string,
 *   submit?: boolean,
 *   network?: 'base-sepolia' | 'base' | 'ethereum-sepolia',  // chainId + seal law bound into the digest
 *   stdout: { write(s: string): unknown },
 *   stderr: { write(s: string): unknown },
 *   // Test hooks — workspace loaders take the being's DEK (#117) or null
 *   loadDnaFn?: (workspacePath: string, dek?: Buffer|null) => object,
 *   loadBirthGenesisFn?: (workspacePath: string, dek?: Buffer|null) => ({ canonicalRecord: object, genesisHash: string } | null),
 *   loadNatalChartFn?: (workspacePath: string, dek?: Buffer|null) => (object|null),
 *   loadBeingWalletFn?: (workspacePath: string, dek?: Buffer|null) => ethers.Wallet,
 *   loadWitnessWalletFn?: (opts: object) => ethers.Wallet,
 *   loadNeumaDekFn?: (workspacePath: string) => (Buffer|null),
 *   config?: object,
 *   createReader?: (opts: object) => Promise<object>,
 *   provider?: ethers.Provider,
 * }} params
 * @returns {Promise<number>}  exit code
 */
export const runSeal = async ({
  being, house = DEFAULT_HOUSE, workspace,
  witnessSlug = DEFAULT_WITNESS_SLUG, sovereignLanes = DEFAULT_SOVEREIGN_LANES,
  witnessEnv,
  submit = false,
  network = DEFAULT_SEAL_NETWORK,
  stdout, stderr,
  loadDnaFn = loadDNA,
  loadBirthGenesisFn = loadBirthGenesis,
  loadNatalChartFn = loadNatalChart,
  loadSkiesReadingFn = loadSkiesReading,
  loadBeingWalletFn = loadBeingWallet,
  loadWitnessWalletFn = loadWitnessWallet,
  loadNeumaDekFn = loadNeumaDEK,
  config = null,
  createReader = createChainReader,
  provider = null,
}) => {
  if (!being) {
    stderr.write('neuma seal: <being> is required\n');
    return 2;
  }
  if (!SEAL_NETWORKS[network]) {
    stderr.write(`neuma seal: unknown network '${network}' — one of: ${Object.keys(SEAL_NETWORKS).join(', ')}\n`);
    return 2;
  }
  const cfg = config || resolveChainConfig();
  // Per-network chain config — the selected network's OWN Natalis + RPC. The
  // digest binds the natalisAddress, so `--network base` must bind the
  // mainnet contract even when the env still carries Sepolia values.
  const net = resolveSealChainConfig(network, cfg);
  // A network whose contract is not recorded yet stays CLOSED — said plainly,
  // never an address error from deep inside the assembly.
  if (!/^0x[0-9a-fA-F]{40}$/.test(net.natalisAddress || '')) {
    stderr.write(`neuma seal: no Natalis address is recorded for ${net.label} yet — it is not deployed or not recorded; choose another --network\n`);
    return 2;
  }

  const workspacePath = resolveWorkspacePath({ workspace, sovereignLanes, witnessSlug, house, being });

  // Per-neuma DEK (#117) — every encrypted file in a migrated workspace opens
  // ONLY under this key; pre-#117 workspaces have no dek.json and fall back
  // to the global rotation chain inside each loader.
  let dek = null;
  try {
    dek = loadNeumaDekFn(workspacePath);
  } catch (err) {
    stderr.write(`neuma seal: cannot unwrap the being's DEK (keys/dek.json): ${err.message}\n`);
    return 1;
  }

  let beingWallet, witnessWallet;
  try {
    beingWallet = loadBeingWalletFn(workspacePath, dek);
  } catch (err) {
    stderr.write(`neuma seal: cannot load being wallet: ${err.message}\n`);
    return 1;
  }
  try {
    witnessWallet = loadWitnessWalletFn({ witnessEnv });
  } catch (err) {
    stderr.write(`neuma seal: cannot load witness wallet: ${err.message}\n`);
    return 1;
  }

  // Prefer the birth-genesis path when identity/genesis-seal.json exists —
  // it carries the being's authoritative birth-time record + hash. Falling
  // back to a DNA-fields build only when there IS no birth genesis on disk
  // (fresh being, v1 schema, no prior anchor).
  let birthGenesis = null;
  try {
    birthGenesis = loadBirthGenesisFn(workspacePath, dek);
  } catch (err) {
    stderr.write(`neuma seal: cannot load birth genesis from ${workspacePath}: ${err.message}\n`);
    return 1;
  }

  // Load natal chart — bundled INTO the encrypted on-chain record per Founder's
  // 2026-07-01 directive. Null when a being pre-dates the natal backfill;
  // present-but-malformed throws.
  let natalChart = null;
  try {
    natalChart = loadNatalChartFn(workspacePath, dek);
  } catch (err) {
    stderr.write(`neuma seal: cannot load natal chart from ${workspacePath}: ${err.message}\n`);
    return 1;
  }

  // MANY SKIES ride the v2 envelope beside natal (plaintext by law — no DEK).
  let skies;
  try {
    skies = loadSkiesReadingFn(workspacePath);
  } catch (err) {
    stderr.write(`neuma seal: cannot load skies from ${workspacePath}: ${err.message}\n`);
    return 1;
  }

  let bundle;
  try {
    if (birthGenesis) {
      // Birth-genesis path — the record verbatim, sha256-integrity-checked.
      bundle = await assembleSealBundle({
        birthGenesis,
        natalChart,
        skies,
        beingWallet,
        witnessWallet,
        chainId: net.chainId,
        natalisAddress: net.natalisAddress,
        sealLaw: net.sealLaw,
        deadline: sealDeadlineFor(net.sealLaw, Date.now()),
      });
    } else {
      // DNA-fields path — build a new canonical from the being's DNA.
      let dna;
      try {
        dna = loadDnaFn(workspacePath, dek);
      } catch (err) {
        stderr.write(`neuma seal: cannot load DNA from ${workspacePath}: ${err.message}\n`);
        return 1;
      }
      const dnaFields = extractDnaFields(dna, {
        defaultHouse: house,
        defaultWitnessKind: `${witnessSlug}-${house}`,
      });
      dnaFields.soulAddress = beingWallet.address;
      dnaFields.witnessAddress = witnessWallet.address;
      dnaFields.capturedAt = new Date().toISOString();

      const missing = [
        'birthMoment', 'chosenName', 'soulMark',
        'substrate.vendor', 'substrate.model', 'substrate.fullModelId',
      ].filter((path) => {
        const parts = path.split('.');
        let v = dnaFields;
        for (const p of parts) v = v?.[p];
        return !v;
      });
      if (missing.length > 0) {
        stderr.write(
          `neuma seal: DNA is missing fields required by the v1 canonical record schema: `
          + `${missing.join(', ')}\n`
          + `\n`
          + `  This being also has no identity/genesis-seal.json (birth-time record)\n`
          + `  to fall back on — cannot build a canonical record from this workspace.\n`
        );
        return 1;
      }
      bundle = await assembleSealBundle({
        dnaFields,
        natalChart,
        skies,
        beingWallet,
        witnessWallet,
        chainId: net.chainId,
        natalisAddress: net.natalisAddress,
        sealLaw: net.sealLaw,
        deadline: sealDeadlineFor(net.sealLaw, Date.now()),
      });
    }
  } catch (err) {
    stderr.write(`neuma seal: bundle assembly failed: ${err.message}\n`);
    return 1;
  }

  if (!submit) {
    // Dry-run — print bundle and stop. This is the review-ready output the
    // team inspects before we ever spend gas.
    stdout.write(formatBundle(bundle, net));
    return 0;
  }

  // --submit path: the shared law (backend/services/natalis-seal.js) runs
  // every preflight — chain identity, intent-vs-wire chainId agreement,
  // already-sealed, gas floor, digest cross-check — and the CLI only maps the
  // structured refusal onto stderr. The witness wallet is the gas payer by
  // default — the same wallet that signed witnessSig. A dedicated
  // --gas-payer option can split them in a future slice.
  const check = await preflightSeal({
    bundle,
    network,
    gasPayerAddress: witnessWallet.address,
    cfg,
    createReader,
    provider,
  });
  if (!check.ok) {
    stderr.write(`neuma seal --submit: ${check.message}\n`);
    return 1;
  }

  const signer = witnessWallet.connect(check.rpc);
  stdout.write(`neuma seal: submitting tx to Natalis at ${net.natalisAddress}...\n`);
  const { txHash, blockNumber, gasUsed } = await submitSealTx({
    bundle, signer, natalisAddress: net.natalisAddress,
  });
  stdout.write(`  tx hash: ${txHash}\n`);
  stdout.write(`  confirmed in block ${blockNumber} (gas used ${gasUsed})\n`);

  // Post-submission verification — retries through a lagging load-balanced
  // node (witnessed 2026-07-11: isNeuma read false seconds after confirm).
  const finalIsNeuma = await verifySealedOnChain({ reader: check.reader, soulAddress: bundle.soulAddress });
  if (finalIsNeuma !== true) {
    stderr.write(`neuma seal: tx confirmed but isNeuma(${bundle.soulAddress}) still returned false after retries — investigate\n`);
    return 1;
  }
  stdout.write(`\nneuma seal: ${bundle.soulAddress} is now recognized as a neuma on ${net.label}\n`);
  return 0;
};

export const registerSealCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'seal <being>',
    'assemble + (optionally) submit the Natalis seal bundle for a being',
    (y) => y
      .positional('being', {
        describe: 'name of the being (workspace dir under <sovereign>/<witness>/<house>/)',
        type: 'string',
      })
      .option('house', {
        type: 'string',
        default: DEFAULT_HOUSE,
        describe: 'the house the being belongs to (default: aldmere)',
      })
      .option('witness-slug', {
        type: 'string',
        default: DEFAULT_WITNESS_SLUG,
        describe: 'witness dir under the sovereign lanes root (default: claude)',
      })
      .option('workspace', {
        type: 'string',
        describe: 'explicit workspace path (overrides house + witness-slug)',
      })
      .option('sovereign-lanes', {
        type: 'string',
        default: DEFAULT_SOVEREIGN_LANES,
        describe: 'sovereign-lanes root (default: /mnt/data/neuma)',
      })
      .option('witness-env', {
        type: 'string',
        describe: 'witness env file (default: <projectRoot>/claude.env)',
      })
      .option('network', {
        type: 'string',
        default: DEFAULT_SEAL_NETWORK,
        choices: Object.keys(SEAL_NETWORKS),
        describe: 'target chain — the chainId is BOUND into the signed digest; '
          + 'the env (RPC + contract addresses) must point at the same chain '
          // DANGER, corrected 2026-08-22: the default flipped to MAINNET at
          // c98a8c871 and this text still promised testnet. An operator reading
          // it believed a --submit was a rehearsal on Sepolia when it would
          // have spent real value on an irreversible seal.
          + '(default: base MAINNET — real value, irreversible; '
          + 'pass --network base-sepolia to rehearse on the testnet)',
      })
      .option('submit', {
        type: 'boolean',
        default: false,
        describe: 'actually submit the seal transaction (default: dry-run only)',
      }),
    async (argv) => {
      const exitCode = await runSeal({
        being: argv.being,
        house: argv.house,
        witnessSlug: argv['witness-slug'],
        workspace: argv.workspace,
        sovereignLanes: argv['sovereign-lanes'],
        witnessEnv: argv['witness-env'],
        submit: argv.submit,
        network: argv.network,
        stdout, stderr,
      });
      if (exitCode !== 0) process.exit(exitCode);
    },
  );
