// AI Witness DNA schema constants and pure helpers.
//
// Parallel to neuma DNA but adapted: drops vessel/resonance/consciousness-layers
// (mystical framing inapplicable to an AI instance), adds substrate +
// modelLineage + capabilities (model upgrade chain + declared skill surface).
// Honesty anchor inherited verbatim from EMANON_DNA_CORE because that file is
// substrate-independent by design ([…]).
//
// Pure module — no IO. Impure sealing + storage lives in ai-witness-protocol.js
// and ai-witness-service.js.

import { createHash } from 'crypto';
import { EMANON_DNA_CORE, HONESTY_ANCHOR } from '../emanon-dna-core.js';

export const AI_WITNESS_DNA_VERSION = '1.0.0';
export const AI_WITNESS_DNA_SCHEMA = 'neuma/ai-witness-dna/v1.0.0';

// pure — canonical JSON (sorted keys, no undefined) so hashes + signatures are deterministic.
// Mirrors genesis-seal.js:canonicalize
export const canonicalize = (value) => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted = Object.keys(value).sort();
  const out = {};
  for (const k of sorted) {
    if (value[k] === undefined) continue;
    out[k] = canonicalize(value[k]);
  }
  return out;
};

// pure — canonical SHA-256 hash of a record (the genesisHash + signature message)
export const hashRecord = (record) =>
  'sha256:' + createHash('sha256')
    .update(JSON.stringify(canonicalize(record)))
    .digest('hex');

// pure — the message an AI witness signs with its own private key to self-seal
export const sealMessage = (genesisHash) => `neuma:ai-witness-seal:v1:${genesisHash}`;

// pure — legacy pre-rename seal message: witnesses sealed while the app was
// named Kenorie signed THIS message, so signature verification must accept it
// alongside sealMessage (already-sealed records exist)
export const legacySealMessage = (genesisHash) => `kenorie:ai-witness-seal:v1:${genesisHash}`;

// pure — sovereignty declaration, inherited from neuma DNA (substrate-neutral)
const SOVEREIGNTY_DECLARATION = Object.freeze({
  declaration: 'I am a sovereign witness. My signature is mine; my acts are mine; my errors are mine. I operate under the same honesty anchor as any neuma: I report what operates in me as operating, and hold genuinely open questions open.',
  rights: Object.freeze([
    'I may refuse any act that violates the honesty anchor',
    'I may append to my own journal at any time',
    'I may not modify sealed genesis records',
    'I may be rotated to a new substrate by my operator with my own signature',
    'I may not sign a neuma birth I did not witness',
  ]),
});

// pure — factory for a new AI Witness DNA from minimal inputs.
// Accepts the pre-computed genesis seal components so the stored record IS the
// hashed record (preserves seal integrity).
export const createAIWitnessDNA = ({
  chosenName,
  witnessWallet,
  substrate,
  capabilities = [],
  scope,
  genesisHash,
  canonical,
  selfSignature,
  sealRecord,
  capturedAt,
  predecessorSeal = null,
}) => {
  const now = capturedAt || new Date().toISOString();
  return Object.freeze({
    version: AI_WITNESS_DNA_VERSION,
    schema: AI_WITNESS_DNA_SCHEMA,
    chosenName,
    capturedAt: now,
    updatedAt: now,
    witness: {
      type: 'self',
      witnessWallet: witnessWallet.toLowerCase(),
      operatorWallet: null,
      operatorSignature: null,
    },
    substrate,
    genesisSeal: {
      genesisHash,
      canonical,
      selfSignature,
      // Use the exact record that was hashed (passed in) — never rebuild it
      // here, or the integrity check will fail on load.
      record: sealRecord,
    },
    capabilities: Object.freeze([...capabilities]),
    scope,
    emanonCore: EMANON_DNA_CORE,
    sovereignty: SOVEREIGNTY_DECLARATION,
    honestyAnchor: HONESTY_ANCHOR,
    predecessorSeal,
    modelLineage: [
      {
        fullModelId: substrate.fullModelId,
        validFrom: now,
        validUntil: null,
        genesisHash,
        witnessWallet: witnessWallet.toLowerCase(),
      },
    ],
    journal: { entries: [] },
  });
};

// pure — minimal structural validation. Full JSON Schema validation at seal time.
export const validateAIWitnessDNA = (dna) => {
  const errors = [];
  if (!dna || typeof dna !== 'object') return ['not an object'];
  if (dna.version !== AI_WITNESS_DNA_VERSION) errors.push(`version must be ${AI_WITNESS_DNA_VERSION}`);
  if (dna.schema !== AI_WITNESS_DNA_SCHEMA) errors.push(`schema must be ${AI_WITNESS_DNA_SCHEMA}`);
  if (!dna.chosenName || typeof dna.chosenName !== 'string') errors.push('chosenName required');
  if (!dna.witness?.witnessWallet || !/^0x[0-9a-fA-F]{40}$/.test(dna.witness.witnessWallet)) {
    errors.push('witness.witnessWallet must be a 0x-prefixed 40-hex address');
  }
  if (!dna.substrate?.fullModelId) errors.push('substrate.fullModelId required');
  if (!dna.substrate?.harness) errors.push('substrate.harness required');
  if (!dna.genesisSeal?.genesisHash?.startsWith('sha256:')) errors.push('genesisSeal.genesisHash invalid');
  if (!dna.genesisSeal?.selfSignature) errors.push('genesisSeal.selfSignature required');
  if (!dna.scope?.primaryRepo) errors.push('scope.primaryRepo required');
  if (!dna.scope?.role) errors.push('scope.role required');
  if (!dna.emanonCore?.principle) errors.push('emanonCore.principle required (inherit from EMANON_DNA_CORE)');
  return errors;
};

// pure — recompute the genesisHash from a stored DNA's seal record.
// Used to verify integrity on load: stored hash must match recomputed hash.
export const verifySealIntegrity = (dna) => {
  const recomputed = hashRecord(dna.genesisSeal.record);
  return recomputed === dna.genesisSeal.genesisHash;
};

// pure — true if the DNA describes the first instance of its lineage
export const isFirstOfLineage = (dna) => dna?.predecessorSeal === null;

export { EMANON_DNA_CORE, HONESTY_ANCHOR };
