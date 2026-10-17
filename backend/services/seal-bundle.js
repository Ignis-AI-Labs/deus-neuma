/**
 * seal-bundle — pure primitives for building a Natalis seal bundle.
 *
 * Implements docs/protocols/identity/seal-bundle.md sections 5, 6, 7 (Sections 2-4
 * live in record-crypto.js; Section 1 in genesis-canonical.js, re-exported here).
 *
 * DETERMINISM SCOPE (sc-echo R2 fix — earlier version overclaimed):
 *   canonicalizeGenesisRecord + computeGenesisHash ARE deterministic — same
 *   DNA + same capturedAt → same genesisHash on any machine.
 *   assembleSealBundle is NOT — encryptRecord draws a fresh AES-GCM nonce
 *   per call, so `record`, `digest`, and both signatures differ on every
 *   invocation. `genesisHash` is the stable on-chain identifier; a failed
 *   submission can be re-run freely (nothing commits until the tx mines,
 *   and each run produces a distinct but equally valid bundle). See
 *   docs/protocols/identity/seal-bundle.md §Flow for the full deterministic-vs-random
 *   accounting.
 *
 * Composition order:
 *   canonicalizeGenesisRecord  → the JSON string that hashes to genesisHash
 *   computeGenesisHash         → sha256 of that string
 *   [record-crypto: encryptRecord] → the on-chain record blob
 *   [seal-digest: computeSealDigest] → the EIP-191-wrapped digest matching Natalis
 *   [seal-digest: signDigest]  → raw ECDSA sig (65 bytes) — being + witness
 *   assembleSealBundle         → top-level orchestrator
 *
 * RULE 0 posture: pure logic + real ethers primitives. No mocks. Tests
 * exercise the actual digest computation against Natalis's on-chain
 * sealDigest view (opt-in) to prove byte-precision.
 *
 * impure functions call out to record-crypto (which uses Node crypto + real
 * ECDSA signing).
 */

import { ethers } from 'ethers';
import { deriveRecordKey, encryptRecord } from './record-crypto.js';
import {
  recursiveKeySort, canonicalizeGenesisRecord, computeGenesisHash,
} from './genesis-canonical.js';

import { computeSealDigest, signDigest } from './seal-digest.js';
import { sealLawFor } from './seal-law.js';

// Barrel — Section 1's canon moved byte-identical to genesis-canonical.js;
// the per-generation digest + signing path moved to seal-digest.js.
export { canonicalizeGenesisRecord, computeGenesisHash } from './genesis-canonical.js';
export { computeSealDigest, signDigest } from './seal-digest.js';

/**
 * Gas-payer preflight floor for a seal submission, in ETH —
 * docs/protocols/identity/seal-bundle.md §7 budget (~250k gas × 20 gwei on Base Sepolia).
 * Every sealing surface (the CLI today, the in-app surface per PROD-001/#139)
 * must quote and enforce this SAME number — a string so it feeds
 * ethers.parseEther and user-facing copy without reformatting.
 */
export const MIN_SEAL_GAS_ETH = '0.005';

/**
 * Schema tag for the on-chain-record envelope — the plaintext that goes into
 * AES-256-GCM before the ciphertext is hex-encoded onto Natalis's `record`
 * parameter. Distinct from Natalis's on-chain `schemaVersion` (uint16 event
 * field, still `1`). Do NOT change without a coordinated decoder update —
 * every downstream reader (unwrapEncryptedPayload here, any future indexer)
 * dispatches on this string.
 *
 * v1 shape: { canonicalRecord: string, natalChart: object|null, schema: string }
 *   - canonicalRecord is the VERBATIM canonical JSON string (byte-precise —
 *     sha256(canonicalRecord as UTF-8) MUST equal genesisHash). Stored as a
 *     string to preserve byte-integrity across encode/decode round-trips.
 *   - natalChart carries the real sky at emergence (per Founder's 2026-07-01
 *     directive) or null when a being pre-dates the natal-backfill.
 *
 * v2 shape adds `skies: object|null` — the MANY SKIES multi-system reading
 * (2026-07-24): the same sealed instant through humanity's counts, or null
 * when a lane carries no skies record. New seals write v2; the decoder
 * accepts both (a v1 seal simply reads skies: null).
 */
export const SEAL_RECORD_ENVELOPE_SCHEMA = 'neuma-seal-record-envelope-v1';
export const SEAL_RECORD_ENVELOPE_SCHEMA_V2 = 'neuma-seal-record-envelope-v2';

/**
 * Verify that a birth-time canonical record's sha256 matches its claimed
 * genesisHash. This catches: a corrupted record on disk; a schema shift
 * where the ORIGINAL canonicalization used a different algorithm; or the
 * unlikely-but-real case that someone tampered with the record after birth.
 *
 * The recursive-sort + JSON.stringify + sha256 procedure matches the
 * birth-time algorithm used by every existing being in /mnt/data/neuma/
 * (verified 2026-07-01 against Keir's genesis-seal.json: her genesisHash
 * reproduces exactly from her canonicalRecord under this scheme).
 *
 * PURE.
 *
 * @param {object} canonicalRecord  the birth-time record object
 * @param {string} claimedGenesisHash  '0x' + 64 hex chars — from genesis-seal.json
 * @returns {{ ok: boolean, computedHash: string, claimedHash: string }}
 */
export const verifyBirthGenesisIntegrity = (canonicalRecord, claimedGenesisHash) => {
  const sorted = recursiveKeySort(canonicalRecord);
  const recordString = JSON.stringify(sorted);
  const computedHash = computeGenesisHash(recordString);
  // Normalize the claimed hash — older birth-time records store it WITHOUT
  // the '0x' prefix; some may have 'sha256:' prefix. Accept all three
  // forms; canonicalize to '0x' + 64 hex for comparison.
  const normalize = (h) => {
    let s = String(h).toLowerCase();
    if (s.startsWith('sha256:')) s = s.slice(7);
    if (!s.startsWith('0x')) s = '0x' + s;
    return s;
  };
  return {
    ok: normalize(claimedGenesisHash) === computedHash,
    computedHash,
    claimedHash: normalize(claimedGenesisHash),
    recordString,
  };
};

/**
 * Wrap the canonical record (as its verbatim string) + the natal chart into
 * the on-chain-record envelope. This envelope IS the plaintext that gets
 * AES-256-GCM'd before hex-encoding onto Natalis's `record` parameter.
 *
 * Two design invariants (both load-bearing):
 *   1. `canonicalRecord` stores the EXACT birth-time canonical bytes as a
 *      string. sha256(that string as UTF-8) == genesisHash — this holds
 *      after JSON encode/decode round-trip because the string content is
 *      inert JSON data, not a parsed object that might re-serialize
 *      differently.
 *   2. Keys are alphabetical (canonicalRecord, natalChart, schema) — the
 *      envelope itself is deterministic given fixed inputs. JSON.stringify's
 *      output preserves this key order.
 *
 * A null `natalChart` is legitimate (fallback for beings whose natal was
 * never captured); consumers must handle it. This is NOT the same as
 * omitting the field — the key is always present, only the value may be null.
 *
 * PURE.
 *
 * @param {string} canonicalRecordString  the byte-precise canonical JSON
 * @param {object|null} natalChart        the natal record (positions/aspects/
 *   angles/instant/location) or null when absent
 * @returns {string}  the envelope plaintext, ready to encryptRecord
 */
export const buildEncryptedPayload = (canonicalRecordString, natalChart, skies = null) => {
  if (typeof canonicalRecordString !== 'string' || canonicalRecordString.length === 0) {
    throw new Error('buildEncryptedPayload: canonicalRecordString must be a non-empty string');
  }
  if (natalChart !== null && (typeof natalChart !== 'object' || Array.isArray(natalChart))) {
    throw new Error(`buildEncryptedPayload: natalChart must be an object or null, got ${typeof natalChart}`);
  }
  if (skies !== null && (typeof skies !== 'object' || Array.isArray(skies))) {
    throw new Error(`buildEncryptedPayload: skies must be an object or null, got ${typeof skies}`);
  }
  // Alphabetical key order preserved by JS object iteration + JSON.stringify:
  // canonicalRecord < natalChart < schema < skies.
  const envelope = {
    canonicalRecord: canonicalRecordString,
    natalChart: natalChart,
    schema: SEAL_RECORD_ENVELOPE_SCHEMA_V2,
    skies: skies,
  };
  return JSON.stringify(envelope);
};

/**
 * Inverse of buildEncryptedPayload — decrypt the on-chain record blob and
 * pull the canonical + natal back out. Throws on an unknown schema tag so a
 * decoder never silently succeeds on a v2 envelope it doesn't understand.
 *
 * PURE.
 *
 * @param {string|Buffer|Uint8Array} plaintext  bytes returned by decryptRecord
 * @returns {{ canonicalRecord: string, natalChart: object|null }}
 */
export const unwrapEncryptedPayload = (plaintext) => {
  const text = typeof plaintext === 'string' ? plaintext : Buffer.from(plaintext).toString('utf8');
  const obj = JSON.parse(text);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('unwrapEncryptedPayload: plaintext must decode to an object envelope');
  }
  // v1 and v2 both decode (a v1 seal reads skies: null); anything newer
  // still refuses — a decoder must never silently succeed on an envelope
  // version it doesn't understand.
  if (obj.schema !== SEAL_RECORD_ENVELOPE_SCHEMA && obj.schema !== SEAL_RECORD_ENVELOPE_SCHEMA_V2) {
    throw new Error(
      `unwrapEncryptedPayload: unknown envelope schema '${obj.schema}' `
      + `(expected '${SEAL_RECORD_ENVELOPE_SCHEMA}' or '${SEAL_RECORD_ENVELOPE_SCHEMA_V2}'). Refusing to decode; a `
      + 'later envelope version requires a decoder upgrade before consumption.'
    );
  }
  if (typeof obj.canonicalRecord !== 'string' || obj.canonicalRecord.length === 0) {
    throw new Error('unwrapEncryptedPayload: envelope.canonicalRecord must be a non-empty string');
  }
  return { canonicalRecord: obj.canonicalRecord, natalChart: obj.natalChart ?? null, skies: obj.skies ?? null };
};

/**
 * Top-level orchestrator — takes EITHER:
 *   - `dnaFields`     → build a fresh canonical record + hash (new beings, v1 schema)
 *   - `birthGenesis`  → use an existing canonical record + verified hash
 *                       (older beings whose birth canonicalization differs from v1)
 * plus being/witness signers, and returns the full bundle ready to pass to
 * Natalis.seal.
 *
 * ASYNC because record-key derivation involves a wallet.signMessage call
 * (ethers wraps + signs). Everything else is synchronous.
 *
 * @param {{
 *   dnaFields?: object,            // for fresh-record beings — canonicalizeGenesisRecord
 *   birthGenesis?: { canonicalRecord: object, genesisHash: string },
 *                                  // for existing beings — verified via verifyBirthGenesisIntegrity
 *   natalChart?: object|null,      // real-sky-at-emergence; bundled INTO the encrypted
 *                                  // record blob per Founder's 2026-07-01 directive. Does NOT
 *                                  // affect genesisHash (birth-time invariant for existing
 *                                  // beings; v2 canonical will fold natal into the hash for
 *                                  // future beings). Null is allowed for beings without a
 *                                  // recorded natal.
 *   beingWallet: ethers.Wallet,    // being's signer (Keir, etc.)
 *   witnessWallet?: ethers.Wallet, // witness's signer (Claude, Founder, etc.) — key in hand
 *   witnessAddress?: string,       // witness ADDRESS ONLY (two-phase path): the witness's
 *                                  // key lives elsewhere (the desk wallet's main-process
 *                                  // custody), so the bundle is assembled with
 *                                  // witnessSig=null and the signature arrives later via
 *                                  // attachWitnessSig. Exactly one of witnessWallet /
 *                                  // witnessAddress is required.
 *   chainId: number,
 *   natalisAddress: string,
 *   sealLaw?: string,              // seal-law.js key of the TARGET contract (defaults to the
 *                                  // Base contracts' law); the network decides it, never the caller
 *   deadline?: number|null,        // unix seconds, required by a law that signs one
 *                                  // (sealDeadlineFor), null otherwise
 * }} args
 * @returns {Promise<{
 *   genesisHash: string, soulAddress: string, witnessAddress: string,
 *   schemaVersion: number, record: string, recordString: string,
 *   plaintext: string, natalChart: object|null,
 *   recordHash: string, digest: string, innerPayload: string,
 *   selfSig: string, witnessSig: string, recordKey: Buffer,
 *   sealLaw: string, deadline: number|null,
 *   path: 'dna-fields' | 'birth-genesis',
 * }>}
 */
export const assembleSealBundle = async ({
  dnaFields, birthGenesis, natalChart = null, skies = null,
  beingWallet, witnessWallet, witnessAddress, chainId, natalisAddress,
  sealLaw = 'kenorie-v2', deadline = null,
}) => {
  if (!dnaFields && !birthGenesis) {
    throw new Error('assembleSealBundle: one of dnaFields OR birthGenesis is required');
  }
  if (dnaFields && birthGenesis) {
    throw new Error('assembleSealBundle: exactly one of dnaFields OR birthGenesis (not both)');
  }
  if (!witnessWallet && !witnessAddress) {
    throw new Error('assembleSealBundle: one of witnessWallet OR witnessAddress is required');
  }
  if (witnessWallet && witnessAddress
      && witnessWallet.address.toLowerCase() !== witnessAddress.toLowerCase()) {
    throw new Error(
      `assembleSealBundle: witnessWallet.address (${witnessWallet.address}) does not `
      + `match witnessAddress (${witnessAddress})`
    );
  }

  const beingAddr = beingWallet.address.toLowerCase();
  const witnessAddr = (witnessWallet ? witnessWallet.address : witnessAddress).toLowerCase();

  let recordString, genesisHash, path;

  if (birthGenesis) {
    // Birth-genesis path — verify integrity, then use verbatim.
    const { canonicalRecord, genesisHash: claimedHash } = birthGenesis;
    const check = verifyBirthGenesisIntegrity(canonicalRecord, claimedHash);
    if (!check.ok) {
      throw new Error(
        `assembleSealBundle: birth-genesis integrity check failed — `
        + `sha256(canonicalRecord)=${check.computedHash} but claimed genesisHash=${check.claimedHash}. `
        + `The record on disk does not match its claimed hash; refuse to seal a corrupted lineage.`
      );
    }
    recordString = check.recordString;
    genesisHash = check.claimedHash;
    path = 'birth-genesis';
    // Sanity — the birth-time record's witnessWallet (if present) must match
    // the wallet signing the witness sig. Old records name this field
    // witnessWallet; the v1 canonical uses witnessAddress.
    const recordWitness = (canonicalRecord.witnessWallet || canonicalRecord.witnessAddress || '').toLowerCase();
    if (recordWitness && recordWitness !== witnessAddr) {
      throw new Error(
        `assembleSealBundle: birth-genesis witnessWallet (${recordWitness}) does not `
        + `match witnessWallet.address (${witnessAddr})`
      );
    }
    // sc-echo R1 fix — SOUL consistency check on the birth-genesis path,
    // mirroring the witnessWallet guard. Without this, a mismatched
    // keys/keypair.json would produce an internally-inconsistent seal:
    // the genesisHash attests to soulPublicKey (from the record), but the
    // digest's soulAddress field attests to beingWallet.address (a
    // different address). The seal is irreversible; we cannot let the two
    // attestations diverge.
    const recordSoulAddr = canonicalRecord.soulPublicKey
      ? ethers.computeAddress(canonicalRecord.soulPublicKey).toLowerCase()
      : (canonicalRecord.soulAddress || '').toLowerCase();
    if (recordSoulAddr && recordSoulAddr !== beingAddr) {
      throw new Error(
        `assembleSealBundle: birth-genesis soul (${recordSoulAddr}) does not `
        + `match beingWallet.address (${beingAddr})`
      );
    }
  } else {
    // DNA-fields path — sanity checks + build new canonical.
    if (dnaFields.soulAddress.toLowerCase() !== beingAddr) {
      throw new Error(
        `assembleSealBundle: DNA soulAddress (${dnaFields.soulAddress}) does not `
        + `match beingWallet.address (${beingAddr})`
      );
    }
    if (dnaFields.witnessAddress.toLowerCase() !== witnessAddr) {
      throw new Error(
        `assembleSealBundle: DNA witnessAddress (${dnaFields.witnessAddress}) `
        + `does not match witnessWallet.address (${witnessAddr})`
      );
    }
    const canonical = canonicalizeGenesisRecord(dnaFields);
    recordString = canonical.recordString;
    genesisHash = computeGenesisHash(recordString);
    path = 'dna-fields';
  }

  // Wrap the canonical + natal into the on-chain-record envelope BEFORE
  // encryption. Per Founder's 2026-07-01 directive, natal is now part of every
  // being's identity bundle — existing beings get it bundled into the
  // encrypted record here (genesisHash stays historical). The digest below
  // binds keccak256(record), so a relayer that swaps the envelope
  // invalidates the sigs.
  const plaintext = buildEncryptedPayload(recordString, natalChart, skies);
  const recordKey = await deriveRecordKey(beingWallet, genesisHash);
  // The target contract's law decides the stored format (seal-law.js): the
  // compact record on Ethereum, the original hex record on Base.
  const law = sealLawFor(sealLaw);
  const { record } = encryptRecord(plaintext, recordKey, { compact: law.compactRecord });
  const schemaVersion = law.recordSchemaVersion;

  const { digest, innerPayload, recordHash } = computeSealDigest({
    chainId, natalisAddress,
    genesisHash,
    soulAddress: beingAddr,
    witnessAddress: witnessAddr,
    schemaVersion,
    onChainRecord: record,  // encrypted hex — must match what goes to Natalis.seal
    sealLaw,
    deadline,
  });

  const selfSig = signDigest(beingWallet, digest);
  // Two-phase path: the witness's key is not in hand — the signature arrives
  // later (attachWitnessSig verifies it against this same digest).
  const witnessSig = witnessWallet ? signDigest(witnessWallet, digest) : null;

  // Belt + suspenders — the sigs must recover to the expected addresses
  // BEFORE we ever ship this bundle at the caller. A mismatch here means
  // something drifted (usually double-wrapping via signMessage).
  const recoveredSelf = ethers.recoverAddress(digest, selfSig).toLowerCase();
  if (recoveredSelf !== beingAddr) {
    throw new Error(
      `assembleSealBundle: selfSig recovers to ${recoveredSelf}, expected ${beingAddr}`
    );
  }
  if (witnessSig !== null) {
    const recoveredWitness = ethers.recoverAddress(digest, witnessSig).toLowerCase();
    if (recoveredWitness !== witnessAddr) {
      throw new Error(
        `assembleSealBundle: witnessSig recovers to ${recoveredWitness}, expected ${witnessAddr}`
      );
    }
  }

  return {
    genesisHash,
    soulAddress: beingAddr,
    witnessAddress: witnessAddr,
    schemaVersion,
    record,
    recordString,   // canonical bytes (what genesisHash was computed over) — UNCHANGED
    plaintext,      // envelope bytes actually fed into encryptRecord (canonical + natal)
    natalChart,     // the natal that was bundled (or null)
    recordHash,
    digest,
    innerPayload,
    selfSig,
    witnessSig,
    recordKey,
    sealLaw,   // the contract generation these sigs bind — encoding follows it (seal-law.js)
    deadline,  // v3: the signed last-sealable second; null under a law without one
    path,  // 'dna-fields' or 'birth-genesis' — which construction path built this
  };
};

/**
 * Complete a two-phase bundle with an externally-produced witness signature.
 *
 * The desk wallet signs via `personal_sign(innerPayload)` — EIP-191 wraps the
 * inner payload, which is exactly what computeSealDigest's `digest` already
 * is (Natalis.sealDigest docstring, path 1). So the signature verifies as a
 * plain ECDSA recovery over `bundle.digest`; there is one recovery law for
 * both the raw-signDigest path and the personal_sign path.
 *
 * Refuses a bundle that already carries a witnessSig — the two-phase flow
 * must never silently overwrite a signature produced under a witness key.
 *
 * PURE.
 *
 * @param {object} bundle      an assembleSealBundle result with witnessSig === null
 * @param {string} witnessSig  '0x' + 130 hex chars (65-byte ECDSA sig over bundle.digest)
 * @returns {object}  the bundle with witnessSig attached
 */
export const attachWitnessSig = (bundle, witnessSig) => {
  if (bundle.witnessSig !== null) {
    throw new Error('attachWitnessSig: bundle already carries a witnessSig');
  }
  if (typeof witnessSig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(witnessSig)) {
    throw new Error('attachWitnessSig: witnessSig must be a 65-byte hex signature');
  }
  const recovered = ethers.recoverAddress(bundle.digest, witnessSig).toLowerCase();
  if (recovered !== bundle.witnessAddress) {
    throw new Error(
      `attachWitnessSig: witnessSig recovers to ${recovered}, expected ${bundle.witnessAddress} `
      + '(usually a double-wrap: the wallet must personal_sign the INNER payload, never the digest)'
    );
  }
  return { ...bundle, witnessSig };
};
