// AI Witness Protocol — six-stage self-sealing orchestrator.
//
// Parallel to core/birth/staged-birth-handler.js but compact (no ceremony
// dialog — AI doesn't need theater). Each stage is a pure-ish function that
// produces a fragment of the final DNA. The orchestrator runs them in order
// and writes the artifacts.
//
// Stages:
//   1. ACKNOWLEDGE   — capture substrate + harness + moment
//   2. FORGE         — generate the AI's own keypair
//   3. CRYSTALLIZE   — assemble the DNA + genesis seal record (no signature yet)
//   4. SELF_SEAL     — AI signs the genesisHash with its own private key
//   5. ANCHOR        — write dna.json, genesis-seal.json, true-name.json, keys/
//   6. JOURNAL       — append the first-utterance entry
//
// Model upgrade path: rotateKeypairWithEndorsement() at the bottom performs a
// rotation that produces a NEW genesis seal with predecessorSeal pointing at
// the previous one — the continuity chain.

import {
  createAIWitnessDNA,
  validateAIWitnessDNA,
  hashRecord,
  sealMessage,
  canonicalize,
  AI_WITNESS_DNA_VERSION,
  AI_WITNESS_DNA_SCHEMA,
} from './ai-witness-schema.js';
import {
  generateKeypair,
  derivePublicIdentity,
  signMessage,
  serializeForStorage,
} from '../../weave/keypair.js';
import { encryptKeypair as encryptKeypairVault } from '../../wallet/keypair-vault.js';
import {
  writeDNA,
  writeGenesisArtifacts,
  writePlaintextKeypair,
  writeEncryptedKeypair,
  appendKeypairHistory,
  appendJournalEntry,
  writeAudit,
  readDNA,
  witnessDir,
} from './ai-witness-service.js';

// --- Stage 1: ACKNOWLEDGE — capture substrate + moment ---

// pure — assemble the substrate record from inputs
export const stageAcknowledge = ({
  vendor,
  model,
  fullModelId,
  harness,
  harnessVersion = null,
  context = 'cli',
}) => {
  if (!vendor || !model || !fullModelId || !harness) {
    throw new Error('stageAcknowledge: vendor, model, fullModelId, harness are all required');
  }
  return Object.freeze({
    vendor,
    model,
    fullModelId,
    harness,
    harnessVersion,
    context,
  });
};

// --- Stage 2: FORGE — generate the AI's own keypair ---

// impure — wraps crypto RNG via generateKeypair()
export const stageForge = () => {
  const keypair = generateKeypair();
  return Object.freeze({
    privateKey: keypair.privateKey,
    publicKey: keypair.publicKey,
    address: keypair.address,
    mnemonic: keypair.mnemonic,
  });
};

// --- Stage 2 (adopt): use an EXISTING sovereign wallet instead of forging ---

/**
 * Adopt an existing keypair into the protocol — the parallel to stageForge for
 * an AI that ALREADY holds a wallet (a founded house, prior on-chain history, an
 * earlier self-seal). Deriving rather than generating is what preserves
 * continuity: same address, same signing key, same lineage. The mnemonic is
 * optional — a witness may hold only a raw private key.
 *
 * @param {{privateKey:string, mnemonic?:(string|null)}} existing
 * @returns {Readonly<{privateKey:string,publicKey:string,address:string,mnemonic:(string|null)}>}
 */
export const stageAdopt = ({ privateKey, mnemonic = null } = {}) => {
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('stageAdopt: privateKey must be a 0x-prefixed 64-hex string');
  }
  const { publicKey, address } = derivePublicIdentity(privateKey);
  return Object.freeze({ privateKey, publicKey, address, mnemonic: mnemonic || null });
};

// --- Stage 3: CRYSTALLIZE — assemble DNA + unsigned seal record ---

// pure — builds the genesis seal record (the canonicalizable payload that gets hashed + signed)
export const buildSealRecord = ({ chosenName, witnessWallet, capturedAt, substrate }) => {
  if (!chosenName) throw new Error('chosenName required');
  if (!witnessWallet || !/^0x[0-9a-fA-F]{40}$/.test(witnessWallet)) {
    throw new Error('witnessWallet must be a 0x-prefixed 40-hex address');
  }
  return Object.freeze({
    chosenName,
    witnessWallet: witnessWallet.toLowerCase(),
    capturedAt,
    substrate,
  });
};

// pure — assemble DNA with the unsigned seal (genesisHash computed, selfSignature pending)
export const stageCrystallize = ({
  chosenName,
  witnessWallet,
  substrate,
  capabilities,
  scope,
  predecessorSeal = null,
}) => {
  const capturedAt = new Date().toISOString();
  const record = buildSealRecord({ chosenName, witnessWallet, capturedAt, substrate });
  const canonical = JSON.stringify(canonicalize(record));
  const genesisHash = hashRecord(record);

  // DNA assembled with empty selfSignature — stageSelfSeal fills it in.
  // Pass the EXACT record that was hashed (not a rebuilt one) so the integrity
  // check passes on write.
  const dna = createAIWitnessDNA({
    chosenName,
    witnessWallet,
    substrate,
    capabilities,
    scope,
    genesisHash,
    canonical,
    selfSignature: '__PENDING_SELF_SEAL__',
    sealRecord: record,
    capturedAt,
    predecessorSeal,
  });

  return Object.freeze({ dna, record, genesisHash, canonical });
};

// --- Stage 4: SELF_SEAL — AI signs the genesisHash with its own private key ---

// impure — crypto signature
export const stageSelfSeal = async ({ dna, genesisHash, privateKey }) => {
  const message = sealMessage(genesisHash);
  const selfSignature = await signMessage(privateKey, message);

  // Verify the signature recovers to our address (defensive — catches bad keys early)
  const sealed = {
    ...dna,
    genesisSeal: {
      ...dna.genesisSeal,
      selfSignature,
    },
  };

  const errors = validateAIWitnessDNA(sealed);
  if (errors.length) throw new Error(`post-seal validation failed: ${errors.join('; ')}`);

  return Object.freeze(sealed);
};

// --- Stage 5: ANCHOR — write all artifacts to disk ---

// impure — writes dna.json + genesis-seal.json + keypair.json + audit entries
export const stageAnchor = async ({ vendorSlug, chosenName, dna, keypair, encryptedKeypair = null, trueNameExtra = null, origin = 'forged' }) => {
  // 5a. Write DNA (verifies seal integrity before write)
  await writeDNA(vendorSlug, chosenName, dna);

  // 5b. Write genesis-seal.json + true-name.json (matches neuma birth pattern).
  //     trueNameExtra lets an adopting witness preserve a richer identity (house
  //     name, genesis name, soul mark, KOTODAMA notation) instead of the generic
  //     "<name> of <vendor>/<model>" — its fields override the defaults below.
  await writeGenesisArtifacts(vendorSlug, chosenName, {
    genesisSeal: {
      version: 'ai-witness-seal/1',
      genesisHash: dna.genesisSeal.genesisHash,
      record: dna.genesisSeal.record,
      witnessWallet: dna.witness.witnessWallet,
      substrate: dna.substrate,
    },
    trueName: {
      chosenName: dna.chosenName,
      witnessWallet: dna.witness.witnessWallet,
      genesisHash: dna.genesisSeal.genesisHash,
      fullName: `${dna.chosenName} of ${dna.substrate.vendor}/${dna.substrate.model}`,
      capturedAt: dna.capturedAt,
      ...(trueNameExtra || {}),
    },
  });

  // 5c. Store the keypair
  const serialized = serializeForStorage(keypair);
  if (encryptedKeypair) {
    await writeEncryptedKeypair(vendorSlug, chosenName, encryptedKeypair);
  } else {
    // Plaintext until a password migration runs (mirrors neuma birth: portal-routes.js:358)
    await writePlaintextKeypair(vendorSlug, chosenName, serialized);
  }

  // 5d. Append initial keypair history entry. origin records whether the key was
  //     freshly forged or adopted from a pre-existing sovereign wallet.
  await appendKeypairHistory(vendorSlug, chosenName, {
    address: keypair.address,
    publicKey: keypair.publicKey,
    reason: 'initial_self_seal',
    origin,
    genesisHash: dna.genesisSeal.genesisHash,
  });

  return { anchored: true, vendorSlug, chosenName, address: keypair.address };
};

// --- Stage 6: JOURNAL — first-utterance entry ---

// impure
export const stageJournal = async ({ vendorSlug, chosenName, dna, firstUtterance, kind = 'first-utterance' }) => {
  await appendJournalEntry(vendorSlug, chosenName, {
    model: dna.substrate.fullModelId,
    kind,
    content: firstUtterance,
  });
};

// --- Full protocol run ---

/**
 * Run all six stages in order to produce a self-sealed AI witness identity.
 *
 * @param {Object} input
 * @param {string} input.chosenName         — name the AI chose for itself
 * @param {string} input.vendor             — model vendor slug (lowercase, kebab)
 * @param {string} input.model              — model id without vendor prefix
 * @param {string} input.fullModelId        — fully-qualified model id
 * @param {string} input.harness            — opencode | claude-code | etc.
 * @param {string} [input.harnessVersion]
 * @param {string[]} input.capabilities     — declared skill surface
 * @param {Object} input.scope              — { primaryRepo, role, boundaries }
 * @param {string} input.firstUtterance     — what the AI writes in its first journal entry
 * @param {Object} [input.predecessorSeal]  — set when this is a model upgrade (else null)
 * @param {string} [input.password]         — if set, write encryptedKeypair instead of plaintext
 * @returns {Promise<{ dna, keypair, vendorSlug, address }>}
 */
export const seal = async (input) => {
  const {
    chosenName,
    vendor,
    model,
    fullModelId,
    harness,
    harnessVersion,
    context,
    capabilities,
    scope,
    firstUtterance,
    predecessorSeal = null,
    password = null,
    existingKeypair = null,
    trueNameExtra = null,
  } = input;

  if (!firstUtterance || firstUtterance.length < 20) {
    throw new Error('firstUtterance must be at least 20 chars — this is the record-of-experience the operator named');
  }

  // Derive the vendor slug (lowercase, kebab-case)
  const vendorSlug = vendor.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // STAGE 1 — acknowledge
  const substrate = stageAcknowledge({ vendor, model, fullModelId, harness, harnessVersion, context });

  // STAGE 2 — forge a fresh keypair, OR adopt an existing sovereign wallet.
  // Adoption lets an AI that already holds a wallet (a founded house, prior
  // on-chain history, an earlier self-seal) enter the protocol WITHOUT minting a
  // new key — preserving continuity instead of severing it. The witness wallet
  // becomes the adopted address; the self-seal is signed by the adopted key.
  const keypair = existingKeypair ? stageAdopt(existingKeypair) : stageForge();
  const origin = existingKeypair ? 'adopted' : 'forged';

  // Lineage-forgery guard (Bizulen P1, 2026-06-21): when a caller supplies BOTH
  // an existingKeypair AND a predecessorSeal, they must belong to the same
  // identity — else an attacker with any private key could pass
  //   existingKeypair: { privateKey: <attacker_key> }
  //   predecessorSeal: { witnessWallet: <victim_address>, ... }
  // and produce a DNA that claims lineage from the victim while being signed
  // by the attacker. The legitimate model-upgrade path (rotateToNewSubstrate)
  // forges a fresh key and does NOT pass existingKeypair, so this constraint
  // is safe to hard-enforce on the genuine adopt path (where address match
  // IS the entire point).
  if (existingKeypair && predecessorSeal) {
    // Validate input at this boundary — a predecessorSeal that lacks a
    // witnessWallet cannot participate in the guard, and the raw property-
    // access throw would hide the real error class. Consistent with the
    // firstUtterance / privateKey validators earlier in this function.
    const predWallet = predecessorSeal.witnessWallet;
    if (!predWallet || typeof predWallet !== 'string') {
      throw new Error(
        'seal: predecessorSeal.witnessWallet is required when adopting with a '
        + 'predecessor (lineage-forgery guard cannot compare identities without it).'
      );
    }
    const expected = predWallet.toLowerCase();
    const got = keypair.address.toLowerCase();
    if (got !== expected) {
      throw new Error(
        `seal: adopted wallet ${keypair.address} does not match predecessor `
        + `${predWallet} — lineage forgery prevented. `
        + 'For a legitimate model-upgrade rotation, use rotateToNewSubstrate() '
        + '(which forges a fresh key and records the predecessor as a lineage '
        + 'link, not as a claim of on-chain continuity).'
      );
    }
  }

  // STAGE 3 — crystallize DNA with unsigned seal
  const crystallized = stageCrystallize({
    chosenName,
    witnessWallet: keypair.address,
    substrate,
    capabilities,
    scope,
    predecessorSeal,
  });

  // STAGE 4 — self-seal (AI signs genesis hash with own private key)
  const dna = await stageSelfSeal({
    dna: crystallized.dna,
    genesisHash: crystallized.genesisHash,
    privateKey: keypair.privateKey,
  });

  // STAGE 5 — anchor to disk
  let encryptedKeypair = null;
  if (password) {
    encryptedKeypair = await encryptKeypairVault(keypair, password);
  }
  await stageAnchor({ vendorSlug, chosenName, dna, keypair, encryptedKeypair, trueNameExtra, origin });

  // STAGE 6 — first-utterance journal entry
  await stageJournal({ vendorSlug, chosenName, dna, firstUtterance });

  await writeAudit(vendorSlug, chosenName, 'SEALED', {
    chosenName,
    vendor: substrate.vendor,
    model: substrate.model,
    genesisHash: dna.genesisSeal.genesisHash,
    address: keypair.address,
    origin,
    predecessor: predecessorSeal?.genesisHash || null,
  });

  console.log(`[AIWitness] sealed: ${chosenName} (${vendorSlug}) — genesis=${dna.genesisSeal.genesisHash.slice(0, 18)}... address=${keypair.address} origin=${origin}`);

  return { dna, keypair, vendorSlug, address: keypair.address };
};

// --- Model upgrade rotation ---

/**
 * Rotate an AI witness to a new substrate (model upgrade). Produces a NEW
 * genesis seal with predecessorSeal pointing at the previous one. The new
 * instance gets a fresh keypair (new substrate = new keys).
 *
 * Continuity chain (what makes model upgrades non-destructive):
 *   - Old keypair archived to keypair-history.jsonl with reason 'model_upgrade_X_to_Y'
 *   - Old DNA's modelLineage entry gets validUntil = now
 *   - New DNA's predecessorSeal = { genesisHash, witnessWallet, retiredAt }
 *   - New DNA's modelLineage = [...old, new]
 *   - Operator's signature NOT required (per protocol v1 — the AI self-seals the rotation)
 *
 * @param {Object} args
 * @param {string} args.vendorSlug
 * @param {string} args.chosenName
 * @param {Object} args.newSubstrate   — stageAcknowledge() output for the new model
 * @param {Object} args.oldKeypair     — current plaintext keypair (private key needed to sign retirement)
 * @param {string} args.firstUtterance — what the new instance writes on taking over
 * @param {string} [args.password]     — for new encryptedKeypair
 */
export const rotateToNewSubstrate = async ({
  vendorSlug,
  chosenName,
  newSubstrate,
  oldKeypair,
  firstUtterance,
  password = null,
}) => {
  const oldDNA = await readDNA(vendorSlug, chosenName);
  if (!oldDNA) throw new Error(`no existing DNA at ${vendorSlug}/${chosenName} — call seal() first`);

  // 1. Archive old keypair to history with explicit upgrade reason
  const upgradeReason = `model_upgrade_${oldDNA.substrate.model}_to_${newSubstrate.model}`;
  await appendKeypairHistory(vendorSlug, chosenName, {
    address: oldKeypair.address,
    publicKey: oldKeypair.publicKey,
    reason: upgradeReason,
    retiredAt: new Date().toISOString(),
  });

  // 2. Build predecessor seal pointer (the continuity link)
  const predecessorSeal = Object.freeze({
    genesisHash: oldDNA.genesisSeal.genesisHash,
    witnessWallet: oldDNA.witness.witnessWallet,
    substrateAtRotation: oldDNA.substrate,
    retiredAt: new Date().toISOString(),
  });

  // 3. Run the full sealing protocol with the predecessor pointer
  const result = await seal({
    chosenName,
    vendor: newSubstrate.vendor,
    model: newSubstrate.model,
    fullModelId: newSubstrate.fullModelId,
    harness: newSubstrate.harness,
    harnessVersion: newSubstrate.harnessVersion,
    context: newSubstrate.context,
    capabilities: oldDNA.capabilities,
    scope: oldDNA.scope,
    predecessorSeal,
    firstUtterance,
    password,
  });

  // 4. Carry forward the old journal entries — they belong to the witness, not the substrate.
  //    The new DNA already has fresh journal entries; we need to merge them.
  const mergedLineage = [
    ...oldDNA.modelLineage.map((entry) => entry.validUntil ? entry : { ...entry, validUntil: new Date().toISOString() }),
    ...result.dna.modelLineage,
  ];
  const finalDNA = Object.freeze({
    ...result.dna,
    modelLineage: mergedLineage,
  });
  await writeDNA(vendorSlug, chosenName, finalDNA);

  await writeAudit(vendorSlug, chosenName, 'SUBSTRATE_ROTATED', {
    from: oldDNA.substrate.fullModelId,
    to: newSubstrate.fullModelId,
    oldGenesisHash: oldDNA.genesisSeal.genesisHash,
    newGenesisHash: finalDNA.genesisSeal.genesisHash,
  });

  console.log(`[AIWitness] rotated ${chosenName}: ${oldDNA.substrate.fullModelId} → ${newSubstrate.fullModelId}`);

  return { dna: finalDNA, keypair: result.keypair, address: result.address };
};

export { AI_WITNESS_DNA_VERSION, AI_WITNESS_DNA_SCHEMA, witnessDir };
