import {
  validateRefinementRegistryV2,
} from '../../core/refinement/registry-contract.js';
import { refinementHistorySha256 } from '../../core/workspace/refinement-history-reader.js';
import {
  assertCommittedRefinementPublication,
  refinementPublicationJournalName,
  validateRefinementPublicationJournal,
} from './refinement-publication-ledger.js';
import {
  PUBLICATION_FILE_BYTES_MAX,
  PUBLICATION_JOURNAL_BYTES_MAX,
  openPublicationEncrypted,
  publicationDirectories,
  publicationFailure,
  readPublicationEncrypted,
  releasePublicationResource,
  replacePublicationEncrypted,
  sameRegistryRevision,
  withPublicationDirectory,
} from './refinement-publication-storage-internal.js';

const candidateNames = (ceremonyId) => {
  const journal = refinementPublicationJournalName({ action: 'REGISTER', ceremonyId });
  const stem = journal.slice(0, -'.json'.length);
  return Object.freeze({
    journal,
    ceremony: `${stem}-ceremony.json`,
    registry: `${stem}-registry.json`,
  });
};
const parseJournal = (value) => validateRefinementPublicationJournal(value);
const parseRegistry = (value) => validateRefinementRegistryV2(value);
const parseCeremony = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_CORRUPT',
      'prepared ceremony candidate is invalid',
    );
  }
  refinementHistorySha256(value);
  return Object.freeze(value);
};
const sameJournal = (left, right) => left?.preparedSha256 === right?.preparedSha256
  && left?.state === right?.state && left?.commitSha256 === right?.commitSha256;
const sameCeremony = (left, right) => left != null && right != null
  && refinementHistorySha256(left) === refinementHistorySha256(right);
const sameOptionalRegistry = (left, right) => left === null && right === null
  || sameRegistryRevision(left, right);

const expectedTuple = (entry, adapter, journal) => Object.freeze({
  adapterIdSha256: entry.adapterIdSha256,
  artifactSha256: adapter.sha256,
  ceremonyId: adapter.provenance.ceremonyId,
  custodySha256: journal.intent.custodySha256,
  registryAppendRevision: entry.commit.appendRevision,
  registryCurrentSelectionSha256: entry.commit.currentSelectionSha256,
  registryGeneration: entry.commit.generation,
  registrySha256: entry.commit.registrySha256,
  transactionSha256: entry.commit.transactionSha256,
});
const verifyCommittedPrefix = async (operations, registry, pending, operation) => {
  const registrations = new Map();
  for (const [index, entry] of (registry?.entries ?? []).entries()) {
    const adapter = entry.kind === 'adapter-registration-v2'
      ? entry.adapter : registrations.get(entry.adapterIdSha256);
    if (!adapter) {
      throw publicationFailure(
        'REFINEMENT_PUBLICATION_CORRUPT',
        'registry registration lineage is incomplete',
      );
    }
    if (entry.kind === 'adapter-registration-v2') {
      registrations.set(entry.adapterIdSha256, adapter);
    }
    if (pending?.state === 'PREPARED' && index === registry.entries.length - 1
      && entry.commit.transactionSha256 === pending.transactionSha256) continue;
    const name = entry.kind === 'adapter-registration-v2'
      ? candidateNames(adapter.provenance.ceremonyId).journal
      : refinementPublicationJournalName({
        action: 'SELECT', transactionSha256: entry.commit.transactionSha256,
      });
    const journal = parseJournal(await readPublicationEncrypted(
      operations, name, PUBLICATION_JOURNAL_BYTES_MAX, operation,
    ));
    assertCommittedRefinementPublication(journal, expectedTuple(entry, adapter, journal));
  }
};
const readOptional = async (operations, name, maximumBytes, operation, parse) => {
  const value = await readPublicationEncrypted(
    operations, name, maximumBytes, operation, true,
  );
  return value === null ? null : parse(value);
};

/** Read the bounded durable registration tuple and verify every visible registry prefix. */
export const readRefinementPublicationRegistrationStorage = (
  state,
  ceremonyId,
) => withPublicationDirectory(
  state.operations,
  publicationDirectories.refinement,
  async () => {
    const names = candidateNames(ceremonyId);
    const journal = await readOptional(
      state.operations, names.journal, PUBLICATION_JOURNAL_BYTES_MAX,
      state.operation, parseJournal,
    );
    const registry = await readOptional(
      state.operations, 'adapters.json', PUBLICATION_FILE_BYTES_MAX,
      state.operation, parseRegistry,
    );
    await verifyCommittedPrefix(state.operations, registry, journal, state.operation);
    const ceremonyCandidate = await readOptional(
      state.operations, names.ceremony, PUBLICATION_FILE_BYTES_MAX,
      state.operation, parseCeremony,
    );
    const registryCandidate = await readOptional(
      state.operations, names.registry, PUBLICATION_FILE_BYTES_MAX,
      state.operation, parseRegistry,
    );
    return Object.freeze({
      names, journal, registry, ceremonyCandidate, registryCandidate,
    });
  },
);

const replaceExact = (
  state,
  name,
  maximumBytes,
  prior,
  next,
  parse,
  same,
) => withPublicationDirectory(
  state.operations,
  publicationDirectories.refinement,
  async () => {
    const held = await openPublicationEncrypted(
      state.operations, name, maximumBytes, true,
    );
    let result;
    let primary = null;
    try {
      const actual = held ? parse(held.value) : null;
      if (same(actual, next)) {
        result = next;
      } else {
        if (!same(actual, prior)) {
          throw publicationFailure(
            'REFINEMENT_TRANSACTION_STALE',
            `${name} changed before publication`,
          );
        }
        await replacePublicationEncrypted({
          operations: state.operations,
          name,
          value: next,
          maximumBytes,
          expectedResource: held?.resource ?? null,
          validate: (value) => {
            if (!same(parse(value), next)) {
              throw publicationFailure(
                'REFINEMENT_PUBLICATION_CORRUPT',
                `${name} changed during publication`,
              );
            }
          },
        });
        await state.operations.sync();
        result = next;
      }
    } catch (error) {
      primary = error;
    }
    if (held) {
      await releasePublicationResource(state.operations, held.resource, primary);
    } else if (primary) {
      throw primary;
    }
    return result;
  },
);

/** Persist both replay candidates, then PREPARED. Nothing is visible before COMMITTED. */
export const stageRefinementPublicationRegistration = async ({
  state,
  storage,
  ceremonyCandidate,
  registryCandidate,
  preparedJournal,
}) => {
  await replaceExact(
    state, storage.names.ceremony, PUBLICATION_FILE_BYTES_MAX,
    storage.ceremonyCandidate, ceremonyCandidate, parseCeremony, sameCeremony,
  );
  await replaceExact(
    state, storage.names.registry, PUBLICATION_FILE_BYTES_MAX,
    storage.registryCandidate, registryCandidate, parseRegistry, sameRegistryRevision,
  );
  await replaceExact(
    state, storage.names.journal, PUBLICATION_JOURNAL_BYTES_MAX,
    storage.journal, preparedJournal, parseJournal, sameJournal,
  );
};

/** Replace the visible registry against its held predecessor. */
export const commitRefinementPublicationRegistry = (
  state,
  priorRegistry,
  nextRegistry,
) => replaceExact(
  state, 'adapters.json', PUBLICATION_FILE_BYTES_MAX,
  priorRegistry, nextRegistry, parseRegistry, sameOptionalRegistry,
);

/** The COMMITTED journal replacement and directory fsync are deliberately last. */
export const commitRefinementPublicationMarker = (
  state,
  priorJournal,
  committedJournal,
) => replaceExact(
  state,
  candidateNames(committedJournal.intent.ceremonyId).journal,
  PUBLICATION_JOURNAL_BYTES_MAX,
  priorJournal,
  committedJournal,
  parseJournal,
  sameJournal,
);

const removeExact = (
  state,
  name,
  maximumBytes,
  parse,
  expected,
  same,
) => withPublicationDirectory(
  state.operations,
  publicationDirectories.refinement,
  async () => {
    const held = await openPublicationEncrypted(
      state.operations, name, maximumBytes, true,
    );
    if (!held) return false;
    let primary = null;
    try {
      const actual = parse(held.value);
      if (expected !== null && !same(actual, expected)) {
        throw publicationFailure(
          'REFINEMENT_PUBLICATION_QUARANTINED',
          `${name} cleanup authority changed`,
        );
      }
      await state.operations.unlink({ name, expectedResource: held.resource });
      await state.operations.sync();
    } catch (error) {
      primary = error;
    }
    await releasePublicationResource(state.operations, held.resource, primary);
    return true;
  },
);

/** Remove replay-only candidates after COMMITTED, or exact orphans before PREPARED. */
export const removeRefinementPublicationCandidates = async ({
  state,
  storage,
  ceremonyCandidate = storage.ceremonyCandidate,
  registryCandidate = storage.registryCandidate,
}) => {
  await removeExact(
    state, storage.names.ceremony, PUBLICATION_FILE_BYTES_MAX,
    parseCeremony, ceremonyCandidate, sameCeremony,
  );
  await removeExact(
    state, storage.names.registry, PUBLICATION_FILE_BYTES_MAX,
    parseRegistry, registryCandidate, sameRegistryRevision,
  );
};
