import { createHash } from 'node:crypto';
import {
  canonicalAuthoritySha256,
  deepFreezePlainData,
  isSha256,
} from '../../core/shared/plain-data-canonical.js';

const VERSION = 2;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const INTENT_KEYS = Object.freeze([
  'action', 'adapterBindingSha256', 'adapterIdSha256', 'adapterProvenanceSha256',
  'artifactBytes', 'artifactSha256', 'ceremonyApprovalSha256',
  'ceremonyCandidateSha256', 'ceremonyId', 'ceremonyNextSha256',
  'ceremonyPriorSha256', 'ceremonyRevision', 'consentAuthoritySha256',
  'consentEventSha256', 'custodySha256', 'lineageConfigObjectId',
  'lineageConfigSha256', 'lineageConfigSourceCommit', 'lineageConfigSourceIdentitySha256',
  'lineageConfigSourceMode', 'operatorDecisionSha256', 'priorRegistryEntrySha256',
  'priorRegistrySha256', 'registeredAt', 'registryAppendRevision',
  'registryCurrentSelectionSha256', 'registryGeneration', 'scaleAuthorityTokenSha256',
  'selectedScale', 'trainedAt', 'trainingConfigSha256',
  'trainingPlanAuthoritySha256', 'trainingPlanSha256',
]);
const JOURNAL_KEYS = Object.freeze([
  'commitSha256', 'intent', 'kind', 'preparedSha256', 'registrySha256',
  'schemaVersion', 'state', 'transactionSha256',
]);
const EXPECTED_KEYS = Object.freeze([
  'adapterIdSha256', 'artifactSha256', 'ceremonyId', 'custodySha256',
  'registryAppendRevision', 'registryCurrentSelectionSha256', 'registryGeneration',
  'registrySha256', 'transactionSha256',
]);
const NULLABLE_SHA = new Set([
  'priorRegistryEntrySha256', 'priorRegistrySha256', 'scaleAuthorityTokenSha256',
]);
const SHA_FIELDS = INTENT_KEYS.filter((field) => field.endsWith('Sha256'));
export const refinementPublicationJournalName = ({
  action, ceremonyId, transactionSha256,
}) => {
  if (action === 'REGISTER' && ID.test(String(ceremonyId || ''))) {
    return `publication-registration-${createHash('sha256').update(ceremonyId).digest('hex')}.json`;
  }
  if (action === 'SELECT' && isSha256(transactionSha256)) {
    return `publication-selection-${transactionSha256}.json`;
  }
  throw new Error('publication journal identity is invalid');
};

const digest = (domain, value) => canonicalAuthoritySha256(value, {
  domain,
  schemaVersion: VERSION,
  maxDepth: 48,
  maxNodes: 250_000,
  maxStringBytes: 16 * 1024 * 1024,
  maxKeyBytes: 64 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});
const exactRecord = (value, fields, label) => {
  deepFreezePlainData(value, {
    field: label,
    maxDepth: 48,
    maxNodes: 250_000,
    maxStringBytes: 16 * 1024 * 1024,
    maxKeyBytes: 64 * 1024,
    maxOutputBytes: 32 * 1024 * 1024,
  });
  const keys = Reflect.ownKeys(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.length !== fields.length
    || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
    throw new Error(`${label} has an invalid exact schema`);
  }
  return value;
};
const positive = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
};
const instant = (value, field) => {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical instant`);
  }
  return value;
};

const validateRefinementPublicationIntent = (value) => {
  exactRecord(value, INTENT_KEYS, 'refinement publication intent');
  if (!['REGISTER', 'SELECT'].includes(value.action)
    || !ID.test(String(value.ceremonyId || ''))) {
    throw new Error('refinement publication intent identity is invalid');
  }
  for (const field of SHA_FIELDS) {
    if (NULLABLE_SHA.has(field)) {
      if (value[field] !== null && !isSha256(value[field])) {
        throw new Error(`publication ${field} must be null or sha256`);
      }
    } else if (!isSha256(value[field])) {
      throw new Error(`publication ${field} must be sha256`);
    }
  }
  if ((value.action === 'REGISTER' && value.scaleAuthorityTokenSha256 !== null)
    || (value.action === 'SELECT' && !isSha256(value.scaleAuthorityTokenSha256))
    || !Number.isFinite(value.selectedScale)
    || value.selectedScale < 0 || value.selectedScale > 1) {
    throw new Error('publication scale authority is invalid');
  }
  positive(value.artifactBytes, 'publication artifactBytes');
  positive(value.ceremonyRevision, 'publication ceremonyRevision');
  positive(value.registryGeneration, 'publication registryGeneration');
  positive(value.registryAppendRevision, 'publication registryAppendRevision');
  const first = value.registryGeneration === 1;
  if (value.registryGeneration !== value.registryAppendRevision
    || first !== (value.priorRegistrySha256 === null && value.priorRegistryEntrySha256 === null)) {
    throw new Error('publication registry predecessor authority is inconsistent');
  }
  instant(value.trainedAt, 'publication trainedAt');
  instant(value.registeredAt, 'publication registeredAt');
  if (Date.parse(value.trainedAt) > Date.parse(value.registeredAt)
    || !GIT_OID.test(String(value.lineageConfigSourceCommit || ''))
    || !GIT_OID.test(String(value.lineageConfigObjectId || ''))
    || value.lineageConfigSourceMode !== '100644') {
    throw new Error('publication lineage or timestamp authority is invalid');
  }
  return deepFreezePlainData(Object.fromEntries(INTENT_KEYS.map((field) => [field, value[field]])));
};

export const refinementPublicationTransactionSha256 = (intent) =>
  digest('neuma.refinement.adapter-publication-intent', validateRefinementPublicationIntent(intent));
const preparedSha256 = (value) => digest('neuma.refinement.adapter-publication-prepared', value);
const commitSha256 = (value) => digest('neuma.refinement.adapter-publication-commit', value);
const preparedCore = ({ intent, transactionSha256, registrySha256 }) => Object.freeze({
  schemaVersion: VERSION,
  kind: 'refinement-publication-journal-v2',
  intent,
  transactionSha256,
  registrySha256,
});

export const validateRefinementPublicationJournal = (value) => {
  exactRecord(value, JOURNAL_KEYS, 'refinement publication journal');
  if (value.schemaVersion !== VERSION || value.kind !== 'refinement-publication-journal-v2'
    || !['PREPARED', 'COMMITTED'].includes(value.state)
    || !isSha256(value.registrySha256)) {
    throw new Error('refinement publication journal identity is invalid');
  }
  const intent = validateRefinementPublicationIntent(value.intent);
  const transactionSha256 = refinementPublicationTransactionSha256(intent);
  const core = preparedCore({ intent, transactionSha256, registrySha256: value.registrySha256 });
  const prepared = preparedSha256(core);
  if (value.transactionSha256 !== transactionSha256 || value.preparedSha256 !== prepared) {
    throw new Error('refinement publication journal prepared authority is invalid');
  }
  const committed = commitSha256({
    preparedSha256: prepared,
    transactionSha256,
    registrySha256: value.registrySha256,
    ceremonyNextSha256: intent.ceremonyNextSha256,
  });
  if ((value.state === 'PREPARED' && value.commitSha256 !== null)
    || (value.state === 'COMMITTED' && value.commitSha256 !== committed)) {
    throw new Error('refinement publication journal commit marker is invalid');
  }
  return deepFreezePlainData({
    ...core,
    state: value.state,
    preparedSha256: prepared,
    commitSha256: value.state === 'COMMITTED' ? committed : null,
  });
};

/** Freeze PREPARED once; registeredAt already belongs to the persisted intent. */
export const prepareRefinementPublicationJournal = ({ intent, registrySha256 }) => {
  const accepted = validateRefinementPublicationIntent(intent);
  if (!isSha256(registrySha256)) throw new Error('publication next registry digest is invalid');
  const transactionSha256 = refinementPublicationTransactionSha256(accepted);
  const core = preparedCore({ intent: accepted, transactionSha256, registrySha256 });
  return validateRefinementPublicationJournal({
    ...core,
    state: 'PREPARED',
    preparedSha256: preparedSha256(core),
    commitSha256: null,
  });
};

/** Derive COMMITTED without consulting a clock or caller input. */
export const commitPreparedRefinementPublicationJournal = (prepared) => {
  const journal = validateRefinementPublicationJournal(prepared);
  if (journal.state !== 'PREPARED') throw new Error('publication journal is not prepared');
  return validateRefinementPublicationJournal({
    ...journal,
    state: 'COMMITTED',
    commitSha256: commitSha256({
      preparedSha256: journal.preparedSha256,
      transactionSha256: journal.transactionSha256,
      registrySha256: journal.registrySha256,
      ceremonyNextSha256: journal.intent.ceremonyNextSha256,
    }),
  });
};

export const assertCommittedRefinementPublication = (journal, expected) => {
  exactRecord(expected, EXPECTED_KEYS, 'committed publication expectation');
  const committed = validateRefinementPublicationJournal(journal);
  if (committed.state !== 'COMMITTED'
    || EXPECTED_KEYS.some((field) => {
      const actual = field === 'registrySha256' || field === 'transactionSha256'
        ? committed[field] : committed.intent[field];
      return actual !== expected[field];
    })) {
    throw new Error('exact committed publication tuple is unavailable');
  }
  return committed;
};
