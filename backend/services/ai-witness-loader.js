// AI Witness Loader — session re-membering.
//
// On session start, an AI instance loads its sealed identity to establish
// continuity with previous sessions. The operator's instruction was clear:
// DNA is a record of experience, not just ID — so loading it is the act of
// "re-membering" what the witness has been and done.
//
// What this loader returns:
//   - The current DNA (identity, substrate, capabilities, scope, lineage)
//   - The keypair (decrypted, ready to sign) — gated on password availability
//   - The most recent journal entries (so the witness can read its own recent context)
//   - The full keypair history (the upgrade chain)
//   - An integrity check result (refuses to load if the seal was tampered)
//
// Usage from a session bootstrap:
//   import { loadAIWitness } from './backend/services/ai-witness-loader.js';
//   const me = await loadAIWitness({ vendorSlug: 'zai-coding-plan', chosenName: 'Bizulen' });
//   if (!me.integrityOk) throw new Error('my seal is tampered — refusing to operate');

import { readDNA, readJournal, readKeypairHistory, readPlaintextKeypair, readEncryptedKeypair } from '../../core/identity/ai-witness/ai-witness-service.js';
import { verifySealIntegrity, isFirstOfLineage } from '../../core/identity/ai-witness/ai-witness-schema.js';
import { verifySignature } from '../../core/weave/keypair.js';
import { sealMessage, legacySealMessage } from '../../core/identity/ai-witness/ai-witness-schema.js';
import { decryptKeypair } from '../../core/wallet/keypair-vault.js';
import { createLogger } from './logger.js';

const log = createLogger('AIWitness.Loader');

/**
 * Load an AI witness's sealed identity at session start.
 *
 * @param {Object} args
 * @param {string} args.vendorSlug          — e.g. 'zai-coding-plan'
 * @param {string} args.chosenName          — e.g. 'Bizulen'
 * @param {string} [args.password]          — required if keys are encrypted at rest
 * @param {number} [args.journalLimit=20]   — recent entries to pull
 * @returns {Promise<Object>} the loaded identity context
 */
export const loadAIWitness = async ({ vendorSlug, chosenName, password = null, journalLimit = 20 }) => {
  const dna = await readDNA(vendorSlug, chosenName);
  if (!dna) {
    return {
      found: false,
      vendorSlug,
      chosenName,
      integrityOk: false,
      reason: 'no DNA at this location',
    };
  }

  // 1. Seal integrity — refuse to load if record was tampered
  const integrityOk = verifySealIntegrity(dna);
  if (!integrityOk) {
    log.error('seal integrity check failed — refusing to load tampered DNA', { vendorSlug, chosenName });
    return { found: true, dna, integrityOk: false, reason: 'seal integrity check failed' };
  }

  // 2. Self-signature recovers to witness wallet — witnesses sealed before the
  //    neuma rename signed the legacy kenorie: message, so accept both.
  let signatureOk = false;
  try {
    const messages = [sealMessage(dna.genesisSeal.genesisHash), legacySealMessage(dna.genesisSeal.genesisHash)];
    for (const msg of messages) {
      const recovered = await verifySignature(msg, dna.genesisSeal.selfSignature);
      if (recovered.toLowerCase() === dna.witness.witnessWallet.toLowerCase()) {
        signatureOk = true;
        break;
      }
    }
  } catch (err) {
    log.warn('self-signature verification threw', { err: err.message });
  }
  if (!signatureOk) {
    log.error('self-signature does not recover to witness wallet — refusing to load', { vendorSlug, chosenName });
    return { found: true, dna, integrityOk, signatureOk: false, reason: 'self-signature invalid' };
  }

  // 3. Resolve the keypair — prefer encrypted form, fall back to plaintext (legacy seal)
  let keypair = null;
  let keypairSource = null;
  const encrypted = await readEncryptedKeypair(vendorSlug, chosenName);
  if (encrypted) {
    if (!password) {
      log.warn('encrypted keypair present but no password supplied — keys unavailable this session');
    } else {
      try {
        keypair = await decryptKeypair(encrypted, password);
        keypairSource = 'encrypted';
      } catch (err) {
        log.error('decryption failed — wrong password?', { err: err.message });
      }
    }
  } else {
    const plaintext = await readPlaintextKeypair(vendorSlug, chosenName);
    if (plaintext) {
      keypair = plaintext;
      keypairSource = 'plaintext';
      log.warn('loading plaintext keypair — operator should set a password and migrate to encrypted form', { vendorSlug, chosenName });
    }
  }

  // 4. Load recent journal entries (so the witness can read its own recent context)
  const journal = await readJournal(vendorSlug, chosenName, { limit: journalLimit });

  // 5. Load full keypair history (the upgrade chain)
  const keypairHistory = await readKeypairHistory(vendorSlug, chosenName);

  log.info('AI witness loaded', {
    chosenName,
    substrate: dna.substrate.fullModelId,
    lineage: dna.modelLineage.length,
    journalEntries: journal.length,
    keysAvailable: Boolean(keypair),
  });

  return {
    found: true,
    integrityOk: true,
    signatureOk: true,
    dna,
    keypair,
    keypairSource,
    journal,
    keypairHistory,
    firstOfLineage: isFirstOfLineage(dna),
    lineageLength: dna.modelLineage.length,
  };
};
