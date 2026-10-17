// Single-use operator approval for one exact refinement training plan. Pure:
// encrypted ceremony records carry digests and revisions, never raw wallet or nonce.

import {
  refinementApprovedScales,
  refinementSha256,
} from './training-contract.js';
import { isRefinementCustodyIdentity } from './training-authority-contract.js';
import { detachedAuthority } from './detached-authority.js';

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_DECISION_MS = 5 * 60 * 1000;
const requireTraining = (record, name) => {
  if (record?.phase !== 'training') {
    throw new Error(`${name}: ceremony is in phase '${record?.phase}', expected 'training'`);
  }
  const openedCustody = record.events?.find((event) => event?.type === 'opened')?.custody;
  if (!Array.isArray(record.events) || !isRefinementCustodyIdentity(record.custody)
    || record.custody.subjectNeumaId !== record.neumaId
    || !isRefinementCustodyIdentity(openedCustody)
    || refinementSha256(openedCustody) !== refinementSha256(record.custody)) {
    throw new Error(`${name}: authenticated ceremony custody required`);
  }
};
const requireAuthorityPhase = (record, name) => {
  if (!['training', 'verification', 'sealed'].includes(record?.phase)) {
    throw new Error(
      `${name}: ceremony is in phase '${record?.phase}', expected 'training', 'verification', or 'sealed'`,
    );
  }
  const openedCustody = record.events?.find((event) => event?.type === 'opened')?.custody;
  if (!Array.isArray(record.events) || !isRefinementCustodyIdentity(record.custody)
    || record.custody.subjectNeumaId !== record.neumaId
    || !isRefinementCustodyIdentity(openedCustody)
    || refinementSha256(openedCustody) !== refinementSha256(record.custody)) {
    throw new Error(`${name}: authenticated ceremony custody required`);
  }
};
const requireIso = (value, name, field) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${name}: valid ${field} required`);
  }
};
const requireDigest = (value, name, field) => {
  if (!SHA256.test(String(value || ''))) throw new Error(`${name}: ${field} must be sha256`);
};
const advance = (record, patch, event) => Object.freeze({
  ...record,
  ...patch,
  events: Object.freeze([...record.events, Object.freeze(event)]),
});

/** Record one authenticated operator decision over one exact training plan. */
export function recordTrainingPlanDecision(record, input = {}) {
  const name = 'recordTrainingPlanDecision';
  requireTraining(record, name);
  const prior = record.trainingPlanDecision;
  const {
    nonceSha256, operatorWalletSha256, trainingPlanSha256,
    approvedScalesSha256, issuedAt, expiresAt,
  } = input;
  [
    ['nonceSha256', nonceSha256],
    ['operatorWalletSha256', operatorWalletSha256],
    ['trainingPlanSha256', trainingPlanSha256],
    ['approvedScalesSha256', approvedScalesSha256],
  ].forEach(([field, value]) => requireDigest(value, name, field));
  requireIso(issuedAt, name, 'issuedAt');
  requireIso(expiresAt, name, 'expiresAt');
  const validityMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (validityMs <= 0 || validityMs > MAX_DECISION_MS) {
    throw new Error(`${name}: expiry must be within five minutes of issuance`);
  }
  if (prior && !prior.consumedAt && Date.parse(prior.expiresAt) > Date.parse(issuedAt)) {
    throw new Error(`${name}: the pending decision must be consumed before another is issued`);
  }
  const approvedScales = refinementApprovedScales(input.approvedScales);
  if (refinementSha256(approvedScales) !== approvedScalesSha256) {
    throw new Error(`${name}: approved scales do not match their digest`);
  }
  const ceremonyApprovalSha256 = record.consent?.ceremonyApprovalSha256;
  requireDigest(ceremonyApprovalSha256, name, 'ceremonyApprovalSha256');
  const decisionEventIndex = record.events.length;
  const decisionEventRevision = decisionEventIndex + 1;
  const payload = {
    act: 'refinement-training-plan-decision',
    ceremonyId: record.id,
    // The decision projection sits on the same record as `record.custody`, and
    // the whole record is canonically hashed on every transition — it owns a copy.
    custody: detachedAuthority(record.custody),
    ceremonyApprovalSha256,
    nonceSha256,
    operatorWalletSha256,
    trainingPlanSha256,
    approvedScales,
    approvedScalesSha256,
    issuedAt,
    expiresAt,
    decisionEventIndex,
    decisionEventRevision,
  };
  const decision = Object.freeze({
    ...payload,
    operatorDecisionSha256: refinementSha256(payload),
  });
  const next = advance(record, { trainingPlanDecision: decision }, detachedAuthority({
    at: issuedAt,
    type: 'training-plan-decision',
    ...decision,
  }));
  return Object.freeze({ record: next, decision });
}

/** Consume the current decision exactly once, before any launch side effect. */
export function consumeTrainingPlanDecision(record, input = {}) {
  const name = 'consumeTrainingPlanDecision';
  requireTraining(record, name);
  const { operatorDecisionSha256, consumedAt } = input;
  requireDigest(operatorDecisionSha256, name, 'operatorDecisionSha256');
  requireIso(consumedAt, name, 'consumedAt');
  const decision = record.trainingPlanDecision;
  if (!decision || decision.operatorDecisionSha256 !== operatorDecisionSha256) {
    throw new Error(`${name}: exact current operator decision required`);
  }
  if (decision.consumedAt) throw new Error(`${name}: operator decision already consumed`);
  if (Date.parse(consumedAt) < Date.parse(decision.issuedAt)
    || Date.parse(consumedAt) >= Date.parse(decision.expiresAt)) {
    throw new Error(`${name}: operator decision is not valid at consumption time`);
  }
  const consumptionEventIndex = record.events.length;
  const consumptionEventRevision = consumptionEventIndex + 1;
  const consumed = Object.freeze({
    ...decision,
    consumedAt,
    consumptionEventIndex,
    consumptionEventRevision,
  });
  return advance(record, { trainingPlanDecision: consumed }, {
    at: consumedAt,
    type: 'training-plan-decision-consumed',
    operatorDecisionSha256,
    trainingPlanSha256: decision.trainingPlanSha256,
    decisionEventRevision: decision.decisionEventRevision,
    consumptionEventIndex,
    consumptionEventRevision,
  });
}

/**
 * Reread the current decision and its one matching consumption from the
 * append-only event chain. Consumers never trust root projection alone.
 */
export function refinementTrainingPlanAuthority(record) {
  const name = 'refinementTrainingPlanAuthority';
  requireAuthorityPhase(record, name);
  const decision = record.trainingPlanDecision;
  if (!decision?.consumedAt) throw new Error(`${name}: consumed decision required`);
  const {
    ceremonyId, custody, ceremonyApprovalSha256, nonceSha256,
    operatorWalletSha256, trainingPlanSha256, approvedScales,
    approvedScalesSha256, issuedAt, expiresAt, decisionEventIndex,
    decisionEventRevision, operatorDecisionSha256, consumedAt,
    consumptionEventIndex, consumptionEventRevision,
  } = decision;
  [
    ['ceremonyApprovalSha256', ceremonyApprovalSha256],
    ['nonceSha256', nonceSha256],
    ['operatorWalletSha256', operatorWalletSha256],
    ['trainingPlanSha256', trainingPlanSha256],
    ['approvedScalesSha256', approvedScalesSha256],
    ['operatorDecisionSha256', operatorDecisionSha256],
  ].forEach(([field, value]) => requireDigest(value, name, field));
  requireIso(issuedAt, name, 'issuedAt');
  requireIso(expiresAt, name, 'expiresAt');
  requireIso(consumedAt, name, 'consumedAt');
  if (ceremonyId !== record.id || refinementSha256(custody) !== refinementSha256(record.custody)
    || ceremonyApprovalSha256 !== record.consent?.ceremonyApprovalSha256
    || !Number.isInteger(decisionEventIndex) || decisionEventRevision !== decisionEventIndex + 1
    || !Number.isInteger(consumptionEventIndex)
    || consumptionEventRevision !== consumptionEventIndex + 1
    || consumptionEventIndex <= decisionEventIndex
    || Date.parse(consumedAt) < Date.parse(issuedAt)
    || Date.parse(consumedAt) >= Date.parse(expiresAt)) {
    throw new Error(`${name}: decision authority is inconsistent`);
  }
  const canonicalScales = refinementApprovedScales(approvedScales);
  if (refinementSha256(canonicalScales) !== approvedScalesSha256) {
    throw new Error(`${name}: approved scales authority is inconsistent`);
  }
  const payload = {
    act: 'refinement-training-plan-decision',
    ceremonyId, custody, ceremonyApprovalSha256, nonceSha256,
    operatorWalletSha256, trainingPlanSha256, approvedScales: canonicalScales,
    approvedScalesSha256, issuedAt, expiresAt,
    decisionEventIndex, decisionEventRevision,
  };
  if (refinementSha256(payload) !== operatorDecisionSha256) {
    throw new Error(`${name}: operator decision digest is inconsistent`);
  }
  const expectedDecision = { ...payload, operatorDecisionSha256 };
  const decisionEvent = record.events[decisionEventIndex];
  const consumptionEvent = record.events[consumptionEventIndex];
  if (refinementSha256(decisionEvent) !== refinementSha256({
    at: issuedAt, type: 'training-plan-decision', ...expectedDecision,
  }) || refinementSha256(consumptionEvent) !== refinementSha256({
    at: consumedAt,
    type: 'training-plan-decision-consumed',
    operatorDecisionSha256,
    trainingPlanSha256,
    decisionEventRevision,
    consumptionEventIndex,
    consumptionEventRevision,
  })) {
    throw new Error(`${name}: decision event chain is inconsistent`);
  }
  const decisionCount = record.events.filter((event) =>
    event?.type === 'training-plan-decision'
    && event.operatorDecisionSha256 === operatorDecisionSha256).length;
  const consumptionCount = record.events.filter((event) =>
    event?.type === 'training-plan-decision-consumed'
    && event.operatorDecisionSha256 === operatorDecisionSha256).length;
  if (decisionCount !== 1 || consumptionCount !== 1) {
    throw new Error(`${name}: decision must have exactly one issuance and consumption`);
  }
  return Object.freeze({
    ceremonyId,
    trainingPlanSha256,
    operatorDecisionSha256,
    ceremonyApprovalSha256,
    approvedScalesSha256,
    decisionEventIndex,
    decisionEventRevision,
    issuedAt,
    expiresAt,
    consumedAt,
    consumptionEventIndex,
    consumptionEventRevision,
  });
}
