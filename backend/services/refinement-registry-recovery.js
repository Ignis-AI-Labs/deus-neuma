import {
  priorRefinementRegistryRevision,
  validateRefinementRegistryV2,
} from '../../core/refinement/registry-contract.js';
import { isSha256 } from '../../core/shared/plain-data-canonical.js';
import {
  validateRefinementPublicationJournal,
} from './refinement-publication-ledger.js';
import {
  PUBLICATION_FILE_BYTES_MAX,
  PUBLICATION_JOURNAL_BYTES_MAX,
  openPublicationEncrypted,
  publicationFailure,
  readPublicationEncrypted,
  releasePublicationResource,
  replacePublicationEncrypted,
  sameRegistryRevision,
} from './refinement-publication-storage-internal.js';

const journalName = (transactionSha256) =>
  `publication-selection-${transactionSha256}.json`;

const assertExactPreparedSelection = ({ current, prior, journal }) => {
  const entry = current.entries.at(-1);
  if (entry.kind !== 'adapter-selection-v2'
    || journal.state !== 'PREPARED'
    || journal.intent.action !== 'SELECT'
    || journal.transactionSha256 !== entry.commit.transactionSha256
    || journal.registrySha256 !== current.registrySha256
    || journal.intent.adapterIdSha256 !== entry.adapterIdSha256
    || journal.intent.artifactSha256 !== entry.artifactSha256
    || journal.intent.selectedScale !== entry.selectedScale
    || !isSha256(journal.intent.scaleAuthorityTokenSha256)
    || journal.intent.registryGeneration !== current.generation
    || journal.intent.registryAppendRevision !== current.appendRevision
    || journal.intent.registryCurrentSelectionSha256 !== current.currentSelectionSha256
    || journal.intent.priorRegistrySha256 !== prior.registrySha256
    || journal.intent.priorRegistryEntrySha256 !== prior.entries.at(-1).entrySha256
    || current.priorRegistrySha256 !== prior.registrySha256
    || entry.priorEntrySha256 !== prior.entries.at(-1).entrySha256
    || journal.intent.ceremonyPriorSha256 !== journal.intent.ceremonyNextSha256) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_QUARANTINED',
      'prepared scale selection does not bind the exact registry transition',
    );
  }
  return journal;
};

/**
 * Restore only one exact trailing PREPARED selection. Registration recovery
 * also owns a ceremony transition and must use its dedicated reconciler.
 */
export const restorePreparedRefinementSelection = async ({
  operations,
  registry,
  operation,
  maximumBytes = PUBLICATION_FILE_BYTES_MAX,
}) => {
  const current = validateRefinementRegistryV2(registry);
  const entry = current.entries.at(-1);
  const prior = priorRefinementRegistryRevision(current);
  if (!prior || entry.kind !== 'adapter-selection-v2') {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_RECOVERY_REQUIRED',
      'registry requires its dedicated registration recovery authority',
    );
  }
  const rawJournal = await readPublicationEncrypted(
    operations,
    journalName(entry.commit.transactionSha256),
    PUBLICATION_JOURNAL_BYTES_MAX,
    operation,
    true,
  );
  if (rawJournal === null) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_QUARANTINED',
      'prepared scale selection journal is absent',
    );
  }
  let journal;
  try {
    journal = validateRefinementPublicationJournal(rawJournal);
  } catch {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_QUARANTINED',
      'prepared scale selection journal is corrupt',
    );
  }
  assertExactPreparedSelection({ current, prior, journal });
  const held = await openPublicationEncrypted(
    operations,
    'adapters.json',
    maximumBytes,
  );
  let primary = null;
  try {
    const heldRegistry = validateRefinementRegistryV2(held.value);
    if (!sameRegistryRevision(heldRegistry, current)) {
      throw publicationFailure(
        'REFINEMENT_TRANSACTION_STALE',
        'registry changed before prepared scale selection restoration',
      );
    }
    await replacePublicationEncrypted({
      operations,
      name: 'adapters.json',
      value: prior,
      maximumBytes,
      expectedResource: held.resource,
      validate: (value) => {
        const restored = validateRefinementRegistryV2(value);
        if (!sameRegistryRevision(restored, prior)) {
          throw publicationFailure(
            'REFINEMENT_PUBLICATION_CORRUPT',
            'restored registry predecessor changed',
          );
        }
      },
    });
    await operations.sync();
  } catch (error) {
    primary = error;
  }
  await releasePublicationResource(operations, held.resource, primary);
  return prior;
};
