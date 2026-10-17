import { refinementAuthoritySha256 as authoritySha256 } from './refinement-transaction-context.js';
import {
  refinementConsentAuthority,
  refinementTrainingPlanAuthority,
} from '../../core/refinement/ceremony.js';
import { refinementCustodyIdentity } from '../../core/refinement/training-authority-contract.js';
import {
  assertRefinementEncryptedEnvelope,
  assertRefinementHistoryAccounting,
  assertRefinementHistoryRecord,
  emptyRefinementHistoryAccounting,
  measureRefinementHistoryJson,
  mergeRefinementHistoryAccounting,
  refinementHistorySha256,
  resolveRefinementHistoryLimits,
} from '../../core/workspace/refinement-history-reader.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertRefinementSubjectAuthority,
  refinementSubjectAuthorityOperations,
} from './refinement-subject-authority.js';

const RECORD_FILE = /^([a-z0-9][a-z0-9-]{0,60})\.json$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REQUEST_FIELDS = Object.freeze(['ceremonyId', 'limits', 'operation', 'subjectAuthority']);
const LIMIT_FIELDS = Object.freeze([
  'maximumCiphertextBytes', 'maximumPlaintextBytes', 'maximumTotalCiphertextBytes',
  'maximumTotalPlaintextBytes', 'maximumRecords', 'maximumDirents', 'maximumNameBytes',
  'maximumDepth', 'maximumNodes', 'maximumStringBytes', 'maximumEvents', 'deadlineMs',
]);
const refuse = (code, message) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup;
const exactObject = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).some((field) => typeof field !== 'string' || !fields.includes(field))) {
    throw refuse('REFINEMENT_HISTORY_INVALID_INPUT', `${label} has invalid options`);
  }
  return value;
};
const exactRequest = (request, ceremony = false) => {
  exactObject(request, REQUEST_FIELDS, 'refinement subject history request');
  if (ceremony && !RECORD_FILE.test(`${request.ceremonyId}.json`)) {
    throw refuse('REFINEMENT_HISTORY_INVALID_INPUT', 'ceremony id is invalid');
  }
  if (request.limits !== undefined) {
    exactObject(request.limits, LIMIT_FIELDS, 'refinement subject history limits');
  }
  const operation = assertRefinementProcessOperation(request.operation);
  assertRefinementSubjectAuthority(request.subjectAuthority, operation);
  return Object.freeze({
    operation,
    limits: resolveRefinementHistoryLimits(request.limits),
    ops: refinementSubjectAuthorityOperations(request.subjectAuthority, operation),
  });
};
const control = (operation) => ({
  deadline: operation.monotonicDeadline,
  signal: operation.signal,
});
const withDirectories = async (ops, names, create, work) => {
  let entered = 0;
  let result;
  let primary = null;
  try {
    for (const name of names) {
      await ops.enter({
        name, create, mode: 0o700, createMode: 0o700,
        label: `refinement ${name} authority`,
      });
      entered += 1;
    }
    result = await work();
  } catch (error) { primary = error; }
  while (entered > 0) {
    try { await ops.leave(); } catch (error) {
      primary = combine(primary, error, 'refinement history directory release');
    }
    entered -= 1;
  }
  if (primary) throw primary;
  return result;
};
const decodeEncrypted = (ops, bytes, limits, label) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > limits.maximumCiphertextBytes) {
    throw refuse('REFINEMENT_HISTORY_OVERFLOW', `${label} ciphertext exceeds its byte envelope`);
  }
  assertRefinementEncryptedEnvelope(bytes.toString('utf8'));
  let value;
  try { value = ops.decrypt(bytes); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', `${label} failed exact decryption`);
  }
  let plaintextBytes;
  try { plaintextBytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', `${label} plaintext is not JSON data`);
  }
  if (plaintextBytes > limits.maximumPlaintextBytes) {
    throw refuse('REFINEMENT_HISTORY_OVERFLOW', `${label} plaintext exceeds its byte envelope`);
  }
  const measured = measureRefinementHistoryJson(value, limits);
  return Object.freeze({
    value,
    accounting: Object.freeze({
      ...emptyRefinementHistoryAccounting(),
      ciphertextBytes: bytes.length,
      plaintextBytes,
      nodes: measured.nodes,
      stringBytes: measured.stringBytes,
    }),
  });
};
const readEncryptedChild = async (ops, name, operation, limits, absent, label) => {
  operation.assertActive();
  const read = await ops.read({
    name, maximumBytes: limits.maximumCiphertextBytes, absent,
    ...control(operation), label,
  });
  if (read.state === 'absent') return Object.freeze({
    state: 'absent', value: null, accounting: Object.freeze(emptyRefinementHistoryAccounting()),
  });
  const decoded = decodeEncrypted(ops, read.bytes, limits, label);
  operation.assertActive();
  return Object.freeze({ state: 'present', ...decoded });
};
const assertCeremonyTransaction = (record, custodySha256) => {
  const transaction = record.transaction;
  if (!Number.isSafeInteger(record.revision) || record.revision < 1
    || !SHA256.test(String(record.priorCeremonySha256 || ''))
    || !transaction || typeof transaction !== 'object' || Array.isArray(transaction)
    || transaction.schemaVersion !== 2 || transaction.revision !== record.revision
    || transaction.priorCeremonySha256 !== record.priorCeremonySha256
    || transaction.custodySha256 !== custodySha256
    || typeof transaction.transition !== 'string'
    || !/^[a-z][a-z0-9-]{0,63}$/.test(transaction.transition)) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'ceremony transaction authority is invalid');
  }
  return record;
};
const readCeremonyChild = async (ops, subjectId, ceremonyId, operation, limits) => {
  const read = await readEncryptedChild(
    ops, `${ceremonyId}.json`, operation, limits, true, 'refinement ceremony record',
  );
  if (read.state === 'absent') return read;
  const record = assertRefinementHistoryRecord(
    read.value, subjectId, ceremonyId, limits, 'ceremony',
  );
  const custodySha256 = authoritySha256(record.custody, 'neuma.refinement.custody-authority');
  assertCeremonyTransaction(record, custodySha256);
  const accounting = assertRefinementHistoryAccounting({
    ...read.accounting, records: 1, events: record.events.length,
  }, limits);
  return Object.freeze({
    state: 'present', record, accounting,
    revision: record.revision,
    recordSha256: refinementHistorySha256(record),
    custodySha256,
  });
};
const absentSet = () => Object.freeze({
  state: 'authoritative-empty',
  records: Object.freeze([]),
  revision: 0,
  historySha256: refinementHistorySha256([]),
  accounting: Object.freeze(emptyRefinementHistoryAccounting()),
});
const readRecordSet = async ({ ops, operation, limits, subjectId, directories, kind }) => {
  try {
    return await withDirectories(ops, directories, false, async () => {
      const listed = await ops.list({
        maximumEntries: limits.maximumDirents,
        maximumNameBytes: limits.maximumNameBytes,
        ...control(operation),
      });
      let accounting = {
        ...emptyRefinementHistoryAccounting(),
        dirents: listed.entries.length,
        nameBytes: listed.nameBytes,
      };
      assertRefinementHistoryAccounting(accounting, limits);
      const records = [];
      for (const entry of [...listed.entries].sort((left, right) => left.name.localeCompare(right.name))) {
        operation.assertActive();
        const match = RECORD_FILE.exec(entry.name);
        if (entry.kind !== 'file' || !match) {
          throw refuse('REFINEMENT_HISTORY_UNSAFE', `${kind} history contains an unsafe entry`);
        }
        const read = await readEncryptedChild(
          ops, entry.name, operation, limits, false, `refinement ${kind} record`,
        );
        const record = assertRefinementHistoryRecord(
          read.value, subjectId, match[1], limits, kind,
        );
        if (kind === 'ceremony') {
          assertCeremonyTransaction(record, authoritySha256(
            record.custody, 'neuma.refinement.custody-authority',
          ));
        }
        accounting = mergeRefinementHistoryAccounting(accounting, {
          ...read.accounting, records: 1, events: record.events.length,
        }, limits);
        records.push(record);
      }
      const revision = records.reduce((sum, record) => {
        const increment = Number.isSafeInteger(record.revision)
          ? record.revision : record.events.length;
        if (!Number.isSafeInteger(increment) || increment < 1
          || !Number.isSafeInteger(sum + increment)) {
          throw refuse('REFINEMENT_HISTORY_OVERFLOW', `${kind} history revision overflowed`);
        }
        return sum + increment;
      }, 0);
      return Object.freeze({
        state: records.length ? 'present' : 'authoritative-empty',
        records: Object.freeze(records),
        revision,
        historySha256: refinementHistorySha256(records),
        accounting: Object.freeze(accounting),
      });
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return absentSet();
    throw error;
  }
};

/** Read only current DNA custody through a held, same-operation subject authority. */
export const readCurrentRefinementCustody = async (request) => {
  const { ops, operation, limits } = exactRequest(request);
  const read = await withDirectories(ops, ['dna'], false, () => readEncryptedChild(
    ops, 'active.json', operation, limits, true, 'current refinement DNA',
  ));
  if (read.state === 'absent') return Object.freeze({ ...read, custody: null });
  let custody;
  try { custody = refinementCustodyIdentity(ops.neumaId, read.value); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'current refinement custody is invalid');
  }
  return Object.freeze({
    state: 'present', custody,
    custodySha256: authoritySha256(custody, 'neuma.refinement.custody-authority'),
    accounting: read.accounting,
  });
};
export const assertCurrentRefinementCustody = async (request, expectedSha256) => {
  const current = await readCurrentRefinementCustody(request);
  if (current.state !== 'present' || current.custodySha256 !== expectedSha256) {
    throw refuse('REFINEMENT_CUSTODY_MISMATCH', 'current sovereign custody changed');
  }
  return current;
};

export const readCurrentRefinementCeremony = async (request) => {
  const { ops, operation, limits } = exactRequest(request, true);
  return withDirectories(ops, ['refinement', 'ceremonies'], false, () => readCeremonyChild(
    ops, ops.neumaId, request.ceremonyId, operation, limits,
  )).catch((error) => {
    if (error?.code === 'ENOENT') return Object.freeze({
      state: 'absent', record: null,
      accounting: Object.freeze(emptyRefinementHistoryAccounting()),
    });
    throw error;
  });
};

export const readCurrentRefinementApproval = async (request) => {
  const read = await readCurrentRefinementCeremony(request);
  if (read.state === 'absent') return read;
  let consentAuthority;
  let trainingPlanAuthority;
  try {
    consentAuthority = refinementConsentAuthority(read.record);
    trainingPlanAuthority = refinementTrainingPlanAuthority(read.record);
  } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'ceremony approval authority is invalid');
  }
  return Object.freeze({
    state: 'present', accounting: read.accounting,
    approval: Object.freeze({
      ceremonyId: read.record.id,
      revision: read.revision,
      recordSha256: read.recordSha256,
      custodySha256: read.custodySha256,
      consentAuthority,
      trainingPlanAuthority,
      sourceCorpusSha256: read.record.corpus?.sourceCorpusSha256,
      sourceManifestSha256: read.record.corpus?.sourceManifestSha256,
      sourceAuthoritySha256: read.record.corpus?.sourceAuthoritySha256,
    }),
  });
};

export const readRefinementCeremonySet = async (request) => {
  const { ops, operation, limits } = exactRequest(request);
  return readRecordSet({
    ops, operation, limits, subjectId: ops.neumaId,
    directories: ['refinement', 'ceremonies'], kind: 'ceremony',
  });
};

export const readRefinementAttunementSet = async (request) => {
  const { ops, operation, limits } = exactRequest(request);
  return readRecordSet({
    ops, operation, limits, subjectId: ops.neumaId,
    directories: ['attunement', 'records'], kind: 'attunement',
  });
};
