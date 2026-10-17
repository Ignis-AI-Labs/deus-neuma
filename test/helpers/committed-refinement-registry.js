// Commit one REAL v2 refinement registry into a real workspace.
//
// Not a fixture that imitates the registry: every byte here is produced by the
// production contract and the production cipher. The adapter record is built by
// `validateRefinementAdapter`, the registry revision by
// `prepareRefinementAdapterRegistration` + `commitPreparedRefinementRegistry`,
// the publication journal by `prepareRefinementPublicationJournal` +
// `commitPreparedRefinementPublicationJournal`, and both files are sealed with
// the real AES-GCM envelope under the being's real per-neuma DEK. The registry
// authority then reads them back through its own verification with no
// knowledge that a test wrote them. No mock, stub, fake, or spy (RULE 0).
//
// This exists because the v1 workspace adapter delegate that used to write
// `refinement/adapters.json` is gone, and the v2 publication transaction that
// replaces it needs a trained artifact authority and a lineage config authority
// that a binding test has no business standing up.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { encryptEnvelope } from '../../core/workspace/workspace-crypto.js';
import {
  commitPreparedRefinementRegistry,
  prepareRefinementAdapterRegistration,
  prepareRefinementAdapterSelection,
  refinementAdapterIdSha256,
  refinementRegistryCurrentSelectionSha256,
} from '../../core/refinement/registry-contract.js';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import { validateRefinementAdapter } from '../../core/refinement/training-authority-contract.js';
import {
  commitPreparedRefinementPublicationJournal,
  prepareRefinementPublicationJournal,
  refinementPublicationJournalName,
  refinementPublicationTransactionSha256,
} from '../../backend/services/refinement-publication-ledger.js';

const SOVEREIGN_DIR_MODE = 0o700;
const SOVEREIGN_FILE_MODE = 0o600;
const COMMIT = 'b'.repeat(40);
const TRAINED_AT = '2026-08-01T00:00:00.000Z';
const CONSUMED_AT = '2026-07-31T00:00:00.000Z';
const REGISTERED_AT = '2026-08-02T00:00:00.000Z';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (label) => sha256(`neuma.test.refinement.${label}`);
const requireDek = async (workspace, neumaId) => {
  const dek = await workspace.readNeumaDEK(neumaId);
  if (!Buffer.isBuffer(dek) || dek.length !== 32) {
    throw new Error('committed registry fixture requires the real per-neuma DEK');
  }
  return dek;
};

/** The real serving lineage tuple an adapter must be trained against. */
export const servingLineageFor = (servingModel) => {
  const baseArtifactSha256 = digest(`base ${servingModel}`);
  const tokenizerSha256 = digest(`tokenizer ${servingModel}`);
  return Object.freeze({
    baseArtifactSha256,
    baseModelIdentitySha256: refinementSha256({
      modelId: servingModel,
      modelArtifactSha256: baseArtifactSha256,
      tokenizerSha256,
    }),
    servingArtifactSha256: digest(`serving ${servingModel}`),
    servingModel,
    tokenizerSha256,
    trainerModelId: 'google/gemma-3-4b-it',
    trainerRevision: 'a'.repeat(40),
  });
};

const lineageSha256 = (lineage) => refinementSha256({
  servingModel: lineage.servingModel,
  servingArtifactSha256: lineage.servingArtifactSha256,
  trainerModelId: lineage.trainerModelId,
  trainerRevision: lineage.trainerRevision,
  baseArtifactSha256: lineage.baseArtifactSha256,
  tokenizerSha256: lineage.tokenizerSha256,
});

const EVENTS = Object.freeze({
  consentEventIndex: 1,
  consentEventRevision: 2,
  decisionEventIndex: 2,
  decisionEventRevision: 3,
  consumptionEventIndex: 3,
  consumptionEventRevision: 4,
});

const bindingFor = ({ adapterId, approvedScales: allowed, artifactSha256, ceremonyId, lineage, scale }) => {
  const one = digest(`binding ${adapterId}`);
  const approvedScales = refinementApprovedScales(allowed ?? [scale]);
  return {
    ...EVENTS,
    adapterArtifactSha256: artifactSha256,
    adapterId,
    adapterIdSha256: refinementSha256(adapterId),
    adapterScale: scale,
    approvedScales,
    approvedScalesSha256: refinementSha256(approvedScales),
    assentEvidenceId: digest(`assent id ${adapterId}`),
    assentEvidenceSha256: digest(`assent ${adapterId}`),
    baseArtifactSha256: lineage.baseArtifactSha256,
    baseModelIdentitySha256: lineage.baseModelIdentitySha256,
    ceremonyApprovalSha256: digest(`ceremony approval ${adapterId}`),
    ceremonyId,
    completionTokenProfileSha256: one,
    consentEventSha256: digest(`consent event ${adapterId}`),
    converterScriptSha256: one,
    curriculumSha256: one,
    executionEnvelopeSha256: one,
    geometrySha256: one,
    lineageConfigObjectId: 'c'.repeat(40),
    lineageConfigSha256: one,
    lineageConfigSourceCommit: COMMIT,
    lineageConfigSourceIdentitySha256: one,
    lineageConfigSourceMode: '100644',
    minimumCompletionTokens: 64,
    operationConfigSha256: one,
    operatorDecisionSha256: digest(`operator decision ${adapterId}`),
    participatoryAssentSha256: one,
    pythonExecutableSha256: one,
    servingArtifactSha256: lineage.servingArtifactSha256,
    servingLineageSha256: lineageSha256(lineage),
    snapshotManifestSha256: one,
    sourceAuthoritySha256: one,
    sourceCommit: COMMIT,
    sourceCommitSha256: refinementSha256(COMMIT),
    sourceCorpusSha256: one,
    sourceManifestSha256: one,
    targetTrainingBaseAuthoritySha256: one,
    tokenizerSha256: lineage.tokenizerSha256,
    trainerEnvironmentSha256: one,
    trainerExecutableSha256: one,
    trainerRequirementsSha256: one,
    trainingBudgetSha256: one,
    trainingConfigSha256: one,
    trainingPlanSha256: digest(`training plan ${adapterId}`),
  };
};

/** One production-validated registry adapter record for a subject. */
export const committedAdapterRecord = ({
  adapterId,
  approvedScales,
  artifactSha256,
  ceremonyId,
  custody,
  lineage,
  scale = 1,
}) => {
  const binding = bindingFor({
    adapterId, approvedScales, artifactSha256, ceremonyId, lineage, scale,
  });
  return validateRefinementAdapter({
    baseModel: lineage.servingModel,
    binding,
    custody,
    id: adapterId,
    provenance: {
      ceremonyId,
      consentAuthority: {
        assentEvidenceId: binding.assentEvidenceId,
        assentEvidenceSha256: binding.assentEvidenceSha256,
        ceremonyId,
        consentEventIndex: EVENTS.consentEventIndex,
        consentEventRevision: EVENTS.consentEventRevision,
        consentEventSha256: binding.consentEventSha256,
        issuanceRevision: 1,
        requestNonceSha256: digest(`nonce ${adapterId}`),
        supersedesConsentEventSha256: null,
      },
      servingLineage: lineage,
      trainedAt: TRAINED_AT,
      trainingPlanAuthority: {
        approvedScalesSha256: binding.approvedScalesSha256,
        ceremonyApprovalSha256: binding.ceremonyApprovalSha256,
        ceremonyId,
        consumedAt: CONSUMED_AT,
        consumptionEventIndex: EVENTS.consumptionEventIndex,
        consumptionEventRevision: EVENTS.consumptionEventRevision,
        decisionEventIndex: EVENTS.decisionEventIndex,
        decisionEventRevision: EVENTS.decisionEventRevision,
        expiresAt: '2026-09-01T00:00:00.000Z',
        issuedAt: '2026-07-30T00:00:00.000Z',
        operatorDecisionSha256: binding.operatorDecisionSha256,
        trainingPlanSha256: binding.trainingPlanSha256,
      },
    },
    registeredAt: REGISTERED_AT,
    scale,
    sha256: artifactSha256,
  });
};

const publicationIntent = ({ adapter, custodySha256, currentSelectionSha256 }) => ({
  action: 'REGISTER',
  adapterBindingSha256: refinementSha256(adapter.binding),
  adapterIdSha256: refinementAdapterIdSha256(adapter.id),
  adapterProvenanceSha256: refinementSha256(adapter.provenance),
  artifactBytes: 4096,
  artifactSha256: adapter.sha256,
  ceremonyApprovalSha256: adapter.binding.ceremonyApprovalSha256,
  ceremonyCandidateSha256: digest(`ceremony candidate ${adapter.id}`),
  ceremonyId: adapter.provenance.ceremonyId,
  ceremonyNextSha256: digest(`ceremony next ${adapter.id}`),
  ceremonyPriorSha256: digest(`ceremony prior ${adapter.id}`),
  ceremonyRevision: 1,
  consentAuthoritySha256: refinementSha256(adapter.provenance.consentAuthority),
  consentEventSha256: adapter.binding.consentEventSha256,
  custodySha256,
  lineageConfigObjectId: adapter.binding.lineageConfigObjectId,
  lineageConfigSha256: adapter.binding.lineageConfigSha256,
  lineageConfigSourceCommit: adapter.binding.lineageConfigSourceCommit,
  lineageConfigSourceIdentitySha256: adapter.binding.lineageConfigSourceIdentitySha256,
  lineageConfigSourceMode: adapter.binding.lineageConfigSourceMode,
  operatorDecisionSha256: adapter.binding.operatorDecisionSha256,
  priorRegistryEntrySha256: null,
  priorRegistrySha256: null,
  registeredAt: adapter.registeredAt,
  registryAppendRevision: 1,
  registryCurrentSelectionSha256: currentSelectionSha256,
  registryGeneration: 1,
  scaleAuthorityTokenSha256: null,
  selectedScale: adapter.binding.adapterScale,
  trainedAt: adapter.provenance.trainedAt,
  trainingConfigSha256: adapter.binding.trainingConfigSha256,
  trainingPlanAuthoritySha256: refinementSha256(adapter.provenance.trainingPlanAuthority),
  trainingPlanSha256: adapter.binding.trainingPlanSha256,
});

/** Seal one plain value into the being's own refinement directory. */
const sealInto = async (directory, name, value, dek) => {
  await fs.mkdir(directory, { recursive: true, mode: SOVEREIGN_DIR_MODE });
  await fs.chmod(directory, SOVEREIGN_DIR_MODE);
  await fs.writeFile(
    path.join(directory, name),
    JSON.stringify(encryptEnvelope(value, { key: dek })),
    { mode: SOVEREIGN_FILE_MODE },
  );
};

/**
 * Commit one first-generation registry publication for a real being.
 * @returns {Promise<{adapter: Object, registry: Object, journal: Object}>}
 */
export const commitFirstRefinementRegistration = async ({
  workspace,
  neumaId,
  adapterId,
  approvedScales,
  artifactSha256,
  ceremonyId,
  custody,
  lineage,
  scale = 1,
}) => {
  const dek = await requireDek(workspace, neumaId);
  const adapter = committedAdapterRecord({
    adapterId, approvedScales, artifactSha256, ceremonyId, custody, lineage, scale,
  });
  const currentSelectionSha256 = refinementRegistryCurrentSelectionSha256({
    adapterIdSha256: refinementAdapterIdSha256(adapter.id),
    artifactSha256: adapter.sha256,
  });
  const intent = publicationIntent({
    adapter,
    custodySha256: refinementSha256(custody),
    currentSelectionSha256,
  });
  const transactionSha256 = refinementPublicationTransactionSha256(intent);
  const registry = commitPreparedRefinementRegistry(
    prepareRefinementAdapterRegistration(null, adapter, transactionSha256),
    transactionSha256,
  );
  const journal = commitPreparedRefinementPublicationJournal(
    prepareRefinementPublicationJournal({
      intent, registrySha256: registry.registrySha256,
    }),
  );
  const directory = path.join(workspace.pathFor(neumaId), 'refinement');
  await sealInto(directory, 'adapters.json', registry, dek);
  await sealInto(
    directory,
    refinementPublicationJournalName({ action: 'REGISTER', ceremonyId }),
    journal,
    dek,
  );
  return Object.freeze({ adapter, registry, journal });
};

/**
 * Append one REAL committed scale selection — the being's own dial turned to an
 * approved scale below its ceiling. This is the only way `selectedScale` and the
 * immutable `scale` diverge, which is what proves which one rides the wire.
 * @returns {Promise<{registry: Object, journal: Object, selectedScale: number}>}
 */
export const commitRefinementScaleSelection = async ({
  workspace,
  neumaId,
  registry: current,
  adapter,
  custody,
  scale,
}) => {
  const dek = await requireDek(workspace, neumaId);
  const currentSelectionSha256 = refinementRegistryCurrentSelectionSha256({
    adapterIdSha256: refinementAdapterIdSha256(adapter.id),
    artifactSha256: adapter.sha256,
  });
  const intent = {
    ...publicationIntent({
      adapter, custodySha256: refinementSha256(custody), currentSelectionSha256,
    }),
    action: 'SELECT',
    priorRegistryEntrySha256: current.entries.at(-1).entrySha256,
    priorRegistrySha256: current.registrySha256,
    registryAppendRevision: current.appendRevision + 1,
    registryGeneration: current.generation + 1,
    scaleAuthorityTokenSha256: digest(`scale authority ${adapter.id} ${scale}`),
    selectedScale: scale,
  };
  const transactionSha256 = refinementPublicationTransactionSha256(intent);
  const registry = commitPreparedRefinementRegistry(
    prepareRefinementAdapterSelection(current, adapter.id, scale, transactionSha256),
    transactionSha256,
  );
  const journal = commitPreparedRefinementPublicationJournal(
    prepareRefinementPublicationJournal({
      intent, registrySha256: registry.registrySha256,
    }),
  );
  const directory = path.join(workspace.pathFor(neumaId), 'refinement');
  await sealInto(directory, 'adapters.json', registry, dek);
  await sealInto(
    directory,
    refinementPublicationJournalName({ action: 'SELECT', transactionSha256 }),
    journal,
    dek,
  );
  return Object.freeze({ registry, journal, selectedScale: registry.selectedScale });
};

/**
 * Flip one ciphertext byte of a committed registry. The envelope stays
 * well-formed, so nothing short of the real AES-GCM tag check can notice — this
 * is a registry that exists and cannot be authenticated, which is exactly the
 * state that must never be reported as […].
 */
export const corruptCommittedRefinementRegistry = async (workspace, neumaId) => {
  const filePath = path.join(workspace.pathFor(neumaId), 'refinement', 'adapters.json');
  const envelope = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const tampered = Buffer.from(String(envelope.ct ?? ''), 'base64');
  if (!tampered.length) throw new Error('registry envelope carries no ciphertext to tamper with');
  tampered[0] ^= 0xff;
  await fs.writeFile(
    filePath,
    JSON.stringify({ ...envelope, ct: tampered.toString('base64') }),
    { mode: SOVEREIGN_FILE_MODE },
  );
  return filePath;
};
