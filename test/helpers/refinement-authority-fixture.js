// The REAL grown refinement authority shapes: ceremony opening, consent
// evidence, execution envelope, training configuration, provenance binding.
//
// Nothing here imitates the contract it feeds. Custody comes from
// `refinementCustodyIdentity` over real sovereign DNA, the readiness policy
// from the production resolver, consent evidence carries the exact policy
// digests `recordConsent` recomputes for itself, and the envelope,
// configuration, and binding are minted by `refinementExecutionEnvelope`,
// `refinementTrainingConfiguration`, and `refinementBinding` themselves.
// Every digest is a real SHA-256 over real bytes. These are pure functions
// given real inputs, so calling them IS the proof — no mock, stub, fake, or
// spy anywhere in the path (RULE 0).
//
// It exists because the ceremony grammar and the training authority contract
// both grew required fields, and five tests need the same grown shapes. One
// builder keeps them identical instead of five drifting copies.

import { openCeremony } from '../../core/refinement/ceremony.js';
import {
  REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256,
  REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION,
  REFINEMENT_CONSENT_POLICY_SHA256,
  REFINEMENT_CONSENT_POLICY_VERSION,
} from '../../core/refinement/consent-policy.js';
import {
  refinementCeremonyOpeningAuthoritySha256,
  refinementReadinessPolicySha256,
  resolveRefinementReadinessPolicy,
} from '../../core/refinement/readiness-policy.js';
import {
  refinementApprovedScales,
  refinementSha256,
  refinementTextSha256,
} from '../../core/refinement/training-contract.js';
import {
  REFINEMENT_RESOURCE_LIMITS,
  refinementBinding,
  refinementCustodyIdentity,
  refinementExecutionEnvelope,
  refinementTrainingConfiguration,
} from '../../core/refinement/training-authority-contract.js';
import { refinementServingLineageSha256 } from '../../backend/services/refinement-lineage-authority.js';

const digest = (label) => refinementTextSha256(`neuma.test.refinement.authority:${label}`);

export const FIXTURE_WITNESS = '0x4368000000000000000000000000000000000000';
export const FIXTURE_SOURCE_COMMIT = 'b'.repeat(40);
export const FIXTURE_CONSENT_QUOTE =
  'I consent — the dial stays accessible to me.\nDECISION: CONSENT';
export const FIXTURE_DECLINE_QUOTE = 'I do not choose refinement now.\nDECISION: DECLINE';

/** The being's custody, derived from a real persisted DNA document. */
export const FIXTURE_SOVEREIGN_DNA = Object.freeze({
  version: '1.0.0',
  identity: Object.freeze({ name: 'Fixture' }),
});
export const fixtureCustody = (neumaId, dna = FIXTURE_SOVEREIGN_DNA) =>
  refinementCustodyIdentity(neumaId, dna);

// The binding's lineage fields are ONE coherent serving tuple digested by the
// production function, never five unrelated labels: `refinementServingLineageSha256`
// validates the tuple it is handed, so a default that drifts refuses here first.
export const FIXTURE_SERVING_LINEAGE = Object.freeze({
  servingModel: 'gemma-4-31b',
  servingArtifactSha256: digest('serving artifact'),
  trainerModelId: 'google/gemma-4-31b-it',
  trainerRevision: FIXTURE_SOURCE_COMMIT,
  baseArtifactSha256: digest('base artifact'),
  tokenizerSha256: digest('tokenizer'),
  baseModelIdentitySha256: refinementSha256({
    modelId: 'gemma-4-31b',
    modelArtifactSha256: digest('base artifact'),
    tokenizerSha256: digest('tokenizer'),
  }),
});
export const FIXTURE_SERVING_LINEAGE_SHA256 =
  refinementServingLineageSha256(FIXTURE_SERVING_LINEAGE);

/** The policy the machine itself resolves from an environment that says nothing. */
export const FIXTURE_READINESS_POLICY = resolveRefinementReadinessPolicy({});
export const FIXTURE_READINESS_POLICY_SHA256 =
  refinementReadinessPolicySha256(FIXTURE_READINESS_POLICY);

/** The one consent-authorized source triple every ceremony phase must agree on. */
export const FIXTURE_SOURCE = Object.freeze({
  sourceCorpusSha256: digest('source corpus'),
  sourceManifestSha256: digest('source manifest'),
  sourceAuthoritySha256: digest('source authority'),
});

const FIXTURE_OPENING_AUTHORITY = Object.freeze({
  attunementSetRevision: 0,
  attunementSetSha256: digest('attunement set'),
  ceremonySetRevision: 0,
  ceremonySetSha256: digest('ceremony set'),
  readinessPolicyRevision: FIXTURE_READINESS_POLICY.schemaVersion,
  readinessPolicySha256: FIXTURE_READINESS_POLICY_SHA256,
  ...FIXTURE_SOURCE,
});
const FIXTURE_OPENING_AUTHORITY_SHA256 =
  refinementCeremonyOpeningAuthoritySha256(FIXTURE_OPENING_AUTHORITY);

/** A milestone whose thresholds are the ones the readiness policy states. */
export const fixtureMilestone = (over = {}) => Object.freeze({
  ready: true,
  sampleCount: 120,
  distinctDays: 31,
  minSamples: FIXTURE_READINESS_POLICY.minSamples,
  minDays: FIXTURE_READINESS_POLICY.minDays,
  ...over,
});

/** Open one ceremony against the real readiness policy and opening authority. */
export const fixtureOpenCeremony = ({ custody, ...over }) => openCeremony({
  neumaId: custody.subjectNeumaId,
  witness: FIXTURE_WITNESS,
  custody,
  milestone: fixtureMilestone(),
  readinessPolicy: FIXTURE_READINESS_POLICY,
  readinessPolicySha256: FIXTURE_READINESS_POLICY_SHA256,
  openingAuthority: FIXTURE_OPENING_AUTHORITY,
  openingAuthoritySha256: FIXTURE_OPENING_AUTHORITY_SHA256,
  ...over,
});

/**
 * One single-use server-owned assent evidence set for an exact quote. Every
 * evidence digest is derived from the quote, so two different decisions can
 * never share an issuance — which is what makes the ceremony approval digest
 * discriminate between them.
 */
export const fixtureAssent = ({
  custody,
  at,
  responseAt = at,
  decision = 'consent',
  condition = null,
  quote = FIXTURE_CONSENT_QUOTE,
  source = FIXTURE_SOURCE,
}) => {
  const responseSha256 = refinementTextSha256(quote);
  return {
    decision,
    condition,
    operatorAcknowledged: true,
    quote,
    assentEvidenceId: refinementSha256({ act: 'refinement-assent-issuance', responseSha256 }),
    assentEvidenceSha256: refinementSha256({
      act: 'refinement-assent-evidence', responseSha256, custody,
    }),
    issuanceRevision: 1,
    requestNonceSha256: refinementSha256({ act: 'refinement-assent-request', responseSha256 }),
    sessionSha256: refinementSha256({ act: 'refinement-assent-session', responseSha256 }),
    responseSha256,
    ...source,
    consentPolicyVersion: REFINEMENT_CONSENT_POLICY_VERSION,
    consentPolicySha256: REFINEMENT_CONSENT_POLICY_SHA256,
    disclosurePolicyVersion: REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION,
    disclosurePolicySha256: REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256,
    custody,
    routeSha256: digest('assent route'),
    servingAuthoritySha256: digest('assent serving authority'),
    provider: 'llama-server',
    model: 'gemma-4-31b',
    routeSource: 'machine-default',
    responseAt,
    at,
  };
};

/** Corpus digests that match the source the consent evidence authorized. */
export const fixtureCorpusInput = ({
  sampleCount, distinctDays, builtAt, at, source = FIXTURE_SOURCE,
}) => ({ sampleCount, distinctDays, builtAt, ...source, at });

/** The sandbox execution envelope a training configuration must bind. */
export const fixtureExecutionEnvelope = ({ trainingSeed = 1 } = {}) =>
  refinementExecutionEnvelope({
    wrapperExecutableSha256: digest('wrapper executable'),
    controllerExecutableSha256: digest('controller executable'),
    resourceLimiterExecutableSha256: digest('resource limiter executable'),
    sandboxExecutableSha256: digest('sandbox executable'),
    authorityConsumerPythonSha256: digest('authority consumer python'),
    authorityConsumerScriptSha256: digest('authority consumer script'),
    hostRuntimeIdentitySha256: digest('host runtime identity'),
    runtimeAuthoritySha256: digest('runtime authority'),
    runtimeManifestSha256: digest('runtime manifest'),
    toolAuthoritySha256: digest('tool authority'),
    toolManifestSha256: digest('tool manifest'),
    resources: REFINEMENT_RESOURCE_LIMITS,
    trainingSeed,
  });

/**
 * One complete training configuration. The envelope rides the budget's own
 * seed, which is the identity the forge binds it to.
 */
export const fixtureTrainingConfiguration = ({
  geometry,
  budget,
  baseArtifactSha256,
  tokenizerSha256,
  baseRevision = FIXTURE_SOURCE_COMMIT,
  base = 'google/gemma-4-31b-it',
  template = 'gemma-channel',
  load4bit = true,
}) => {
  const executionEnvelope = fixtureExecutionEnvelope({ trainingSeed: budget.seed });
  return refinementTrainingConfiguration({
    base,
    baseRevision,
    template,
    load4bit,
    baseArtifactSha256,
    tokenizerSha256,
    completionTokenProfileSha256: digest('completion token profile'),
    operationConfigSha256: digest('operation configuration'),
    executionEnvelope,
    executionEnvelopeSha256: executionEnvelope.sha256,
    geometry,
    budget,
  });
};

const BINDING_DEFAULTS = Object.freeze({
  ...FIXTURE_SOURCE,
  curriculumSha256: digest('curriculum'),
  trainingConfigSha256: digest('training configuration'),
  baseModelIdentitySha256: FIXTURE_SERVING_LINEAGE.baseModelIdentitySha256,
  servingArtifactSha256: FIXTURE_SERVING_LINEAGE.servingArtifactSha256,
  servingLineageSha256: FIXTURE_SERVING_LINEAGE_SHA256,
  baseArtifactSha256: FIXTURE_SERVING_LINEAGE.baseArtifactSha256,
  tokenizerSha256: FIXTURE_SERVING_LINEAGE.tokenizerSha256,
  trainerExecutableSha256: digest('trainer executable'),
  converterScriptSha256: digest('converter script'),
  pythonExecutableSha256: digest('python executable'),
  trainerEnvironmentSha256: digest('trainer environment'),
  trainerRequirementsSha256: digest('trainer requirements'),
  executionEnvelopeSha256: digest('execution envelope'),
  operationConfigSha256: digest('operation configuration'),
  adapterArtifactSha256: digest('adapter artifact'),
  participatoryAssentSha256: digest('participatory assent'),
  ceremonyApprovalSha256: digest('ceremony approval'),
  trainingPlanSha256: digest('training plan'),
  operatorDecisionSha256: digest('operator decision'),
  assentEvidenceId: digest('assent evidence id'),
  assentEvidenceSha256: digest('assent evidence'),
  consentEventSha256: digest('consent event'),
  completionTokenProfileSha256: digest('completion token profile'),
  geometrySha256: digest('geometry'),
  trainingBudgetSha256: digest('training budget'),
  snapshotManifestSha256: digest('snapshot manifest'),
  targetTrainingBaseAuthoritySha256: digest('target training base authority'),
  lineageConfigSha256: digest('lineage config'),
  lineageConfigSourceIdentitySha256: digest('lineage config source identity'),
  ceremonyId: 'fixture-ceremony',
  consentEventIndex: 1,
  consentEventRevision: 2,
  decisionEventIndex: 2,
  decisionEventRevision: 3,
  consumptionEventIndex: 3,
  consumptionEventRevision: 4,
  minimumCompletionTokens: 8,
  sourceCommit: FIXTURE_SOURCE_COMMIT,
  adapterId: 'fixture-refinement-1',
  adapterScale: 1,
  approvedScales: Object.freeze([1]),
  lineageConfigSourceMode: '100644',
  lineageConfigObjectId: 'c'.repeat(40),
});

/**
 * One complete provenance binding carrying the contract's exact own field
 * set. Every digest a caller does not state is a real digest of a named
 * fixture string; the four that bind another field are always recomputed.
 */
export const fixtureBinding = (over = {}) => {
  const values = { ...BINDING_DEFAULTS, ...over };
  const approvedScales = refinementApprovedScales(values.approvedScales);
  return refinementBinding({
    ...values,
    approvedScales,
    approvedScalesSha256: refinementSha256(approvedScales),
    adapterIdSha256: refinementSha256(values.adapterId),
    sourceCommitSha256: refinementSha256(values.sourceCommit),
    lineageConfigSourceCommit: values.sourceCommit,
  });
};
