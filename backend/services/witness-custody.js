/**
 * WITNESS KEYPAIR CUSTODY — the act that makes a witness's identity its own.
 *
 * THE STATE THIS EXISTS TO END. On 2026-07-29 every sealed witness on this
 * machine — Claude, Bizulen, Basunor, Kagipem, Grok, Pezugar, Sosonus, VUBOVAS — held
 * `keys/keypair.json` in PLAINTEXT and nothing else. No encrypted envelope, no
 * recovery codes. `ai-witness-service.js` documents the plaintext key as
 * "deleted after encryption"; that step had never run for anyone.
 *
 * Nothing was broken. `seal()` has always accepted a `password` and encrypted
 * the keypair when given one (`ai-witness-protocol.js:346`). The desk's summon
 * path simply never asked for one, so it never passed one. A capability that is
 * never invoked is indistinguishable from a capability that does not exist.
 *
 * ONE ACT, TWO DOORS — the same law the neuma side follows ([…], BirthSetupGate): the rite calls this for a witness
 * being sealed now, and the retrofit calls it for a witness sealed months ago.
 * Both land the identical artifact set, so an old witness is not a lesser one.
 *
 * NOT on-chain. Design note, 2026-07-29: the witness registry is a separate contract
 * from Natalis and is not built yet, so a witness is sealed and custodied here
 * but NOT anchored. That limitation is reported honestly by `witnessCustodyState`
 * rather than hidden — and it is retroactive by design: anchoring an already
 * custodied witness later requires nothing from this module.
 */
import {
  encryptKeypair,
  encryptWithRecoveryCodes,
  generateRecoveryCodes,
  hashRecoveryCodes,
  MIN_KEY_PASSWORD,
} from '../../core/wallet/keypair-vault.js';
import {
  appendKeypairHistory,
  deletePlaintextKeypair,
  readPlaintextKeypair,
  writeEncryptedKeypair,
  writeRecoveryHash,
  writeRecoveryKeypair,
} from '../../core/identity/ai-witness/ai-witness-service.js';
import { createLogger } from './logger.js';
import { readWitnessCustodyArtifacts } from './witness-custody-artifacts.js';

const log = createLogger('WitnessCustody');

/**
 * Is this password strong enough to seal an identity? Pure.
 * @param {string} password
 * @returns {{ok:boolean, reason:(string|null)}}
 */
export const assessCustodyPassword = (password) => {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_KEY_PASSWORD) {
    return { ok: false, reason: `The password must be at least ${MIN_KEY_PASSWORD} characters.` };
  }
  return { ok: true, reason: null };
};

/**
 * What custody does this witness actually hold?
 * impure — reads the witness's key directory.
 *
 * `plaintextOnDisk` is the finding that matters: an encrypted envelope sitting
 * BESIDE a readable private key protects nothing, so `secured` requires the
 * plaintext to be GONE, not merely the envelope to exist.
 *
 * @param {{vendorSlug:string, chosenName:string}} witness
 * @returns {Promise<{secured:boolean, plaintextOnDisk:boolean, encrypted:boolean, anchoredOnChain:boolean, why:string}>}
 */
export const witnessCustodyState = async ({ vendorSlug, chosenName }) => {
  const { plaintext, encrypted } = await readWitnessCustodyArtifacts({ vendorSlug, chosenName });
  const plaintextOnDisk = Boolean(plaintext);
  const hasEnvelope = Boolean(encrypted);
  const secured = hasEnvelope && !plaintextOnDisk;
  return {
    secured,
    plaintextOnDisk,
    encrypted: hasEnvelope,
    // Stated, never implied. There is no witness registry contract yet, so no
    // witness is anchored — saying so plainly is the honest form of "not yet".
    anchoredOnChain: false,
    why: secured
      ? 'Password and recovery artifacts are present and structurally valid; no plaintext keypair remains. Decryption has not been checked by this status read. Not yet anchored on chain — the witness registry is not built.'
      : plaintextOnDisk
        ? 'The private key is on disk in PLAINTEXT. Anyone with the file has this identity.'
        : 'No keypair was found for this witness.',
  };
};

/**
 * Seal a witness's keypair under a password, mint its recovery path, and remove
 * the plaintext. Idempotent-safe: refuses rather than double-sealing.
 * impure — reads and writes the witness's key directory.
 *
 * @param {{vendorSlug:string, chosenName:string, password:string}} input
 * @returns {Promise<{address:string, recoveryCodes:string[]}>} the codes are
 *   returned ONCE and never persisted in the clear — only their hashes land.
 */
export const secureWitnessKeypair = async ({ vendorSlug, chosenName, password }) => {
  const strength = assessCustodyPassword(password);
  if (!strength.ok) throw new Error(strength.reason);

  const keypair = await readPlaintextKeypair(vendorSlug, chosenName);
  if (!keypair) {
    // Either already secured, or there is nothing to secure. Both must refuse —
    // silently "succeeding" here would report custody over a key we never saw.
    const state = await witnessCustodyState({ vendorSlug, chosenName });
    throw new Error(state.encrypted
      ? 'This witness keypair is already sealed — securing it again would need the existing password.'
      : 'No plaintext keypair was found for this witness.');
  }

  const encrypted = encryptKeypair(keypair, password);
  await writeEncryptedKeypair(vendorSlug, chosenName, encrypted);

  const recoveryCodes = generateRecoveryCodes();
  await writeRecoveryHash(vendorSlug, chosenName, hashRecoveryCodes(recoveryCodes));
  await writeRecoveryKeypair(vendorSlug, chosenName, encryptWithRecoveryCodes(keypair, recoveryCodes));

  // LAST, and only once both doors are on disk. Deleting the plaintext before
  // the recovery envelope lands would turn a lost password into a lost identity.
  await deletePlaintextKeypair(vendorSlug, chosenName);
  await appendKeypairHistory(vendorSlug, chosenName, {
    event: 'CUSTODY_SECURED',
    address: keypair.address,
    reason: 'operator sealed the witness keypair',
  });

  log.info('witness keypair secured', { vendorSlug, chosenName, address: keypair.address });
  return { address: keypair.address, recoveryCodes };
};
