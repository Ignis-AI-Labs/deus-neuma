import { randomBytes } from 'node:crypto';
import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';
import {
  measureRefinementHistoryJson,
  resolveRefinementHistoryLimits,
} from '../../core/workspace/refinement-history-reader.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import { refinementSubjectAuthorityOperations } from './refinement-subject-authority.js';

const SHA256 = /^[0-9a-f]{64}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STATE_BYTES_MAX = 128 * 1024;
const LIMITS = resolveRefinementHistoryLimits({
  maximumCiphertextBytes: STATE_BYTES_MAX,
  maximumPlaintextBytes: STATE_BYTES_MAX,
  maximumTotalCiphertextBytes: STATE_BYTES_MAX,
  maximumTotalPlaintextBytes: STATE_BYTES_MAX,
  maximumRecords: 1,
  maximumDirents: 1,
  maximumNameBytes: 256,
  maximumDepth: 32,
  maximumNodes: 16_384,
  maximumStringBytes: STATE_BYTES_MAX,
  maximumEvents: 1,
  deadlineMs: 10_000,
});
const STATES = new WeakMap();
const STATE_FIELDS = Object.freeze([
  'ceremonyKeySha256', 'ceremonyRecordSha256', 'ceremonyRevision', 'consumedAt',
  'custodySha256', 'evidenceId', 'evidenceSha256', 'issuanceRevision', 'issuedAt',
  'leaseExpiresAt', 'owner', 'priorStateSha256', 'refusalCount', 'requestNonceSha256',
  'revision', 'schemaVersion', 'status',
]);
const NEXT_FIELDS = Object.freeze([
  'ceremonyRecordSha256', 'ceremonyRevision', 'consumedAt', 'custodySha256',
  'evidenceId', 'evidenceSha256', 'issuanceRevision', 'issuedAt', 'leaseExpiresAt',
  'owner', 'refusalCount', 'requestNonceSha256', 'status',
]);
const OWNER_FIELDS = Object.freeze(['bootId', 'pid', 'startTicks', 'uid']);
const STATUS = new Set(['ISSUING', 'ISSUED', 'CONSUMED', 'INDETERMINATE_HELD']);
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const exactKeys = (value, fields) => {
  const keys = Reflect.ownKeys(value || {});
  return value && typeof value === 'object' && !Array.isArray(value)
    && keys.length === fields.length
    && keys.every((field) => typeof field === 'string' && fields.includes(field));
};
const exactIso = (value) => ISO.test(String(value || ''))
  && new Date(Date.parse(value)).toISOString() === value;
const exactOwner = (owner) => exactKeys(owner, OWNER_FIELDS)
  && Number.isSafeInteger(owner.pid) && owner.pid > 0
  && Number.isSafeInteger(owner.uid) && owner.uid >= 0
  && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(String(owner.bootId || ''))
  && /^[0-9]+$/.test(String(owner.startTicks || ''));
const stateSha256 = (value) => canonicalAuthoritySha256(value, {
  domain: 'neuma.refinement.assent-issuance-state',
  schemaVersion: 2,
  maxDepth: 32,
  maxNodes: 16_384,
  maxStringBytes: STATE_BYTES_MAX,
  maxKeyBytes: 1024,
  maxOutputBytes: STATE_BYTES_MAX,
});
const ceremonyKeySha256 = (ceremonyId) => canonicalAuthoritySha256(ceremonyId, {
  domain: 'neuma.refinement.ceremony-key', schemaVersion: 2,
});
const exactCeremonyId = (value) => {
  if (!CEREMONY_ID.test(String(value || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'assent issuance ceremony id is invalid');
  }
  return value;
};
const validateState = (value, ceremonyId) => {
  const issuing = value?.status === 'ISSUING';
  const issued = value?.status === 'ISSUED';
  const consumed = value?.status === 'CONSUMED';
  const held = value?.status === 'INDETERMINATE_HELD';
  if (!exactKeys(value, STATE_FIELDS) || value.schemaVersion !== 2
    || value.ceremonyKeySha256 !== ceremonyKeySha256(ceremonyId)
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.ceremonyRevision) || value.ceremonyRevision < 1
    || !Number.isSafeInteger(value.issuanceRevision) || value.issuanceRevision < 1
    || !Number.isSafeInteger(value.refusalCount) || value.refusalCount < 0
    || value.refusalCount > 3 || !STATUS.has(value.status)
    || !exactOwner(value.owner) || !exactIso(value.issuedAt)
    || !exactIso(value.leaseExpiresAt)
    || ![
      value.priorStateSha256, value.custodySha256, value.ceremonyRecordSha256,
      value.requestNonceSha256,
    ].every((digest) => SHA256.test(String(digest || '')))
    || ((issuing || held) && (value.evidenceId !== null || value.evidenceSha256 !== null))
    || ((issued || consumed) && ![
      value.evidenceId, value.evidenceSha256,
    ].every((digest) => SHA256.test(String(digest || ''))))
    || (consumed ? !exactIso(value.consumedAt) : value.consumedAt !== null)) {
    throw refuse('REFINEMENT_TRANSACTION_CORRUPT', 'assent issuance state is not canonical');
  }
  measureRefinementHistoryJson(value, LIMITS);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > STATE_BYTES_MAX) {
    throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'assent issuance state exceeds its envelope');
  }
  return Object.freeze({ ...value, owner: Object.freeze({ ...value.owner }) });
};
const control = (operation) => ({
  deadline: operation.monotonicDeadline,
  signal: operation.signal,
});
const closeResource = async (ops, resource, primary, label) => {
  if (!resource) return primary;
  try {
    await ops.release(resource);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, label);
  }
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
    try { await ops.leave(); } catch (cleanup) {
      primary = combine(primary, cleanup, 'assent issuance directory release');
    }
    entered -= 1;
  }
  if (primary) throw primary;
  return result;
};
const readHeld = async (ops, ceremonyId, operation) => {
  const name = `${ceremonyKeySha256(ceremonyId)}.json`;
  let resource = null;
  try {
    resource = (await ops.open({
      kind: 'file', name, mode: 0o400, label: 'assent issuance state',
    })).resource;
    const read = await ops.read({
      resource, maximumBytes: STATE_BYTES_MAX, ...control(operation),
      label: 'assent issuance state',
    });
    let decoded;
    try { decoded = ops.decrypt(read.bytes); } catch {
      throw refuse('REFINEMENT_TRANSACTION_CORRUPT', 'assent issuance state cannot be authenticated');
    }
    const state = validateState(decoded, ceremonyId);
    return Object.freeze({ state, resource, stateSha256: stateSha256(state) });
  } catch (error) {
    if (!resource && error?.code === 'ENOENT') {
      return Object.freeze({ state: null, resource: null, stateSha256: stateSha256(null) });
    }
    const primary = await closeResource(
      ops, resource, error, 'assent issuance read resource release',
    );
    throw primary;
  }
};
const publish = async (ops, ceremonyId, state, expectedResource, operation) => {
  const bytes = ops.encrypt(state);
  if (bytes.length < 1 || bytes.length > STATE_BYTES_MAX) {
    throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'assent issuance ciphertext exceeds its envelope');
  }
  const name = `${ceremonyKeySha256(ceremonyId)}.json`;
  const temporaryName = `.assent-${randomBytes(24).toString('hex')}.tmp`;
  let temporary = null;
  let published = false;
  let primary = null;
  try {
    temporary = (await ops.create({
      kind: 'file', name: temporaryName, mode: 0o600,
      label: 'assent issuance transaction',
    })).resource;
    await ops.write({ resource: temporary, bytes, maximumBytes: STATE_BYTES_MAX });
    await ops.replace({
      sourceResource: temporary,
      targetName: name,
      expectedTargetResource: expectedResource,
    });
    published = true;
    const durable = await ops.read({
      resource: temporary, maximumBytes: STATE_BYTES_MAX, ...control(operation),
      label: 'durable assent issuance state',
    });
    let decoded;
    try { decoded = validateState(ops.decrypt(durable.bytes), ceremonyId); } catch {
      throw refuse('REFINEMENT_TRANSACTION_DURABILITY', 'assent issuance state is not durable');
    }
    if (stateSha256(decoded) !== stateSha256(state)) {
      throw refuse('REFINEMENT_TRANSACTION_DURABILITY', 'assent issuance digest did not become durable');
    }
  } catch (error) { primary = error; }
  if (!published && temporary) {
    try { await ops.unlink({ name: temporaryName, expectedResource: temporary }); }
    catch (cleanup) { primary = combine(primary, cleanup, 'assent issuance staging removal'); }
  }
  primary = await closeResource(
    ops, temporary, primary, 'assent issuance staging resource release',
  );
  if (primary) throw primary;
  return state;
};
const authorityState = (authority, operation) => {
  const state = STATES.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'assent issuance state authority is invalid');
  }
  assertRefinementSubjectTransaction(state.transactionOwner, operation);
  return state;
};
const createAuthority = (transactionOwner, ceremonyId, operation, snapshot) => {
  const authority = Object.freeze({ kind: 'refinement-assent-issuance-state-authority-v2' });
  STATES.set(authority, {
    active: true, transactionOwner, ceremonyId, operation, snapshot,
  });
  return authority;
};

export const openRefinementAssentIssuanceState = async ({
  transactionOwner, ceremonyId, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const subjectAuthority = assertRefinementSubjectTransaction(transactionOwner, activeOperation);
  const ops = refinementSubjectAuthorityOperations(subjectAuthority, activeOperation);
  // Custody refuses to leave a directory that still owns an open file, so the
  // read resource is released here, inside the entered scope — the same order
  // commitRefinementAssentIssuanceState already uses below.
  const snapshot = await withStateDirectory(ops, false, async () => {
    const held = await readHeld(ops, exactCeremonyId(ceremonyId), activeOperation);
    const primary = await closeResource(
      ops, held.resource, null, 'assent issuance state resource release',
    );
    if (primary) throw primary;
    return Object.freeze({ state: held.state, stateSha256: held.stateSha256 });
  }).catch((error) => {
    if (error?.code === 'ENOENT') {
      return Object.freeze({ state: null, stateSha256: stateSha256(null) });
    }
    throw error;
  });
  return createAuthority(transactionOwner, ceremonyId, activeOperation, snapshot);
};

export const assertRefinementAssentIssuanceState = (authority, operation) => {
  const state = authorityState(authority, operation);
  return state.snapshot;
};

/** Re-read under the same subject lock, compare the prior digest, then atomic-CAS replace. */
export const commitRefinementAssentIssuanceState = async (authority, next, operation) => {
  const state = authorityState(authority, operation);
  if (!exactKeys(next, NEXT_FIELDS)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'next assent issuance state is invalid');
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
        throw refuse('REFINEMENT_TRANSACTION_STALE', 'assent issuance state changed before commit');
      }
      const revision = (current.state?.revision || 0) + 1;
      if (!Number.isSafeInteger(revision)) {
        throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'assent issuance revision overflowed');
      }
      const value = validateState({
        ...next,
        schemaVersion: 2,
        ceremonyKeySha256: ceremonyKeySha256(state.ceremonyId),
        revision,
        priorStateSha256: current.stateSha256,
      }, state.ceremonyId);
      await publish(ops, state.ceremonyId, value, current.resource, state.operation);
      return value;
    } catch (error) { primary = error; }
    finally {
      primary = await closeResource(
        ops, current.resource, primary, 'assent issuance target resource release',
      );
    }
    throw primary;
  });
  state.active = false;
  return createAuthority(state.transactionOwner, state.ceremonyId, state.operation, Object.freeze({
    state: committed,
    stateSha256: stateSha256(committed),
  }));
};

export const closeRefinementAssentIssuanceState = (authority, operation) => {
  const state = authorityState(authority, operation);
  state.active = false;
  return true;
};
