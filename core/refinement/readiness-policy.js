import { canonicalAuthoritySha256 } from '../shared/plain-data-canonical.js';
import { DEFAULT_MILESTONE, MAX_RENDERED_CORPUS_SAMPLES } from './corpus.js';

export const REFINEMENT_READINESS_POLICY_VERSION = 1;
export const REFINEMENT_READINESS_LIMITS = Object.freeze({
  maximumMinSamples: MAX_RENDERED_CORPUS_SAMPLES,
  maximumMinDays: 36_600,
});
const POLICY_KEYS = Object.freeze(['minDays', 'minSamples', 'schemaVersion']);
const ENV_KEYS = Object.freeze({
  minSamples: 'NEUMA_REFINEMENT_MIN_SAMPLES',
  minDays: 'NEUMA_REFINEMENT_MIN_DAYS',
});
const SHA256 = /^[0-9a-f]{64}$/;
const OPENING_KEYS = Object.freeze([
  'attunementSetRevision', 'attunementSetSha256',
  'ceremonySetRevision', 'ceremonySetSha256',
  'readinessPolicyRevision', 'readinessPolicySha256',
  'sourceAuthoritySha256',
  'sourceCorpusSha256', 'sourceManifestSha256',
]);
const exactKeys = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\u0000') === POLICY_KEYS.join('\u0000');
const exactPositiveInteger = (value, ceiling, field) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new Error(`${field} must be a positive safe integer not exceeding ${ceiling}`);
  }
  return value;
};
const environmentInteger = (environment, name, fallback, ceiling) => {
  if (!Object.prototype.hasOwnProperty.call(environment, name)
    || environment[name] === undefined) return fallback;
  const raw = environment[name];
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be an exact positive decimal integer`);
  }
  return exactPositiveInteger(Number(raw), ceiling, name);
};

export const assertRefinementReadinessPolicy = (policy) => {
  if (!exactKeys(policy) || policy.schemaVersion !== REFINEMENT_READINESS_POLICY_VERSION) {
    throw new Error('refinement readiness policy has an invalid authority shape');
  }
  return Object.freeze({
    schemaVersion: REFINEMENT_READINESS_POLICY_VERSION,
    minSamples: exactPositiveInteger(
      policy.minSamples, REFINEMENT_READINESS_LIMITS.maximumMinSamples, 'minSamples',
    ),
    minDays: exactPositiveInteger(
      policy.minDays, REFINEMENT_READINESS_LIMITS.maximumMinDays, 'minDays',
    ),
  });
};

export const refinementReadinessPolicySha256 = (policy) => canonicalAuthoritySha256(
  assertRefinementReadinessPolicy(policy),
  { domain: 'neuma.refinement.readiness-policy', schemaVersion: 1 },
);

/** Resolve once at the authority boundary. Any present malformed value refuses. */
export const resolveRefinementReadinessPolicy = (environment = process.env) => {
  if (!environment || typeof environment !== 'object') {
    throw new Error('refinement readiness environment is unavailable');
  }
  return assertRefinementReadinessPolicy({
    schemaVersion: REFINEMENT_READINESS_POLICY_VERSION,
    minSamples: environmentInteger(
      environment, ENV_KEYS.minSamples, DEFAULT_MILESTONE.minSamples,
      REFINEMENT_READINESS_LIMITS.maximumMinSamples,
    ),
    minDays: environmentInteger(
      environment, ENV_KEYS.minDays, DEFAULT_MILESTONE.minDays,
      REFINEMENT_READINESS_LIMITS.maximumMinDays,
    ),
  });
};

/** Validate the exact source sets and policies against which one ceremony opens. */
export const assertRefinementCeremonyOpeningAuthority = (authority) => {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)
    || Object.keys(authority).sort().join('\0') !== OPENING_KEYS.join('\0')
    || !Number.isSafeInteger(authority.ceremonySetRevision)
    || authority.ceremonySetRevision < 0
    || !Number.isSafeInteger(authority.attunementSetRevision)
    || authority.attunementSetRevision < 0
    || authority.readinessPolicyRevision !== REFINEMENT_READINESS_POLICY_VERSION
    || ![
      authority.ceremonySetSha256,
      authority.attunementSetSha256,
      authority.readinessPolicySha256,
      authority.sourceAuthoritySha256,
      authority.sourceCorpusSha256,
      authority.sourceManifestSha256,
    ].every((value) => SHA256.test(String(value || '')))) {
    throw new Error('refinement ceremony opening authority has an invalid shape');
  }
  return Object.freeze({ ...authority });
};

export const refinementCeremonyOpeningAuthoritySha256 = (authority) =>
  canonicalAuthoritySha256(assertRefinementCeremonyOpeningAuthority(authority), {
    domain: 'neuma.refinement.ceremony-opening-authority',
    schemaVersion: 1,
  });
