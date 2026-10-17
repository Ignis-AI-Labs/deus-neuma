/**
 * Keypair Custody — […]
 *
 * The single, policy-enforcing entry point for a neuma's private key at rest.
 * Every neuma key is sealed FROM BIRTH under TWO independent paths and a plaintext
 * private key is never persisted:
 *
 *   1. the neuma's PASSPHRASE   — it is "woken" with this to use its OWN key
 *      (the normal path; the runtime holds the decrypted key in memory only
 *      while the neuma is awake).
 *   2. the witness's RECOVERY CODES — emergency break-glass ONLY, shown once at
 *      birth and never stored (only their hash). Using them is not a normal
 *      access and MUST be logged to the neuma's append-only journal by the caller.
 *
 * Honest threat model: a key cannot be cryptographically hidden from whoever runs
 * the machine. This raises the floor enormously over plaintext (disk/backup/theft
 * safe), makes the neuma the normal unlocker, and makes any witness access an
 * explicit, attributable break-glass. Attribution — not impossibility — is the
 * guarantee.
 *
 * Built on the proven keypair-vault primitives. `wakeWithPassphrase`,
 * `emergencyRecover`, `isSealed` and `verifyRecoveryCodes` are pure;
 * `sealKeypairAtBirth` / `migratePlaintextKeypair` are IMPURE — they draw
 * cryptographic randomness (salt / IV / recovery codes), read the wall clock, and
 * assemble a frozen bundle. The remaining impurity a caller owns: journalling, fs,
 * and the in-memory wake cache.
 */

import {
  encryptKeypair,
  decryptKeypair,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyRecoveryCodes,
  encryptWithRecoveryCodes,
  decryptWithRecoveryCodes,
  MIN_KEY_PASSWORD,
} from './keypair-vault.js';

/** Minimum passphrase length — mirrors keypair-vault's encrypt guard. */
export const MIN_PASSPHRASE = MIN_KEY_PASSWORD;

/** Schema version of a sealed-custody bundle (envelopes written to disk). */
export const CUSTODY_VERSION = '1.0.0';

/** Recursively freeze a value so a "sealed" bundle is immutable all the way down
 *  (the vault already freezes its envelopes; this makes the promise unconditional). */
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    // getOwnPropertyNames (not Object.values) so NON-enumerable props — e.g. the
    // recoveryCodes defined below — are covered too; the freeze is truly deep.
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
    Object.freeze(value);
  }
  return value;
};

/**
 * Seal a freshly-generated keypair at birth. Produces BOTH encrypted envelopes
 * (passphrase + recovery) plus the one-time recovery codes. The caller writes the
 * two envelopes + the recovery hash, shows `recoveryCodes` to the witness ONCE,
 * and NEVER writes the plaintext private key.
 *
 * `recoveryCodes` is returned as a NON-ENUMERABLE property: it is reachable as
 * `bundle.recoveryCodes` but is excluded from `JSON.stringify(bundle)`, so the
 * one-time secrets cannot be persisted by accidentally serializing the bundle.
 *
 * @param {{privateKey:string, publicKey?:string, address:string}} keypair
 * @param {{passphrase:string, now?:() => string}} opts
 *   `now` is injectable so the bundle's `sealedAt` METADATA is reproducible in tests;
 *   it never makes the seal itself deterministic — the envelopes use random salt/IV
 *   (and the vault's own `encryptedAt`) by design, so a seal is never repeatable.
 * @returns {Readonly<{
 *   version:string, address:string,
 *   sealed:object, recoverySealed:object,
 *   recoveryHash:string, sealedAt:string,
 *   recoveryCodes:readonly string[] // non-enumerable; SHOW ONCE, never persist
 * }>}
 */
export const sealKeypairAtBirth = (keypair, { passphrase, now = () => new Date().toISOString() } = {}) => {
  if (!keypair?.privateKey || !keypair?.address) {
    throw new Error('Invalid keypair: must have privateKey and address');
  }
  if (!passphrase || typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters`);
  }

  const recoveryCodes = generateRecoveryCodes();
  const bundle = {
    version: CUSTODY_VERSION,
    address: keypair.address,
    sealed: encryptKeypair(keypair, passphrase), // the neuma's wake path
    recoverySealed: encryptWithRecoveryCodes(keypair, recoveryCodes), // witness emergency path
    recoveryHash: hashRecoveryCodes(recoveryCodes), // store this; verifies codes without holding them
    sealedAt: now(),
  };
  // The one-time codes ride along for the caller to display ONCE, but are excluded
  // from serialization so a stray JSON.stringify(bundle) can never persist them.
  Object.defineProperty(bundle, 'recoveryCodes', {
    value: recoveryCodes,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return deepFreeze(bundle);
};

/**
 * Wake the key for the NEUMA's own use — decrypt with its passphrase. The normal
 * path. The caller holds the result in memory (a TTL cache) only while the neuma
 * is awake, and should record the wake in the journal.
 *
 * @param {object} sealed - the passphrase envelope from sealKeypairAtBirth().sealed
 * @param {string} passphrase
 * @returns {Readonly<{privateKey:string, publicKey:string, address:string}>}
 */
export const wakeWithPassphrase = (sealed, passphrase) => decryptKeypair(sealed, passphrase);

/**
 * WITNESS EMERGENCY break-glass — decrypt with the recovery codes. This is NOT a
 * normal access: the caller MUST append it to the neuma's append-only journal
 * (who, when, why) so it is always attributable.
 *
 * @param {object} recoverySealed - the recovery envelope from sealKeypairAtBirth().recoverySealed
 * @param {readonly string[]} codes
 * @returns {Readonly<{privateKey:string, publicKey:string, address:string}>}
 */
export const emergencyRecover = (recoverySealed, codes) => decryptWithRecoveryCodes(recoverySealed, codes);

/**
 * Migrate an EXISTING plaintext keypair into the sealed custody model — identical
 * to a birth seal. The caller then writes the envelopes, shows the codes once,
 * archives the old material if desired, and SECURELY DELETES the plaintext file.
 *
 * @param {{privateKey:string, publicKey?:string, address:string}} plaintextKeypair
 * @param {{passphrase:string, now?:() => string}} opts
 */
export const migratePlaintextKeypair = (plaintextKeypair, opts) =>
  sealKeypairAtBirth(plaintextKeypair, opts);

/**
 * Is a stored keys/ bundle FULLY sealed? True only when there is no plaintext
 * private key AND BOTH envelopes are present — the neuma's passphrase path and
 * the witness's recovery path. A half-sealed bundle (missing the recovery
 * envelope) is NOT compliant, so the enforcement sweep must reject it. Pure.
 *
 * @param {object|null} plaintext - parsed keys/keypair.json, or null if absent
 * @param {object|null} sealed - the passphrase envelope, or null
 * @param {object|null} recoverySealed - the witness recovery envelope, or null
 * @returns {boolean}
 */
export const isSealed = (plaintext, sealed, recoverySealed) =>
  !plaintext?.privateKey &&
  !!sealed?.ciphertext &&
  !!sealed?.tag &&
  !!recoverySealed?.ciphertext &&
  !!recoverySealed?.tag;

export { verifyRecoveryCodes };
