/**
 * Scale-authority tokens: the on-disk record contract, bounded reclamation of
 * terminal records, and issuance.
 *
 * RECLAMATION CONTRACT. Issuance counts every `scale-<digest>.json` under the
 * held scale-authorities directory against SCALE_AUTHORITIES_MAX, so the
 * directory must shed what is provably dead or the dial bricks permanently.
 * One pass runs inline on the SAME held registry authority and branded
 * operation as the issuance that triggered it — never a sweeper with custody
 * of its own. A pass reads at most RECLAMATION_SCAN_MAX names from a persisted
 * round-robin cursor, journals the exact set it intends to unlink, then unlinks
 * each name anchored to the resource it verified: a crash leaves either the old
 * state or the new one, and the next issuance resumes the journal.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import { isSha256 } from '../../core/shared/plain-data-canonical.js';
import { resolveCurrentRefinementRegistryState } from './refinement-registry-authority-state.js';
import {
  assertRefinementAdapterId,
  assertPublishableRefinementRegistryAuthority,
} from './refinement-registry-authority.js';
import {
  validateRefinementPublicationJournal,
  refinementPublicationJournalName,
} from './refinement-publication-ledger.js';
import {
  PUBLICATION_JOURNAL_BYTES_MAX,
  openPublicationEncrypted,
  publicationDirectories,
  publicationFailure,
  readPublicationEncrypted,
  releasePublicationResource,
  replacePublicationEncrypted,
  withPublicationDirectory,
} from './refinement-publication-storage-internal.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_FILE = /^scale-([a-f0-9]{64})\.json$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const TOKEN_FIELDS = Object.freeze([
  'adapterId', 'adapterIdSha256', 'approvedScales', 'approvedScalesSha256',
  'artifactSha256', 'custodySha256', 'expiresAt', 'issuedAt', 'operatorWalletSha256',
  'publicationTransactionSha256', 'registryAppendRevision',
  'registryCurrentSelectionSha256', 'registryGeneration', 'registrySha256',
  'schemaVersion', 'selectedScale', 'state', 'subjectNeumaId', 'tokenSha256',
]);
const STATE_NAME = 'scale-reclamation-state.json';
const JOURNAL_NAME = 'scale-reclamation-journal.json';
const SCALE_AUTHORITIES_MAX = 4096;
const RECLAMATION_SCAN_MAX = 32;
const REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_ENTRIES_MAX = SCALE_AUTHORITIES_MAX + 256;
const STATE_BYTES_MAX = 128 * 1024;
/** Issuance owns the directory: the leaf is created on first use, reads never create. */
const ISSUANCE_DIRECTORIES = Object.freeze([
  publicationDirectories.refinement[0],
  Object.freeze({
    name: 'scale-authorities', create: true, mode: 0o700, createMode: 0o700,
    label: 'refinement scale authority directory',
  }),
]);
const exactKeys = (value, fields) => {
  const keys = Reflect.ownKeys(value || {});
  return value && typeof value === 'object' && !Array.isArray(value)
    && keys.length === fields.length
    && keys.every((key) => typeof key === 'string' && fields.includes(key));
};
const instant = (value) => typeof value === 'string'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const sameValue = (left, right) => refinementSha256(left) === refinementSha256(right);

export const assertRefinementScaleAuthorityToken = (value) => {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw publicationFailure(
      'INVALID_REFINEMENT_SCALE_AUTHORITY', 'scale authority token is invalid',
    );
  }
  return value;
};
export const refinementScaleAuthorityTokenSha256 = (token) => createHash('sha256')
  .update('neuma.refinement.scale-authority\0', 'utf8')
  .update(assertRefinementScaleAuthorityToken(token), 'utf8')
  .digest('hex');
export const refinementScaleAuthorityRecordName = (tokenSha256) => {
  if (!isSha256(tokenSha256)) {
    throw publicationFailure(
      'INVALID_REFINEMENT_SCALE_AUTHORITY', 'scale authority digest is invalid',
    );
  }
  return `scale-${tokenSha256}.json`;
};

export const validateRefinementScaleAuthorityRecord = (
  value,
  expected = {},
  { allowConsumed = false, requireUnexpired = true, now = Date.now() } = {},
) => {
  if (value?.schemaVersion !== 2 || !exactKeys(value, TOKEN_FIELDS)
    || !['ISSUED', 'CONSUMED'].includes(value.state)
    || !isSha256(value.tokenSha256) || !isSha256(value.adapterIdSha256)
    || !isSha256(value.artifactSha256) || !isSha256(value.custodySha256)
    || !isSha256(value.approvedScalesSha256)
    || !isSha256(value.publicationTransactionSha256)
    || !isSha256(value.registryCurrentSelectionSha256)
    || !isSha256(value.registrySha256)
    || !SUBJECT.test(String(value.subjectNeumaId || ''))
    || !Number.isSafeInteger(value.registryGeneration) || value.registryGeneration < 1
    || !Number.isSafeInteger(value.registryAppendRevision) || value.registryAppendRevision < 1
    || !instant(value.issuedAt) || !instant(value.expiresAt)
    || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || (value.operatorWalletSha256 !== null && !isSha256(value.operatorWalletSha256))) {
    throw publicationFailure(
      'INVALID_REFINEMENT_SCALE_AUTHORITY', 'scale authority token is invalid',
    );
  }
  assertRefinementAdapterId(value.adapterId);
  const approvedScales = refinementApprovedScales(value.approvedScales);
  if (!sameValue(approvedScales, value.approvedScales)
    || refinementSha256(approvedScales) !== value.approvedScalesSha256
    || !approvedScales.includes(value.selectedScale)) {
    throw publicationFailure(
      'INVALID_REFINEMENT_SCALE_AUTHORITY', 'scale authority token is invalid',
    );
  }
  if (value.state === 'CONSUMED' && !allowConsumed) {
    throw publicationFailure(
      'REFINEMENT_SCALE_AUTHORITY_REPLAYED',
      'scale authority token was already consumed',
    );
  }
  const expectedFields = TOKEN_FIELDS.filter((field) => Object.hasOwn(expected, field));
  if (expectedFields.some((field) => !sameValue(value[field], expected[field]))) {
    throw publicationFailure(
      'REFINEMENT_SCALE_AUTHORITY_STALE', 'scale authority is stale or mismatched',
    );
  }
  if (Object.hasOwn(expected, 'scale') && !approvedScales.includes(expected.scale)) {
    throw publicationFailure('INVALID_ADAPTER_SCALE', 'scale is not covered by current approval');
  }
  if (value.state === 'ISSUED' && requireUnexpired
    && (!Number.isFinite(now) || Date.parse(value.expiresAt) <= now)) {
    throw publicationFailure(
      'REFINEMENT_SCALE_AUTHORITY_EXPIRED', 'scale authority expired',
    );
  }
  return Object.freeze({ ...value, approvedScales });
};

const statePayload = (cursor) => Object.freeze({ schemaVersion: 1, cursor });
const reclamationState = (cursor) => {
  if (cursor !== null && !TOKEN_FILE.test(String(cursor))) {
    throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'scale reclamation cursor is invalid');
  }
  const payload = statePayload(cursor);
  return Object.freeze({ ...payload, stateSha256: refinementSha256(payload) });
};
const validateReclamationState = (value) => {
  if (!exactKeys(value, ['cursor', 'schemaVersion', 'stateSha256'])
    || value.schemaVersion !== 1 || !isSha256(value.stateSha256)) {
    throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'scale reclamation state is invalid');
  }
  const expected = reclamationState(value.cursor);
  if (expected.stateSha256 !== value.stateSha256) {
    throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'scale reclamation state changed');
  }
  return expected;
};
const journalPayload = (cutoffAt, candidates, nextCursor) => Object.freeze({
  schemaVersion: 1, state: 'PREPARED', cutoffAt, candidates, nextCursor,
});
const reclamationJournal = (cutoffAt, candidates, nextCursor) => {
  const payload = journalPayload(cutoffAt, candidates, nextCursor);
  return Object.freeze({ ...payload, preparedSha256: refinementSha256(payload) });
};
const validateReclamationJournal = (value) => {
  if (!exactKeys(value, [
    'candidates', 'cutoffAt', 'nextCursor', 'preparedSha256', 'schemaVersion', 'state',
  ]) || value.schemaVersion !== 1 || value.state !== 'PREPARED' || !instant(value.cutoffAt)
    || !Array.isArray(value.candidates) || value.candidates.length > RECLAMATION_SCAN_MAX
    || !isSha256(value.preparedSha256)
    || (value.nextCursor !== null && !TOKEN_FILE.test(String(value.nextCursor)))) {
    throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'scale reclamation journal is invalid');
  }
  const candidates = Object.freeze(value.candidates.map((candidate) => {
    if (!exactKeys(candidate, ['name', 'recordSha256'])
      || !TOKEN_FILE.test(String(candidate.name)) || !isSha256(candidate.recordSha256)) {
      throw publicationFailure(
        'REFINEMENT_PUBLICATION_CORRUPT', 'scale reclamation candidate is invalid',
      );
    }
    return Object.freeze({ ...candidate });
  }));
  const expected = reclamationJournal(value.cutoffAt, candidates, value.nextCursor);
  if (expected.preparedSha256 !== value.preparedSha256) {
    throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'scale reclamation journal changed');
  }
  return expected;
};
/**
 * Provably terminal: an unconsumed token whose TTL has passed, or a consumed
 * marker whose expiry cleared the replay window. Consumption refuses an expired
 * token, so `expiresAt` never precedes the consumption instant — keying
 * retention on it holds every marker at least the full window, never less.
 */
const terminalAt = (record, cutoffAt) => Date.parse(record.expiresAt)
  <= Date.parse(cutoffAt) - (record.state === 'CONSUMED' ? REPLAY_RETENTION_MS : 0);

const replaceState = async (operations, operation, cursor) => {
  operation.assertActive();
  const next = reclamationState(cursor);
  const opened = await openPublicationEncrypted(operations, STATE_NAME, STATE_BYTES_MAX, true);
  let primary = null;
  try {
    if (opened) validateReclamationState(opened.value);
    await replacePublicationEncrypted({
      operations, name: STATE_NAME, value: next, maximumBytes: STATE_BYTES_MAX,
      expectedResource: opened?.resource ?? null,
      validate: (value) => validateReclamationState(value),
    });
    await operations.sync();
  } catch (error) { primary = error; }
  if (opened) return releasePublicationResource(operations, opened.resource, primary);
  if (primary) throw primary;
};
const removeCandidate = async (operations, operation, candidate, journal) => {
  operation.assertActive();
  const opened = await openPublicationEncrypted(
    operations, candidate.name, PUBLICATION_JOURNAL_BYTES_MAX, true,
  );
  if (!opened) return;
  let primary = null;
  try {
    const match = TOKEN_FILE.exec(candidate.name);
    const record = validateRefinementScaleAuthorityRecord(opened.value, {
      tokenSha256: match[1],
    }, { allowConsumed: true, requireUnexpired: false });
    if (refinementSha256(record) !== candidate.recordSha256
      || !terminalAt(record, journal.cutoffAt)) {
      throw publicationFailure(
        'REFINEMENT_PUBLICATION_QUARANTINED',
        'scale reclamation candidate changed or is not terminal',
      );
    }
    await operations.unlink({ name: candidate.name, expectedResource: opened.resource });
  } catch (error) { primary = error; }
  return releasePublicationResource(operations, opened.resource, primary);
};
const finishReclamationJournal = async (operations, operation, opened, journal) => {
  let primary = null;
  try {
    for (const candidate of journal.candidates) {
      await removeCandidate(operations, operation, candidate, journal);
    }
    await replaceState(operations, operation, journal.nextCursor);
    await operations.unlink({ name: JOURNAL_NAME, expectedResource: opened.resource });
    await operations.sync();
  } catch (error) { primary = error; }
  return releasePublicationResource(operations, opened.resource, primary);
};
const resumeReclamation = async (operations, operation) => {
  const opened = await openPublicationEncrypted(operations, JOURNAL_NAME, STATE_BYTES_MAX, true);
  if (!opened) return false;
  let journal;
  try { journal = validateReclamationJournal(opened.value); } catch (error) {
    return releasePublicationResource(operations, opened.resource, error);
  }
  await finishReclamationJournal(operations, operation, opened, journal);
  return true;
};
const tokenNames = async (operations, operation) => {
  const listed = await operations.list({
    maximumEntries: DIRECTORY_ENTRIES_MAX,
    maximumNameBytes: DIRECTORY_ENTRIES_MAX * 80,
    deadline: operation.monotonicDeadline,
    signal: operation.signal,
  });
  const names = listed.entries
    .filter(({ kind, name }) => kind === 'file' && TOKEN_FILE.test(name))
    .map(({ name }) => name)
    .sort();
  return Object.freeze(names);
};
const currentCursor = async (operations, operation) => {
  const raw = await readPublicationEncrypted(
    operations, STATE_NAME, STATE_BYTES_MAX, operation, true,
  );
  return raw === null ? null : validateReclamationState(raw).cursor;
};
const scanWindow = (names, cursor) => {
  let start = cursor === null ? 0 : names.findIndex((name) => name > cursor);
  if (start < 0) start = 0;
  const window = names.slice(start, start + RECLAMATION_SCAN_MAX);
  const nextCursor = window.length && window.at(-1) !== names.at(-1) ? window.at(-1) : null;
  return Object.freeze({ window: Object.freeze(window), nextCursor });
};
const reclaimTerminalAuthorities = async (operations, operation, cutoffAt) => {
  if (await resumeReclamation(operations, operation)) return;
  const names = await tokenNames(operations, operation);
  const cursor = await currentCursor(operations, operation);
  const { window, nextCursor } = scanWindow(names, cursor);
  const candidates = [];
  for (const name of window) {
    operation.assertActive();
    const value = await readPublicationEncrypted(
      operations, name, PUBLICATION_JOURNAL_BYTES_MAX, operation,
    );
    const record = validateRefinementScaleAuthorityRecord(value, {
      tokenSha256: TOKEN_FILE.exec(name)[1],
    }, { allowConsumed: true, requireUnexpired: false });
    if (terminalAt(record, cutoffAt)) {
      candidates.push(Object.freeze({ name, recordSha256: refinementSha256(record) }));
    }
  }
  if (!candidates.length) return replaceState(operations, operation, nextCursor);
  const journal = reclamationJournal(cutoffAt, Object.freeze(candidates), nextCursor);
  await replacePublicationEncrypted({
    operations, name: JOURNAL_NAME, value: journal, maximumBytes: STATE_BYTES_MAX,
    expectedResource: null, validate: (value) => validateReclamationJournal(value),
  });
  await operations.sync();
  const opened = await openPublicationEncrypted(operations, JOURNAL_NAME, STATE_BYTES_MAX);
  const prepared = validateReclamationJournal(opened.value);
  return finishReclamationJournal(operations, operation, opened, prepared);
};

const selectionAuthority = (adapter) => Object.freeze({
  adapterId: adapter.id,
  adapterSha256: adapter.sha256,
  publicationTransactionSha256: adapter.publicationTransactionSha256,
  approvedScales: Object.freeze([...adapter.binding.approvedScales]),
  approvedScalesSha256: adapter.binding.approvedScalesSha256,
  registrySha256: adapter.registrySha256,
  registryCurrentSelectionSha256: adapter.registryCurrentSelectionSha256,
  registryGeneration: adapter.registryGeneration,
  registryAppendRevision: adapter.registryAppendRevision,
  isCurrent: adapter.isCurrent,
  selectedScale: adapter.selectedScale,
});
export const publicScaleSelectionAuthority = (issued) => {
  if (!issued || typeof issued !== 'object' || !issued.selectionAuthority) {
    throw publicationFailure(
      'INVALID_REFINEMENT_SCALE_AUTHORITY', 'scale selection authority is unavailable',
    );
  }
  return issued.selectionAuthority;
};

export const issueRefinementScaleAuthority = async ({
  registryAuthority, adapterId, operatorWalletSha256 = null, operation,
}) => {
  // Issuing a scale authority is the first half of a write, so a pre-v2
  // registry is refused here rather than at the append it would lead to.
  assertPublishableRefinementRegistryAuthority(registryAuthority, operation);
  const state = resolveCurrentRefinementRegistryState(registryAuthority, operation);
  const matches = state.adapters.filter(({ id }) => id === assertRefinementAdapterId(adapterId));
  if (matches.length !== 1) throw publicationFailure('ADAPTER_NOT_FOUND', 'adapter is unavailable');
  if (operatorWalletSha256 !== null && !isSha256(operatorWalletSha256)) {
    throw publicationFailure('INVALID_OPERATOR_AUTHORITY', 'operator wallet authority is invalid');
  }
  const adapter = matches[0];
  const registration = await withPublicationDirectory(
    state.operations, publicationDirectories.refinement,
    async () => validateRefinementPublicationJournal(await readPublicationEncrypted(
      state.operations,
      refinementPublicationJournalName({
        action: 'REGISTER', ceremonyId: adapter.provenance.ceremonyId,
      }),
      PUBLICATION_JOURNAL_BYTES_MAX,
      state.operation,
    )),
  );
  if (registration.state !== 'COMMITTED'
    || registration.transactionSha256 !== adapter.publicationTransactionSha256) {
    throw publicationFailure('REFINEMENT_REGISTRY_UNCOMMITTED', 'adapter registration is uncommitted');
  }
  return withPublicationDirectory(state.operations, ISSUANCE_DIRECTORIES, async () => {
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 60_000).toISOString();
    await reclaimTerminalAuthorities(state.operations, state.operation, issuedAt);
    if ((await tokenNames(state.operations, state.operation)).length >= SCALE_AUTHORITIES_MAX) {
      throw publicationFailure(
        'REFINEMENT_SCALE_AUTHORITY_CAPACITY', 'scale authority capacity is exhausted',
      );
    }
    const authorityToken = randomBytes(32).toString('base64url');
    const record = Object.freeze({
      schemaVersion: 2,
      state: 'ISSUED',
      tokenSha256: refinementScaleAuthorityTokenSha256(authorityToken),
      issuedAt,
      expiresAt,
      subjectNeumaId: state.operations.neumaId,
      adapterId: adapter.id,
      adapterIdSha256: adapter.adapterIdSha256,
      artifactSha256: adapter.sha256,
      publicationTransactionSha256: adapter.publicationTransactionSha256,
      registryGeneration: state.registry.generation,
      registryAppendRevision: state.registry.appendRevision,
      registrySha256: state.registry.registrySha256,
      registryCurrentSelectionSha256: state.registry.currentSelectionSha256,
      custodySha256: registration.intent.custodySha256,
      approvedScalesSha256: adapter.binding.approvedScalesSha256,
      approvedScales: adapter.binding.approvedScales,
      selectedScale: adapter.selectedScale,
      operatorWalletSha256,
    });
    const exact = validateRefinementScaleAuthorityRecord(record);
    await replacePublicationEncrypted({
      operations: state.operations,
      name: refinementScaleAuthorityRecordName(exact.tokenSha256),
      value: exact,
      maximumBytes: PUBLICATION_JOURNAL_BYTES_MAX,
      expectedResource: null,
      validate: (value) => validateRefinementScaleAuthorityRecord(value),
    });
    await state.operations.sync();
    return Object.freeze({
      authorityToken,
      expiresAt,
      approvedScales: exact.approvedScales,
      selectedScale: exact.selectedScale,
      selectionAuthority: selectionAuthority(adapter),
    });
  });
};
