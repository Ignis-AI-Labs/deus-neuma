import {
  commitPreparedRefinementRegistry,
  prepareRefinementAdapterRegistration,
  refinementAdapterIdSha256,
  refinementRegistryCurrentSelectionSha256,
} from '../../core/refinement/registry-contract.js';
import { recordTraining } from '../../core/refinement/ceremony.js';
import { validateRefinementAdapter } from '../../core/refinement/training-authority-contract.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { refinementHistorySha256 } from '../../core/workspace/refinement-history-reader.js';
import { assertAdapterArtifactIntegrity } from './adapter-artifact-integrity.js';
import {
  assertRefinementCeremonyTransaction,
  closeRefinementCeremonyTransaction,
  openRefinementCeremonyTransaction,
  prepareRefinementCeremonyTransition,
  projectPreparedRefinementCeremonyTransition,
} from './refinement-ceremony-transaction.js';
import {
  prepareRefinementPublicationJournal,
  refinementPublicationTransactionSha256,
} from './refinement-publication-ledger.js';
import { stageRefinementPublicationRegistration } from './refinement-publication-registration-storage.js';
import {
  publicationFailure,
  readCurrentPublicationAuthority,
} from './refinement-publication-storage-internal.js';

/** Build and durably stage both exact replay candidates before PREPARED. */
export const prepareNewRefinementPublicationRegistration = async ({
  state,
  transactionOwner,
  ceremonyId,
  draft,
  training,
  artifact,
  lineage,
  lineageConfigAuthority,
  storage,
}) => {
  let ceremonyAuthority = null;
  let result;
  let primary = null;
  try {
    ceremonyAuthority = await openRefinementCeremonyTransaction({
      transactionOwner,
      ceremonyId,
      operation: state.operation,
    });
    const current = await readCurrentPublicationAuthority(state, ceremonyId);
    const snapshot = assertRefinementCeremonyTransaction(
      ceremonyAuthority,
      state.operation,
    ).current;
    if (current.record.phase !== 'training'
      || snapshot.recordSha256 !== current.recordSha256) {
      throw publicationFailure(
        'WRONG_PHASE',
        'adapter publication requires the exact training ceremony',
      );
    }
    const registeredAt = new Date().toISOString();
    const adapter = validateRefinementAdapter({
      baseModel: draft.baseModel,
      binding: draft.binding,
      custody: current.custody,
      id: draft.id,
      provenance: {
        ceremonyId,
        consentAuthority: current.consentAuthority,
        servingLineage: draft.servingLineage,
        trainedAt: draft.trainedAt,
        trainingPlanAuthority: current.trainingPlanAuthority,
      },
      registeredAt,
      scale: draft.scale,
      sha256: artifact.sha256,
    });
    await assertAdapterArtifactIntegrity({
      adapter,
      lineageConfigAuthority,
      operation: state.operation,
      servingArtifactSha256: adapter.binding.servingArtifactSha256,
      servingModel: adapter.baseModel,
    });
    if (artifact.objectId !== artifact.sha256
      || Object.entries(lineage).some(([field, value]) => adapter.binding[field] !== value)) {
      throw publicationFailure(
        'INVALID_ADAPTER_AUTHORITY',
        'artifact or lineage binding changed before publication',
      );
    }
    const ceremonyCandidate = recordTraining(current.record, {
      ...training,
      adapter: {
        id: adapter.id,
        baseModel: adapter.baseModel,
        artifactPath: artifact.objectId,
        sha256: adapter.sha256,
        binding: adapter.binding,
      },
    });
    const ceremonyCommit = prepareRefinementCeremonyTransition(
      ceremonyAuthority,
      ceremonyCandidate,
      'training-published',
      state.operation,
    );
    const ceremonyNext = projectPreparedRefinementCeremonyTransition(
      ceremonyCommit,
      ceremonyAuthority,
      state.operation,
    );
    const adapterIdSha256 = refinementAdapterIdSha256(adapter.id);
    const intent = Object.freeze({
      action: 'REGISTER',
      adapterBindingSha256: refinementSha256(adapter.binding),
      adapterIdSha256,
      adapterProvenanceSha256: refinementSha256(adapter.provenance),
      artifactBytes: artifact.bytes,
      artifactSha256: artifact.sha256,
      ceremonyApprovalSha256: adapter.binding.ceremonyApprovalSha256,
      ceremonyCandidateSha256: refinementHistorySha256(ceremonyCandidate),
      ceremonyId,
      ceremonyNextSha256: ceremonyNext.recordSha256,
      ceremonyPriorSha256: ceremonyNext.priorCeremonySha256,
      ceremonyRevision: ceremonyNext.revision,
      consentAuthoritySha256: refinementSha256(current.consentAuthority),
      consentEventSha256: adapter.binding.consentEventSha256,
      custodySha256: current.custodySha256,
      lineageConfigObjectId: lineage.lineageConfigObjectId,
      lineageConfigSha256: lineage.lineageConfigSha256,
      lineageConfigSourceCommit: lineage.lineageConfigSourceCommit,
      lineageConfigSourceIdentitySha256: lineage.lineageConfigSourceIdentitySha256,
      lineageConfigSourceMode: lineage.lineageConfigSourceMode,
      operatorDecisionSha256: adapter.binding.operatorDecisionSha256,
      priorRegistryEntrySha256: storage.registry?.entries.at(-1).entrySha256 ?? null,
      priorRegistrySha256: storage.registry?.registrySha256 ?? null,
      registeredAt,
      registryAppendRevision: (storage.registry?.appendRevision ?? 0) + 1,
      registryCurrentSelectionSha256: refinementRegistryCurrentSelectionSha256({
        adapterIdSha256,
        artifactSha256: artifact.sha256,
      }),
      registryGeneration: (storage.registry?.generation ?? 0) + 1,
      scaleAuthorityTokenSha256: null,
      selectedScale: adapter.scale,
      trainedAt: adapter.provenance.trainedAt,
      trainingConfigSha256: adapter.binding.trainingConfigSha256,
      trainingPlanAuthoritySha256: refinementSha256(current.trainingPlanAuthority),
      trainingPlanSha256: adapter.binding.trainingPlanSha256,
    });
    const transactionSha256 = refinementPublicationTransactionSha256(intent);
    const registryCandidate = commitPreparedRefinementRegistry(
      prepareRefinementAdapterRegistration(
        storage.registry,
        adapter,
        transactionSha256,
      ),
      transactionSha256,
    );
    const preparedJournal = prepareRefinementPublicationJournal({
      intent,
      registrySha256: registryCandidate.registrySha256,
    });
    await stageRefinementPublicationRegistration({
      state,
      storage,
      ceremonyCandidate,
      registryCandidate,
      preparedJournal,
    });
    result = Object.freeze({ preparedJournal });
  } catch (error) {
    primary = error;
  }
  if (ceremonyAuthority) {
    try {
      closeRefinementCeremonyTransaction(ceremonyAuthority, state.operation);
    } catch (error) {
      primary = primary
        ? new AggregateError(
          [primary, error],
          'publication preparation and ceremony authority close failed',
        )
        : error;
    }
  }
  if (primary) throw primary;
  return result;
};
