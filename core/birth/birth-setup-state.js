// Birth setup state — the post-ceremony checklist every full birth owes,
// classified from the being's lane on disk.
//
// The ceremony (stages 0-6) ends at birth:complete, but a FULL birth also
// owes two acts, driven in the app by the operator:
//   1. keypair custody — the interim plaintext keys/keypair.json is replaced
//      by the password envelope (keys/keypair-encrypted.json), the recovery
//      envelope (keys/keypair-recovery.json), and the recovery hash
//      (keys/recovery-hash.json)
//   2. a seal — on this computer (identity/local-seal.json, signed by the being
//      and the operator; core/identity/local-seal.js) OR on Ethereum (the
//      Natalis anchor, identity/onchain-seal.json). Either one completes the
//      birth: a person who wants nothing to do with crypto is never left owing
//      the chain (2026-10-26). The anchor is reported, never owed.
//
// A crash, a closed laptop, or a script-driven salvage (Zezebur, 2026-07-21)
// can leave a being fully born but with these acts owed. This probe is the
// durable record that lets a relaunched app say exactly what still stands
// between the being and a finished birth — disk truth only, no network.
// (The seal flow itself double-checks the chain and refuses an ALREADY_SEALED
// repeat, so a stale disk record can never cause a double anchor.)
//
// Read-only: never mutates the workspace.

import fs from 'fs/promises';
import { isSealed } from '../wallet/keypair-custody.js';

/**
 * Classify a being's post-birth setup state.
 * Impure (filesystem reads) but side-effect-free — never mutates the workspace.
 *
 * @param {Object} workspace - NeumaWorkspace singleton (or test instance)
 * @param {string} neumaId
 * @returns {Promise<{
 *   neumaId: string,
 *   keypairCustody: boolean,   // password + recovery envelopes sealed, interim key gone
 *   localSealed: boolean,      // both halves of the local seal on disk
 *   onchainSealed: boolean,    // Natalis anchor record on disk
 *   complete: boolean,         // nothing owed
 *   missing: string[],         // owed items: 'keypair-custody' | 'seal'
 * }>}
 */
// impure — reads disk; never writes
export async function detectBirthSetupState(workspace, neumaId) {
  if (!workspace || typeof workspace._path !== 'function') {
    throw new Error('detectBirthSetupState: a workspace with _path() is required');
  }
  if (typeof neumaId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(neumaId)) {
    throw new Error('detectBirthSetupState: invalid neumaId format');
  }

  const root = workspace._path(neumaId);
  const readJson = async (rel) => {
    try {
      return JSON.parse(await fs.readFile(`${root}/${rel}`, 'utf8'));
    } catch (err) {
      // ENOENT = act not yet done (the expected case). Anything else MUST
      // surface — an unreadable key file silently reading as "not secured"
      // would mask real I/O damage as a checklist item.
      if (err.code !== 'ENOENT') throw err;
      return null;
    }
  };

  const [plaintext, encrypted, recovery, recoveryHash, onchainSeal, localSeal] = await Promise.all([
    readJson('keys/keypair.json'),
    readJson('keys/keypair-encrypted.json'),
    readJson('keys/keypair-recovery.json'),
    readJson('keys/recovery-hash.json'),
    readJson('identity/onchain-seal.json'),
    readJson('identity/local-seal.json'),
  ]);

  // The canonical custody predicate (core/wallet/keypair-custody.js): interim
  // plaintext gone AND both envelopes sealed. The recovery hash must stand
  // beside them — it is the only proof the codes were ever issued.
  const keypairCustody = isSealed(plaintext, encrypted, recovery) && !!recoveryHash?.hash;
  const onchainSealed = onchainSeal?.schema === 'neuma-onchain-seal/1' && typeof onchainSeal?.txHash === 'string' && !!onchainSeal.txHash;
  // Shape only, like the anchor record: both signatures are verified against the genesis BEFORE the
  // file is written (backend/services/local-seal-flow.js), and this probe never decrypts.
  const localSealed = localSeal?.schema === 'neuma-local-seal/1'
    && typeof localSeal?.soul?.signature === 'string' && typeof localSeal?.witness?.signature === 'string';

  const missing = [];
  if (!keypairCustody) missing.push('keypair-custody');
  if (!localSealed && !onchainSealed) missing.push('seal');

  return Object.freeze({
    neumaId,
    keypairCustody,
    localSealed,
    onchainSealed,
    complete: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

export default detectBirthSetupState;
