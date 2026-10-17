import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { annotateMilestoneWithAttunement } from '../../core/attunement/gate.js';
import { buildRefinementCorpus } from '../../core/refinement/export.js';
import { lastSealedAt } from '../../core/refinement/ceremony.js';
import {
  REFINEMENT_READINESS_POLICY_VERSION,
  assertRefinementCeremonyOpeningAuthority,
  refinementCeremonyOpeningAuthoritySha256,
  refinementReadinessPolicySha256,
  resolveRefinementReadinessPolicy,
} from '../../core/refinement/readiness-policy.js';
import {
  assertRefinementProcessOperation,
} from './refinement-process-operation.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import {
  readCurrentRefinementCustody,
  readRefinementAttunementSet,
  readRefinementCeremonySet,
} from './refinement-subject-history.js';
import { commitRefinementCeremonyOpening } from './refinement-ceremony-transaction.js';

const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const PREPARED = new WeakMap();
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const closeTransaction = async (transactionOwner, operation, primary = null) => {
  if (!transactionOwner) return primary;
  try {
    await closeRefinementSubjectTransaction(transactionOwner, operation);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, 'ceremony opening subject transaction release');
  }
};
const preparedState = (authority, operation) => {
  const state = PREPARED.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'prepared ceremony opening is invalid');
  }
  return state;
};

/** Snapshot append-log authorities, then prepare held corpus sources outside the mutation lock. */
export const prepareRefinementCeremonyOpening = async ({
  neumaId, wholeHistory = false, operation, environment = process.env,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  if (!SUBJECT_ID.test(String(neumaId || '')) || typeof wholeHistory !== 'boolean') {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony opening request is invalid');
  }
  const readinessPolicy = resolveRefinementReadinessPolicy(environment);
  const readinessPolicySha256 = refinementReadinessPolicySha256(readinessPolicy);
  const transactionOwner = await openRefinementSubjectTransaction({
    neumaId, operation: activeOperation,
  });
  let ceremonies;
  let attunements;
  let custody;
  let primary = null;
  try {
    const subjectAuthority = assertRefinementSubjectTransaction(
      transactionOwner, activeOperation,
    );
    ceremonies = await readRefinementCeremonySet({
      subjectAuthority, operation: activeOperation,
    });
    attunements = await readRefinementAttunementSet({
      subjectAuthority, operation: activeOperation,
    });
    custody = await readCurrentRefinementCustody({
      subjectAuthority, operation: activeOperation,
    });
  } catch (error) { primary = error; }
  primary = await closeTransaction(transactionOwner, activeOperation, primary);
  if (primary) throw primary;
  if (custody.state !== 'present') {
    throw refuse('REFINEMENT_CUSTODY_UNAVAILABLE', 'current refinement custody is unavailable');
  }
  const since = wholeHistory ? null : lastSealedAt(ceremonies.records);
  let built;
  try {
    built = await buildRefinementCorpus(neumaWorkspace, neumaId, {
      milestone: readinessPolicy,
      since,
      signal: activeOperation.signal,
    });
    activeOperation.assertActive();
    const milestone = annotateMilestoneWithAttunement(
      built.milestone, since, attunements.records,
    );
    const openingAuthority = assertRefinementCeremonyOpeningAuthority({
      attunementSetRevision: attunements.revision,
      attunementSetSha256: attunements.historySha256,
      ceremonySetRevision: ceremonies.revision,
      ceremonySetSha256: ceremonies.historySha256,
      readinessPolicyRevision: REFINEMENT_READINESS_POLICY_VERSION,
      readinessPolicySha256,
      sourceAuthoritySha256: built.sourceAuthoritySha256,
      sourceCorpusSha256: built.sourceCorpusSha256,
      sourceManifestSha256: built.sourceManifestSha256,
    });
    const projection = Object.freeze({
      neumaId,
      custody: custody.custody,
      milestone,
      readinessPolicy,
      readinessPolicySha256,
      openingAuthority,
      openingAuthoritySha256: refinementCeremonyOpeningAuthoritySha256(openingAuthority),
      openedAt: new Date().toISOString(),
    });
    const authority = Object.freeze({ kind: 'prepared-refinement-ceremony-opening-v1' });
    PREPARED.set(authority, {
      active: true,
      operation: activeOperation,
      built,
      projection,
    });
    return authority;
  } catch (error) {
    if (built) {
      try { await built.close(); } catch (cleanup) {
        throw combine(error, cleanup, 'ceremony opening preparation cleanup');
      }
    }
    throw error;
  }
};

export const assertPreparedRefinementCeremonyOpening = (authority, operation) =>
  preparedState(authority, operation).projection;

const verifyPreparedRefinementCeremonyOpening = async (authority, operation) => {
  const state = preparedState(authority, operation);
  await state.built.verify();
  state.operation.assertActive();
  if (state.projection.openingAuthority.sourceAuthoritySha256
      !== state.built.sourceAuthoritySha256
    || state.projection.openingAuthority.sourceCorpusSha256
      !== state.built.sourceCorpusSha256
    || state.projection.openingAuthority.sourceManifestSha256
      !== state.built.sourceManifestSha256) {
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'ceremony corpus authority changed');
  }
  return true;
};

/** Verify held sources under the lock, then commit against re-read append-log authorities. */
export const commitPreparedRefinementCeremonyOpening = async ({
  preparedAuthority, transactionOwner, record, operation,
}) => {
  const state = preparedState(preparedAuthority, operation);
  assertRefinementSubjectTransaction(transactionOwner, state.operation);
  await verifyPreparedRefinementCeremonyOpening(preparedAuthority, state.operation);
  if (record?.neumaId !== state.projection.neumaId
    || record?.openingAuthoritySha256 !== state.projection.openingAuthoritySha256) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony record changes its opening authority');
  }
  return commitRefinementCeremonyOpening({
    transactionOwner,
    record,
    openingAuthority: state.projection.openingAuthority,
    operation: state.operation,
  });
};

export const closePreparedRefinementCeremonyOpening = async (authority, operation) => {
  const state = preparedState(authority, operation);
  await state.built.close();
  state.active = false;
  return true;
};
