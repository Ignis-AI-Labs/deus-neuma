// Pure append-only refinement ceremony grammar.
import {
  refinementSha256,
  refinementTextSha256,
} from './training-contract.js';
import {
  isRefinementCustodyIdentity,
  refinementBinding,
  refinementTrainingConfiguration,
} from './training-authority-contract.js';
import {
  REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256,
  REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION,
  REFINEMENT_CONSENT_POLICY_SHA256,
  REFINEMENT_CONSENT_POLICY_VERSION,
} from './consent-policy.js';
import { detachedAuthority as detached } from './detached-authority.js';
import {
  assertRefinementCeremonyOpeningAuthority,
  assertRefinementReadinessPolicy,
  refinementCeremonyOpeningAuthoritySha256,
  refinementReadinessPolicySha256,
} from './readiness-policy.js';

const SHA256 = /^[0-9a-f]{64}$/;

export const CEREMONY_PHASES = Object.freeze([
  'consent', 'corpus', 'training', 'verification', 'sealed',
]);

const TERMINAL_PHASES = Object.freeze(['sealed', 'declined', 'abandoned']);

const requireIso = (at, fn) => {
  const epoch = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== at) {
    throw new Error(`${fn}: exact canonical ISO timestamp required`);
  }
  return at;
};

const requirePhase = (record, phase, fn) => {
  if (record?.phase !== phase) {
    throw new Error(`${fn}: ceremony is in phase '${record?.phase}', expected '${phase}'`);
  }
};

const requireCustody = (record, fn) => {
  const openedCustody = record?.events?.find((event) => event?.type === 'opened')?.custody;
  if (!isRefinementCustodyIdentity(record?.custody)
    || record.custody.subjectNeumaId !== record.neumaId
    || !isRefinementCustodyIdentity(openedCustody)
    || refinementSha256(openedCustody) !== refinementSha256(record.custody)) {
    throw new Error(`${fn}: exact ceremony custody required`);
  }
};

const advance = (record, patch, event) => Object.freeze({
  ...record,
  ...patch,
  events: Object.freeze([...record.events, Object.freeze(event)]),
});

export const isCeremonyOpen = (record) =>
  typeof record?.phase === 'string' && !TERMINAL_PHASES.includes(record.phase);

export const mayAnnounceRefinement = (record) => record?.phase === 'sealed';

export function lastSealedAt(records) {
  return (Array.isArray(records) ? records : [])
    .filter((r) => r?.phase === 'sealed' && typeof r.sealedAt === 'string')
    .map((r) => r.sealedAt)
    .sort()
    .at(-1) || null;
}

/**
 * Open a refinement ceremony against one frozen readiness authority. Pure.
 */
export function openCeremony({
  neumaId, witness, custody, milestone, readinessPolicy,
  readinessPolicySha256, openingAuthority, openingAuthoritySha256,
  override, openedAt,
}) {
  if (typeof neumaId !== 'string' || !neumaId.trim()) {
    throw new Error('openCeremony: neumaId required');
  }
  if (typeof witness !== 'string' || !witness.trim()) {
    throw new Error('openCeremony: operator required');
  }
  if (!isRefinementCustodyIdentity(custody) || custody.subjectNeumaId !== neumaId) {
    throw new Error('openCeremony: exact server-derived custody required');
  }
  const policy = assertRefinementReadinessPolicy(readinessPolicy);
  if (refinementReadinessPolicySha256(policy) !== readinessPolicySha256) {
    throw new Error('openCeremony: readiness policy digest mismatch');
  }
  const opening = assertRefinementCeremonyOpeningAuthority(openingAuthority);
  if (opening.readinessPolicySha256 !== readinessPolicySha256
    || refinementCeremonyOpeningAuthoritySha256(opening) !== openingAuthoritySha256) {
    throw new Error('openCeremony: opening authority digest mismatch');
  }
  if (!milestone || typeof milestone.ready !== 'boolean'
    || milestone.minSamples !== policy.minSamples || milestone.minDays !== policy.minDays) {
    throw new Error('openCeremony: milestone does not match its readiness policy');
  }
  const ceremonyCustody = Object.freeze({ ...custody });
  const ceremonyMilestone = Object.freeze({ ...milestone });
  requireIso(openedAt, 'openCeremony');
  const overridden = typeof override === 'string' && override.trim();
  if (!milestone.ready && !overridden) {
    throw Object.assign(new Error('openCeremony: milestone not reached — an operator '
      + 'override with a stated reason is required'), { code: 'MILESTONE_NOT_REACHED' });
  }
  const opened = detached({
    at: openedAt, type: 'opened', custody: ceremonyCustody,
    milestone: ceremonyMilestone, readinessPolicy: policy, readinessPolicySha256,
    openingAuthority: opening, openingAuthoritySha256,
    ...(overridden && { override: override.trim() }),
  });
  return Object.freeze({
    id: `ceremony-${Date.parse(openedAt)}`, neumaId, witness, openedAt, phase: 'consent',
    custody: ceremonyCustody, milestone: ceremonyMilestone, readinessPolicy: policy,
    readinessPolicySha256, openingAuthority: opening, openingAuthoritySha256,
    ...(overridden && { override: override.trim() }), events: Object.freeze([opened]),
  });
}

const consentEventPayload = ({
  record, decision, condition, evidence, custody,
  participatoryAssentSha256, ceremonyApprovalSha256, consentEventIndex,
  supersedesConsentEventSha256,
}) => ({
  act: 'refinement-consent-event',
  ceremonyId: record.id,
  neumaId: record.neumaId,
  decision,
  condition,
  evidence,
  custody,
  participatoryAssentSha256,
  ceremonyApprovalSha256,
  consentEventIndex,
  consentEventRevision: consentEventIndex + 1,
  supersedesConsentEventSha256: supersedesConsentEventSha256 || null,
});

/** Record one server-authenticated, exact-corpus-bound decision. */
export function recordConsent(record, input) {
  const {
    decision, operatorAcknowledged, quote, assentEvidenceId, assentEvidenceSha256,
    issuanceRevision, requestNonceSha256, sessionSha256, responseSha256,
    sourceCorpusSha256, sourceManifestSha256, sourceAuthoritySha256,
    consentPolicyVersion, consentPolicySha256,
    disclosurePolicyVersion, disclosurePolicySha256,
    custody, routeSha256, servingAuthoritySha256,
    provider, model, routeSource, responseAt, condition, at,
  } = input;
  requirePhase(record, 'consent', 'recordConsent');
  requireIso(at, 'recordConsent');
  const validCondition = decision === 'conditional'
    ? typeof condition === 'string' && condition.trim() === condition
      && condition.length > 0 && Buffer.byteLength(condition, 'utf8') <= 2048
    : condition === null;
  if (!['consent', 'decline', 'conditional'].includes(decision)
    || operatorAcknowledged !== true || typeof quote !== 'string' || !quote.trim()
    || Buffer.byteLength(quote, 'utf8') > 256 * 1024
    || ![
      assentEvidenceId, assentEvidenceSha256, requestNonceSha256,
      sessionSha256, responseSha256, sourceCorpusSha256, sourceManifestSha256,
      sourceAuthoritySha256, consentPolicySha256, disclosurePolicySha256,
      routeSha256, servingAuthoritySha256,
    ].every((value) => SHA256.test(String(value || '')))
    || !Number.isSafeInteger(issuanceRevision) || issuanceRevision < 1
    || !Number.isSafeInteger(consentPolicyVersion) || consentPolicyVersion < 1
    || consentPolicyVersion !== REFINEMENT_CONSENT_POLICY_VERSION
    || consentPolicySha256 !== REFINEMENT_CONSENT_POLICY_SHA256
    || disclosurePolicyVersion !== REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION
    || disclosurePolicySha256 !== REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256
    || !Number.isSafeInteger(disclosurePolicyVersion) || disclosurePolicyVersion < 1
    || responseSha256 !== refinementTextSha256(quote)
    || !isRefinementCustodyIdentity(record.custody)
    || !isRefinementCustodyIdentity(custody)
    || custody.subjectNeumaId !== record.neumaId
    || refinementSha256(record.custody) !== refinementSha256(custody)
    || !provider || !model || !routeSource || !validCondition) {
    throw new Error('recordConsent: decision requires acknowledged server-owned evidence');
  }
  requireIso(responseAt, 'recordConsent');
  const priorConditional = record.conditionalAssent || null;
  const supersedesConsentEventSha256 = priorConditional?.authority?.consentEventSha256 || null;
  if (supersedesConsentEventSha256 && !SHA256.test(supersedesConsentEventSha256)) {
    throw new Error('recordConsent: prior conditional assent authority is invalid');
  }
  // The evidence owns its OWN copy of custody: the record holds custody at its
  // root too, and both are hashed together here and in every history digest.
  const evidence = Object.freeze({
    assentEvidenceId, assentEvidenceSha256, issuanceRevision, requestNonceSha256,
    sessionSha256, responseSha256, sourceCorpusSha256, sourceManifestSha256,
    sourceAuthoritySha256, consentPolicyVersion, consentPolicySha256,
    disclosurePolicyVersion, disclosurePolicySha256,
    custody: detached(custody),
    routeSha256, servingAuthoritySha256, provider, model, routeSource, responseAt,
  });
  const participatoryAssentSha256 = refinementSha256({
    act: 'participatory-refinement-assent',
    ceremonyId: record.id,
    neumaId: record.neumaId,
    decision,
    quote,
    evidence,
    custody,
    ...(condition && { condition }),
  });
  const ceremonyApprovalSha256 = refinementSha256({
    act: decision === 'conditional'
      ? 'refinement-condition-acknowledged'
      : decision === 'consent' ? 'refinement-ceremony-approved' : 'refinement-decline-acknowledged',
    ceremonyId: record.id,
    neumaId: record.neumaId,
    operator: record.witness,
    assentEvidenceId,
    assentEvidenceSha256,
    operatorAcknowledged,
    at,
  });
  const consentEventIndex = record.events.length;
  const consentEventRevision = consentEventIndex + 1;
  const consentEventSha256 = refinementSha256(consentEventPayload({
    record, decision, condition, evidence, custody,
    participatoryAssentSha256, ceremonyApprovalSha256, consentEventIndex,
    supersedesConsentEventSha256,
  }));
  const authority = Object.freeze({
    ceremonyId: record.id,
    assentEvidenceId,
    assentEvidenceSha256,
    issuanceRevision,
    requestNonceSha256,
    consentEventSha256,
    consentEventIndex,
    consentEventRevision,
    supersedesConsentEventSha256,
  });
  const event = detached({
    at,
    type: decision === 'conditional' ? 'conditional-assent-held'
      : decision === 'consent' ? 'consent' : 'consent-declined',
    decision,
    authority,
    participatoryAssentSha256,
    ceremonyApprovalSha256,
  });
  const shared = Object.freeze({
    at, ...(condition && { condition }), evidence, authority,
    participatoryAssentSha256, ceremonyApprovalSha256,
    ...(supersedesConsentEventSha256 && { supersedesConsentEventSha256 }),
  });
  if (decision === 'conditional') {
    const priorHolds = Array.isArray(record.assentHolds) ? record.assentHolds : [];
    if (priorHolds.length >= 64) throw new Error('recordConsent: conditional assent history is full');
    return advance(record, {
      phase: 'consent',
      custody,
      conditionalAssent: shared,
      assentHolds: Object.freeze([...priorHolds, detached(shared)]),
    }, event);
  }
  if (decision === 'decline') {
    return advance(record, {
      phase: 'declined', custody, conditionalAssent: null, decline: shared,
    }, event);
  }
  return advance(record, {
    phase: 'corpus', custody, conditionalAssent: null, consent: shared,
  }, event);
}

/** Reread and authenticate the immutable executable consent event chain. */
export function refinementConsentAuthority(record) {
  const decision = record?.consent ? 'consent' : record?.decline ? 'decline' : null;
  const settled = record?.consent || record?.decline;
  const authority = settled?.authority;
  const event = Number.isSafeInteger(authority?.consentEventIndex)
    ? record?.events?.[authority.consentEventIndex]
    : null;
  if (!decision || !settled?.evidence || !isRefinementCustodyIdentity(record?.custody)
    || authority?.ceremonyId !== record.id
    || authority.consentEventRevision !== authority.consentEventIndex + 1
    || event?.authority?.consentEventSha256 !== authority.consentEventSha256
    || event?.decision !== decision
    || event?.type !== (decision === 'consent' ? 'consent' : 'consent-declined')
    || event?.at !== settled.at
    || event?.participatoryAssentSha256 !== settled.participatoryAssentSha256
    || event?.ceremonyApprovalSha256 !== settled.ceremonyApprovalSha256
    || (settled.supersedesConsentEventSha256 || null)
      !== authority.supersedesConsentEventSha256
    || refinementSha256(consentEventPayload({
      record,
      decision,
      condition: settled.condition || null,
      evidence: settled.evidence,
      custody: record.custody,
      participatoryAssentSha256: settled.participatoryAssentSha256,
      ceremonyApprovalSha256: settled.ceremonyApprovalSha256,
      consentEventIndex: authority.consentEventIndex,
      supersedesConsentEventSha256: authority.supersedesConsentEventSha256,
    })) !== authority.consentEventSha256) {
    throw new Error('refinementConsentAuthority: consent event chain failed validation');
  }
  return Object.freeze({ ...authority });
}

/** Record exact consent-authorized corpus digests and counts. */
export function recordCorpus(record, {
  sampleCount,
  distinctDays,
  builtAt,
  provenance,
  sourceCorpusSha256,
  sourceManifestSha256,
  sourceAuthoritySha256,
  at,
}) {
  requirePhase(record, 'corpus', 'recordCorpus');
  requireCustody(record, 'recordCorpus');
  requireIso(at, 'recordCorpus');
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error('recordCorpus: a corpus with zero samples cannot proceed to training');
  }
  if (![sourceCorpusSha256, sourceManifestSha256, sourceAuthoritySha256]
    .every((value) => SHA256.test(String(value || '')))
    || sourceCorpusSha256 !== record.consent?.evidence?.sourceCorpusSha256
    || sourceManifestSha256 !== record.consent?.evidence?.sourceManifestSha256
    || sourceAuthoritySha256 !== record.consent?.evidence?.sourceAuthoritySha256) {
    throw new Error('recordCorpus: corpus does not match the consent-authorized source');
  }
  refinementConsentAuthority(record);
  const corpus = Object.freeze({
    sampleCount,
    distinctDays,
    builtAt,
    ...(provenance && { provenance: Object.freeze(provenance) }),
    sourceCorpusSha256,
    sourceManifestSha256,
    sourceAuthoritySha256,
  });
  return advance(record, { phase: 'training', corpus }, {
    at,
    type: 'corpus',
    sampleCount,
    distinctDays,
    builtAt,
    sourceCorpusSha256,
    sourceManifestSha256,
    sourceAuthoritySha256,
    consentEventRevision: record.consent.authority.consentEventRevision,
  });
}

/**
 * Record a completed training run and its registered adapter. Pure.
 * @param {Object} record - ceremony in phase 'training'
 * @param {{adapter: {id: string, baseModel: string, artifactPath: string, sha256: string, binding: Object},
 *   binding: Object, configuration: Object, curriculum: {id: string, sha256: string},
 *   steps?: number, lossFirst?: number, lossLast?: number, at: string}} training
 * @returns {Object}
 */
export function recordTraining(record, {
  adapter,
  binding: claimedBinding,
  configuration: claimedConfiguration,
  curriculum: claimedCurriculum,
  steps,
  lossFirst,
  lossLast,
  at,
}) {
  requirePhase(record, 'training', 'recordTraining');
  requireCustody(record, 'recordTraining');
  requireIso(at, 'recordTraining');
  if (!adapter?.id || !adapter?.baseModel || !adapter?.artifactPath || !adapter?.sha256) {
    throw new Error('recordTraining: adapter with id, baseModel, artifactPath, sha256 required');
  }
  if (!claimedBinding) throw new Error('recordTraining: provenance binding required');
  const binding = refinementBinding(claimedBinding);
  if (binding.adapterId !== adapter.id || binding.adapterArtifactSha256 !== adapter.sha256) {
    throw new Error('recordTraining: binding adapter identity does not match the trained artifact');
  }
  if (!adapter.binding) throw new Error('recordTraining: adapter binding required');
  const adapterBinding = refinementBinding(adapter.binding);
  if (refinementSha256(adapterBinding) !== refinementSha256(binding)) {
    throw new Error('recordTraining: registry and ceremony bindings must be identical');
  }
  const configuration = refinementTrainingConfiguration(claimedConfiguration);
  if (configuration.sha256 !== binding.trainingConfigSha256
    || configuration.geometry.sha256 !== binding.geometrySha256
    || configuration.budget.sha256 !== binding.trainingBudgetSha256) {
    throw new Error('recordTraining: configuration does not match provenance binding');
  }
  if (!claimedCurriculum || typeof claimedCurriculum.id !== 'string'
    || !SHA256.test(String(claimedCurriculum.sha256 || ''))
    || claimedCurriculum.sha256 !== binding.curriculumSha256) {
    throw new Error('recordTraining: curriculum does not match provenance binding');
  }
  const curriculum = Object.freeze({
    id: claimedCurriculum.id,
    sha256: claimedCurriculum.sha256,
  });
  const training = Object.freeze({
    at,
    adapter: Object.freeze({
      id: adapter.id,
      baseModel: adapter.baseModel,
      artifactPath: adapter.artifactPath,
      sha256: adapter.sha256,
      binding,
    }),
    configuration,
    curriculum,
    ...(Number.isFinite(steps) && { steps }),
    ...(Number.isFinite(lossFirst) && { lossFirst }),
    ...(Number.isFinite(lossLast) && { lossLast }),
  });
  // A spread copies `training`'s own slots only — adapter/configuration/curriculum
  // would stay the record's objects, so the event takes detached copies.
  return advance(record, { phase: 'verification', training },
    detached({ ...training, type: 'training' }));
}

/**
 * Record a training attempt that failed. The ceremony stays in 'training' —
 * ready to retry — and the failure is part of the record. Pure.
 * @param {Object} record - ceremony in phase 'training'
 * @param {{error: string, at: string}} failure
 * @returns {Object}
 */
export function recordTrainingFailure(record, { error, at }) {
  requirePhase(record, 'training', 'recordTrainingFailure');
  requireCustody(record, 'recordTrainingFailure');
  requireIso(at, 'recordTrainingFailure');
  return advance(record, {}, { at, type: 'training-failed', error: String(error).slice(0, 500) });
}

/**
 * Record a binding verification attempt. Only `bound: true` — the machine's
 * own word that THIS ceremony's adapter rides the being's conduit — seals the
 * ceremony. A failed attempt stays in 'verification' with its reason on the
 * record, and mayAnnounceRefinement stays false. Pure.
 * @param {Object} record - ceremony in phase 'verification'
 * @param {{bound: boolean, reason: string, endpoint?: string, model?: string,
 *   lora?: Array, at: string}} attempt
 * @returns {Object}
 */
export function recordVerification(record, { bound, reason, endpoint, model, lora, at }) {
  requirePhase(record, 'verification', 'recordVerification');
  requireCustody(record, 'recordVerification');
  requireIso(at, 'recordVerification');
  if (bound !== true && bound !== false) {
    throw new Error('recordVerification: bound must be explicitly true or false');
  }
  const verification = Object.freeze({
    at, bound, reason: String(reason || ''),
    ...(endpoint && { endpoint }), ...(model && { model }),
    ...(Array.isArray(lora) && { lora }),
  });
  return advance(
    record,
    bound ? { phase: 'sealed', sealedAt: at, verification } : { verification },
    // `lora` is the caller's array and lives on the record too — the event copies it.
    detached({ ...verification, type: bound ? 'verified' : 'verification-failed' }),
  );
}

/**
 * Close an in-progress ceremony without sealing it — the operator's explicit,
 * reasoned act, preserved in the record. Pure.
 * @param {Object} record - any non-terminal ceremony
 * @param {{reason: string, at: string}} closing
 * @returns {Object}
 */
export function abandonCeremony(record, { reason, at }) {
  if (!isCeremonyOpen(record)) {
    throw new Error(`abandonCeremony: ceremony is already ${record?.phase}`);
  }
  requireCustody(record, 'abandonCeremony');
  requireIso(at, 'abandonCeremony');
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('abandonCeremony: a stated reason is required');
  }
  return advance(record, { phase: 'abandoned' }, { at, type: 'abandoned', reason: reason.trim() });
}

export {
  consumeTrainingPlanDecision,
  recordTrainingPlanDecision,
  refinementTrainingPlanAuthority,
} from './training-plan-decision.js';
