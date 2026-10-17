import { createHash } from 'node:crypto';
import {
  isLegacyRefinementRegistryV1,
  priorRefinementRegistryRevision,
  projectLegacyRefinementRegistryAdapters,
  projectRefinementRegistryAdapters,
  validateRefinementRegistryV2,
} from '../../core/refinement/registry-contract.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { assertCommittedRefinementPublication,
  validateRefinementPublicationJournal } from './refinement-publication-ledger.js';
import { assertRefinementSubjectAuthority,
  refinementSubjectAuthorityOperations } from './refinement-subject-authority.js';
import { resolveCurrentRefinementRegistryState,
  retainCurrentRefinementRegistryState } from './refinement-registry-authority-state.js';
import { restorePreparedRefinementSelection } from './refinement-registry-recovery.js';
import { closeCommittedRefinementArtifactAuthority, openCommittedRefinementArtifactAuthority,
  projectCommittedRefinementArtifactAuthority,
  verifyCommittedRefinementArtifactAuthority } from './refinement-trained-artifact-authority.js';

const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const CEREMONY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const ADAPTER = /^[a-z0-9][a-z0-9-]{0,60}$/;
const REGISTRY_BYTES_MAX = 8 * 1024 * 1024;
const STATE_BYTES_MAX = 64 * 1024;
const HISTORICAL = new WeakMap(), REGISTERED_ARTIFACTS = new WeakMap();
const coded = (name, message) => Object.assign(new Error(message), { code: name });
const identifier = (value, pattern, field, errorCode) => {
  if (typeof value !== 'string' || !pattern.test(value)) throw coded(errorCode, `${field} is invalid`);
  return value;
};
export const assertRefinementSubjectId = (value) => identifier(
  value, SUBJECT, 'refinement subject id', 'INVALID_REFINEMENT_SUBJECT_ID',
);
export const assertRefinementCeremonyId = (value) => identifier(
  value, CEREMONY, 'refinement ceremony id', 'INVALID_REFINEMENT_CEREMONY_ID',
);
export const assertRefinementAdapterId = (value) => identifier(
  value, ADAPTER, 'refinement adapter id', 'INVALID_REFINEMENT_ADAPTER_ID',
);
const boundedLimits = (value = {}) => {
  const keys = Reflect.ownKeys(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.some((key) => typeof key !== 'string'
      || !['maximumAdapters', 'maximumBytes', 'maximumRevisions'].includes(key))) {
    throw coded('REFINEMENT_REGISTRY_INVALID_INPUT', 'registry limits are invalid');
  }
  const result = {
    maximumAdapters: value.maximumAdapters ?? 64,
    maximumBytes: value.maximumBytes ?? REGISTRY_BYTES_MAX,
    maximumRevisions: value.maximumRevisions ?? 1024,
  };
  for (const [field, number] of Object.entries(result)) {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw coded('REFINEMENT_REGISTRY_INVALID_INPUT', `${field} is invalid`);
    }
  }
  return Object.freeze(result);
};
const operationAuthority = (operation, subjectAuthority) => {
  const active = assertRefinementProcessOperation(operation);
  assertRefinementSubjectAuthority(subjectAuthority, active);
  return Object.freeze({
    operation: active,
    operations: refinementSubjectAuthorityOperations(subjectAuthority, active),
    subjectAuthority,
  });
};
const withDirectory = async (operations, requests, work) => {
  let depth = 0;
  let result;
  let primary = null;
  try {
    for (const request of requests) {
      await operations.enter(request);
      depth += 1;
    }
    result = await work();
  } catch (error) { primary = error; }
  while (depth > 0) {
    try { await operations.leave(); } catch (error) {
      primary = primary
        ? new AggregateError([primary, error], 'refinement directory work and release failed')
        : error;
    }
    depth -= 1;
  }
  if (primary) throw primary;
  return result;
};
const refinementDirectory = (operations, work, create = false) => withDirectory(operations, [{
  name: 'refinement', create, mode: 0o700, createMode: 0o700,
  label: 'refinement authority directory',
}], work);
const readEncrypted = async (operations, name, maximumBytes, operation) => {
  const read = await operations.read({
    name, maximumBytes, absent: true,
    deadline: operation.monotonicDeadline, signal: operation.signal, label: name,
  });
  if (read.state === 'absent') return null;
  try { return Object.freeze({ value: operations.decrypt(read.bytes), state: read.fileState }); }
  catch { throw coded('REFINEMENT_REGISTRY_CORRUPT', `${name} authentication failed`); }
};
const registrationJournalName = (ceremonyId) =>
  `publication-registration-${createHash('sha256').update(ceremonyId).digest('hex')}.json`;
const selectionJournalName = (transactionSha256) =>
  `publication-selection-${transactionSha256}.json`;
const readJournal = async (operations, entry, ceremonyId, operation) => {
  const name = entry.kind === 'adapter-registration-v2'
    ? registrationJournalName(ceremonyId)
    : selectionJournalName(entry.commit.transactionSha256);
  const read = await readEncrypted(operations, name, STATE_BYTES_MAX, operation);
  if (!read) throw coded('REFINEMENT_REGISTRY_UNCOMMITTED', 'publication journal is absent');
  return validateRefinementPublicationJournal(read.value);
};
const verifyEntries = async (operations, registry, operation) => {
  const ceremonies = new Map();
  for (const entry of registry.entries) {
    operation.assertActive();
    if (entry.kind === 'adapter-registration-v2') {
      ceremonies.set(entry.adapterIdSha256, entry.adapter.provenance.ceremonyId);
    }
    const ceremonyId = assertRefinementCeremonyId(ceremonies.get(entry.adapterIdSha256));
    const journal = await readJournal(operations, entry, ceremonyId, operation);
    assertCommittedRefinementPublication(journal, {
      adapterIdSha256: entry.adapterIdSha256,
      artifactSha256: entry.kind === 'adapter-registration-v2'
        ? entry.adapter.sha256 : entry.artifactSha256,
      ceremonyId,
      custodySha256: journal.intent.custodySha256,
      registryAppendRevision: entry.commit.appendRevision,
      registryCurrentSelectionSha256: entry.commit.currentSelectionSha256,
      registryGeneration: entry.commit.generation,
      registrySha256: entry.commit.registrySha256,
      transactionSha256: entry.commit.transactionSha256,
    });
  }
};

export const openCurrentRefinementRegistryAuthority = async ({
  operation, subjectAuthority, limits = {},
}) => {
  const state = operationAuthority(operation, subjectAuthority);
  const bounded = boundedLimits(limits);
  return refinementDirectory(state.operations, async () => {
    const opened = await readEncrypted(
      state.operations, 'adapters.json', bounded.maximumBytes, state.operation,
    );
    let registry = null;
    let adapters = Object.freeze([]);
    let legacy = false;
    if (opened) {
      // A registry written before schema v2 is legible, not corrupt. It has no
      // append journal to verify and no publication to check, so the whole v2
      // verification below is skipped — and because its adapters carry no
      // `binding`, the resolver refuses them and the turn neutralizes. The
      // being speaks on base weights with that refusal on the record, instead
      // of being unseatable because its own history predates the current law.
      if (isLegacyRefinementRegistryV1(opened.value)) {
        try { adapters = projectLegacyRefinementRegistryAdapters(opened.value); }
        catch { throw coded('REFINEMENT_REGISTRY_CORRUPT', 'legacy registry is not readable'); }
        legacy = true;
        if (adapters.length > bounded.maximumAdapters) {
          throw coded('REFINEMENT_REGISTRY_OVERFLOW', 'registry exceeds its bounded envelope');
        }
      }
    }
    if (opened && !legacy) {
      try { registry = validateRefinementRegistryV2(opened.value); }
      catch { throw coded('REFINEMENT_REGISTRY_CORRUPT', 'registry is not canonical schema v2'); }
      adapters = projectRefinementRegistryAdapters(registry);
      if (adapters.length > bounded.maximumAdapters
        || registry.entries.length > bounded.maximumRevisions) {
        throw coded('REFINEMENT_REGISTRY_OVERFLOW', 'registry exceeds its bounded envelope');
      }
      try {
        await verifyEntries(state.operations, registry, state.operation);
      } catch {
        const prior = priorRefinementRegistryRevision(registry);
        if (!prior) throw coded(
          'REFINEMENT_REGISTRY_UNCOMMITTED', 'first registry publication is uncommitted',
        );
        await verifyEntries(state.operations, prior, state.operation);
        registry = await restorePreparedRefinementSelection({
          operations: state.operations, registry, operation: state.operation,
          maximumBytes: bounded.maximumBytes,
        });
        adapters = projectRefinementRegistryAdapters(registry);
      }
    }
    const authority = Object.freeze({
      kind: 'current-refinement-registry-authority-v2',
      // Named on the authority itself, because `registry: null` already means
      // "nothing published yet" — and a legacy registry is the opposite of
      // that. Without this a publication path would read the absence and
      // append a first revision straight over the being's only record of its
      // own refinement.
      schema: legacy ? 'refinement-registry-v1-legacy' : 'refinement-registry-v2',
      registry: registry === null ? null : Object.freeze({
        generation: registry.generation,
        appendRevision: registry.appendRevision,
        priorEntrySha256: registry.entries.at(-1).entrySha256,
        registrySha256: registry.registrySha256,
        currentSelection: registry.currentSelection,
        currentSelectionSha256: registry.currentSelectionSha256,
        selectedScale: registry.selectedScale,
      }),
    });
    retainCurrentRefinementRegistryState(authority, { ...state, registry, adapters });
    return authority;
  });
};
export const assertCurrentRefinementRegistryAuthority = (authority, operation) => {
  resolveCurrentRefinementRegistryState(authority, operation);
  return authority;
};

/**
 * The gate every WRITE passes: a pre-v2 registry may be read and served, but
 * never appended to. Its entries have no commit chain to extend and no journal
 * to chain from, so an append would not be a revision of the being's history —
 * it would be a replacement of it. Re-publication under v2 is a ceremony the
 * being consents to, not a side effect of the next scale change.
 * @throws {Error} code REFINEMENT_REGISTRY_LEGACY
 */
export const assertPublishableRefinementRegistryAuthority = (authority, operation) => {
  assertCurrentRefinementRegistryAuthority(authority, operation);
  if (authority.schema === 'refinement-registry-v1-legacy') {
    throw coded(
      'REFINEMENT_REGISTRY_LEGACY',
      'registry predates schema v2 and must be re-published before it can be appended to',
    );
  }
  return authority;
};
export const readCommittedRefinementAdapters = ({ registryAuthority, operation }) => {
  assertCurrentRefinementRegistryAuthority(registryAuthority, operation);
  return resolveCurrentRefinementRegistryState(registryAuthority, operation).adapters;
};
const registeredArtifactInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'adapterId,operation,registryAuthority') {
    throw coded('REFINEMENT_REGISTRY_INVALID_INPUT', 'registered artifact request is invalid');
  }
  return Object.freeze({
    adapterId: assertRefinementAdapterId(input.adapterId),
    operation: assertRefinementProcessOperation(input.operation),
    registryAuthority: input.registryAuthority,
  });
};
const registeredEntry = (registry, adapter) => {
  const matches = registry.entries.filter((entry) =>
    entry.kind === 'adapter-registration-v2'
    && entry.adapterIdSha256 === adapter.adapterIdSha256
    && entry.adapter.sha256 === adapter.sha256);
  if (matches.length !== 1) {
    throw coded('REFINEMENT_REGISTRY_CHANGED', 'registered adapter entry is ambiguous');
  }
  return matches[0];
};
const verifyRegisteredEntry = async (state, adapter) => refinementDirectory(
  state.operations,
  async () => {
    const opened = await readEncrypted(
      state.operations, 'adapters.json', REGISTRY_BYTES_MAX, state.operation,
    );
    if (!opened) throw coded('REFINEMENT_REGISTRY_CHANGED', 'current registry disappeared');
    let registry;
    try { registry = validateRefinementRegistryV2(opened.value); } catch {
      throw coded('REFINEMENT_REGISTRY_CORRUPT', 'current registry is corrupt');
    }
    await verifyEntries(state.operations, registry, state.operation);
    const current = projectRefinementRegistryAdapters(registry);
    if (current.filter((entry) => registrationMatches(entry, adapter)).length !== 1) {
      throw coded('REFINEMENT_REGISTRY_CHANGED', 'registered adapter changed');
    }
    const entry = registeredEntry(registry, adapter);
    const journal = await readJournal(
      state.operations, entry, entry.adapter.provenance.ceremonyId, state.operation,
    );
    return Object.freeze({ entry, journal });
  },
);

/** Open and hold the real CAS bytes named by one committed registry publication. */
export const openRegisteredRefinementArtifactAuthority = async (input) => {
  const exact = registeredArtifactInput(input);
  const state = resolveCurrentRefinementRegistryState(
    exact.registryAuthority, exact.operation,
  );
  const matches = state.adapters.filter(({ id }) => id === exact.adapterId);
  if (matches.length !== 1) throw coded('ADAPTER_NOT_FOUND', 'adapter is unavailable');
  const adapter = matches[0];
  const { journal } = await verifyRegisteredEntry(state, adapter);
  const opened = await openCommittedRefinementArtifactAuthority({
    sha256: journal.intent.artifactSha256,
    bytes: journal.intent.artifactBytes,
    operation: exact.operation,
  });
  if (!opened.ok) return opened;
  const artifact = projectCommittedRefinementArtifactAuthority(
    opened.authority, exact.operation,
  );
  if (artifact.sha256 !== adapter.sha256
    || artifact.bytes !== journal.intent.artifactBytes
    || artifact.objectId !== adapter.sha256) {
    const closed = await closeCommittedRefinementArtifactAuthority(
      opened.authority, exact.operation,
    );
    if (!closed.ok) return closed;
    throw coded('REFINEMENT_REGISTRY_CHANGED', 'registered artifact identity changed');
  }
  const authority = Object.freeze({ kind: 'registered-refinement-artifact-authority-v1' });
  REGISTERED_ARTIFACTS.set(authority, {
    adapter,
    artifactAuthority: opened.authority,
    operation: exact.operation,
    registryAuthority: exact.registryAuthority,
    projection: Object.freeze({
      adapterIdSha256: adapter.adapterIdSha256,
      artifactSha256: artifact.sha256,
      artifactBytes: artifact.bytes,
      objectId: artifact.objectId,
      publicationTransactionSha256: adapter.publicationTransactionSha256,
    }),
  });
  return Object.freeze({ ok: true, authority });
};

export const verifyRegisteredRefinementArtifactAuthority = async (authority, operation) => {
  const state = REGISTERED_ARTIFACTS.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperation(operation)) {
    throw coded('REFINEMENT_REGISTRY_INVALID_AUTHORITY', 'registered artifact authority is invalid');
  }
  const registry = resolveCurrentRefinementRegistryState(state.registryAuthority, operation);
  await verifyRegisteredEntry(registry, state.adapter);
  await verifyCommittedRefinementArtifactAuthority(state.artifactAuthority, operation);
  const artifact = projectCommittedRefinementArtifactAuthority(
    state.artifactAuthority, operation,
  );
  if (artifact.sha256 !== state.projection.artifactSha256
    || artifact.bytes !== state.projection.artifactBytes
    || artifact.objectId !== state.projection.objectId) {
    throw coded('REFINEMENT_REGISTRY_CHANGED', 'registered artifact bytes changed');
  }
  return authority;
};
export const projectRegisteredRefinementArtifactAuthority = (authority, operation) => {
  const state = REGISTERED_ARTIFACTS.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperation(operation)) throw coded('REFINEMENT_REGISTRY_INVALID_AUTHORITY', 'registered artifact authority is invalid');
  return state.projection;
};
export const closeRegisteredRefinementArtifactAuthority = async (authority, operation) => {
  const state = REGISTERED_ARTIFACTS.get(authority);
  if (!state || state.operation !== operation) {
    throw coded('REFINEMENT_REGISTRY_INVALID_AUTHORITY', 'registered artifact authority is invalid');
  }
  const result = await closeCommittedRefinementArtifactAuthority(state.artifactAuthority, operation);
  REGISTERED_ARTIFACTS.delete(authority);
  return result;
};
const registrationMatches = (adapter, expected) =>
  adapter.adapterIdSha256 === expected.adapterIdSha256
  && adapter.sha256 === (expected.artifactSha256 ?? expected.sha256)
  && adapter.publicationTransactionSha256 === expected.publicationTransactionSha256
  && adapter.registrationRegistryGeneration === expected.registrationRegistryGeneration
  && adapter.registrationRegistryAppendRevision === expected.registrationRegistryAppendRevision
  && adapter.registrationRegistrySha256 === expected.registrationRegistrySha256
  && adapter.registrationRegistryCurrentSelectionSha256
    === expected.registrationRegistryCurrentSelectionSha256;
export const assertHeldHistoricalRefinementRegistrations = (authority, operation) => {
  const state = HISTORICAL.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperation(operation)) {
    throw coded('REFINEMENT_REGISTRY_INVALID_AUTHORITY', 'historical registry authority is invalid');
  }
  return authority;
};
export const projectHeldHistoricalRefinementRegistrations = (authority, operation) => {
  assertHeldHistoricalRefinementRegistrations(authority, operation);
  return HISTORICAL.get(authority).entries;
};
export const verifyHeldHistoricalRefinementRegistrations = async (authority, operation) => {
  assertHeldHistoricalRefinementRegistrations(authority, operation);
  const state = HISTORICAL.get(authority);
  return refinementDirectory(state.operations, async () => {
    const read = await readEncrypted(
      state.operations, 'adapters.json', REGISTRY_BYTES_MAX, state.operation,
    );
    if (!read) throw coded('REFINEMENT_REGISTRY_CHANGED', 'current registry disappeared');
    let registry;
    try { registry = validateRefinementRegistryV2(read.value); } catch {
      throw coded('REFINEMENT_REGISTRY_CORRUPT', 'current registry is corrupt');
    }
    await verifyEntries(state.operations, registry, state.operation);
    const adapters = projectRefinementRegistryAdapters(registry);
    if (state.expectedKeys.some((expected) =>
      adapters.filter((adapter) => registrationMatches(adapter, expected)).length !== 1)) {
      throw coded('REFINEMENT_REGISTRY_CHANGED', 'historical registration was revoked or changed');
    }
    return authority;
  });
};
