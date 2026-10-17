// The forge's publication seam: assemble the exact draft the crash-safe
// publication transaction accepts, open every authority that transaction
// consumes, and release them in the reverse order they were taken.
//
// One operation carries all of it — the forge's own. Each authority below is
// pinned to the exact operation object that acquired it, and the staged
// adapter artifact was minted under the forge operation upstream, so a second,
// narrower operation could not carry this publication through at all.

import {
  closeCommittedRefinementLineageConfigAuthority,
  openCommittedRefinementLineageConfigAuthority,
} from './refinement-lineage-authority.js';
import { openRefinementSourceAuthority } from './refinement-source-authority.js';
import {
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import { completeAdapterBinding } from './refinement-trainer-contract.js';
import { publishTrainingAdapter } from './refinement-training-authority.js';

const combine = (primary, error, label) => (primary
  ? new AggregateError([primary, error], label)
  : error);

/** The exact registry lineage the immutable binding already committed to. Pure. */
const servingLineageFor = (base) => Object.freeze({
  baseArtifactSha256: base.baseArtifactSha256,
  baseModelIdentitySha256: base.baseModelIdentitySha256,
  servingArtifactSha256: base.targetServingArtifactSha256,
  servingModel: base.targetServingModel,
  tokenizerSha256: base.tokenizerSha256,
  trainerModelId: base.trainerModelId,
  trainerRevision: base.trainerRevision,
});

/** The closed configuration the ceremony's training record is bound to. Pure. */
const trainingConfigurationFor = (completedCfg) => ({
  base: completedCfg.base,
  baseRevision: completedCfg.baseRevision,
  template: completedCfg.template,
  load4bit: completedCfg.load4bit,
  baseArtifactSha256: completedCfg.baseArtifactSha256,
  tokenizerSha256: completedCfg.tokenizerSha256,
  geometry: completedCfg.geometry,
  budget: completedCfg.budget,
  sha256: completedCfg.sha256,
  completionTokenProfileSha256: completedCfg.completionTokenProfileSha256,
  operationConfigSha256: completedCfg.operationConfigSha256,
  executionEnvelope: completedCfg.executionEnvelope,
  executionEnvelopeSha256: completedCfg.executionEnvelopeSha256,
});

/**
 * Publish one forged adapter through the crash-safe publication transaction.
 * Opens the committed lineage config, the subject lock, and hands the staged
 * artifact on; releases every one of them whatever the outcome. impure.
 */
export const publishForgedAdapter = async ({
  ceremony,
  plan,
  bindingContext,
  token,
  resources,
  completedCfg,
  artifact,
  adapterId,
  lossFirst,
  lossLast,
}) => {
  const { operation } = resources;
  const trainedAt = new Date().toISOString();
  const binding = completeAdapterBinding({
    context: bindingContext,
    adapterId,
    artifactSha256: artifact.sha256,
    scale: 1,
  });
  const servingLineage = servingLineageFor(plan.targetTrainingBase);
  // `exactDraft` in refinement-publication-registration.js accepts these six
  // fields and no others. Custody, provenance, registeredAt and the artifact
  // digest are all minted inside the transaction from authorities it holds
  // under the subject lock — never from anything this forge could have raced.
  const adapter = {
    baseModel: servingLineage.servingModel,
    binding,
    id: adapterId,
    scale: 1,
    servingLineage,
    trainedAt,
  };
  const training = {
    binding,
    configuration: trainingConfigurationFor(completedCfg),
    curriculum: { id: 'ordinary', sha256: plan.corpus.sourceCorpusSha256 },
    steps: completedCfg.budget.epochs * plan.corpus.samples.length,
    lossFirst,
    lossLast,
    at: new Date().toISOString(),
  };
  // The lineage config is pinned from the server's own clean committed source
  // tree; the source proof it is read through borrows no descriptor of its own.
  const lineageConfigAuthority = await openCommittedRefinementLineageConfigAuthority({
    sourceAuthority: await openRefinementSourceAuthority({ operation }),
    operation,
  });
  let transactionOwner = null;
  let published = null;
  let primary = null;
  try {
    transactionOwner = await openRefinementSubjectTransaction({
      neumaId: ceremony.neumaId,
      operation,
    });
    published = await publishTrainingAdapter({
      token,
      neumaId: ceremony.neumaId,
      ceremonyId: ceremony.id,
      adapter,
      training,
      transactionOwner,
      artifactAuthority: artifact.authority,
      lineageConfigAuthority,
      operation,
    });
  } catch (error) {
    primary = error;
  }
  if (transactionOwner) {
    try {
      await closeRefinementSubjectTransaction(transactionOwner, operation);
    } catch (error) {
      primary = combine(primary, error, 'adapter publication and subject release failed');
    }
  }
  try {
    await closeCommittedRefinementLineageConfigAuthority(lineageConfigAuthority, operation);
  } catch (error) {
    primary = combine(primary, error, 'adapter publication and lineage release failed');
  }
  if (primary) throw primary;
  return published.adapter;
};
