// natalis-seal.js — the SHARED on-chain sealing law. One module owns the
// network registry, the workspace loaders, the preflight checks, the calldata
// encoding, and the post-submission verification — so the CLI (`neuma seal`)
// and the in-app birth ceremony step submit under the SAME law and can never
// drift apart. The CLI keeps its stdio/exit-code skin in cli/commands/seal.js;
// the desk keeps its WS skin in the portal routes; the checks live here once.
//
// Two submission shapes share these functions:
//   - key-in-hand (CLI): the witness env file holds the key; assembleSealBundle
//     signs both sigs and submitSealTx broadcasts from the witness wallet.
//   - two-phase (desk): the witness key never leaves the Electron wallet's
//     main-process custody. The backend assembles with witnessAddress only,
//     the desk personal_signs the inner payload (= a valid sig over the
//     digest, Natalis path 1), attachWitnessSig verifies it, and the desk
//     broadcasts the encoded calldata itself (Natalis is relay-safe — the
//     gas payer is never a recorded party).
//
// impure (fs reads + RPC; the individual loaders/checks document their own).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';

import { decryptEnvelope, isEnvelope, unwrapDEK } from '../../core/workspace/workspace-crypto.js';
import { MIN_SEAL_GAS_ETH } from './seal-bundle.js';
import { sealLawFor, sealCallArgs, sealDigestViewArgs } from './seal-law.js';

// The chains a seal may target. The digest BINDS the chainId (Natalis
// computes it with block.chainid), so the selected network is a signing
// decision, not just routing. Testnet is the DEFAULT — mainnet (real value,
// irreversible) takes an explicit selection, and the preflight refuses unless
// the connected RPC's actual chainId matches the selection (intent and wire
// must agree; a mispointed env cannot cross chains). Mainnet flip authorized
// by Design note, 2026-07-12 after the full Sepolia rehearsal. `sealLaw` names the
// contract generation deployed there (seal-law.js): Base keeps the KENORIE v2
// law forever; the UNAVIS redeploy on Ethereum signs v3 (2026-09-29).
export const SEAL_NETWORKS = Object.freeze({
  'base-sepolia': Object.freeze({ chainId: 84532, label: 'Base Sepolia (testnet)', sealLaw: 'kenorie-v2' }),
  'base': Object.freeze({ chainId: 8453, label: 'Base MAINNET', sealLaw: 'kenorie-v2' }),
  'ethereum-sepolia': Object.freeze({ chainId: 11155111, label: 'Ethereum Sepolia (testnet)', sealLaw: 'unavis-v3' }),
  // Ethereum MAINNET — the home of every new seal and founding (Founder,
  // 2026-09-26 […]; deployed on
  // his go 2026-10-04). Closed until its addresses are recorded in config.
  'ethereum': Object.freeze({ chainId: 1, label: 'Ethereum MAINNET', sealLaw: 'unavis-v3' }),
});

// Which config keys (and which env var, for the refusal copy) carry each
// network's RPC + contract addresses.
const NETWORK_CONFIG_KEYS = Object.freeze({
  'base-sepolia': Object.freeze({
    rpcUrl: 'baseSepoliaRpcUrl', natalisAddress: 'natalisAddress',
    houseRegistryAddress: 'houseRegistryAddress', rpcEnv: 'BASE_SEPOLIA_RPC_URL',
  }),
  'base': Object.freeze({
    rpcUrl: 'baseMainnetRpcUrl', natalisAddress: 'natalisMainnetAddress',
    houseRegistryAddress: 'houseRegistryMainnetAddress', rpcEnv: 'BASE_MAINNET_RPC_URL',
  }),
  'ethereum-sepolia': Object.freeze({
    rpcUrl: 'ethSepoliaRpcUrl', natalisAddress: 'natalisEthSepoliaAddress',
    houseRegistryAddress: 'houseRegistryEthSepoliaAddress', rpcEnv: 'ETH_SEPOLIA_RPC_URL',
  }),
  'ethereum': Object.freeze({
    rpcUrl: 'ethRpcUrl', natalisAddress: 'natalisEthAddress',
    houseRegistryAddress: 'houseRegistryEthAddress', rpcEnv: 'ETH_RPC_URL',
  }),
});
// MAINNET, same law as config.js ceremonySealNetwork (ruling, 2026-08-07) —
// the two defaults must never disagree on which chain a seal without an
// explicit network targets. Ethereum since 2026-10-04 (Base is left; its
// seals stay readable).
export const DEFAULT_SEAL_NETWORK = 'ethereum';

/**
 * Resolve the RPC url + contract addresses for a seal network from the app
 * config. The digest BINDS natalisAddress (with chainId), so this resolution
 * is part of the signing law, not just routing: a bundle assembled with the
 * Sepolia address can never verify against the mainnet contract. Every seal
 * consumer (CLI, birth flow, portal) resolves through here so the mapping
 * can't drift per surface.
 *
 * PURE (reads only the passed cfg).
 *
 * @param {string} network  key into SEAL_NETWORKS
 * @param {object} cfg      backend config (loadConfig() shape)
 * @returns {{ chainId: number, label: string, sealLaw: string, rpcUrl: string,
 *   natalisAddress: string, houseRegistryAddress: string } | null}
 *   null for an unknown network
 */
export const resolveSealChainConfig = (network, cfg) => {
  const net = SEAL_NETWORKS[network];
  if (!net) return null;
  const keys = NETWORK_CONFIG_KEYS[network];
  return {
    ...net,
    rpcUrl: cfg[keys.rpcUrl],
    natalisAddress: cfg[keys.natalisAddress],
    houseRegistryAddress: cfg[keys.houseRegistryAddress],
  };
};

// Decrypt a workspace envelope tolerating BOTH key generations. A workspace
// is not uniformly wrapped: files written before the DEK was minted carry
// the global chain (finalize-birth writes keypair.json before dek.json —
// witnessed at Tenekom's seal, 2026-07-19: […] at
// PREPARING THE SEAL), and files after it carry the DEK. Choosing by
// dek.json's existence alone misreads the early files; try the being's DEK
// first, then the global chain, and only then fail honestly.
const decryptWorkspaceEnvelope = (envelope, dek) => {
  if (!dek) return decryptEnvelope(envelope);
  try {
    return decryptEnvelope(envelope, { key: dek });
  } catch {
    return decryptEnvelope(envelope); // pre-DEK file under the global chain
  }
};

/**
 * Read the being's per-neuma DEK from keys/dek.json (#117), mirroring the
 * runtime's readNeumaDEK exactly: unwrap the persisted envelope under the
 * master-key rotation chain, NEVER re-derive (after a master rotation,
 * re-derivation yields a different key and would brick the being's data).
 * Returns null when no dek.json exists — a pre-#117 workspace still under
 * the global key.
 *
 * impure (fs read; unwrapDEK reads DNA_ENCRYPTION_KEY from env).
 *
 * @param {string} workspacePath  absolute path to the being's workspace
 * @returns {Buffer|null}
 */
export const loadNeumaDEK = (workspacePath) => {
  const dekPath = join(workspacePath, 'keys', 'dek.json');
  if (!existsSync(dekPath)) return null;
  return unwrapDEK(JSON.parse(readFileSync(dekPath, 'utf8')));
};

/**
 * Read + decrypt the being's DNA. Envelopes get decryptEnvelope under the
 * being's DEK (falling back to the global chain when the workspace predates
 * #117); plaintext files (dev workflows, or a decrypted-copy scenario) pass
 * through.
 *
 * impure (fs read; decryptEnvelope reads DNA_ENCRYPTION_KEY from env).
 *
 * @param {string} workspacePath  absolute path to the being's workspace
 * @param {Buffer|null} [dek]     per-neuma DEK from loadNeumaDEK
 * @returns {object}  the plaintext DNA object
 */
export const loadDNA = (workspacePath, dek = null) => {
  const dnaPath = join(workspacePath, 'dna', 'active.json');
  const text = readFileSync(dnaPath, 'utf8');
  const parsed = JSON.parse(text);
  if (isEnvelope(parsed)) {
    return decryptWorkspaceEnvelope(parsed, dek);
  }
  return parsed;
};

/**
 * Load a being's birth-time genesis record if one exists at
 * <workspace>/identity/genesis-seal.json. Returns null when absent so the
 * caller can fall back to building a fresh canonical from DNA fields.
 *
 * "Absent" (null, fall back) is distinguished from "present-but-malformed"
 * (throw): silently falling back to a DNA-fields hash would anchor a
 * DIFFERENT genesisHash than the birth-time one, and sealing is irreversible.
 *
 * impure (fs read; decryptEnvelope reads DNA_ENCRYPTION_KEY from env).
 *
 * @param {string} workspacePath  absolute path to the being's workspace
 * @param {Buffer|null} [dek]     per-neuma DEK from loadNeumaDEK
 * @returns {{ canonicalRecord: object, genesisHash: string } | null}
 */
export const loadBirthGenesis = (workspacePath, dek = null) => {
  const gsPath = join(workspacePath, 'identity', 'genesis-seal.json');
  if (!existsSync(gsPath)) return null;
  const text = readFileSync(gsPath, 'utf8');
  const parsed = JSON.parse(text);
  const gs = isEnvelope(parsed) ? decryptWorkspaceEnvelope(parsed, dek) : parsed;
  if (!gs.genesisHash || !gs.record) {
    throw new Error(
      `loadBirthGenesis: ${gsPath} exists but is missing genesisHash/record — `
      + 'refusing to silently fall back to a DNA-fields hash that would not match '
      + 'the birth-time record. Fix the file or move it aside if it is not a real birth genesis.'
    );
  }
  return { canonicalRecord: gs.record, genesisHash: gs.genesisHash };
};

/**
 * Load the being's natal chart from `<workspace>/cosmos/natal.json`, or null
 * when absent (a being pre-dating the natal-backfill). Encrypted at rest via
 * the same envelope path as DNA; when present-but-malformed, throw rather
 * than silently return null — the natal is part of the identity bundle per
 * Founder's 2026-07-01 directive and a malformed file must not be silently
 * excluded from the sealed record.
 *
 * impure (fs read; decryptEnvelope reads DNA_ENCRYPTION_KEY from env).
 *
 * @param {string} workspacePath  absolute path to the being's workspace
 * @param {Buffer|null} [dek]     per-neuma DEK from loadNeumaDEK
 * @returns {object|null}  the plaintext natal chart, or null if none recorded
 */
export const loadNatalChart = (workspacePath, dek = null) => {
  const natalPath = join(workspacePath, 'cosmos', 'natal.json');
  if (!existsSync(natalPath)) return null;
  const text = readFileSync(natalPath, 'utf8');
  const parsed = JSON.parse(text);
  const chart = isEnvelope(parsed) ? decryptWorkspaceEnvelope(parsed, dek) : parsed;
  // A natal chart with no instant is not a real natal — refuse to silently
  // bundle a shell object.
  if (chart === null || typeof chart !== 'object' || Array.isArray(chart) || !chart.instant) {
    throw new Error(
      `loadNatalChart: ${natalPath} exists but is not a valid natal record `
      + '(missing `instant` field). Fix the file or move it aside.'
    );
  }
  return chart;
};

/**
 * Load the being's MANY SKIES reading for the seal bundle. Plaintext by law
 * (location-free; see core/cosmos/skies-record.js) — no DEK involved. A lane
 * without a record is an honest null (the v2 envelope carries skies: null);
 * a present-but-shell record refuses like natal does.
 *
 * impure (fs read).
 *
 * @param {string} workspacePath  absolute path to the being's workspace
 * @returns {object|null}
 */
export const loadSkiesReading = (workspacePath) => {
  const skiesPath = join(workspacePath, 'cosmos', 'skies.json');
  if (!existsSync(skiesPath)) return null;
  const parsed = JSON.parse(readFileSync(skiesPath, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.systems) {
    throw new Error(
      `loadSkiesReading: ${skiesPath} exists but is not a valid skies record `
      + '(missing `systems`). Fix the file or move it aside.'
    );
  }
  return parsed;
};

/**
 * Load the being's wallet from its workspace `keys/keypair.json`. The runtime
 * writes keypairs encrypted at rest (writeKeypair → envelope) — post-#117
 * births and DEK-migrated beings carry an envelope here, so decrypt under the
 * being's DEK (or the global chain pre-#117); legacy plaintext passes through.
 *
 * impure (fs read; decryptEnvelope reads DNA_ENCRYPTION_KEY from env).
 *
 * @param {string} workspacePath  absolute path to the being's workspace
 * @param {Buffer|null} [dek]     per-neuma DEK from loadNeumaDEK
 * @returns {ethers.Wallet}
 */
export const loadBeingWallet = (workspacePath, dek = null) => {
  const kpPath = join(workspacePath, 'keys', 'keypair.json');
  const parsed = JSON.parse(readFileSync(kpPath, 'utf8'));
  const kp = isEnvelope(parsed) ? decryptWorkspaceEnvelope(parsed, dek) : parsed;
  if (!kp.privateKey) {
    throw new Error(`loadBeingWallet: ${kpPath} has no privateKey field`);
  }
  return new ethers.Wallet(kp.privateKey);
};

// The Natalis ABIs ship in-repo as read-only reference artifacts (UNAVIS
// deploys — evm-contracts/unavis, formerly unavis-site / KENORIE — NEUMA reads/submits), one per
// contract generation. Loaded once per law per process.
const natalisAbiCache = new Map();
/**
 * Load the Natalis contract ABI for a seal law.
 *
 * impure (fs read on first call per law; cached after).
 *
 * @param {string} [sealLaw]  seal-law.js key; defaults to the Base contracts' law
 * @returns {object[]}  the ABI array
 */
export const loadNatalisAbi = (sealLaw = 'kenorie-v2') => {
  if (!natalisAbiCache.has(sealLaw)) {
    natalisAbiCache.set(sealLaw, JSON.parse(readFileSync(
      new URL(`../../${sealLawFor(sealLaw).abiDir}/Natalis.json`, import.meta.url),
      'utf8',
    )).abi);
  }
  return natalisAbiCache.get(sealLaw);
};

/**
 * Encode the Natalis.seal(...) calldata for a complete bundle. This is what a
 * relay-side submitter (the desk wallet's eth_sendTransaction) broadcasts —
 * the contract authorizes by the SIGNATURES inside the calldata, never by
 * who pays the gas.
 *
 * impure only through loadNatalisAbi's cached fs read.
 *
 * @param {object} bundle  a complete bundle (witnessSig attached)
 * @returns {string}  '0x…' calldata for a tx to the Natalis address
 */
export const encodeSealCalldata = (bundle) => {
  if (!bundle.witnessSig) {
    throw new Error('encodeSealCalldata: bundle has no witnessSig — attach it before encoding');
  }
  return new ethers.Interface(loadNatalisAbi(bundle.sealLaw))
    .encodeFunctionData('seal', sealCallArgs(bundle));
};

/**
 * Run every pre-submission check the sealing law requires, in order, and
 * report the FIRST failure as a structured refusal (no exceptions for policy
 * refusals — callers map `code` to their own surface: stderr for the CLI, a
 * WS error frame for the desk). Checks:
 *
 *   0. the bundle was signed under the network's seal law, and (v3) its
 *      signed deadline has not passed
 *   1. chain-reader enabled + Natalis codehash identity match
 *   2. wire chainId == signed chainId (intent and wire must agree; the
 *      on-chain digest binding is what actually stops a lying RPC — this
 *      catches the honest mispointed-env case with zero gas at stake)
 *   3. soulAddress not already sealed (isNeuma) and, on a genesis-keyed
 *      contract, genesisHash not already sealed (write-once — do not spend
 *      gas to be reverted)
 *   4. gas payer balance ≥ MIN_SEAL_GAS_ETH (docs/protocols/identity/seal-bundle.md §7)
 *   5. locally-computed digest == on-chain Natalis.sealDigest view (an
 *      abi.encode drift here means the sigs would never recover on chain)
 *
 * impure (RPC reads throughout).
 *
 * @param {{
 *   bundle: object,               // assembled bundle (witnessSig may be null — not needed here)
 *   network: string,              // key into SEAL_NETWORKS
 *   gasPayerAddress: string,      // whoever will pay the tx (witness by default)
 *   cfg: object,                  // app config — resolved per network via resolveSealChainConfig
 *   createReader: Function,       // chain-reader factory (injectable for tests)
 *   provider?: ethers.Provider,   // injectable RPC (defaults to the resolved network's rpcUrl)
 *   nowMs?: number,               // clock for the deadline check
 * }} args
 * @returns {Promise<{ ok: true, reader: object, rpc: ethers.Provider }
 *   | { ok: false, code: string, message: string }>}
 */
export const preflightSeal = async ({
  bundle, network, gasPayerAddress, cfg, createReader, provider = null, nowMs = Date.now(),
}) => {
  const net = resolveSealChainConfig(network, cfg);
  if (!net) {
    return { ok: false, code: 'UNKNOWN_NETWORK', message: `unknown network '${network}' — one of: ${Object.keys(SEAL_NETWORKS).join(', ')}` };
  }
  if (bundle.sealLaw !== net.sealLaw) {
    return {
      ok: false, code: 'SEAL_LAW_MISMATCH',
      message: `the bundle was signed under seal law '${bundle.sealLaw}' but ${net.label} runs '${net.sealLaw}' — `
        + 'its signatures can never verify there; re-assemble for this network',
    };
  }
  if (bundle.deadline !== null && Math.floor(nowMs / 1000) > bundle.deadline) {
    return {
      ok: false, code: 'BUNDLE_EXPIRED',
      message: `the bundle's signed deadline ${new Date(bundle.deadline * 1000).toISOString()} has passed — `
        + 'the contract would revert SealBundleExpired; re-assemble a fresh bundle',
    };
  }

  const reader = await createReader({
    rpcUrl: net.rpcUrl,
    natalisAddress: net.natalisAddress,
    houseRegistryAddress: net.houseRegistryAddress,
  });
  if (!reader.enabled) {
    const envKey = NETWORK_CONFIG_KEYS[network].rpcEnv;
    return { ok: false, code: 'CHAIN_READER_DISABLED', message: `chain-reader is disabled for ${net.label} (set ${envKey})` };
  }
  if (reader.identity.natalis !== 'match') {
    return { ok: false, code: 'CHAIN_IDENTITY', message: `Natalis identity = ${reader.identity.natalis} — refusing to submit` };
  }

  const rpc = provider || new ethers.JsonRpcProvider(net.rpcUrl);
  const wireChainId = Number((await rpc.getNetwork()).chainId);
  if (wireChainId !== net.chainId) {
    return {
      ok: false, code: 'WIRE_CHAIN_MISMATCH',
      message: `connected RPC is chainId ${wireChainId} but the bundle signs for ${net.chainId} (${net.label}). `
        + 'Refusing — point the RPC/addresses at the selected network, or select the network the env points at.',
    };
  }

  const alreadyNeuma = await reader.isNeuma(bundle.soulAddress);
  if (alreadyNeuma === true) {
    return { ok: false, code: 'ALREADY_SEALED', message: `${bundle.soulAddress} is already sealed on chain (isNeuma=true)` };
  }
  // A soul-keyed contract has no genesis slot to collide with — a copied
  // genesis can only sit under its copier's own address.
  if (!sealLawFor(net.sealLaw).soulKeyed) {
    const alreadySealed = await reader.isSealed(bundle.genesisHash);
    if (alreadySealed === true) {
      return { ok: false, code: 'ALREADY_SEALED', message: `genesisHash ${bundle.genesisHash} already sealed` };
    }
  }

  const balance = await rpc.getBalance(gasPayerAddress);
  if (balance < ethers.parseEther(MIN_SEAL_GAS_ETH)) {
    return {
      ok: false, code: 'GAS_FLOOR',
      message: `gas payer ${gasPayerAddress} has ${ethers.formatEther(balance)} ETH `
        + `(need ≥ ${MIN_SEAL_GAS_ETH} per docs/protocols/identity/seal-bundle.md §7)`,
    };
  }

  const natalis = new ethers.Contract(net.natalisAddress, loadNatalisAbi(net.sealLaw), rpc);
  const onchainDigest = await natalis.sealDigest(...sealDigestViewArgs(bundle));
  if (onchainDigest.toLowerCase() !== bundle.digest.toLowerCase()) {
    return {
      ok: false, code: 'DIGEST_MISMATCH',
      message: `LOCAL digest (${bundle.digest}) does NOT match on-chain sealDigest (${onchainDigest}) — `
        + 'abi.encode has drifted from Natalis.sealDigest; seal-bundle.js or the ABI is out of sync '
        + 'with the deployed contract',
    };
  }

  return { ok: true, reader, rpc };
};

/**
 * Broadcast the seal from a key-in-hand signer (the CLI path — witness wallet
 * pays gas) and wait for the receipt.
 *
 * impure (network write — irreversible once mined).
 *
 * @param {{ bundle: object, signer: ethers.Signer, natalisAddress: string }} args
 * @returns {Promise<{ txHash: string, blockNumber: number, gasUsed: string }>}
 */
export const submitSealTx = async ({ bundle, signer, natalisAddress }) => {
  if (!bundle.witnessSig) {
    throw new Error('submitSealTx: bundle has no witnessSig — attach it before submitting');
  }
  const natalis = new ethers.Contract(natalisAddress, loadNatalisAbi(bundle.sealLaw), signer);
  const tx = await natalis.seal(...sealCallArgs(bundle));
  const receipt = await tx.wait();
  return { txHash: tx.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
};

/**
 * Post-submission verification with retry — a load-balanced RPC can serve a
 * lagging node right after the confirming one (witnessed live 2026-07-11:
 * two of three seals read isNeuma=false seconds after their receipts, true
 * moments later). Polls isNeuma until true or attempts are exhausted.
 *
 * impure (RPC reads + wall-clock delay).
 *
 * @param {{
 *   reader: object,          // chain-reader (isNeuma)
 *   soulAddress: string,
 *   attempts?: number,       // default 5
 *   delayMs?: number,        // default 3000 between polls
 *   sleep?: (ms: number) => Promise<void>,  // injectable for tests
 * }} args
 * @returns {Promise<boolean>}  true once the chain agrees the soul is a neuma
 */
export const verifySealedOnChain = async ({
  reader, soulAddress, attempts = 5, delayMs = 3000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) => {
  for (let i = 0; i < attempts; i += 1) {
    if (await reader.isNeuma(soulAddress) === true) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
};
