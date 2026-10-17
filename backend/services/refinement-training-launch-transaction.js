// The operator's training decision, as one transaction. Issue binds a persisted
// single-use token to one exact plan digest, subject, operator wallet, and
// ceremony revision under a bounded TTL; consume records that decision through
// the immutable grammar and commits it to the ceremony BEFORE any source, model,
// or process side effect can run. The ceremony record is the journal and the
// persisted approval is the CAS that follows it, so a crash between the two
// recovers without ever re-asking the operator.

import { randomBytes } from 'node:crypto';
import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import {
  consumeTrainingPlanDecision,
  recordTrainingPlanDecision,
  refinementTrainingPlanAuthority,
} from '../../core/refinement/training-plan-decision.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import {
  assertRefinementCeremonyTransaction,
  closeRefinementCeremonyTransaction,
  commitPreparedRefinementCeremonyTransition,
  openRefinementCeremonyTransaction,
  prepareRefinementCeremonyTransition,
  projectPreparedRefinementCeremonyTransition,
} from './refinement-ceremony-transaction.js';
import {
  assertRefinementTrainingApprovalState,
  closeRefinementTrainingApprovalState,
  commitRefinementTrainingApprovalState,
  openRefinementTrainingApprovalState,
} from './refinement-training-approval-store.js';
import { refinementAuthoritySha256 } from './refinement-transaction-context.js';

const SHA256 = /^[0-9a-f]{64}$/;
const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const APPROVAL_TTL_MS = 4 * 60_000;
const DECISION_TRANSITION = 'training-plan-decision-consumed';
const LAUNCH_AUTHORITIES = new WeakMap();
const PLAN_FIELDS = Object.freeze([
  'approvedScales', 'approvedScalesSha256', 'ceremonyId', 'ceremonyRecordSha256',
  'ceremonyRevision', 'custodySha256', 'executionEnvelopeSha256', 'neumaId',
  'operationConfigSha256', 'trainingPlanSha256',
]);
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const exactIso = (epoch) => new Date(epoch).toISOString();
const approvalTokenSha256 = (token) => canonicalAuthoritySha256(token, {
  domain: 'neuma.refinement.training-approval-token',
  schemaVersion: 1,
});
const operatorWalletSha256 = (wallet) => {
  if (typeof wallet !== 'string' || !wallet.trim()
    || Buffer.byteLength(wallet, 'utf8') > 1024) {
    throw refuse('TRAINING_APPROVAL_INVALID', 'an authenticated operator wallet is required');
  }
  return refinementAuthoritySha256(wallet, 'neuma.refinement.operator-wallet');
};
const exactApprovalToken = (token) => {
  if (typeof token !== 'string' || !APPROVAL_TOKEN.test(token)) {
    throw refuse('TRAINING_APPROVAL_INVALID', 'the training approval token is invalid');
  }
  return approvalTokenSha256(token);
};
const exactSubject = (neumaId, ceremonyId, trainingPlanSha256) => {
  if (!SUBJECT_ID.test(String(neumaId || '')) || !CEREMONY_ID.test(String(ceremonyId || ''))
    || !SHA256.test(String(trainingPlanSha256 || ''))) {
    throw refuse('TRAINING_APPROVAL_INVALID', 'the training launch request is invalid');
  }
  return Object.freeze({ neumaId, ceremonyId, trainingPlanSha256 });
};

/** Accept only the exact launch-safe projection minted by the training plan resolver. */
const exactPlanAuthority = (value) => {
  const keys = Reflect.ownKeys(value || {});
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.length !== PLAN_FIELDS.length
    || keys.some((field) => typeof field !== 'string' || !PLAN_FIELDS.includes(field))
    || !SUBJECT_ID.test(String(value.neumaId || ''))
    || !CEREMONY_ID.test(String(value.ceremonyId || ''))
    || !Number.isSafeInteger(value.ceremonyRevision) || value.ceremonyRevision < 1
    || ![
      value.approvedScalesSha256, value.ceremonyRecordSha256, value.custodySha256,
      value.executionEnvelopeSha256, value.operationConfigSha256, value.trainingPlanSha256,
    ].every((digest) => SHA256.test(String(digest || '')))) {
    throw refuse('TRAINING_APPROVAL_INVALID', 'the resolved training plan authority is invalid');
  }
  let approvedScales;
  try { approvedScales = refinementApprovedScales(value.approvedScales); } catch {
    throw refuse('TRAINING_APPROVAL_INVALID', 'the approved training scales are invalid');
  }
  if (refinementSha256(approvedScales) !== value.approvedScalesSha256) {
    throw refuse('TRAINING_APPROVAL_INVALID', 'the approved training scale digest is invalid');
  }
  return Object.freeze({ ...value, approvedScales });
};
const APPROVAL_FIELDS = Object.freeze([
  'approvalTokenSha256', 'approvedScales', 'approvedScalesSha256', 'ceremonyRecordSha256',
  'ceremonyRevision', 'consumedAt', 'consumedCeremonyRecordSha256', 'consumedCeremonyRevision',
  'custodySha256', 'executionEnvelopeSha256', 'expiresAt', 'issuedAt', 'operationConfigSha256',
  'operatorDecisionSha256', 'operatorWalletSha256', 'status', 'trainingPlanSha256',
]);
const nextState = (current, patch) => Object.freeze(Object.fromEntries(APPROVAL_FIELDS.map(
  (field) => [field, Object.hasOwn(patch, field) ? patch[field] : current[field]],
)));
const pendingState = ({ plan, walletSha256, tokenSha256, issuedAt, expiresAt }) => nextState(plan, {
  approvalTokenSha256: tokenSha256,
  consumedAt: null,
  consumedCeremonyRecordSha256: null,
  consumedCeremonyRevision: null,
  expiresAt,
  issuedAt,
  operatorDecisionSha256: null,
  operatorWalletSha256: walletSha256,
  status: 'PENDING',
});
const safeApproval = (state, ceremonyId) => Object.freeze({
  ceremonyId,
  ceremonyRevision: state.ceremonyRevision,
  approvalRevision: state.revision,
  trainingPlanSha256: state.trainingPlanSha256,
  approvedScales: Object.freeze([...state.approvedScales]),
  approvedScalesSha256: state.approvedScalesSha256,
  issuedAt: state.issuedAt,
  expiresAt: state.expiresAt,
});
const closeHeld = async ({ ceremonyAuthority, transactionOwner }, operation, primary = null) => {
  if (ceremonyAuthority) {
    try { closeRefinementCeremonyTransaction(ceremonyAuthority, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'ceremony authority release'); }
  }
  try { await closeRefinementSubjectTransaction(transactionOwner, operation); }
  catch (cleanup) { primary = combine(primary, cleanup, 'subject transaction release'); }
  return primary;
};

/** Hold the subject lock and one pinned ceremony snapshot for the whole transaction. */
const withHeldCeremony = async (neumaId, ceremonyId, operation, work) => {
  const transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
  let ceremonyAuthority = null;
  let result;
  let primary = null;
  try {
    ceremonyAuthority = await openRefinementCeremonyTransaction({
      transactionOwner, ceremonyId, operation,
    });
    result = await work({ transactionOwner, ceremonyAuthority });
  } catch (error) { primary = error; }
  primary = await closeHeld({ ceremonyAuthority, transactionOwner }, operation, primary);
  if (primary) throw primary;
  return result;
};
const openApprovalState = async (transactionOwner, ceremonyId, operation) => {
  const authority = await openRefinementTrainingApprovalState({
    transactionOwner, ceremonyId, operation,
  });
  return Object.freeze({
    authority,
    state: assertRefinementTrainingApprovalState(authority, operation).state,
  });
};
const closeApprovalState = (authority, operation, primary = null) => {
  if (!authority) return primary;
  try {
    closeRefinementTrainingApprovalState(authority, operation);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, 'training approval state release');
  }
};
const commitApprovalState = async (authority, next, operation) => {
  const committed = await commitRefinementTrainingApprovalState(authority, next, operation);
  return Object.freeze({
    authority: committed,
    state: assertRefinementTrainingApprovalState(committed, operation).state,
  });
};

/** Refuse unless the pinned ceremony is still the exact one the plan was resolved against. */
const assertPlanCeremony = (current, plan, walletSha256) => {
  if (current.record.phase !== 'training'
    || current.revision !== plan.ceremonyRevision
    || current.recordSha256 !== plan.ceremonyRecordSha256
    || current.custodySha256 !== plan.custodySha256) {
    throw refuse(
      'TRAINING_APPROVAL_CEREMONY_CHANGED',
      'the training plan no longer matches the current ceremony',
    );
  }
  if (operatorWalletSha256(current.record.witness) !== walletSha256) {
    throw refuse('TRAINING_APPROVAL_OPERATOR_CHANGED', 'the ceremony belongs to another operator');
  }
  const decision = current.record.trainingPlanDecision;
  if (decision && !decision.consumedAt) {
    throw refuse(
      'TRAINING_APPROVAL_DECISION_PENDING',
      'the ceremony holds an operator decision that was never consumed',
    );
  }
  return current;
};

/** A same-wallet re-prepare supersedes the prior token; a foreign wallet never does. */
const assertSupersedable = (prior, walletSha256) => {
  if (prior && prior.operatorWalletSha256 !== walletSha256) {
    throw refuse(
      'TRAINING_APPROVAL_OPERATOR_CHANGED',
      'another operator holds the training approval for this ceremony',
    );
  }
  return true;
};
const assertConsumable = (state, expected) => {
  if (!state) {
    throw refuse('TRAINING_APPROVAL_ABSENT', 'no training approval was issued for this ceremony');
  }
  if (state.approvalTokenSha256 !== expected.tokenSha256) {
    throw refuse(
      'TRAINING_APPROVAL_SUPERSEDED',
      'this training approval was superseded by a later one',
    );
  }
  if (state.status === 'CONSUMED') {
    throw refuse('TRAINING_APPROVAL_REPLAY', 'this training approval was already consumed');
  }
  if (state.trainingPlanSha256 !== expected.trainingPlanSha256) {
    throw refuse('TRAINING_APPROVAL_PLAN_CHANGED', 'the approved training plan digest changed');
  }
  if (state.operatorWalletSha256 !== expected.walletSha256) {
    throw refuse(
      'TRAINING_APPROVAL_OPERATOR_CHANGED',
      'another operator was issued this training approval',
    );
  }
  if (Date.now() >= Date.parse(state.expiresAt)) {
    throw refuse('TRAINING_APPROVAL_EXPIRED', 'this training approval expired');
  }
  return state;
};

/**
 * Reread one already-journalled decision for this exact token. A crash between
 * the ceremony commit and the approval CAS lands here, and recovery finishes the
 * CAS instead of asking the operator to decide a second time.
 */
const journalledDecision = (current, pending) => {
  const decision = current.record.trainingPlanDecision;
  if (!decision || decision.nonceSha256 !== pending.approvalTokenSha256) return null;
  if (!decision.consumedAt) {
    throw refuse(
      'TRAINING_APPROVAL_DECISION_PENDING',
      'the recorded operator decision was never consumed',
    );
  }
  const authority = refinementTrainingPlanAuthority(current.record);
  if (authority.trainingPlanSha256 !== pending.trainingPlanSha256
    || authority.issuedAt !== pending.issuedAt
    || authority.expiresAt !== pending.expiresAt
    || current.revision !== pending.ceremonyRevision + 1
    || current.custodySha256 !== pending.custodySha256) {
    throw refuse(
      'TRAINING_APPROVAL_CEREMONY_CHANGED',
      'the recorded operator decision does not belong to this approval',
    );
  }
  return Object.freeze({
    record: current.record,
    recordSha256: current.recordSha256,
    revision: current.revision,
    consumedAt: authority.consumedAt,
    operatorDecisionSha256: authority.operatorDecisionSha256,
  });
};
/**
 * Canonical history digests reject in-memory object aliases, and the pure
 * grammar hands back one frozen custody/scale object shared by the record root,
 * its decision, and its events. The durable record is JSON and carries no
 * aliases, so the transition is stamped from exactly the value that lands.
 */
const durableShape = (record) => JSON.parse(JSON.stringify(record));
const commitDecisionTransition = async (ceremonyAuthority, next, operation) => {
  const prepared = prepareRefinementCeremonyTransition(
    ceremonyAuthority, next, DECISION_TRANSITION, operation,
  );
  const projected = projectPreparedRefinementCeremonyTransition(
    prepared, ceremonyAuthority, operation,
  );
  const record = await commitPreparedRefinementCeremonyTransition(
    ceremonyAuthority, prepared, operation,
  );
  const durable = assertRefinementCeremonyTransaction(ceremonyAuthority, operation).current;
  if (durable.recordSha256 !== projected.recordSha256
    || durable.revision !== projected.revision
    || durable.custodySha256 !== projected.custodySha256) {
    throw refuse(
      'REFINEMENT_TRANSACTION_DURABILITY',
      'the committed training decision authority changed',
    );
  }
  return Object.freeze({
    record, recordSha256: durable.recordSha256, revision: durable.revision,
  });
};

/** Record and consume the decision in one ceremony transition — the launch journal. */
const journalDecision = async ({ ceremonyAuthority, current, pending, operation }) => {
  if (current.record.phase !== 'training'
    || current.revision !== pending.ceremonyRevision
    || current.recordSha256 !== pending.ceremonyRecordSha256
    || current.custodySha256 !== pending.custodySha256) {
    throw refuse(
      'TRAINING_APPROVAL_CEREMONY_CHANGED',
      'the ceremony changed after this training approval was issued',
    );
  }
  const consumedAtEpoch = Date.now();
  if (consumedAtEpoch >= Date.parse(pending.expiresAt)) {
    throw refuse(
      'TRAINING_APPROVAL_EXPIRED', 'this training approval expired before it was consumed',
    );
  }
  const consumedAt = exactIso(consumedAtEpoch);
  const recorded = recordTrainingPlanDecision(current.record, {
    nonceSha256: pending.approvalTokenSha256,
    operatorWalletSha256: pending.operatorWalletSha256,
    trainingPlanSha256: pending.trainingPlanSha256,
    approvedScales: pending.approvedScales,
    approvedScalesSha256: pending.approvedScalesSha256,
    issuedAt: pending.issuedAt,
    expiresAt: pending.expiresAt,
  });
  const committed = await commitDecisionTransition(
    ceremonyAuthority,
    durableShape(consumeTrainingPlanDecision(recorded.record, {
      operatorDecisionSha256: recorded.decision.operatorDecisionSha256,
      consumedAt,
    })),
    operation,
  );
  return Object.freeze({
    ...committed, consumedAt, operatorDecisionSha256: recorded.decision.operatorDecisionSha256,
  });
};
const issueLaunchAuthority = (state, record, operation) => {
  const authority = Object.freeze({ kind: 'refinement-training-launch-authority-v1' });
  LAUNCH_AUTHORITIES.set(authority, {
    active: true,
    operation,
    projection: Object.freeze({
      neumaId: record.neumaId,
      ceremonyId: record.id,
      ceremonyRevision: state.ceremonyRevision,
      consumedCeremonyRecordSha256: state.consumedCeremonyRecordSha256,
      consumedCeremonyRevision: state.consumedCeremonyRevision,
      trainingPlanSha256: state.trainingPlanSha256,
      operationConfigSha256: state.operationConfigSha256,
      executionEnvelopeSha256: state.executionEnvelopeSha256,
      approvedScales: Object.freeze([...state.approvedScales]),
      approvedScalesSha256: state.approvedScalesSha256,
      operatorWalletSha256: state.operatorWalletSha256,
      operatorDecisionSha256: state.operatorDecisionSha256,
      issuedAt: state.issuedAt,
      expiresAt: state.expiresAt,
      consumedAt: state.consumedAt,
      record,
    }),
  });
  return authority;
};

/**
 * Issue one persisted single-use approval over one exact resolved training plan.
 * Returns only the safe projection, the one-time token, and its expiry.
 */
export const issueRefinementTrainingApproval = async ({
  planAuthority, operatorWallet, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const plan = exactPlanAuthority(planAuthority);
  const walletSha256 = operatorWalletSha256(operatorWallet);
  return withHeldCeremony(
    plan.neumaId, plan.ceremonyId, activeOperation,
    async ({ transactionOwner, ceremonyAuthority }) => {
      const current = assertRefinementCeremonyTransaction(
        ceremonyAuthority, activeOperation,
      ).current;
      assertPlanCeremony(current, plan, walletSha256);
      const opened = await openApprovalState(transactionOwner, plan.ceremonyId, activeOperation);
      let authority = opened.authority;
      let primary;
      try {
        assertSupersedable(opened.state, walletSha256);
        const token = randomBytes(32).toString('base64url');
        const issuedAtEpoch = Date.now();
        const committed = await commitApprovalState(authority, pendingState({
          plan,
          walletSha256,
          tokenSha256: approvalTokenSha256(token),
          issuedAt: exactIso(issuedAtEpoch),
          expiresAt: exactIso(issuedAtEpoch + APPROVAL_TTL_MS),
        }), activeOperation);
        authority = committed.authority;
        closeRefinementTrainingApprovalState(authority, activeOperation);
        authority = null;
        return Object.freeze({
          approval: safeApproval(committed.state, plan.ceremonyId),
          approvalToken: token,
          expiresAt: committed.state.expiresAt,
        });
      } catch (error) { primary = error; }
      primary = closeApprovalState(authority, activeOperation, primary);
      throw primary;
    },
  );
};

/**
 * Consume one issued approval exactly once. The decision is journalled into the
 * ceremony before the launch authority exists, so no side effect can precede it.
 */
export const consumeRefinementTrainingApproval = async ({
  neumaId, ceremonyId, trainingPlanSha256, approvalToken, operatorWallet, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const subject = exactSubject(neumaId, ceremonyId, trainingPlanSha256);
  const expected = Object.freeze({
    tokenSha256: exactApprovalToken(approvalToken),
    walletSha256: operatorWalletSha256(operatorWallet),
    trainingPlanSha256: subject.trainingPlanSha256,
  });
  return withHeldCeremony(
    subject.neumaId, subject.ceremonyId, activeOperation,
    async ({ transactionOwner, ceremonyAuthority }) => {
      const current = assertRefinementCeremonyTransaction(
        ceremonyAuthority, activeOperation,
      ).current;
      const opened = await openApprovalState(
        transactionOwner, subject.ceremonyId, activeOperation,
      );
      let authority = opened.authority;
      let primary;
      try {
        const pending = assertConsumable(opened.state, expected);
        const journalled = journalledDecision(current, pending)
          || await journalDecision({
            ceremonyAuthority, current, pending, operation: activeOperation,
          });
        const committed = await commitApprovalState(authority, nextState(pending, {
          consumedAt: journalled.consumedAt,
          consumedCeremonyRecordSha256: journalled.recordSha256,
          consumedCeremonyRevision: journalled.revision,
          operatorDecisionSha256: journalled.operatorDecisionSha256,
          status: 'CONSUMED',
        }), activeOperation);
        authority = committed.authority;
        closeRefinementTrainingApprovalState(authority, activeOperation);
        authority = null;
        return issueLaunchAuthority(committed.state, journalled.record, activeOperation);
      } catch (error) { primary = error; }
      primary = closeApprovalState(authority, activeOperation, primary);
      throw primary;
    },
  );
};

/** Project the exact consumed launch authority; only its issuing operation may read it. */
export const assertRefinementTrainingLaunchAuthority = (authority, operation) => {
  const state = LAUNCH_AUTHORITIES.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)) {
    throw refuse('TRAINING_LAUNCH_STALE', 'the training launch authority is unavailable');
  }
  return state.projection;
};

export const closeRefinementTrainingLaunchAuthority = (authority, operation) => {
  const state = LAUNCH_AUTHORITIES.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperationIdentity(operation)) {
    throw refuse('TRAINING_LAUNCH_STALE', 'the training launch authority is invalid');
  }
  if (!state.active) return false;
  state.active = false;
  return true;
};
