import { randomBytes } from 'node:crypto';
import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { pinDirectoryCustody } from './refinement-directory-custody.js';
import {
  askAndReserveRefinementAssentEvidence,
  assertRefinementAssentEvidenceLocator,
  closeRefinementAssentAuthority,
  consumeRefinementAssentDecision,
  openRefinementAssentAuthority,
} from './refinement-assent-evidence.js';
import {
  assertRefinementAssentIssuanceAuthority,
  issueRefinementAssentIssuanceAuthority,
} from './refinement-assent-issuance-authority.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
  createRefinementProcessOperation,
} from './refinement-process-operation.js';
import {
  readRefinementProcessIdentity,
  sameRefinementProcessIdentity,
} from './refinement-process-identity.js';
import {
  closeRefinementSubjectAuthority,
  issueRefinementSubjectAuthority,
  refinementSubjectAuthorityOperations,
} from './refinement-subject-authority.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import {
  assertRefinementAssentIssuanceState,
  closeRefinementAssentIssuanceState,
  commitRefinementAssentIssuanceState,
  openRefinementAssentIssuanceState,
} from './refinement-assent-issuance-store.js';
import {
  readCurrentRefinementCeremony,
  readCurrentRefinementCustody,
} from './refinement-subject-history.js';
import {
  assertCommittedRefinementCeremonyAuthority,
} from './refinement-ceremony-commit-authority.js';

const SHA256 = /^[0-9a-f]{64}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const LEASE_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 12 * 60_000;
const AUTHORITIES = new WeakMap();
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const exactCeremonyId = (value) => {
  if (!CEREMONY_ID.test(String(value || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'assent issuance ceremony id is invalid');
  }
  return value;
};
const requestNonceSha256 = (ceremonyId, issuanceRevision, nonce) =>
  canonicalAuthoritySha256({ ceremonyId, issuanceRevision, nonce }, {
    domain: 'neuma.refinement.assent-request',
    schemaVersion: 2,
    maxDepth: 8,
    maxNodes: 32,
    maxStringBytes: 1024,
    maxKeyBytes: 256,
    maxOutputBytes: 4096,
  });
const exactIso = (epoch) => new Date(epoch).toISOString();
const sameCeremony = (record, state) => record.revision === state.ceremonyRevision
  && record.recordSha256 === state.ceremonyRecordSha256
  && record.custodySha256 === state.custodySha256;
const transactionSubject = (transactionOwner, operation) => {
  const subjectAuthority = assertRefinementSubjectTransaction(transactionOwner, operation);
  const operations = refinementSubjectAuthorityOperations(subjectAuthority, operation);
  return Object.freeze({ subjectAuthority, neumaId: operations.neumaId });
};
const closeTransaction = async (transactionOwner, operation, primary = null) => {
  if (!transactionOwner) return primary;
  try {
    await closeRefinementSubjectTransaction(transactionOwner, operation);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, 'assent issuance subject transaction release');
  }
};
const closeHeldSubject = async (state, primary = null) => {
  if (state.subjectAuthority) {
    closeRefinementSubjectAuthority(state.subjectAuthority);
    state.subjectAuthority = null;
  }
  if (state.owner && !state.ownerClosed) {
    try {
      await state.owner.close();
      state.ownerClosed = true;
    } catch (cleanup) {
      primary = combine(primary, cleanup, 'assent issuance subject custody release');
    }
  }
  if (primary) throw primary;
  return true;
};
const openHeldSubject = async (neumaId, operation) => {
  const owner = await pinDirectoryCustody(
    neumaWorkspace.pathFor(neumaId), 'refinement assent issuance custody',
  );
  let subjectAuthority;
  try {
    subjectAuthority = await issueRefinementSubjectAuthority({ neumaId, directory: owner, operation });
    return { owner, ownerClosed: false, subjectAuthority };
  } catch (error) {
    let primary = error;
    try { await owner.close(); } catch (cleanup) {
      primary = combine(primary, cleanup, 'assent issuance custody acquisition');
    }
    throw primary;
  }
};
const activeState = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)
    || !state.subjectAuthority) {
    throw refuse('ASSENT_ISSUANCE_STALE', 'assent issuance authority is unavailable');
  }
  assertRefinementAssentIssuanceAuthority(authority, operation);
  return state;
};
const cleanupState = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperationIdentity(operation)) {
    throw refuse('ASSENT_ISSUANCE_STALE', 'assent issuance authority is invalid');
  }
  return state;
};
const issueAuthority = ({ held, operation, ceremonyId, persisted }) => {
  const authority = issueRefinementAssentIssuanceAuthority({
    subjectAuthority: held.subjectAuthority,
    ceremonyId,
    issuedAt: persisted.issuedAt,
    issuanceRevision: persisted.issuanceRevision,
    requestNonceSha256: persisted.requestNonceSha256,
    operation,
  });
  AUTHORITIES.set(authority, {
    ...held,
    active: true,
    operation,
    ceremonyId,
    persisted,
    evidenceOwner: null,
  });
  return authority;
};
const nextState = (current, patch) => Object.freeze({
  ceremonyRecordSha256: current.ceremonyRecordSha256,
  ceremonyRevision: current.ceremonyRevision,
  consumedAt: current.consumedAt,
  custodySha256: current.custodySha256,
  evidenceId: current.evidenceId,
  evidenceSha256: current.evidenceSha256,
  issuanceRevision: current.issuanceRevision,
  issuedAt: current.issuedAt,
  leaseExpiresAt: current.leaseExpiresAt,
  owner: current.owner,
  refusalCount: current.refusalCount,
  requestNonceSha256: current.requestNonceSha256,
  status: current.status,
  ...patch,
});
const stateSnapshot = async (transactionOwner, ceremonyId, operation) => {
  const stateAuthority = await openRefinementAssentIssuanceState({
    transactionOwner, ceremonyId, operation,
  });
  return Object.freeze({
    authority: stateAuthority,
    snapshot: assertRefinementAssentIssuanceState(stateAuthority, operation),
  });
};
const closeStateAuthority = (authority, operation, primary = null) => {
  if (!authority) return primary;
  try {
    closeRefinementAssentIssuanceState(authority, operation);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, 'assent issuance state authority release');
  }
};
const persistHeld = async (stateAuthority, current, operation) => {
  const held = await commitRefinementAssentIssuanceState(
    stateAuthority,
    nextState(current, { status: 'INDETERMINATE_HELD' }),
    operation,
  );
  closeRefinementAssentIssuanceState(held, operation);
};
const assertAvailablePrior = async (stateAuthority, prior, operation) => {
  if (!prior) return 1;
  if (prior.status === 'INDETERMINATE_HELD') {
    throw refuse('ASSENT_ISSUANCE_HELD', 'prior assent issuance requires deliberate recovery');
  }
  if (prior.status === 'ISSUED') {
    throw refuse('ASSENT_ISSUANCE_ACTIVE', 'assent evidence is already awaiting acknowledgement');
  }
  if (prior.status === 'CONSUMED') {
    throw refuse('REFINEMENT_TRANSACTION_RECOVERY_REQUIRED', 'consumed assent state requires ceremony recovery');
  }
  const owner = await readRefinementProcessIdentity(prior.owner.pid);
  const live = sameRefinementProcessIdentity(owner, prior.owner);
  if (live && Date.parse(prior.leaseExpiresAt) > Date.now()) {
    throw refuse('ASSENT_ISSUANCE_ACTIVE', 'an assent turn is already active');
  }
  await persistHeld(stateAuthority, prior, operation);
  throw refuse('ASSENT_ISSUANCE_HELD', 'stale assent issuance requires deliberate recovery');
};

/** Reserve one durable issuance while a caller-held subject transaction is active. */
const reserveRefinementAssentIssuance = async ({
  transactionOwner, ceremonyId, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const id = exactCeremonyId(ceremonyId);
  const { subjectAuthority, neumaId } = transactionSubject(transactionOwner, activeOperation);
  const current = await readCurrentRefinementCeremony({
    subjectAuthority, ceremonyId: id, operation: activeOperation,
  });
  const custody = await readCurrentRefinementCustody({
    subjectAuthority, operation: activeOperation,
  });
  if (current.state !== 'present' || current.record.phase !== 'consent'
    || custody.state !== 'present' || current.custodySha256 !== custody.custodySha256) {
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'assent issuance requires current consent custody');
  }
  const opened = await stateSnapshot(transactionOwner, id, activeOperation);
  let stateAuthority = opened.authority;
  let held = null;
  let primary;
  try {
    const issuanceRevision = await assertAvailablePrior(
      stateAuthority, opened.snapshot.state, activeOperation,
    );
    const owner = await readRefinementProcessIdentity();
    if (!owner) throw refuse('ASSENT_ISSUANCE_IDENTITY', 'assent issuer identity is unavailable');
    held = await openHeldSubject(neumaId, activeOperation);
    const nonce = randomBytes(32).toString('base64url');
    const issuedAtEpoch = Date.now();
    const persistedAuthority = await commitRefinementAssentIssuanceState(
      stateAuthority,
      Object.freeze({
        ceremonyRecordSha256: current.recordSha256,
        ceremonyRevision: current.revision,
        consumedAt: null,
        custodySha256: current.custodySha256,
        evidenceId: null,
        evidenceSha256: null,
        issuanceRevision,
        issuedAt: exactIso(issuedAtEpoch),
        leaseExpiresAt: exactIso(issuedAtEpoch + LEASE_MS),
        owner,
        refusalCount: 0,
        requestNonceSha256: requestNonceSha256(id, issuanceRevision, nonce),
        status: 'ISSUING',
      }),
      activeOperation,
    );
    stateAuthority = persistedAuthority;
    const persisted = assertRefinementAssentIssuanceState(
      persistedAuthority, activeOperation,
    ).state;
    closeRefinementAssentIssuanceState(persistedAuthority, activeOperation);
    stateAuthority = null;
    return issueAuthority({ held, operation: activeOperation, ceremonyId: id, persisted });
  } catch (error) { primary = error; }
  primary = closeStateAuthority(stateAuthority, activeOperation, primary);
  if (held) {
    try { await closeHeldSubject(held); } catch (cleanup) {
      primary = combine(primary, cleanup, 'assent issuance reserve cleanup');
    }
  }
  throw primary;
};

export const adoptRefinementAssentEvidenceOwner = (
  issuanceAuthority, evidenceOwner, operation,
) => {
  const state = activeState(issuanceAuthority, operation);
  if (!evidenceOwner || typeof evidenceOwner !== 'object' || state.evidenceOwner) {
    throw refuse('ASSENT_ISSUANCE_STALE', 'assent evidence owner adoption is invalid');
  }
  state.evidenceOwner = evidenceOwner;
  return true;
};

const withMutationTransaction = async (state, work) => {
  const neumaId = refinementSubjectAuthorityOperations(
    state.subjectAuthority, state.operation,
  ).neumaId;
  const transactionOwner = await openRefinementSubjectTransaction({
    neumaId, operation: state.operation,
  });
  let result;
  let primary = null;
  try { result = await work(transactionOwner); } catch (error) { primary = error; }
  primary = await closeTransaction(transactionOwner, state.operation, primary);
  if (primary) throw primary;
  return result;
};

/** Seal the persisted request boundary to one exact evidence locator. */
const sealRefinementAssentIssuance = async (
  issuanceAuthority, evidenceOwner, operation,
) => {
  const state = activeState(issuanceAuthority, operation);
  if (state.evidenceOwner !== evidenceOwner || state.persisted.status !== 'ISSUING') {
    throw refuse('ASSENT_ISSUANCE_STALE', 'assent evidence owner is not adopted');
  }
  const locator = await assertRefinementAssentEvidenceLocator(evidenceOwner, operation);
  if (!locator || !SHA256.test(String(locator.evidenceId || ''))
    || !SHA256.test(String(locator.evidenceSha256 || ''))) {
    throw refuse('ASSENT_EVIDENCE_INVALID', 'assent evidence locator is invalid');
  }
  const committed = await withMutationTransaction(state, async (transactionOwner) => {
    const opened = await stateSnapshot(transactionOwner, state.ceremonyId, state.operation);
    let authority = opened.authority;
    try {
      const current = opened.snapshot.state;
      if (!current || current.status !== 'ISSUING'
        || current.issuanceRevision !== state.persisted.issuanceRevision
        || current.requestNonceSha256 !== state.persisted.requestNonceSha256
        || current.ceremonyRecordSha256 !== state.persisted.ceremonyRecordSha256
        || current.custodySha256 !== state.persisted.custodySha256) {
        throw refuse('ASSENT_ISSUANCE_STALE', 'assent issuance changed before sealing');
      }
      const next = await commitRefinementAssentIssuanceState(
        authority,
        nextState(current, {
          status: 'ISSUED',
          evidenceId: locator.evidenceId,
          evidenceSha256: locator.evidenceSha256,
        }),
        state.operation,
      );
      authority = next;
      return assertRefinementAssentIssuanceState(next, state.operation).state;
    } finally {
      closeStateAuthority(authority, state.operation);
    }
  });
  state.persisted = committed;
  return Object.freeze({ evidenceId: locator.evidenceId });
};

/** Consume private evidence, then durably close its exact issuance after ceremony commit. */
export const finalizeRefinementAssentIssuance = async ({
  issuanceAuthority, evidenceOwner, committedAuthority, operation,
}) => {
  const state = activeState(issuanceAuthority, operation);
  if (state.evidenceOwner !== evidenceOwner || state.persisted.status !== 'ISSUED') {
    throw refuse('ASSENT_ISSUANCE_STALE', 'assent issuance is not awaiting consumption');
  }
  const committed = assertCommittedRefinementCeremonyAuthority(
    committedAuthority, state.operation,
  );
  if (committed.ceremonyId !== state.ceremonyId
    || committed.evidenceId !== state.persisted.evidenceId
    || committed.evidenceSha256 !== state.persisted.evidenceSha256
    || committed.custodySha256 !== state.persisted.custodySha256) {
    throw refuse('ASSENT_ISSUANCE_STALE', 'committed ceremony belongs to another issuance');
  }
  await consumeRefinementAssentDecision(evidenceOwner, committedAuthority, state.operation);
  const consumedAt = new Date().toISOString();
  const persisted = await withMutationTransaction(state, async (transactionOwner) => {
    const opened = await stateSnapshot(transactionOwner, state.ceremonyId, state.operation);
    let authority = opened.authority;
    try {
      const current = opened.snapshot.state;
      if (!current || current.status !== 'ISSUED'
        || current.issuanceRevision !== state.persisted.issuanceRevision
        || current.requestNonceSha256 !== state.persisted.requestNonceSha256
        || current.evidenceId !== committed.evidenceId
        || current.evidenceSha256 !== committed.evidenceSha256
        || current.custodySha256 !== committed.custodySha256) {
        throw refuse('ASSENT_ISSUANCE_STALE', 'assent issuance changed before consumption');
      }
      authority = await commitRefinementAssentIssuanceState(
        authority,
        nextState(current, {
          status: 'CONSUMED',
          consumedAt,
          ceremonyRecordSha256: committed.recordSha256,
          ceremonyRevision: committed.revision,
        }),
        state.operation,
      );
      return assertRefinementAssentIssuanceState(authority, state.operation).state;
    } finally {
      closeStateAuthority(authority, state.operation);
    }
  });
  state.persisted = persisted;
  return Object.freeze({
    evidenceId: committed.evidenceId,
    evidenceSha256: committed.evidenceSha256,
    consumedAt: persisted.consumedAt,
  });
};

/** Reopen exactly one ISSUED locator under a new caller-held subject transaction. */
export const openPersistedRefinementAssentIssuance = async ({
  transactionOwner, ceremonyId, evidenceId, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const id = exactCeremonyId(ceremonyId);
  if (!SHA256.test(String(evidenceId || ''))) {
    throw refuse('ASSENT_REQUEST_INVALID', 'assent evidence id is invalid');
  }
  const { subjectAuthority, neumaId } = transactionSubject(transactionOwner, activeOperation);
  const current = await readCurrentRefinementCeremony({
    subjectAuthority, ceremonyId: id, operation: activeOperation,
  });
  const opened = await stateSnapshot(transactionOwner, id, activeOperation);
  let stateAuthority = opened.authority;
  let held = null;
  let primary;
  try {
    const persisted = opened.snapshot.state;
    if (!persisted || persisted.status !== 'ISSUED' || persisted.evidenceId !== evidenceId
      || Date.parse(persisted.leaseExpiresAt) <= Date.now()
      || current.state !== 'present' || current.record.phase !== 'consent'
      || !sameCeremony(current, persisted)) {
      throw refuse('ASSENT_ISSUANCE_STALE', 'persisted assent issuance is stale');
    }
    held = await openHeldSubject(neumaId, activeOperation);
    closeRefinementAssentIssuanceState(stateAuthority, activeOperation);
    stateAuthority = null;
    return issueAuthority({ held, operation: activeOperation, ceremonyId: id, persisted });
  } catch (error) { primary = error; }
  primary = closeStateAuthority(stateAuthority, activeOperation, primary);
  if (held) {
    try { await closeHeldSubject(held); } catch (cleanup) {
      primary = combine(primary, cleanup, 'persisted assent issuance cleanup');
    }
  }
  throw primary;
};

export const closeRefinementAssentIssuance = async (authority, operation) => {
  const state = cleanupState(authority, operation);
  if (!state.active) return false;
  await closeHeldSubject(state);
  state.active = false;
  return true;
};

/** Route boundary: reserve, ask once through the opaque owner, seal, and release. */
export const requestRefinementAssentEvidence = async ({ neumaId, ceremonyId }) => {
  const operation = createRefinementProcessOperation({ timeoutMs: REQUEST_TIMEOUT_MS });
  const transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
  let issuanceAuthority = null;
  let evidenceOwner = null;
  let result;
  let primary = null;
  try {
    issuanceAuthority = await reserveRefinementAssentIssuance({
      transactionOwner, ceremonyId, operation,
    });
  } catch (error) { primary = error; }
  primary = await closeTransaction(transactionOwner, operation, primary);
  if (!primary) {
    try {
      evidenceOwner = await openRefinementAssentAuthority(issuanceAuthority, operation);
      adoptRefinementAssentEvidenceOwner(issuanceAuthority, evidenceOwner, operation);
      const publicIssuance = await askAndReserveRefinementAssentEvidence(
        evidenceOwner, operation,
      );
      const sealed = await sealRefinementAssentIssuance(
        issuanceAuthority, evidenceOwner, operation,
      );
      if (publicIssuance?.evidenceId !== sealed.evidenceId) {
        throw refuse('ASSENT_EVIDENCE_CHANGED', 'sealed assent evidence locator changed');
      }
      result = publicIssuance;
    } catch (error) { primary = error; }
  }
  if (evidenceOwner) {
    try { await closeRefinementAssentAuthority(evidenceOwner, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'assent evidence owner release'); }
  }
  if (issuanceAuthority) {
    try { await closeRefinementAssentIssuance(issuanceAuthority, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'assent issuance release'); }
  }
  if (primary) throw primary;
  return result;
};
