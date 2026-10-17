import { deepFreezePlainData } from '../shared/plain-data-canonical.js';
import { refinementSha256 } from './training-contract.js';

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const ADAPTER_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ADAPTER_FIELDS = Object.freeze([
  'baseModel', 'binding', 'custody', 'id', 'provenance', 'registeredAt', 'scale', 'sha256',
]);
const PROVENANCE_FIELDS = Object.freeze([
  'ceremonyId', 'consentAuthority', 'servingLineage', 'trainedAt', 'trainingPlanAuthority',
]);
const CONSENT_FIELDS = Object.freeze([
  'assentEvidenceId', 'assentEvidenceSha256', 'ceremonyId', 'consentEventIndex',
  'consentEventRevision', 'issuanceRevision', 'requestNonceSha256',
  'supersedesConsentEventSha256', 'consentEventSha256',
]);
const DECISION_FIELDS = Object.freeze([
  'approvedScalesSha256', 'ceremonyApprovalSha256', 'ceremonyId', 'consumedAt',
  'consumptionEventIndex', 'consumptionEventRevision', 'decisionEventIndex',
  'decisionEventRevision', 'expiresAt', 'issuedAt', 'operatorDecisionSha256',
  'trainingPlanSha256',
]);
const LINEAGE_FIELDS = Object.freeze([
  'baseArtifactSha256', 'baseModelIdentitySha256', 'servingArtifactSha256',
  'servingModel', 'tokenizerSha256', 'trainerModelId', 'trainerRevision',
]);

const exactRecord = (value, fields, label) => {
  deepFreezePlainData(value, {
    field: label,
    maxDepth: 32,
    maxNodes: 100_000,
    maxStringBytes: 8 * 1024 * 1024,
    maxKeyBytes: 1024,
    maxOutputBytes: 32 * 1024 * 1024,
  });
  const keys = Reflect.ownKeys(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.length !== fields.length
    || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
    throw new Error(`${label} must have its exact own string field set`);
  }
  return value;
};
const digest = (value, field) => {
  if (!SHA256.test(String(value || ''))) throw new Error(`${field} must be sha256`);
  return value;
};
const index = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
};
const boundedId = (value, field) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${field} is invalid`);
  return value;
};
const isCanonicalRefinementAdapterInstant = (value) => {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
const instant = (value, field) => {
  if (!isCanonicalRefinementAdapterInstant(value)) throw new Error(`${field} must be a canonical instant`);
  return value;
};

const consentAuthority = (value) => {
  exactRecord(value, CONSENT_FIELDS, 'adapter consent authority');
  boundedId(value.ceremonyId, 'consent ceremonyId');
  boundedId(value.assentEvidenceId, 'consent assentEvidenceId');
  digest(value.assentEvidenceSha256, 'consent assentEvidenceSha256');
  digest(value.requestNonceSha256, 'consent requestNonceSha256');
  digest(value.consentEventSha256, 'consent consentEventSha256');
  if (value.supersedesConsentEventSha256 !== null) {
    digest(value.supersedesConsentEventSha256, 'consent supersedesConsentEventSha256');
  }
  if (!Number.isSafeInteger(value.issuanceRevision) || value.issuanceRevision < 1) {
    throw new Error('consent issuanceRevision must be a positive safe integer');
  }
  index(value.consentEventIndex, 'consent consentEventIndex');
  if (value.consentEventRevision !== value.consentEventIndex + 1) {
    throw new Error('consent event revision is inconsistent');
  }
  return Object.freeze(Object.fromEntries(CONSENT_FIELDS.map((field) => [field, value[field]])));
};

const decisionAuthority = (value) => {
  exactRecord(value, DECISION_FIELDS, 'adapter decision authority');
  boundedId(value.ceremonyId, 'decision ceremonyId');
  for (const field of [
    'approvedScalesSha256', 'ceremonyApprovalSha256', 'operatorDecisionSha256',
    'trainingPlanSha256',
  ]) digest(value[field], `decision ${field}`);
  for (const field of ['issuedAt', 'expiresAt', 'consumedAt']) instant(value[field], `decision ${field}`);
  index(value.decisionEventIndex, 'decision decisionEventIndex');
  index(value.consumptionEventIndex, 'decision consumptionEventIndex');
  if (value.decisionEventRevision !== value.decisionEventIndex + 1
    || value.consumptionEventRevision !== value.consumptionEventIndex + 1
    || value.decisionEventIndex >= value.consumptionEventIndex
    || Date.parse(value.issuedAt) > Date.parse(value.consumedAt)
    || Date.parse(value.consumedAt) >= Date.parse(value.expiresAt)) {
    throw new Error('adapter decision authority is inconsistent');
  }
  return Object.freeze(Object.fromEntries(DECISION_FIELDS.map((field) => [field, value[field]])));
};

const servingLineage = (value) => {
  exactRecord(value, LINEAGE_FIELDS, 'adapter serving lineage');
  for (const field of [
    'baseArtifactSha256', 'baseModelIdentitySha256', 'servingArtifactSha256', 'tokenizerSha256',
  ]) digest(value[field], `serving lineage ${field}`);
  if (typeof value.servingModel !== 'string' || !value.servingModel.trim()
    || typeof value.trainerModelId !== 'string' || !value.trainerModelId.trim()
    || !GIT_OID.test(String(value.trainerRevision || ''))) {
    throw new Error('adapter serving lineage model identity is invalid');
  }
  const expectedIdentity = refinementSha256({
    modelId: value.servingModel,
    modelArtifactSha256: value.baseArtifactSha256,
    tokenizerSha256: value.tokenizerSha256,
  });
  if (value.baseModelIdentitySha256 !== expectedIdentity) {
    throw new Error('adapter serving lineage base identity is invalid');
  }
  return Object.freeze(Object.fromEntries(LINEAGE_FIELDS.map((field) => [field, value[field]])));
};
const servingLineageSha256 = (value) => refinementSha256({
  servingModel: value.servingModel,
  servingArtifactSha256: value.servingArtifactSha256,
  trainerModelId: value.trainerModelId,
  trainerRevision: value.trainerRevision,
  baseArtifactSha256: value.baseArtifactSha256,
  tokenizerSha256: value.tokenizerSha256,
});

const adapterProvenance = (value, binding, registeredAt) => {
  exactRecord(value, PROVENANCE_FIELDS, 'adapter provenance');
  boundedId(value.ceremonyId, 'adapter provenance ceremonyId');
  instant(value.trainedAt, 'adapter trainedAt');
  const consent = consentAuthority(value.consentAuthority);
  const decision = decisionAuthority(value.trainingPlanAuthority);
  const lineage = servingLineage(value.servingLineage);
  if (value.ceremonyId !== binding.ceremonyId || consent.ceremonyId !== binding.ceremonyId
    || decision.ceremonyId !== binding.ceremonyId
    || consent.assentEvidenceId !== binding.assentEvidenceId
    || consent.assentEvidenceSha256 !== binding.assentEvidenceSha256
    || consent.consentEventSha256 !== binding.consentEventSha256
    || consent.consentEventIndex !== binding.consentEventIndex
    || consent.consentEventRevision !== binding.consentEventRevision
    || decision.trainingPlanSha256 !== binding.trainingPlanSha256
    || decision.operatorDecisionSha256 !== binding.operatorDecisionSha256
    || decision.ceremonyApprovalSha256 !== binding.ceremonyApprovalSha256
    || decision.approvedScalesSha256 !== binding.approvedScalesSha256
    || decision.decisionEventIndex !== binding.decisionEventIndex
    || decision.decisionEventRevision !== binding.decisionEventRevision
    || decision.consumptionEventIndex !== binding.consumptionEventIndex
    || decision.consumptionEventRevision !== binding.consumptionEventRevision
    || binding.consentEventIndex > binding.decisionEventIndex
    || binding.decisionEventIndex >= binding.consumptionEventIndex
    || lineage.baseModelIdentitySha256 !== binding.baseModelIdentitySha256
    || lineage.servingArtifactSha256 !== binding.servingArtifactSha256
    || lineage.baseArtifactSha256 !== binding.baseArtifactSha256
    || lineage.tokenizerSha256 !== binding.tokenizerSha256
    || servingLineageSha256(lineage) !== binding.servingLineageSha256
    || Date.parse(decision.consumedAt) > Date.parse(value.trainedAt)
    || Date.parse(value.trainedAt) > Date.parse(registeredAt)) {
    throw new Error('adapter provenance does not match its immutable binding');
  }
  return Object.freeze({
    ceremonyId: value.ceremonyId,
    consentAuthority: consent,
    servingLineage: lineage,
    trainedAt: value.trainedAt,
    trainingPlanAuthority: decision,
  });
};

/** Validate one exact digest-addressed registry record; mutable paths are forbidden. */
export const validateRefinementAdapterRecord = (adapter, validateBinding, validateCustody) => {
  exactRecord(adapter, ADAPTER_FIELDS, 'refinement adapter');
  if (typeof validateBinding !== 'function' || typeof validateCustody !== 'function') {
    throw new Error('refinement adapter validators are unavailable');
  }
  if (!ADAPTER_ID.test(String(adapter.id || ''))
    || typeof adapter.baseModel !== 'string' || !adapter.baseModel.trim()) {
    throw new Error('refinement adapter identity is invalid');
  }
  digest(adapter.sha256, 'adapter sha256');
  instant(adapter.registeredAt, 'adapter registeredAt');
  if (!Number.isFinite(adapter.scale) || adapter.scale < 0 || adapter.scale > 1) {
    throw new Error('adapter scale must be finite in [0, 1]');
  }
  const binding = validateBinding(adapter.binding);
  if (!validateCustody(adapter.custody)) throw new Error('adapter custody is invalid');
  const custody = Object.freeze({
    subjectNeumaId: adapter.custody.subjectNeumaId,
    sovereignDnaSha256: adapter.custody.sovereignDnaSha256,
  });
  const provenance = adapterProvenance(adapter.provenance, binding, adapter.registeredAt);
  if (binding.adapterId !== adapter.id || binding.adapterArtifactSha256 !== adapter.sha256
    || binding.adapterScale !== adapter.scale || provenance.servingLineage.servingModel !== adapter.baseModel) {
    throw new Error('adapter identity does not match its immutable binding');
  }
  return Object.freeze({
    baseModel: adapter.baseModel,
    binding,
    custody,
    id: adapter.id,
    provenance,
    registeredAt: adapter.registeredAt,
    scale: adapter.scale,
    sha256: adapter.sha256,
  });
};
