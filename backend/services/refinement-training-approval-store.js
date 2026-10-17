import { randomBytes } from 'node:crypto';
import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';
import {
  measureRefinementHistoryJson,
  resolveRefinementHistoryLimits,
} from '../../core/workspace/refinement-history-reader.js';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import { refinementSubjectAuthorityOperations } from './refinement-subject-authority.js';
import { assertRefinementSubjectTransaction } from './refinement-subject-transaction-lock.js';

const SHA256 = /^[0-9a-f]{64}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const STATE_BYTES_MAX = 64 * 1024;
const LIMITS = resolveRefinementHistoryLimits({
  maximumCiphertextBytes: STATE_BYTES_MAX,
  maximumPlaintextBytes: STATE_BYTES_MAX,
  maximumTotalCiphertextBytes: STATE_BYTES_MAX,
  maximumTotalPlaintextBytes: STATE_BYTES_MAX,
  maximumRecords: 1,
  maximumDirents: 16,
  maximumNameBytes: 1024,
  maximumDepth: 32,
  maximumNodes: 16_384,
  maximumStringBytes: STATE_BYTES_MAX,
  maximumEvents: 1,
  deadlineMs: 10_000,
});
const STATES = new WeakMap();
const STATE_FIELDS = Object.freeze([
  'approvalTokenSha256', 'approvedScales', 'approvedScalesSha256',
  'ceremonyKeySha256', 'ceremonyRecordSha256', 'ceremonyRevision',
  'consumedAt', 'consumedCeremonyRecordSha256', 'consumedCeremonyRevision',
  'custodySha256', 'executionEnvelopeSha256', 'expiresAt', 'issuedAt',
  'operationConfigSha256', 'operatorDecisionSha256', 'operatorWalletSha256',
  'priorStateSha256', 'revision', 'schemaVersion', 'status', 'trainingPlanSha256',
]);
const NEXT_FIELDS = Object.freeze(STATE_FIELDS.filter((field) =>
  !['ceremonyKeySha256', 'priorStateSha256', 'revision', 'schemaVersion'].includes(field)));
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const exactKeys = (value, fields) => {
  const keys = Reflect.ownKeys(value || {});
  return value && typeof value === 'object' && !Array.isArray(value)
    && keys.length === fields.length
    && keys.every((field) => typeof field === 'string' && fields.includes(field));
};
const exactIso = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && new Date(Date.parse(value)).toISOString() === value;
const exactCeremonyId = (value) => {
  if (!CEREMONY_ID.test(String(value || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'training approval ceremony id is invalid');
  }
  return value;
};
const ceremonyKeySha256 = (ceremonyId) => canonicalAuthoritySha256(ceremonyId, {
  domain: 'neuma.refinement.training-approval-key', schemaVersion: 1,
});
const stateSha256 = (value) => canonicalAuthoritySha256(value, {
  domain: 'neuma.refinement.training-approval-state',
  schemaVersion: 1,
  maxDepth: 32,
  maxNodes: 16_384,
  maxStringBytes: STATE_BYTES_MAX,
  maxKeyBytes: 1024,
  maxOutputBytes: STATE_BYTES_MAX,
});
const validateState = (value, ceremonyId) => {
  const pending = value?.status === 'PENDING';
  const consumed = value?.status === 'CONSUMED';
  const digests = [
    value?.approvalTokenSha256, value?.approvedScalesSha256,
    value?.ceremonyRecordSha256, value?.custodySha256,
    value?.executionEnvelopeSha256, value?.operationConfigSha256,
    value?.operatorWalletSha256, value?.priorStateSha256, value?.trainingPlanSha256,
  ];
  if (!exactKeys(value, STATE_FIELDS) || value.schemaVersion !== 1
    || value.ceremonyKeySha256 !== ceremonyKeySha256(ceremonyId)
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.ceremonyRevision) || value.ceremonyRevision < 1
    || !['PENDING', 'CONSUMED'].includes(value.status)
    || !digests.every((digest) => SHA256.test(String(digest || '')))
    || !exactIso(value.issuedAt) || !exactIso(value.expiresAt)
    || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 5 * 60_000
    || (pending && (value.consumedAt !== null
      || value.consumedCeremonyRecordSha256 !== null
      || value.consumedCeremonyRevision !== null
      || value.operatorDecisionSha256 !== null))
    || (consumed && (!exactIso(value.consumedAt)
      || Date.parse(value.consumedAt) < Date.parse(value.issuedAt)
      || Date.parse(value.consumedAt) >= Date.parse(value.expiresAt)
      || !SHA256.test(String(value.consumedCeremonyRecordSha256 || ''))
      || !Number.isSafeInteger(value.consumedCeremonyRevision)
      || value.consumedCeremonyRevision <= value.ceremonyRevision
      || !SHA256.test(String(value.operatorDecisionSha256 || ''))))) {
    throw refuse('REFINEMENT_TRANSACTION_CORRUPT', 'training approval state is not canonical');
  }
  let approvedScales;
  try { approvedScales = refinementApprovedScales(value.approvedScales); } catch {
    throw refuse('REFINEMENT_TRANSACTION_CORRUPT', 'training approval scales are invalid');
  }
  if (refinementSha256(approvedScales) !== value.approvedScalesSha256) {
    throw refuse('REFINEMENT_TRANSACTION_CORRUPT', 'training approval scale digest is invalid');
  }
  const normalized = Object.freeze({ ...value, approvedScales });
  measureRefinementHistoryJson(normalized, LIMITS);
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > STATE_BYTES_MAX) {
    throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'training approval state exceeds its envelope');
  }
  return normalized;
};
const control = (operation) => ({
  deadline: operation.monotonicDeadline,
  signal: operation.signal,
});
const closeResource = async (ops, resource, primary, label) => {
  if (!resource) return primary;
  try { await ops.release(resource); return primary; }
  catch (cleanup) { return combine(primary, cleanup, label); }
};
const withStateDirectory = async (ops, create, work) => {
  let entered = 0;
  let result;
  let primary = null;
  try {
    for (const name of ['refinement', 'transactions']) {
      await ops.enter({
        name, create, mode: 0o700, createMode: 0o700,
        label: `refinement ${name} directory`,
      });
      entered += 1;
    }
    result = await work();
  } catch (error) { primary = error; }
  while (entered > 0) {
    try { await ops.leave(); }
    catch (cleanup) { primary = combine(primary, cleanup, 'training approval directory release'); }
    entered -= 1;
  }
  if (primary) throw primary;
  return result;
};
const stateName = (ceremonyId) => `training-approval-${ceremonyKeySha256(ceremonyId)}.json`;
const readHeld = async (ops, ceremonyId, operation) => {
  const name = stateName(ceremonyId);
  let resource = null;
  try {
    resource = (await ops.open({
      kind: 'file', name, mode: 0o400, label: 'training approval state',
    })).resource;
    const read = await ops.read({
      resource, maximumBytes: STATE_BYTES_MAX, ...control(operation),
      label: 'training approval state',
    });
    let decoded;
    try { decoded = ops.decrypt(read.bytes); } catch {
      throw refuse('REFINEMENT_TRANSACTION_CORRUPT', 'training approval state cannot be authenticated');
    }
    const state = validateState(decoded, ceremonyId);
    return Object.freeze({ state, resource, stateSha256: stateSha256(state) });
  } catch (error) {
    if (!resource && error?.code === 'ENOENT') {
      return Object.freeze({ state: null, resource: null, stateSha256: stateSha256(null) });
    }
    throw await closeResource(ops, resource, error, 'training approval read resource release');
  }
};
const publish = async (ops, ceremonyId, state, expectedResource, operation) => {
  const bytes = ops.encrypt(state);
  if (bytes.length < 1 || bytes.length > STATE_BYTES_MAX) {
    throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'training approval ciphertext exceeds its envelope');
  }
  const temporaryName = `.training-approval-${randomBytes(24).toString('hex')}.tmp`;
  let temporary = null;
  let published = false;
  let primary = null;
  try {
    temporary = (await ops.create({
      kind: 'file', name: temporaryName, mode: 0o600,
      label: 'training approval transaction',
    })).resource;
    await ops.write({ resource: temporary, bytes, maximumBytes: STATE_BYTES_MAX });
    await ops.replace({
      sourceResource: temporary,
      targetName: stateName(ceremonyId),
      expectedTargetResource: expectedResource,
    });
    published = true;
    const durable = await ops.read({
      resource: temporary, maximumBytes: STATE_BYTES_MAX, ...control(operation),
      label: 'durable training approval state',
    });
    let decoded;
    try { decoded = validateState(ops.decrypt(durable.bytes), ceremonyId); } catch {
      throw refuse('REFINEMENT_TRANSACTION_DURABILITY', 'training approval state is not durable');
    }
    if (stateSha256(decoded) !== stateSha256(state)) {
      throw refuse('REFINEMENT_TRANSACTION_DURABILITY', 'training approval digest did not become durable');
    }
  } catch (error) { primary = error; }
  if (!published && temporary) {
    try { await ops.unlink({ name: temporaryName, expectedResource: temporary }); }
    catch (cleanup) { primary = combine(primary, cleanup, 'training approval staging removal'); }
  }
  primary = await closeResource(ops, temporary, primary, 'training approval staging release');
  if (primary) throw primary;
  return state;
};
const authorityState = (authority, operation) => {
  const state = STATES.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'training approval state authority is invalid');
  }
  assertRefinementSubjectTransaction(state.transactionOwner, operation);
  return state;
};
const createAuthority = (transactionOwner, ceremonyId, operation, snapshot) => {
  const authority = Object.freeze({ kind: 'refinement-training-approval-state-v1' });
  STATES.set(authority, {
    active: true, transactionOwner, ceremonyId, operation, snapshot,
  });
  return authority;
};

export const openRefinementTrainingApprovalState = async ({
  transactionOwner, ceremonyId, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const subjectAuthority = assertRefinementSubjectTransaction(transactionOwner, activeOperation);
  const ops = refinementSubjectAuthorityOperations(subjectAuthority, activeOperation);
  let snapshot;
  try {
    // Custody refuses to leave a directory that still owns an open file, so the
    // read resource is released here, inside the entered scope — the same order
    // commitRefinementTrainingApprovalState already uses below.
    snapshot = await withStateDirectory(ops, false, async () => {
      const held = await readHeld(ops, exactCeremonyId(ceremonyId), activeOperation);
      const primary = await closeResource(
        ops, held.resource, null, 'training approval state resource release',
      );
      if (primary) throw primary;
      return Object.freeze({ state: held.state, stateSha256: held.stateSha256 });
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    snapshot = Object.freeze({ state: null, stateSha256: stateSha256(null) });
  }
  return createAuthority(transactionOwner, ceremonyId, activeOperation, snapshot);
};

export const assertRefinementTrainingApprovalState = (authority, operation) =>
  authorityState(authority, operation).snapshot;

export const commitRefinementTrainingApprovalState = async (authority, next, operation) => {
  const state = authorityState(authority, operation);
  if (!exactKeys(next, NEXT_FIELDS)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'next training approval state is invalid');
  }
  const subjectAuthority = assertRefinementSubjectTransaction(
    state.transactionOwner, state.operation,
  );
  const ops = refinementSubjectAuthorityOperations(subjectAuthority, state.operation);
  const committed = await withStateDirectory(ops, true, async () => {
    const current = await readHeld(ops, state.ceremonyId, state.operation);
    let primary = null;
    try {
      if (current.stateSha256 !== state.snapshot.stateSha256) {
        throw refuse('REFINEMENT_TRANSACTION_STALE', 'training approval state changed before commit');
      }
      const revision = (current.state?.revision || 0) + 1;
      if (!Number.isSafeInteger(revision)) {
        throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'training approval revision overflowed');
      }
      const value = validateState({
        ...next,
        schemaVersion: 1,
        ceremonyKeySha256: ceremonyKeySha256(state.ceremonyId),
        revision,
        priorStateSha256: current.stateSha256,
      }, state.ceremonyId);
      await publish(ops, state.ceremonyId, value, current.resource, state.operation);
      return value;
    } catch (error) { primary = error; }
    finally {
      primary = await closeResource(
        ops, current.resource, primary, 'training approval target resource release',
      );
    }
    throw primary;
  });
  state.active = false;
  return createAuthority(state.transactionOwner, state.ceremonyId, state.operation, Object.freeze({
    state: committed, stateSha256: stateSha256(committed),
  }));
};

export const closeRefinementTrainingApprovalState = (authority, operation) => {
  const state = STATES.get(authority);
  if (!state
    || state.operation !== assertRefinementProcessOperationIdentity(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'training approval state authority is invalid');
  }
  if (!state.active) return false;
  state.active = false;
  return true;
};
