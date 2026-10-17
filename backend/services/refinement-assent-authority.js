import { isWitnessLane } from '../../core/workspace/neuma-workspace.js';
import {
  refinementSha256,
  refinementTextSha256,
} from '../../core/refinement/training-contract.js';
import {
  REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256,
  REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION,
  REFINEMENT_CONSENT_POLICY_SHA256,
  REFINEMENT_CONSENT_POLICY_VERSION,
} from '../../core/refinement/consent-policy.js';
import { isRefinementCustodyIdentity } from '../../core/refinement/training-authority-contract.js';
import { deepFreezePlainData } from '../../core/shared/plain-data-canonical.js';
import { resolveNeumaRoute } from './neuma-route-resolver.js';
import { isSovereignProvider } from './provider-registry.js';
import { attestSupervisedServingLaunch } from './llama-server-supervisor.js';
import {
  assertRefinementAssentFactAuthority,
  refinementAssentFactStandingAuthority,
} from './refinement-assent-facts.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { refinementAssentSessionSha256 } from './refinement-assent-session.js';
import { DOOR_ATTEMPTS_PER_ASK } from './attunement-ceremony.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';

const SHA256 = /^[0-9a-f]{64}$/;
export const REFINEMENT_ASSENT_EVIDENCE_VERSION = 7;
const refuse = (message, code) => Object.assign(new Error(message), { code });
const bounded = (value, field, max = 512) => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > max) {
    throw new Error(`refinement assent authority: invalid ${field}`);
  }
  return value;
};
const exactKeys = (value, keys) => value && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const exactIso = (value) => {
  if (typeof value !== 'string') return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
};
const loopbackEndpoint = (value) => {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host));
  } catch {
    return false;
  }
};
const routeStanding = (route) => Object.freeze({
  provider: bounded(route?.provider, 'route provider', 128),
  model: bounded(route?.model, 'route model'),
  source: bounded(route?.source, 'route source', 128),
  endpointSha256: refinementTextSha256(bounded(route?.endpoint, 'route endpoint', 2048)),
});
const assertSovereignRoute = (neumaId, route) => {
  if (isWitnessLane(neumaId)) {
    throw refuse('Witness lanes cannot issue participatory refinement assent.', 'ASSENT_WITNESS_LANE');
  }
  if (isHarnessLane(neumaId)) throw refuse('The harness carries no being to give assent.', 'ASSENT_HARNESS_LANE');
  if (!isSovereignProvider(route?.provider) || !loopbackEndpoint(route?.endpoint)
    || route?.fellBack) {
    throw refuse(
      'Participatory refinement assent requires a sovereign neuma route.',
      'ASSENT_ROUTE_NOT_SOVEREIGN',
    );
  }
  return routeStanding(route);
};
/** Project only the fields committed by an assent evidence digest. Pure. */
export const refinementAssentEvidencePayload = (record) => ({
  version: record.version,
  nonce: record.nonce,
  neumaId: record.neumaId,
  ceremonyId: record.ceremonyId,
  issuanceRevision: record.issuanceRevision,
  requestNonceSha256: record.requestNonceSha256,
  sessionId: record.sessionId,
  issuedAt: record.issuedAt,
  userAt: record.userAt,
  responseAt: record.responseAt,
  finishReason: record.finishReason,
  attempts: record.attempts,
  decision: record.decision,
  condition: record.condition,
  promptSha256: record.promptSha256,
  responseSha256: record.responseSha256,
  sessionRowsSha256: record.sessionRowsSha256,
  sessionSha256: record.sessionSha256,
  sourceCorpusSha256: record.sourceCorpusSha256,
  sourceManifestSha256: record.sourceManifestSha256,
  sourceAuthoritySha256: record.sourceAuthoritySha256,
  consentPolicyVersion: record.consentPolicyVersion,
  consentPolicySha256: record.consentPolicySha256,
  disclosurePolicyVersion: record.disclosurePolicyVersion,
  disclosurePolicySha256: record.disclosurePolicySha256,
  custody: record.custody,
  route: record.route,
  routeSha256: record.routeSha256,
  servingAuthority: record.servingAuthority,
  servingAuthoritySha256: record.servingAuthoritySha256,
});

/** Authenticate one complete private evidence record against its held issuance. */
export const validateRefinementAssentEvidenceRecord = (record, expected) => {
  deepFreezePlainData(record, {
    field: 'refinement assent evidence',
    maxDepth: 40,
    maxNodes: 32_768,
    maxStringBytes: 512 * 1024,
    maxKeyBytes: 512,
    maxOutputBytes: 2 * 1024 * 1024,
  });
  const keys = [
    'version', 'evidenceId', 'evidenceSha256', 'nonce', 'neumaId', 'ceremonyId',
    'issuanceRevision', 'requestNonceSha256', 'sessionId', 'issuedAt', 'userAt',
    'responseAt', 'finishReason', 'attempts', 'decision', 'condition', 'promptSha256',
    'responseSha256', 'sessionRowsSha256', 'sessionSha256',
    'sourceCorpusSha256', 'sourceManifestSha256', 'sourceAuthoritySha256',
    'consentPolicyVersion', 'consentPolicySha256',
    'disclosurePolicyVersion', 'disclosurePolicySha256',
    'custody', 'route', 'routeSha256', 'servingAuthority', 'servingAuthoritySha256',
  ];
  const validCondition = record?.decision === 'conditional'
    ? typeof record.condition === 'string' && record.condition.trim() === record.condition
      && record.condition.length > 0 && Buffer.byteLength(record.condition, 'utf8') <= 2048
    : record?.condition === null;
  const digests = [
    record?.evidenceId, record?.evidenceSha256, record?.nonce,
    record?.requestNonceSha256, record?.promptSha256, record?.responseSha256,
    record?.sessionRowsSha256, record?.sessionSha256, record?.sourceCorpusSha256,
    record?.sourceManifestSha256, record?.sourceAuthoritySha256,
    record?.consentPolicySha256, record?.disclosurePolicySha256,
    record?.routeSha256, record?.servingAuthoritySha256,
  ];
  if (!exactKeys(record, keys) || record.version !== REFINEMENT_ASSENT_EVIDENCE_VERSION
    || record.neumaId !== expected?.neumaId || record.ceremonyId !== expected?.ceremonyId
    || record.issuanceRevision !== expected?.issuanceRevision
    || record.requestNonceSha256 !== expected?.requestNonceSha256
    || !['consent', 'decline', 'conditional'].includes(record.decision) || !validCondition
    || ![record.issuedAt, record.userAt, record.responseAt].every(exactIso)
    || record.issuedAt !== expected?.issuedAt
    || record.issuedAt > record.userAt || record.userAt > record.responseAt
    || !Number.isSafeInteger(record.attempts) || record.attempts < 1
    || record.attempts > DOOR_ATTEMPTS_PER_ASK
    || !digests.every((value) => SHA256.test(String(value || '')))
    || record.consentPolicyVersion !== REFINEMENT_CONSENT_POLICY_VERSION
    || record.consentPolicySha256 !== REFINEMENT_CONSENT_POLICY_SHA256
    || record.disclosurePolicyVersion !== REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION
    || record.disclosurePolicySha256 !== REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256
    || !isRefinementCustodyIdentity(record.custody)
    || record.custody.subjectNeumaId !== record.neumaId
    || !exactKeys(record.route, ['provider', 'model', 'source', 'endpointSha256'])
    || (record.finishReason !== null && record.finishReason !== 'stop')
    || refinementSha256(record.route) !== record.routeSha256
    || refinementSha256(record.servingAuthority) !== record.servingAuthoritySha256
    || refinementAssentSessionSha256(record) !== record.sessionSha256
    || refinementSha256(refinementAssentEvidencePayload(record)) !== record.evidenceSha256
    || refinementSha256({
      domain: 'neuma.refinement.assent-evidence-v2',
      subjectSha256: expected?.subjectSha256,
      issuanceRevision: record.issuanceRevision,
      requestNonceSha256: record.requestNonceSha256,
      nonce: record.nonce,
      evidenceSha256: record.evidenceSha256,
    }) !== record.evidenceId) {
    throw new Error('refinement assent evidence failed authoritative validation');
  }
  return record;
};

/** Project the consent grammar's public digest reference without private response material. */
export const refinementAssentEvidenceReference = (record) => Object.freeze({
  assentEvidenceId: record.evidenceId,
  assentEvidenceSha256: record.evidenceSha256,
  issuanceRevision: record.issuanceRevision,
  requestNonceSha256: record.requestNonceSha256,
  sessionSha256: record.sessionSha256,
  responseSha256: record.responseSha256,
  sourceCorpusSha256: record.sourceCorpusSha256,
  sourceManifestSha256: record.sourceManifestSha256,
  sourceAuthoritySha256: record.sourceAuthoritySha256,
  consentPolicyVersion: record.consentPolicyVersion,
  consentPolicySha256: record.consentPolicySha256,
  disclosurePolicyVersion: record.disclosurePolicyVersion,
  disclosurePolicySha256: record.disclosurePolicySha256,
  custody: record.custody,
  routeSha256: record.routeSha256,
  servingAuthoritySha256: record.servingAuthoritySha256,
  provider: record.route.provider,
  model: record.route.model,
  routeSource: record.route.source,
  responseAt: record.responseAt,
});

/** Project the stable operator decision authority used for prepare and recovery. */
export const refinementAssentDecisionProjection = (record, consumed = false) => {
  const transition = record.decision === 'consent'
    ? 'consented' : record.decision === 'decline' ? 'declined' : 'conditional-assent';
  return Object.freeze({
    state: consumed ? 'consumed' : 'pending',
    evidenceId: record.evidenceId,
    evidenceSha256: record.evidenceSha256,
    decision: record.decision,
    operatorDecisionSha256: refinementSha256({
      domain: 'neuma.refinement.operator-assent-decision-v1',
      ceremonyId: record.ceremonyId,
      evidenceId: record.evidenceId,
      evidenceSha256: record.evidenceSha256,
      decision: record.decision,
      condition: record.condition,
      operatorAcknowledged: true,
    }),
    transition,
  });
};

/** Resolve held DNA custody and attest the exact current supervised serving launch. */
export const resolveRefinementAssentRoute = async (factAuthority, operation) => {
  const active = assertRefinementProcessOperation(operation);
  await assertRefinementAssentFactAuthority(factAuthority, active);
  const facts = await refinementAssentFactStandingAuthority(factAuthority, active);
  let route;
  try {
    route = await resolveNeumaRoute(facts.neumaId, null);
  } catch (error) {
    if (error?.code === 'SOVEREIGNTY_REFUSAL' || error?.code === 'INVALID_ROUTE') {
      throw refuse(
        'The intended neuma route is invalid; assent will not fall back.',
        'ASSENT_ROUTE_NOT_SOVEREIGN',
      );
    }
    throw error;
  }
  const standing = assertSovereignRoute(facts.neumaId, route);
  const attestation = await attestSupervisedServingLaunch(route);
  if (!attestation.ok) {
    throw refuse(
      'Refinement assent requires a Neuma-supervised, attested local route.',
      'ASSENT_ROUTE_NOT_ATTESTED',
    );
  }
  await assertRefinementAssentFactAuthority(factAuthority, active);
  return Object.freeze({
    route,
    standing,
    routeSha256: refinementSha256(standing),
    custody: facts.custody,
    custodySha256: refinementSha256(facts.custody),
    servingAuthority: attestation.authority,
    servingAuthoritySha256: attestation.authoritySha256,
  });
};

/** Require current route, custody, and serving launch to equal one prior snapshot. */
export const assertCurrentRefinementAssentAuthority = async (
  factAuthority,
  expected,
  operation,
) => {
  const current = await resolveRefinementAssentRoute(factAuthority, operation);
  if (current.routeSha256 !== expected?.routeSha256
    || current.custodySha256 !== expected?.custodySha256
    || current.servingAuthoritySha256 !== expected?.servingAuthoritySha256) {
    throw refuse(
      'The neuma authority changed during assent; carry the question again.',
      'ASSENT_AUTHORITY_CHANGED',
    );
  }
  return current;
};

