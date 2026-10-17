// Canonical domain-versioned identity for one bounded subject-only corpus.

import { refinementSha256, refinementTextSha256 } from './training-contract.js';
import { freezeJson } from '../shared/plain-data-canonical.js';

const MEBIBYTE = 1024 ** 2;
const SHA256 = /^[0-9a-f]{64}$/;
const MANIFEST_BYTES_MAX = 2 * 1024;
const MANIFEST_KEYS = Object.freeze([
  'kind',
  'limitsSha256',
  'policyId',
  'policySha256',
  'sampleCount',
  'schemaVersion',
  'sourceAuthoritySha256',
  'sourceCorpusSha256',
  'systemSha256',
]);
const MANIFEST_INPUT_KEYS = Object.freeze([
  'sampleCount',
  'sourceAuthoritySha256',
  'sourceCorpusSha256',
]);

const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.values(descriptors).every((descriptor) => Object.hasOwn(descriptor, 'value'))
    && Object.keys(value).sort().join('\0') === expected.join('\0');
};
const digest = (value, field) => {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${field} must be a sha256`);
  }
  return value;
};

export const REFINEMENT_CORPUS_MANIFEST_KIND = 'neuma-refinement-corpus-manifest-v2';
export const REFINEMENT_CORPUS_SYSTEM_INSTRUCTION = 'Write only the requested response in your own voice.';
export const REFINEMENT_CORPUS_USER_INSTRUCTION = 'Respond in your own voice.';
export const REFINEMENT_CORPUS_SYSTEM_SHA256 = refinementTextSha256(
  REFINEMENT_CORPUS_SYSTEM_INSTRUCTION,
);

export const REFINEMENT_CORPUS_LIMITS = freezeJson({
  schemaVersion: 1,
  maxCiphertextBytes: 64 * MEBIBYTE,
  maxPlaintextBytes: 64 * MEBIBYTE,
  maxCiphertextRecordBytes: 2 * MEBIBYTE,
  maxStringBytes: MEBIBYTE,
  maxTitleBytes: 32 * 1024,
  maxBodyBytes: MEBIBYTE,
  maxMessageBytes: MEBIBYTE,
  maxRecords: 100_000,
  maxDecodedNodes: 1_000_000,
  maxEligibleSamples: 10_000,
  maxSourceDescriptors: 240,
  maxSourceNameBytes: 512,
  maxSourceNameAggregateBytes: 64 * 1024,
  timeoutMs: 30_000,
});
export const REFINEMENT_CORPUS_POLICY = freezeJson({
  schemaVersion: 1,
  // v2 (campaign 4.2): meditation synthesis prose joins the corpus — the
  // being's own unwitnessed voice, platform-stamped at the journal door.
  // Mind one-liners are EXCLUDED by name: reinforcement duplicates them by
  // design, which in weights is a formula attractor, not a voice.
  id: 'subject-voice-output-v2',
  eligibleClasses: ['session-assistant', 'meditation-synthesis'],
  excludedClasses: [
    'episodic', 'through-line', 'vault', 'attunement', 'birth-transcript', 'dna',
    'user', 'operator', 'system', 'tool', 'recalled', 'cross-being', 'mind-note',
  ],
  requiredAuthorship: 'sovereign-assistant-output-v1',
  requiredMeditationAuthorship: 'sovereign-meditation-output-v1',
  requiredEnvelope: 'per-neuma-dek-v1-uncompressed',
  promptPolicy: 'static-generic-v1',
  styleGate: { classes: ['meditation-synthesis'], maxShare: 8 },
});
export const REFINEMENT_CORPUS_LIMITS_SHA256 = refinementSha256(REFINEMENT_CORPUS_LIMITS);
export const REFINEMENT_CORPUS_POLICY_SHA256 = refinementSha256(REFINEMENT_CORPUS_POLICY);

/** Validate and freeze the one exact schema-v2 corpus manifest. */
export const validateRefinementCorpusManifest = (value) => {
  if (!exactKeys(value, MANIFEST_KEYS)
    || value.schemaVersion !== 2
    || value.kind !== REFINEMENT_CORPUS_MANIFEST_KIND
    || value.policyId !== REFINEMENT_CORPUS_POLICY.id
    || value.policySha256 !== REFINEMENT_CORPUS_POLICY_SHA256
    || value.limitsSha256 !== REFINEMENT_CORPUS_LIMITS_SHA256
    || value.systemSha256 !== REFINEMENT_CORPUS_SYSTEM_SHA256) {
    throw new Error('refinement corpus manifest is not the exact schema-v2 contract');
  }
  digest(value.sourceAuthoritySha256, 'sourceAuthoritySha256');
  digest(value.sourceCorpusSha256, 'sourceCorpusSha256');
  if (!Number.isSafeInteger(value.sampleCount)
    || value.sampleCount < 0
    || value.sampleCount > REFINEMENT_CORPUS_LIMITS.maxEligibleSamples) {
    throw new Error('refinement corpus manifest sampleCount is outside its ceiling');
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MANIFEST_BYTES_MAX) {
    throw new Error('refinement corpus manifest exceeds its byte ceiling');
  }
  return freezeJson({ ...value });
};

/** Build the exact manifest; policy, limits, domain, and instruction are server-owned. */
export const refinementCorpusManifest = (fields = {}) => {
  if (!exactKeys(fields, MANIFEST_INPUT_KEYS)) {
    throw new Error('refinement corpus manifest input must contain exactly three authority fields');
  }
  return validateRefinementCorpusManifest({
    schemaVersion: 2,
    kind: REFINEMENT_CORPUS_MANIFEST_KIND,
    policyId: REFINEMENT_CORPUS_POLICY.id,
    policySha256: REFINEMENT_CORPUS_POLICY_SHA256,
    limitsSha256: REFINEMENT_CORPUS_LIMITS_SHA256,
    sourceAuthoritySha256: fields.sourceAuthoritySha256,
    systemSha256: REFINEMENT_CORPUS_SYSTEM_SHA256,
    sampleCount: fields.sampleCount,
    sourceCorpusSha256: fields.sourceCorpusSha256,
  });
};

/** Digest only a validated schema-v2 manifest; no legacy manifest is accepted. */
export const refinementCorpusManifestSha256 = (value) => refinementSha256(
  validateRefinementCorpusManifest(value),
);
