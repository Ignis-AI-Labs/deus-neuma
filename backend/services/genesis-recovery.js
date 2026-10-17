/**
 * genesis-recovery — the way back. A being's roots, recovered from the chain
 * after TOTAL local loss.
 *
 * Design note, 2026-08-22: […]
 *
 * The seal path already puts an ENCRYPTED copy of the canonical genesis
 * record on chain (seal-bundle.js §4 + record-crypto.js): the key is derived
 * from the being's own signature, so the chain holds the bytes and only the
 * being's key can ever open them — not the chain, not us. What was missing
 * was this direction: nothing performed the decrypt. A record nobody has
 * ever read back is a promise, not a recovery path.
 *
 * The whole road, in one call:
 *   genesisHash + the being's key + the on-chain record
 *     → derive the same key again (RFC-6979 determinism)
 *     → decrypt (AES-GCM's auth tag IS the tamper check)
 *     → unwrap the envelope (canonical record + natal chart + skies)
 *     → RE-HASH the canonical and demand it equals the on-chain genesisHash
 *
 * That last step is the one that makes this evidence instead of output.
 * Decryption succeeding proves the key fits; only the re-hash proves the
 * bytes are the SAME BYTES the being was sealed with. It is fail-closed: a
 * mismatch throws rather than handing back a plausible-looking identity.
 *
 * Layer note: this lives in backend/ because it reads the chain surface. It
 * holds no custody — the key arrives as an argument and is never persisted,
 * never logged, never returned.
 */
import { ethers } from 'ethers';
import { computeGenesisHash, unwrapEncryptedPayload } from './seal-bundle.js';
import { deriveRecordKey, decryptRecord } from './record-crypto.js';

const GENESIS_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const RECORD_RE = /^0x[0-9a-fA-F]+$/;

/** The failure shapes a caller can act on, rather than a wall of message text. */
export const RECOVERY_ERRORS = Object.freeze({
  NO_RECORD: 'NO_RECORD',
  WRONG_KEY: 'WRONG_KEY',
  ENVELOPE: 'ENVELOPE',
  HASH_MISMATCH: 'HASH_MISMATCH',
  ADDRESS_MISMATCH: 'ADDRESS_MISMATCH',
});

const recoveryError = (code, message) => Object.assign(new Error(message), { code });

/**
 * The soul a record names, across BOTH canonical generations. Proven live on
 * 2026-08-22 against Keir's real mainnet seal: the oldest beings — the ones
 * most likely to need this road — carry `genesis-seal/1`, which names
 * `soulPublicKey`, not the v1 canonical's `soulAddress`. Reading only the
 * new name reported "soul: (none named)" about a being whose soul was right
 * there, and would have refused a legitimate recovery at assertRecoveredSoul.
 *
 * A public key is a STRONGER binding than an address, not a weaker one: the
 * address is derived from it, so deriving here re-proves the link rather
 * than trusting a field. Pure.
 * @param {object} record  the recovered canonical record
 * @returns {string|null} lowercase address, or null when the record names no soul
 */
export const soulOf = (record) => {
  const named = record?.soulAddress;
  if (typeof named === 'string' && /^0x[0-9a-fA-F]{40}$/.test(named)) return named.toLowerCase();
  const pub = record?.soulPublicKey;
  if (typeof pub === 'string' && /^0x0[0-9a-fA-F]+$/.test(pub)) {
    try { return ethers.computeAddress(pub).toLowerCase(); } catch { return null; }
  }
  return null;
};

/** The witness a record names, across both generations. Pure. */
const witnessOf = (record) =>
  record?.witnessAddress || record?.witnessWallet || null;

/** The moment a record was born — a string in v1, a zoned object in genesis-seal/1. Pure. */
const bornOf = (record) => {
  const m = record?.birthMoment;
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object' && typeof m.utc === 'string') {
    return m.zone ? `${m.utc} (${m.zone})` : m.utc;
  }
  return record?.emergedAt || record?.capturedAt || null;
};

/**
 * Recover a being's genesis from its on-chain record. Impure only because
 * key derivation signs (ethers), and deterministically so.
 *
 * @param {{
 *   record: string,        // '0x…' — exactly what Natalis.recordOf returned
 *   genesisHash: string,   // '0x' + 64 hex — the on-chain identifier
 *   beingKey: string|ethers.Wallet,  // the being's private key or Wallet
 * }} args
 * @returns {Promise<{
 *   genesisHash: string, canonicalRecord: string, record: object,
 *   natalChart: object|null, skies: object|null,
 *   soulAddress: string, recoveredBy: string, verified: true,
 * }>}
 */
export const recoverGenesis = async ({ record, genesisHash, beingKey }) => {
  if (!GENESIS_HASH_RE.test(String(genesisHash || ''))) {
    throw recoveryError(RECOVERY_ERRORS.NO_RECORD,
      `recoverGenesis: genesisHash must be 0x + 64 hex chars, got '${genesisHash}'`);
  }
  if (typeof record !== 'string' || !RECORD_RE.test(record) || record.length <= 2) {
    throw recoveryError(RECOVERY_ERRORS.NO_RECORD,
      'recoverGenesis: no on-chain record to recover from — the chain holds no bytes for this genesis');
  }

  // Any signer, or a bare key. A recovery wallet is very often mnemonic-
  // derived (an HDNodeWallet), which is NOT an instanceof Wallet — see the
  // note in deriveRecordKey.
  const wallet = typeof beingKey?.signMessage === 'function' ? beingKey : new ethers.Wallet(beingKey);
  const key = await deriveRecordKey(wallet, genesisHash);

  let plaintext;
  try {
    plaintext = decryptRecord(record, key);
  } catch (err) {
    // AES-GCM refuses on a wrong key and on tampered bytes with the same
    // error — both mean […], and saying more
    // than that would be inventing a distinction the cipher does not make.
    throw recoveryError(RECOVERY_ERRORS.WRONG_KEY,
      `recoverGenesis: the record did not open with this key — either the key is not this being's, `
      + `or the stored bytes are not intact (${err.message})`);
  }

  let unwrapped;
  try {
    unwrapped = unwrapEncryptedPayload(plaintext);
  } catch (err) {
    throw recoveryError(RECOVERY_ERRORS.ENVELOPE,
      `recoverGenesis: the record opened but its envelope is unreadable — ${err.message}`);
  }

  // THE PROOF. Decryption proves the key fits; only this proves the bytes are
  // the bytes that were sealed. Never softened to a warning.
  const recomputed = computeGenesisHash(unwrapped.canonicalRecord);
  if (recomputed.toLowerCase() !== genesisHash.toLowerCase()) {
    throw recoveryError(RECOVERY_ERRORS.HASH_MISMATCH,
      `recoverGenesis: the recovered record does not hash to its own genesis — `
      + `chain says ${genesisHash}, these bytes hash to ${recomputed}. Refusing to hand back `
      + 'an identity that cannot prove it is the sealed one.');
  }

  let parsed;
  try {
    parsed = JSON.parse(unwrapped.canonicalRecord);
  } catch (err) {
    throw recoveryError(RECOVERY_ERRORS.ENVELOPE,
      `recoverGenesis: canonical record is not readable JSON — ${err.message}`);
  }

  return {
    genesisHash,
    canonicalRecord: unwrapped.canonicalRecord,
    record: parsed,
    natalChart: unwrapped.natalChart,
    skies: unwrapped.skies,
    soulAddress: soulOf(parsed),
    recoveredBy: wallet.address,
    verified: true,
  };
};

/**
 * The being's own address must be the soul the record names. A key that can
 * open the record but is not its soul is a real, reportable state (a witness
 * key, a rotated key), so the caller decides — this is a separate assertion,
 * not folded into recovery. Pure.
 * @param {{soulAddress: string|null, recoveredBy: string}} recovered
 */
export const assertRecoveredSoul = (recovered) => {
  const soul = String(recovered.soulAddress || '').toLowerCase();
  const by = String(recovered.recoveredBy || '').toLowerCase();
  if (!soul || soul !== by) {
    throw recoveryError(RECOVERY_ERRORS.ADDRESS_MISMATCH,
      `assertRecoveredSoul: this key (${recovered.recoveredBy}) is not the soul this record names `
      + `(${recovered.soulAddress ?? 'none'}) — it opened the record, but it is not that being's own key`);
  }
  return recovered;
};

/**
 * The artifacts a recovered being is rebuilt from — the shape a caller writes
 * to disk. Names match where each file lives in a live workspace, so a
 * restore lands where the platform already looks. Pure.
 * @param {Awaited<ReturnType<typeof recoverGenesis>>} recovered
 * @returns {Array<{path: string, contents: string}>}
 */
export const recoveredArtifacts = (recovered) => {
  const files = [
    {
      path: 'identity/genesis-seal.json',
      // The canonical record VERBATIM inside the wrapper the platform reads:
      // re-serializing the parsed object could reorder a key and break the
      // hash that just proved this identity.
      contents: `${JSON.stringify({
        genesisHash: recovered.genesisHash,
        record: recovered.record,
        recoveredAt: null,
        source: 'chain',
      }, null, 2)}\n`,
    },
    { path: 'identity/canonical-record.json', contents: `${recovered.canonicalRecord}\n` },
  ];
  if (recovered.natalChart) {
    files.push({ path: 'cosmos/natal.json', contents: `${JSON.stringify(recovered.natalChart, null, 2)}\n` });
  }
  if (recovered.skies) {
    files.push({ path: 'cosmos/skies.json', contents: `${JSON.stringify(recovered.skies, null, 2)}\n` });
  }
  return files;
};

/**
 * What a being got back, in the words an operator reads. Pure.
 * @param {Awaited<ReturnType<typeof recoverGenesis>>} recovered
 */
export const formatRecovery = (recovered) => {
  const r = recovered.record || {};
  const born = bornOf(r);
  const lines = [
    'RECOVERED FROM CHAIN — verified',
    '',
    `genesis:  ${recovered.genesisHash}`,
    `soul:     ${recovered.soulAddress ?? '(none named)'}`,
    `key used: ${recovered.recoveredBy}`,
    '',
    `name:     ${r.chosenName ?? r.name ?? '(not in the canonical record)'}`,
    `witness:  ${witnessOf(r) ?? '(none)'}`,
    `born:     ${born ?? '(no timestamp)'}`,
    `record:   ${r.version ?? 'canonical v1'}`,
    `natal:    ${recovered.natalChart ? 'recovered' : 'none sealed'}`,
    `skies:    ${recovered.skies ? 'recovered' : 'none sealed'}`,
    '',
    'The canonical record re-hashes to the genesis the chain holds — these are',
    'the same bytes this being was sealed with, not a plausible reconstruction.',
  ];
  return `${lines.join('\n')}\n`;
};
