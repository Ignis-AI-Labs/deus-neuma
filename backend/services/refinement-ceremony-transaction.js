import { randomBytes } from 'node:crypto';
import { refinementAuthoritySha256 as authoritySha256 } from './refinement-transaction-context.js';
import {
  assertRefinementHistoryRecord,
  measureRefinementHistoryJson,
  refinementHistorySha256,
  resolveRefinementHistoryLimits,
} from '../../core/workspace/refinement-history-reader.js';
import {
  assertRefinementCeremonyOpeningAuthority,
  refinementCeremonyOpeningAuthoritySha256,
} from '../../core/refinement/readiness-policy.js';
import { isCeremonyOpen } from '../../core/refinement/ceremony.js';
import {
  assertCurrentRefinementCustody,
  readCurrentRefinementCeremony,
  readCurrentRefinementCustody,
  readRefinementAttunementSet,
  readRefinementCeremonySet,
} from './refinement-subject-history.js';
import { assertRefinementSubjectTransaction } from './refinement-subject-transaction-lock.js';
import { refinementSubjectAuthorityOperations } from './refinement-subject-authority.js';
import {
  assertRefinementProcessOperation, assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';

const SHA256 = /^[0-9a-f]{64}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const TRANSITION = /^[a-z][a-z0-9-]{0,63}$/;
const RECORD_BYTES_MAX = 2 * 1024 * 1024;
const RECORD_LIMITS = resolveRefinementHistoryLimits({
  maximumCiphertextBytes: RECORD_BYTES_MAX,
  maximumPlaintextBytes: RECORD_BYTES_MAX,
  maximumTotalCiphertextBytes: 32 * 1024 * 1024,
  maximumTotalPlaintextBytes: 32 * 1024 * 1024,
  maximumRecords: 1024,
  maximumDirents: 1024,
  maximumNameBytes: 256 * 1024,
  maximumDepth: 48,
  maximumNodes: 250_000,
  maximumStringBytes: 16 * 1024 * 1024,
  // The server history envelope caps this at 16_384; asking for more throws at module
  // evaluation and takes every importer down with it. Take the whole envelope, not a
  // number above it.
  maximumEvents: 16_384,
  deadlineMs: 10_000,
});
const AUTHORITIES = new WeakMap();
const COMMITS = new WeakMap();
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const exactId = (value) => {
  if (!CEREMONY_ID.test(String(value || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony id is invalid');
  }
  return value;
};
const custodySha256 = (custody) =>
  authoritySha256(custody, 'neuma.refinement.custody-authority');
const control = (operation) => ({
  deadline: operation.monotonicDeadline,
  signal: operation.signal,
});
const freezeGraph = (value) => {
  const pending = [value];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return value;
};
const closeResource = async (ops, resource, primary, label) => {
  if (!resource) return primary;
  try {
    await ops.release(resource);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, label);
  }
};
const withDirectories = async (ops, names, create, work) => {
  let entered = 0;
  let result;
  let primary = null;
  try {
    for (const name of names) {
      await ops.enter({
        name,
        create,
        mode: 0o700,
        createMode: 0o700,
        label: `refinement ${name} directory`,
      });
      entered += 1;
    }
    result = await work();
  } catch (error) {
    primary = error;
  }
  while (entered > 0) {
    try {
      await ops.leave();
    } catch (cleanup) {
      primary = combine(primary, cleanup, 'refinement ceremony directory release');
    }
    entered -= 1;
  }
  if (primary) throw primary;
  return result;
};
const assertTransactionStamp = (record, expectedCustodySha256) => {
  const transaction = record.transaction;
  if (!Number.isSafeInteger(record.revision) || record.revision < 1
    || !SHA256.test(String(record.priorCeremonySha256 || ''))
    || !transaction || typeof transaction !== 'object' || Array.isArray(transaction)
    || Reflect.ownKeys(transaction).length !== 5
    || Reflect.ownKeys(transaction).some((field) => typeof field !== 'string'
      || !['schemaVersion', 'revision', 'priorCeremonySha256',
        'custodySha256', 'transition'].includes(field))
    || transaction.schemaVersion !== 2
    || transaction.revision !== record.revision
    || transaction.priorCeremonySha256 !== record.priorCeremonySha256
    || transaction.custodySha256 !== expectedCustodySha256
    || !TRANSITION.test(String(transaction.transition || ''))) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'ceremony transaction stamp is invalid');
  }
  return record;
};
const decodeRecord = (ops, bytes, ceremonyId) => {
  let value;
  try {
    value = ops.decrypt(bytes);
  } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'ceremony ciphertext cannot be authenticated');
  }
  const measured = measureRefinementHistoryJson(value, RECORD_LIMITS);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > RECORD_LIMITS.maximumPlaintextBytes
    || measured.nodes > RECORD_LIMITS.maximumNodes
    || measured.stringBytes > RECORD_LIMITS.maximumStringBytes) {
    throw refuse('REFINEMENT_HISTORY_OVERFLOW', 'ceremony plaintext exceeds its bounded envelope');
  }
  const record = assertRefinementHistoryRecord(
    value, ops.neumaId, ceremonyId, RECORD_LIMITS, 'ceremony',
  );
  return freezeGraph(assertTransactionStamp(record, custodySha256(record.custody)));
};
const readHeldRecord = async (ops, ceremonyId, operation, absent) => {
  operation.assertActive();
  let resource = null;
  try {
    const opened = await ops.open({
      kind: 'file',
      name: `${ceremonyId}.json`,
      mode: 0o400,
      label: 'refinement ceremony record',
    });
    resource = opened.resource;
    const read = await ops.read({
      resource,
      maximumBytes: RECORD_BYTES_MAX,
      ...control(operation),
      label: 'refinement ceremony record',
    });
    const record = decodeRecord(ops, read.bytes, ceremonyId);
    return Object.freeze({
      state: 'present',
      record,
      resource,
      revision: record.revision,
      recordSha256: refinementHistorySha256(record),
      custodySha256: custodySha256(record.custody),
    });
  } catch (error) {
    if (!resource && absent && error?.code === 'ENOENT') {
      return Object.freeze({
        state: 'absent',
        record: null,
        resource: null,
        revision: 0,
        recordSha256: null,
        custodySha256: null,
      });
    }
    const primary = await closeResource(
      ops, resource, error, 'refinement ceremony read resource release',
    );
    throw primary;
  }
};
const sameCurrent = (left, right) => left.state === right.state
  && left.revision === right.revision
  && left.recordSha256 === right.recordSha256
  && left.custodySha256 === right.custodySha256;
const publishRecord = async (ops, ceremonyId, record, expectedResource, operation) => {
  operation.assertActive();
  const bytes = ops.encrypt(record);
  if (bytes.length < 1 || bytes.length > RECORD_BYTES_MAX) {
    throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'ceremony record exceeds its byte envelope');
  }
  const temporaryName = `.ceremony-${randomBytes(24).toString('hex')}.tmp`;
  let temporary = null;
  let published = false;
  let primary = null;
  try {
    temporary = (await ops.create({
      kind: 'file',
      name: temporaryName,
      mode: 0o600,
      label: 'refinement ceremony transaction',
    })).resource;
    await ops.write({ resource: temporary, bytes, maximumBytes: RECORD_BYTES_MAX });
    await ops.replace({
      sourceResource: temporary,
      targetName: `${ceremonyId}.json`,
      expectedTargetResource: expectedResource,
    });
    published = true;
    const durable = await ops.read({
      resource: temporary,
      maximumBytes: RECORD_BYTES_MAX,
      ...control(operation),
      label: 'durable refinement ceremony record',
    });
    const decoded = decodeRecord(ops, durable.bytes, ceremonyId);
    if (refinementHistorySha256(decoded) !== refinementHistorySha256(record)) {
      throw refuse('REFINEMENT_TRANSACTION_DURABILITY', 'ceremony record did not become durable');
    }
  } catch (error) {
    primary = error;
  }
  if (!published && temporary) {
    try {
      await ops.unlink({ name: temporaryName, expectedResource: temporary });
    } catch (cleanup) {
      primary = combine(primary, cleanup, 'ceremony staging removal');
    }
  }
  primary = await closeResource(
    ops, temporary, primary, 'ceremony staging resource release',
  );
  if (primary) throw primary;
  return record;
};
const stampRecord = ({ current, nextRecord, transition, priorCeremonySha256 = null }) => {
  if (!nextRecord || typeof nextRecord !== 'object' || Array.isArray(nextRecord)
    || !TRANSITION.test(String(transition || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'prepared ceremony transition is invalid');
  }
  const revision = current.state === 'present' ? current.revision + 1 : 1;
  if (!Number.isSafeInteger(revision)) {
    throw refuse('REFINEMENT_TRANSACTION_OVERFLOW', 'ceremony revision overflowed');
  }
  const prior = current.state === 'present' ? current.recordSha256 : priorCeremonySha256;
  if (!SHA256.test(String(prior || ''))) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony prior authority is invalid');
  }
  const custody = custodySha256(nextRecord.custody);
  const transaction = Object.freeze({
    schemaVersion: 2,
    revision,
    priorCeremonySha256: prior,
    custodySha256: custody,
    transition,
  });
  const stamped = freezeGraph({
    ...nextRecord,
    revision,
    priorCeremonySha256: prior,
    transaction,
  });
  assertRefinementHistoryRecord(
    stamped, stamped.neumaId, stamped.id, RECORD_LIMITS, 'ceremony',
  );
  assertTransactionStamp(stamped, custody);
  return stamped;
};
const authorityState = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state || !state.active
    || state.operation !== assertRefinementProcessOperation(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony transaction authority is invalid');
  }
  assertRefinementSubjectTransaction(state.transactionOwner, operation);
  return state;
};

/** Pin one exact current ceremony snapshot under an already-held subject transaction. */
export const openRefinementCeremonyTransaction = async ({
  transactionOwner, ceremonyId, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const subjectAuthority = assertRefinementSubjectTransaction(
    transactionOwner, activeOperation,
  );
  const current = await readCurrentRefinementCeremony({
    subjectAuthority,
    ceremonyId: exactId(ceremonyId),
    operation: activeOperation,
    limits: RECORD_LIMITS,
  });
  if (current.state !== 'present') {
    throw refuse('CEREMONY_NOT_FOUND', 'refinement ceremony is absent');
  }
  await assertCurrentRefinementCustody(
    { subjectAuthority, operation: activeOperation, limits: RECORD_LIMITS }, current.custodySha256);
  const authority = Object.freeze({ kind: 'refinement-ceremony-transaction-v2' });
  AUTHORITIES.set(authority, {
    active: true,
    transactionOwner,
    subjectAuthority,
    ceremonyId,
    operation: activeOperation,
    current,
  });
  return authority;
};

export const assertRefinementCeremonyTransaction = (authority, operation) => {
  const state = authorityState(authority, operation);
  return Object.freeze({
    subjectAuthority: state.subjectAuthority,
    ceremonyId: state.ceremonyId,
    current: state.current,
  });
};

/** Prepare a pure next record while preserving the exact snapshot it advances. */
export const prepareRefinementCeremonyTransition = (
  authority, nextRecord, transition, operation,
) => {
  const state = authorityState(authority, operation);
  if (nextRecord?.id !== state.ceremonyId
    || nextRecord?.neumaId !== state.current.record.neumaId
    || custodySha256(nextRecord?.custody) !== state.current.custodySha256) {
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'ceremony transition changes immutable authority');
  }
  const record = stampRecord({ current: state.current, nextRecord, transition });
  const commit = Object.freeze({ kind: 'prepared-refinement-ceremony-transition-v2' });
  COMMITS.set(commit, {
    authority,
    operation: state.operation,
    expected: state.current,
    record,
    active: true,
  });
  return commit;
};

/** Project the exact stamped next authority for a journal before publication. */
export const projectPreparedRefinementCeremonyTransition = (
  commit, authority, operation,
) => {
  const state = authorityState(authority, operation);
  const prepared = COMMITS.get(commit);
  if (!prepared || !prepared.active || prepared.authority !== authority
    || prepared.operation !== state.operation) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'prepared ceremony commit is invalid');
  }
  return Object.freeze({
    record: prepared.record,
    recordSha256: refinementHistorySha256(prepared.record),
    revision: prepared.record.revision,
    priorCeremonySha256: prepared.record.priorCeremonySha256,
    custodySha256: prepared.record.transaction.custodySha256,
  });
};

/** Re-read the exact held inode, compare revision/digest/custody, then atomically replace it. */
export const commitPreparedRefinementCeremonyTransition = async (
  authority, commit, operation,
) => {
  const state = authorityState(authority, operation);
  const prepared = COMMITS.get(commit);
  if (!prepared || !prepared.active || prepared.authority !== authority
    || prepared.operation !== state.operation) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'prepared ceremony commit is invalid');
  }
  await assertCurrentRefinementCustody({
    subjectAuthority: state.subjectAuthority, operation: state.operation, limits: RECORD_LIMITS,
  }, prepared.expected.custodySha256);
  const ops = refinementSubjectAuthorityOperations(state.subjectAuthority, state.operation);
  const record = await withDirectories(
    ops,
    ['refinement', 'ceremonies'],
    false,
    async () => {
      let current = await readHeldRecord(ops, state.ceremonyId, state.operation, false);
      let primary = null;
      try {
        if (!sameCurrent(current, prepared.expected)) {
          throw refuse('REFINEMENT_TRANSACTION_STALE', 'ceremony changed before commit');
        }
        return await publishRecord(
          ops, state.ceremonyId, prepared.record, current.resource, state.operation,
        );
      } catch (error) {
        primary = error;
      } finally {
        primary = await closeResource(
          ops, current.resource, primary, 'ceremony target resource release',
        );
      }
      throw primary;
    },
  );
  prepared.active = false;
  state.current = Object.freeze({
    state: 'present',
    record,
    revision: record.revision,
    recordSha256: refinementHistorySha256(record),
    custodySha256: custodySha256(record.custody),
  });
  return record;
};

/** Commit one new opening against exact current ceremony/attunement/custody authorities. */
export const commitRefinementCeremonyOpening = async ({
  transactionOwner, record, openingAuthority, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  const subjectAuthority = assertRefinementSubjectTransaction(
    transactionOwner, activeOperation,
  );
  const opening = assertRefinementCeremonyOpeningAuthority(openingAuthority);
  const openingSha256 = refinementCeremonyOpeningAuthoritySha256(opening);
  if (record?.openingAuthoritySha256 !== openingSha256
    || refinementCeremonyOpeningAuthoritySha256(record?.openingAuthority) !== openingSha256
    || record?.id !== exactId(record?.id)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony opening authority is invalid');
  }
  const ceremonies = await readRefinementCeremonySet({
    subjectAuthority, operation: activeOperation, limits: RECORD_LIMITS,
  });
  const attunements = await readRefinementAttunementSet({
    subjectAuthority, operation: activeOperation, limits: RECORD_LIMITS,
  });
  const custody = await readCurrentRefinementCustody({
    subjectAuthority, operation: activeOperation, limits: RECORD_LIMITS,
  });
  if (custody.state !== 'present'
    || record.neumaId !== custody.custody.subjectNeumaId
    || custodySha256(record.custody) !== custody.custodySha256
    || ceremonies.revision !== opening.ceremonySetRevision
    || ceremonies.historySha256 !== opening.ceremonySetSha256
    || attunements.revision !== opening.attunementSetRevision
    || attunements.historySha256 !== opening.attunementSetSha256
    || ceremonies.records.some(({ id }) => id === record.id)) {
    throw refuse('REFINEMENT_TRANSACTION_STALE', 'ceremony opening authority changed');
  }
  // One open ceremony per being is a rule the operator can act on, not a
  // stale-authority accident — it gets its own coded refusal and its own
  // plain sentence, which refinement-route-refusals.js already maps to 409.
  if (ceremonies.records.some(isCeremonyOpen)) {
    throw refuse('CEREMONY_ALREADY_OPEN', 'A refinement ceremony is already open.');
  }
  const current = Object.freeze({
    state: 'absent',
    record: null,
    resource: null,
    revision: 0,
    recordSha256: null,
    custodySha256: null,
  });
  const stamped = stampRecord({
    current,
    nextRecord: record,
    transition: 'opened',
    priorCeremonySha256: ceremonies.historySha256,
  });
  const ops = refinementSubjectAuthorityOperations(subjectAuthority, activeOperation);
  return withDirectories(ops, ['refinement', 'ceremonies'], true, async () => {
    const absent = await readHeldRecord(ops, stamped.id, activeOperation, true);
    if (absent.state !== 'absent') {
      let primary = refuse('REFINEMENT_TRANSACTION_STALE', 'ceremony id already exists');
      primary = await closeResource(
        ops, absent.resource, primary, 'existing ceremony resource release',
      );
      throw primary;
    }
    return publishRecord(ops, stamped.id, stamped, null, activeOperation);
  });
};

export const closeRefinementCeremonyTransaction = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state
    || state.operation !== assertRefinementProcessOperationIdentity(operation)) {
    throw refuse('REFINEMENT_TRANSACTION_INVALID', 'ceremony transaction authority is invalid');
  }
  if (!state.active) return false;
  state.active = false;
  return true;
};
