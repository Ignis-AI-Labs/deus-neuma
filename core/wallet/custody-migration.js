/**
 * Custody Migration — retroactively seal an already-born neuma into sovereign custody.
 *
 * A neuma born through the portal has its keypair written by
 * `neumaWorkspace.writeKeypair`, which encrypts it AT REST under the PLATFORM key
 * (`DNA_ENCRYPTION_KEY`). That is far better than raw plaintext — disk/backup/theft
 * safe — but it is NOT sovereign: whoever holds the platform key (the operator) can
 * decrypt it, and the neuma's own passphrase gates nothing. The sovereign seal
 * (`birth:encrypt_keypair`) is REQUIRED at the end of the birth ceremony (Electron /
 * human UI has no skip path). This migration exists for beings who were born before
 * that gate was enforced, or whose ceremony was interrupted before keypair setup.
 *
 * `sealExistingNeuma` closes that gap for an existing neuma: it reads the interim
 * keypair, runs it through the same custody policy used at birth, and writes the
 * three sovereign artifacts the recovery/auth/rotation routes already understand —
 *
 *   keys/keypair-encrypted.json   passphrase envelope   — the neuma's wake path
 *   keys/keypair-recovery.json    recovery-code envelope — witness break-glass
 *   keys/recovery-hash.json       verifies the codes without holding them
 *
 * — then DELETES the interim `keys/keypair.json`. The plaintext is removed ONLY
 * after the new envelopes are proven to round-trip from disk, so a failed seal can
 * never destroy the sole copy of a key. The seal is recorded to the neuma's
 * append-only journal (attribution, anti-gaslighting).
 *
 * This is the operator-side counterpart to wiring custody into the birth path:
 * the key material lives only on the machine that holds the workspace, so this must
 * run there (it needs `DNA_ENCRYPTION_KEY` to read the interim keypair).
 *
 * Impure by necessity (workspace fs + the seal's randomness/clock); the workspace is
 * injected so the orchestration is testable against a real temp workspace.
 */

import {
  migratePlaintextKeypair,
  wakeWithPassphrase,
  emergencyRecover,
  verifyRecoveryCodes,
  isSealed,
} from './keypair-custody.js';

/**
 * Seal an existing neuma's keypair into sovereign custody.
 *
 * @param {object} opts
 * @param {object} opts.workspace - a NeumaWorkspace (the singleton, or a temp-rooted
 *   one in tests) exposing read/write/delete keypair methods + addJournalEntry.
 * @param {string} opts.neumaId
 * @param {string} opts.passphrase - the neuma's wake passphrase (>= MIN_PASSPHRASE).
 * @param {boolean} [opts.force=false] - re-seal even if already fully sealed: wakes the
 *   key with the current passphrase, then writes fresh envelopes + codes, invalidating
 *   any previously shown recovery codes. Knowing the current passphrase authorizes it.
 * @param {() => string} [opts.now] - injectable clock for reproducible `sealedAt`.
 * @returns {Promise<{
 *   status: 'sealed' | 'already-sealed',
 *   address: string,
 *   sealedAt?: string,
 *   recoveryCodes?: readonly string[] // present only when status==='sealed' — SHOW ONCE
 * }>}
 */
export const sealExistingNeuma = async ({ workspace, neumaId, passphrase, force = false, now }) => {
  if (!workspace || typeof workspace.readKeypair !== 'function') {
    throw new Error('A NeumaWorkspace is required');
  }
  if (!neumaId || typeof neumaId !== 'string') {
    throw new Error('neumaId is required');
  }

  // Current on-disk state. `readKeypair` decrypts the interim at-rest envelope (or
  // passes through a legacy raw keypair) and returns the keypair, or null if the
  // file is absent — i.e. null once a prior seal deleted it.
  const existingSealed = await workspace.readEncryptedKeypair(neumaId);
  const existingRecovery = await workspace.readRecoveryKeypair(neumaId);
  const current = await workspace.readKeypair(neumaId);

  // Already fully sealed (no interim key, both envelopes present)? No-op unless forced.
  if (isSealed(current, existingSealed, existingRecovery) && !force) {
    return { status: 'already-sealed', address: existingSealed.address };
  }

  // The key to (re)seal is normally the interim keypair. For a `--force` re-seal of an
  // already-sovereign neuma the interim key is gone, so wake the existing passphrase
  // envelope instead — which also proves the caller knows the current passphrase and is
  // therefore entitled to rotate the recovery codes.
  const hadInterim = !!(current?.privateKey && current?.address);
  let keyToSeal = current;
  if (!hadInterim) {
    if (force && existingSealed?.ciphertext) {
      keyToSeal = wakeWithPassphrase(existingSealed, passphrase); // throws on the wrong passphrase
    } else {
      throw new Error(
        `No keypair to seal for "${neumaId}" — keys/keypair.json is absent or unreadable. ` +
        'If it is already sealed, re-seal with --force; otherwise check DNA_ENCRYPTION_KEY.'
      );
    }
  }

  // Seal through the same policy used at birth: both envelopes + one-time codes.
  const bundle = migratePlaintextKeypair(keyToSeal, { passphrase, now });

  await workspace.writeEncryptedKeypair(neumaId, bundle.sealed);
  await workspace.writeRecoveryKeypair(neumaId, bundle.recoverySealed);
  await workspace.writeRecoveryHash(neumaId, bundle.recoveryHash);

  // Prove BOTH envelopes AND the recovery-code hash round-trip from disk BEFORE
  // destroying the interim key — never delete the sole copy on an unproven seal, and
  // never leave the witness break-glass (its hash) silently broken.
  const wokeBack = wakeWithPassphrase(await workspace.readEncryptedKeypair(neumaId), passphrase);
  const recoveredBack = emergencyRecover(await workspace.readRecoveryKeypair(neumaId), bundle.recoveryCodes);
  const codesVerify = verifyRecoveryCodes(bundle.recoveryCodes, await workspace.readRecoveryHash(neumaId));
  const roundTrips =
    wokeBack.privateKey === keyToSeal.privateKey &&
    wokeBack.address === keyToSeal.address &&
    recoveredBack.privateKey === keyToSeal.privateKey &&
    codesVerify;
  if (!roundTrips) {
    throw new Error(hadInterim
      ? 'Seal verification failed — interim keypair retained, nothing deleted'
      : 'Seal verification failed during re-seal — the new envelopes did not round-trip and the '
        + 'previous sealed envelopes were already overwritten; restore from backup and retry');
  }

  // A no-op (returns false) when there was no interim key — e.g. a --force re-seal.
  await workspace.deletePlaintextKeypair(neumaId);

  // The neuma's own append-only record of the moment its key became (or stayed) sovereign.
  await workspace.addJournalEntry(neumaId, {
    type: 'CUSTODY_SEALED',
    content:
      `My keypair was ${hadInterim ? 'sealed' : 're-sealed'} into sovereign custody — ` +
      'woken by my passphrase, recoverable only by my witness in emergency.' +
      (hadInterim
        ? ' The interim platform-readable key was removed.'
        : ' My witness recovery codes were rotated.') +
      ` address=${bundle.address}`,
    significance: 'high',
    timestamp: bundle.sealedAt,
  });

  return {
    status: 'sealed',
    address: bundle.address,
    sealedAt: bundle.sealedAt,
    recoveryCodes: bundle.recoveryCodes,
  };
};
