import { projectRefinementRegistryAdapters } from '../../core/refinement/registry-contract.js';
import { recordTraining } from '../../core/refinement/ceremony.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { refinementHistorySha256 } from '../../core/workspace/refinement-history-reader.js';
import {
  assertRefinementCeremonyTransaction,
  closeRefinementCeremonyTransaction,
  commitPreparedRefinementCeremonyTransition,
  openRefinementCeremonyTransaction,
  prepareRefinementCeremonyTransition,
  projectPreparedRefinementCeremonyTransition,
} from './refinement-ceremony-transaction.js';
import {
  projectCommittedRefinementLineageConfigAuthority,
  verifyCommittedRefinementLineageConfigAuthority,
} from './refinement-lineage-authority.js';
import {
  commitPreparedRefinementPublicationJournal,
} from './refinement-publication-ledger.js';
import {
  prepareNewRefinementPublicationRegistration,
} from './refinement-publication-preparation.js';
import {
  commitRefinementPublicationMarker,
  commitRefinementPublicationRegistry,
  readRefinementPublicationRegistrationStorage,
  removeRefinementPublicationCandidates,
} from './refinement-publication-registration-storage.js';
import {
  publicationFailure,
  readCurrentPublicationAuthority,
} from './refinement-publication-storage-internal.js';
import {
  readCommittedRefinementPublicationJournal,
  verifyCurrentRefinementPublicationAuthority,
  verifyRefinementPublicationEvidence,
} from './refinement-publication-verifier.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import { refinementSubjectAuthorityOperations } from './refinement-subject-authority.js';
import {
  projectRefinementPublicationArtifactAuthority,
  retryRefinementTrainedArtifactCleanup,
  settleRefinementArtifactPublication,
  verifyRefinementPublicationArtifactAuthority,
} from './refinement-trained-artifact-authority.js';

const exactDraft = (value) => {
  const fields = ['baseModel', 'binding', 'id', 'scale', 'servingLineage', 'trainedAt'];
  const descriptors = value && typeof value === 'object'
    ? Object.getOwnPropertyDescriptors(value) : {};
  const keys = Reflect.ownKeys(descriptors);
  if (!value || Array.isArray(value) || keys.length !== fields.length
    || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
    || fields.some((field) => !Object.hasOwn(descriptors[field], 'value'))) {
    throw publicationFailure(
      'INVALID_ADAPTER_AUTHORITY',
      'adapter publication draft is invalid',
    );
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [
    field, descriptors[field].value,
  ])));
};
const stateFor = (transactionOwner, operation) => {
  const active = assertRefinementProcessOperation(operation);
  const subjectAuthority = assertRefinementSubjectTransaction(transactionOwner, active);
  return Object.freeze({
    operation: active,
    subjectAuthority,
    operations: refinementSubjectAuthorityOperations(subjectAuthority, active),
  });
};
const registrationFor = (registry, journal) => {
  const matches = projectRefinementRegistryAdapters(registry).filter((adapter) =>
    adapter.publicationTransactionSha256 === journal.transactionSha256
    && adapter.adapterIdSha256 === journal.intent.adapterIdSha256
    && adapter.sha256 === journal.intent.artifactSha256);
  if (matches.length !== 1) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_CORRUPT',
      'publication registry carries no exact registration',
    );
  }
  return matches[0];
};
const assertCandidate = (storage, journal) => {
  const ceremony = storage.ceremonyCandidate;
  const registry = storage.registryCandidate;
  if (!ceremony || !registry
    || refinementHistorySha256(ceremony) !== journal.intent.ceremonyCandidateSha256
    || registry.registrySha256 !== journal.registrySha256
    || registry.entries.at(-1).commit.transactionSha256 !== journal.transactionSha256
    || registry.generation !== journal.intent.registryGeneration
    || registry.appendRevision !== journal.intent.registryAppendRevision
    || registry.currentSelectionSha256 !== journal.intent.registryCurrentSelectionSha256
    || registry.priorRegistrySha256 !== journal.intent.priorRegistrySha256
    || registry.entries.at(-1).priorEntrySha256 !== journal.intent.priorRegistryEntrySha256) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_QUARANTINED',
      'prepared publication replay authority is incomplete or changed',
    );
  }
  return Object.freeze({ ceremony, registry });
};
const reconstructCeremony = (current, candidate) => {
  const reproduced = recordTraining(current.record, candidate.training);
  if (refinementHistorySha256(reproduced) !== refinementHistorySha256(candidate)) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_QUARANTINED',
      'prepared ceremony is not derived from its exact predecessor',
    );
  }
  return reproduced;
};
const sameStampedCeremony = (current, candidate) => {
  const stamped = {
    ...candidate,
    revision: current.record.revision,
    priorCeremonySha256: current.record.priorCeremonySha256,
    transaction: current.record.transaction,
  };
  return refinementHistorySha256(stamped) === current.recordSha256;
};

const applyPrepared = async ({
  state,
  transactionOwner,
  storage,
  lineageConfigAuthority,
}) => {
  const journal = storage.journal;
  if (journal?.state !== 'PREPARED') {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_QUARANTINED',
      'publication recovery requires one prepared journal',
    );
  }
  const candidates = assertCandidate(storage, journal);
  const adapter = registrationFor(candidates.registry, journal);
  let ceremonyAuthority = null;
  let result;
  let primary = null;
  try {
    ceremonyAuthority = await openRefinementCeremonyTransaction({
      transactionOwner,
      ceremonyId: journal.intent.ceremonyId,
      operation: state.operation,
    });
    const current = await readCurrentPublicationAuthority(state, journal.intent.ceremonyId);
    const snapshot = assertRefinementCeremonyTransaction(
      ceremonyAuthority,
      state.operation,
    ).current;
    if (snapshot.recordSha256 !== current.recordSha256
      || snapshot.revision !== current.revision
      || snapshot.custodySha256 !== current.custodySha256) {
      throw publicationFailure(
        'REFINEMENT_TRANSACTION_STALE',
        'held ceremony and current approval authority differ',
      );
    }
    await verifyRefinementPublicationEvidence({
      state, journal, adapter, lineageConfigAuthority,
    });
    if (current.recordSha256 === journal.intent.ceremonyPriorSha256) {
      const nextRecord = reconstructCeremony(current, candidates.ceremony);
      const commit = prepareRefinementCeremonyTransition(
        ceremonyAuthority,
        nextRecord,
        'training-published',
        state.operation,
      );
      const projected = projectPreparedRefinementCeremonyTransition(
        commit,
        ceremonyAuthority,
        state.operation,
      );
      if (projected.recordSha256 !== journal.intent.ceremonyNextSha256
        || projected.revision !== journal.intent.ceremonyRevision
        || projected.priorCeremonySha256 !== journal.intent.ceremonyPriorSha256
        || projected.custodySha256 !== journal.intent.custodySha256) {
        throw publicationFailure(
          'REFINEMENT_PUBLICATION_QUARANTINED',
          'prepared ceremony projection changed during recovery',
        );
      }
      await commitPreparedRefinementCeremonyTransition(
        ceremonyAuthority,
        commit,
        state.operation,
      );
      await state.operations.sync();
    } else if (current.recordSha256 !== journal.intent.ceremonyNextSha256
      || !sameStampedCeremony(current, candidates.ceremony)) {
      throw publicationFailure(
        'REFINEMENT_PUBLICATION_QUARANTINED',
        'ceremony is neither the prepared predecessor nor successor',
      );
    }
    const registryIsPrior = (storage.registry?.registrySha256 ?? null)
      === journal.intent.priorRegistrySha256;
    const registryIsNext = storage.registry?.registrySha256 === journal.registrySha256;
    if (!registryIsPrior && !registryIsNext) {
      throw publicationFailure(
        'REFINEMENT_PUBLICATION_QUARANTINED',
        'registry is neither the prepared predecessor nor successor',
      );
    }
    if (registryIsPrior) {
      await commitRefinementPublicationRegistry(
        state,
        storage.registry,
        candidates.registry,
      );
    }
    await verifyRefinementPublicationEvidence({
      state, journal, adapter, lineageConfigAuthority,
    });
    const committedJournal = commitPreparedRefinementPublicationJournal(journal);
    await commitRefinementPublicationMarker(state, journal, committedJournal);
    result = Object.freeze({
      adapter: registrationFor(candidates.registry, committedJournal),
      ceremony: candidates.ceremony,
      journal: committedJournal,
      registry: candidates.registry,
    });
  } catch (error) {
    primary = error;
  }
  if (ceremonyAuthority) {
    try {
      closeRefinementCeremonyTransaction(ceremonyAuthority, state.operation);
    } catch (error) {
      primary = new AggregateError(
        [primary, error],
        'publication recovery and ceremony authority close failed',
      );
    }
  }
  if (primary) throw primary;
  return result;
};


/** Finish one durable PREPARED registration after a process restart. */
export const reconcilePreparedRefinementPublication = async ({
  transactionOwner,
  ceremonyId,
  lineageConfigAuthority,
  operation,
}) => {
  const state = stateFor(transactionOwner, operation);
  const storage = await readRefinementPublicationRegistrationStorage(state, ceremonyId);
  if (!storage.journal) return Object.freeze({ state: 'ABSENT' });
  if (storage.journal.state === 'COMMITTED') {
    const adapter = registrationFor(storage.registry, storage.journal);
    await verifyCurrentRefinementPublicationAuthority({
      adapter,
      lineageConfigAuthority,
      operation: state.operation,
      subjectAuthority: state.subjectAuthority,
    });
    await removeRefinementPublicationCandidates({ state, storage });
    return Object.freeze({
      state: 'COMMITTED',
      adapter,
      publication: storage.journal,
    });
  }
  const result = await applyPrepared({
    state,
    transactionOwner,
    storage,
    lineageConfigAuthority,
  });
  await removeRefinementPublicationCandidates({ state, storage });
  return Object.freeze({
    state: 'COMMITTED',
    adapter: result.adapter,
    publication: result.journal,
  });
};


/** Consume one publication artifact owner into one crash-replayable committed registration. */
export const publishCommittedRefinementAdapter = async ({
  transactionOwner,
  ceremonyId,
  adapter: draftInput,
  training,
  publicationArtifactAuthority,
  lineageConfigAuthority,
  operation,
}) => {
  const state = stateFor(transactionOwner, operation);
  const draft = exactDraft(draftInput);
  let committed;
  let result;
  let primary = null;
  try {
    await Promise.all([
      verifyRefinementPublicationArtifactAuthority(
        publicationArtifactAuthority,
        state.operation,
      ),
      verifyCommittedRefinementLineageConfigAuthority(
        lineageConfigAuthority,
        state.operation,
      ),
    ]);
    const artifact = projectRefinementPublicationArtifactAuthority(
      publicationArtifactAuthority,
      state.operation,
    );
    const lineage = projectCommittedRefinementLineageConfigAuthority(
      lineageConfigAuthority,
      state.operation,
    );
    let storage = await readRefinementPublicationRegistrationStorage(state, ceremonyId);
    if (!storage.journal && (storage.ceremonyCandidate || storage.registryCandidate)) {
      await removeRefinementPublicationCandidates({ state, storage });
      storage = await readRefinementPublicationRegistrationStorage(state, ceremonyId);
    }
    if (!storage.journal) {
      await prepareNewRefinementPublicationRegistration({
        state,
        transactionOwner,
        ceremonyId,
        draft,
        training,
        artifact,
        lineage,
        lineageConfigAuthority,
        storage,
      });
      storage = await readRefinementPublicationRegistrationStorage(state, ceremonyId);
    }
    const recovered = await reconcilePreparedRefinementPublication({
      transactionOwner,
      ceremonyId,
      lineageConfigAuthority,
      operation: state.operation,
    });
    if (recovered.state !== 'COMMITTED') {
      throw publicationFailure(
        'REFINEMENT_PUBLICATION_QUARANTINED',
        'publication did not reach a committed state',
      );
    }
    const registered = recovered.adapter;
    if (registered.id !== draft.id
      || registered.baseModel !== draft.baseModel
      || registered.scale !== draft.scale
      || registered.sha256 !== artifact.sha256
      || refinementSha256(registered.binding) !== refinementSha256(draft.binding)
      || refinementSha256(registered.provenance.servingLineage)
        !== refinementSha256(draft.servingLineage)
      || registered.provenance.trainedAt !== draft.trainedAt) {
      throw publicationFailure(
        'REFINEMENT_TRANSACTION_STALE',
        'committed registration differs from the publication request',
      );
    }
    committed = true;
    result = Object.freeze({
      adapter: registered,
      publication: recovered.publication,
    });
  } catch (error) {
    primary = error;
    try {
      const journal = await readCommittedRefinementPublicationJournal(state, ceremonyId);
      committed = journal.state === 'COMMITTED';
    } catch {
      committed = false;
    }
  }
  try {
    let settled = await settleRefinementArtifactPublication({
      publicationArtifactAuthority,
      operation: state.operation,
      outcome: committed ? 'committed' : 'refused',
    });
    if (!settled.ok) {
      settled = await retryRefinementTrainedArtifactCleanup(
        settled.cleanupAuthority,
        state.operation,
      );
    }
    if (!settled.ok) {
      const cleanupError = publicationFailure(
        'REFINEMENT_ARTIFACT_CLEANUP_FAILED',
        'publication artifact cleanup requires explicit recovery',
      );
      Object.defineProperty(cleanupError, 'cleanupAuthority', {
        value: settled.cleanupAuthority,
      });
      throw cleanupError;
    }
  } catch (error) {
    primary = primary
      ? new AggregateError([primary, error], 'publication and artifact cleanup failed')
      : error;
  }
  if (primary) throw primary;
  return result;
};
