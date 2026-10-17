import { validateRefinementAdapter } from '../../core/refinement/training-authority-contract.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { refinementAdapterIdSha256 } from '../../core/refinement/registry-contract.js';
import { assertAdapterArtifactIntegrity } from './adapter-artifact-integrity.js';
import {
  projectCommittedRefinementLineageConfigAuthority,
  verifyCommittedRefinementLineageConfigAuthority,
} from './refinement-lineage-authority.js';
import {
  assertCommittedRefinementPublication,
  refinementPublicationJournalName,
  validateRefinementPublicationJournal,
} from './refinement-publication-ledger.js';
import {
  PUBLICATION_JOURNAL_BYTES_MAX,
  assertCurrentAdapterAuthority,
  publicationDirectories,
  publicationFailure,
  readCurrentPublicationAuthority,
  readPublicationEncrypted,
  withPublicationDirectory,
} from './refinement-publication-storage-internal.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { refinementSubjectAuthorityOperations } from './refinement-subject-authority.js';
import { verifyCommittedRefinementArtifact } from './refinement-trained-artifact-authority.js';

const canonicalRefinementPublicationAdapter = (value) =>
  validateRefinementAdapter({
    baseModel: value?.baseModel,
    binding: value?.binding,
    custody: value?.custody,
    id: value?.id,
    provenance: value?.provenance,
    registeredAt: value?.registeredAt,
    scale: value?.scale,
    sha256: value?.sha256,
  });

const exactIntentAuthority = ({ adapter, current, journal, lineage }) => {
  const binding = adapter.binding;
  const expected = Object.freeze({
    adapterBindingSha256: refinementSha256(binding),
    adapterIdSha256: refinementAdapterIdSha256(adapter.id),
    adapterProvenanceSha256: refinementSha256(adapter.provenance),
    artifactSha256: adapter.sha256,
    ceremonyApprovalSha256: binding.ceremonyApprovalSha256,
    ceremonyId: adapter.provenance.ceremonyId,
    consentAuthoritySha256: refinementSha256(current.consentAuthority),
    consentEventSha256: binding.consentEventSha256,
    custodySha256: current.custodySha256,
    lineageConfigObjectId: lineage.lineageConfigObjectId,
    lineageConfigSha256: lineage.lineageConfigSha256,
    lineageConfigSourceCommit: lineage.lineageConfigSourceCommit,
    lineageConfigSourceIdentitySha256: lineage.lineageConfigSourceIdentitySha256,
    lineageConfigSourceMode: lineage.lineageConfigSourceMode,
    operatorDecisionSha256: binding.operatorDecisionSha256,
    registeredAt: adapter.registeredAt,
    trainedAt: adapter.provenance.trainedAt,
    trainingConfigSha256: binding.trainingConfigSha256,
    trainingPlanAuthoritySha256: refinementSha256(current.trainingPlanAuthority),
    scaleAuthorityTokenSha256: null,
    selectedScale: adapter.scale,
    trainingPlanSha256: binding.trainingPlanSha256,
  });
  if (Object.entries(expected).some(([field, value]) => journal.intent[field] !== value)) {
    throw publicationFailure(
      'REFINEMENT_TRANSACTION_STALE',
      'publication intent no longer matches current authority',
    );
  }
  assertCurrentAdapterAuthority(adapter, current);
  return adapter;
};
const registrationExpectation = (adapter, custodySha256) => Object.freeze({
  adapterIdSha256: adapter.adapterIdSha256,
  artifactSha256: adapter.sha256,
  ceremonyId: adapter.provenance.ceremonyId,
  custodySha256,
  registryAppendRevision: adapter.registrationRegistryAppendRevision,
  registryCurrentSelectionSha256: adapter.registrationRegistryCurrentSelectionSha256,
  registryGeneration: adapter.registrationRegistryGeneration,
  registrySha256: adapter.registrationRegistrySha256,
  transactionSha256: adapter.publicationTransactionSha256,
});

export const verifyRefinementPublicationEvidence = async ({
  state,
  journal,
  adapter,
  lineageConfigAuthority,
}) => {
  const candidate = canonicalRefinementPublicationAdapter(adapter);
  await verifyCommittedRefinementLineageConfigAuthority(
    lineageConfigAuthority,
    state.operation,
  );
  const lineage = projectCommittedRefinementLineageConfigAuthority(
    lineageConfigAuthority,
    state.operation,
  );
  await assertAdapterArtifactIntegrity({
    adapter: candidate,
    lineageConfigAuthority,
    operation: state.operation,
    servingArtifactSha256: candidate.binding.servingArtifactSha256,
    servingModel: candidate.baseModel,
  });
  const artifact = await verifyCommittedRefinementArtifact({
    sha256: journal.intent.artifactSha256,
    bytes: journal.intent.artifactBytes,
    operation: state.operation,
  });
  if (artifact.objectId !== journal.intent.artifactSha256) {
    throw publicationFailure(
      'INVALID_ADAPTER_AUTHORITY',
      'committed artifact object authority changed',
    );
  }
  const current = await readCurrentPublicationAuthority(
    state,
    candidate.provenance.ceremonyId,
  );
  exactIntentAuthority({ adapter: candidate, current, journal, lineage });
  return Object.freeze({ adapter: candidate, current, lineage, artifact });
};

const readCommittedJournal = (state, ceremonyId) => withPublicationDirectory(
  state.operations,
  publicationDirectories.refinement,
  async () => validateRefinementPublicationJournal(await readPublicationEncrypted(
    state.operations,
    refinementPublicationJournalName({ action: 'REGISTER', ceremonyId }),
    PUBLICATION_JOURNAL_BYTES_MAX,
    state.operation,
  )),
);

/** Re-read COMMITTED plus current custody, consent, consumed decision, lineage, and CAS bytes. */
export const verifyCurrentRefinementPublicationAuthority = async ({
  adapter,
  lineageConfigAuthority,
  operation,
  subjectAuthority,
}) => {
  const active = assertRefinementProcessOperation(operation);
  const state = Object.freeze({
    operation: active,
    subjectAuthority,
    operations: refinementSubjectAuthorityOperations(subjectAuthority, active),
  });
  const candidate = canonicalRefinementPublicationAdapter(adapter);
  const journal = await readCommittedJournal(state, candidate.provenance.ceremonyId);
  const evidence = await verifyRefinementPublicationEvidence({
    state,
    journal,
    adapter: candidate,
    lineageConfigAuthority,
  });
  assertCommittedRefinementPublication(
    journal,
    registrationExpectation(adapter, evidence.current.custodySha256),
  );
  const attestation = Object.freeze({
    artifactSha256: evidence.artifact.sha256,
    ceremonyId: candidate.provenance.ceremonyId,
    ceremonyRevision: evidence.current.revision,
    ceremonySha256: evidence.current.recordSha256,
    consentAuthoritySha256: journal.intent.consentAuthoritySha256,
    custodySha256: evidence.current.custodySha256,
    lineageConfigSha256: evidence.lineage.lineageConfigSha256,
    lineageConfigSourceCommit: evidence.lineage.lineageConfigSourceCommit,
    operatorDecisionSha256: journal.intent.operatorDecisionSha256,
    publicationTransactionSha256: journal.transactionSha256,
    registryAppendRevision: journal.intent.registryAppendRevision,
    registryGeneration: journal.intent.registryGeneration,
    registrySha256: journal.registrySha256,
    trainingPlanAuthoritySha256: journal.intent.trainingPlanAuthoritySha256,
  });
  return Object.freeze({
    ...attestation,
    servingAttestationSha256: refinementSha256(attestation),
  });
};

export const readCommittedRefinementPublicationJournal = readCommittedJournal;
