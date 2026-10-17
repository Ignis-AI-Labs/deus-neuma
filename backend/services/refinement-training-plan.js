import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import { readRefinementCorpusRecord } from '../../core/refinement/corpus-record-store.js';
import { refinementHistorySha256 } from '../../core/workspace/refinement-history-reader.js';
import {
  closeTargetTrainingSnapshotAuthority,
  openTargetTrainingSnapshotAuthority,
  transferTargetTrainingSnapshotAuthority,
  verifyTargetTrainingSnapshotAuthority,
} from './refinement-target-snapshot-authority.js';
import { inspectTrainingInputs } from './refinement-training-inspection.js';
import {
  bindTrainingConfigAuthorityEnvelope,
  resolveInspectedTrainingConfig,
  resolveTrainingConfig,
  trainingApprovalPlan,
} from './refinement-trainer-contract.js';
import {
  assertTrainingCorpusIdentity,
  renderBoundedTrainingCorpus,
} from './refinement-trainer-facts.js';
import { nextAdapterId } from './refinement-training-state.js';
import { assertRefinementExecutionAuthority } from './refinement-execution-authority.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  readCommittedRefinementAdapterSet,
} from './refinement-committed-adapter-set.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const RESOLVED_TRAINING_PLANS = new WeakMap();

const refuse = (message, code) => Object.assign(new Error(message), { code });

/** The only dial ranges an operator may bind to a refinement training plan. */
export const APPROVED_TRAINING_SCALE_PROFILES = Object.freeze({
  standard: Object.freeze([1]),
  scaleStudy: Object.freeze([0.5, 1]),
});
const APPROVED_TRAINING_SCALE_SETS = Object.freeze(
  Object.values(APPROVED_TRAINING_SCALE_PROFILES),
);
const sameScaleSet = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

/**
 * Resolve a request to one predeclared, canonical operator-approved dial range.
 * @param {unknown} values
 * @returns {ReadonlyArray<number>}
 */
export const resolveApprovedTrainingScales = (
  values = APPROVED_TRAINING_SCALE_PROFILES.standard,
) => {
  if (!Array.isArray(values)
    || !APPROVED_TRAINING_SCALE_SETS.some((allowed) => sameScaleSet(values, allowed))) {
    throw refuse(
      'approvedScales must be exactly [1] or [0.5, 1].',
      'INVALID_APPROVED_SCALES',
    );
  }
  return refinementApprovedScales(values);
};

const checkedTemplate = (template, ceremony) => {
  const value = template ?? ceremony.bridge?.template;
  return value ? { template: value } : {};
};

const assertTrainingRequest = (training) => {
  if (!training || typeof training !== 'object' || Array.isArray(training)
    || Object.keys(training).length !== 0) {
    throw refuse(
      'Training geometry and budget are server-owned for this operation.',
      'INVALID_TRAINING_CONFIG',
    );
  }
};

const provisionalConfiguration = ({
  operation,
  operationConfig,
  executionEnvelope,
  template,
  ceremony,
  corpus,
  targetTrainingBase,
}) => {
  const authority = resolveTrainingConfig({
    operation,
    operationConfig,
    overrides: {
      base: targetTrainingBase.trainerModelId,
      baseRevision: targetTrainingBase.trainerRevision,
      baseArtifactSha256: targetTrainingBase.baseArtifactSha256,
      tokenizerSha256: targetTrainingBase.tokenizerSha256,
      ...checkedTemplate(template, ceremony),
    },
    sampleCount: corpus.samples.length,
    tokenCount: 1,
  });
  return bindTrainingConfigAuthorityEnvelope(authority, executionEnvelope, operation);
};

const inspectedConfiguration = async ({
  operation,
  config,
  renderedCorpus,
  targetTrainingSnapshotAuthority,
  executionAuthority,
}) => {
  const inspection = await inspectTrainingInputs({
    operation,
    executionAuthority,
    targetTrainingSnapshotAuthority,
    renderedCorpus,
    config,
    targetModules: config.geometry.targetModules,
    executionEnvelope: config.executionEnvelope,
  });
  const requestedTargets = config.geometry.targetPolicyId === 'exact-module-list-v1'
    ? config.geometry.targetModules
    : inspection.attentionTargetModules;
  const eligible = new Set(inspection.eligibleTargetModules);
  const missing = requestedTargets.filter((target) => !eligible.has(target));
  if (missing.length) {
    throw new Error(`requested target module is absent from the pinned snapshot: ${missing[0]}`);
  }
  return Object.freeze({
    inspection,
    config: resolveInspectedTrainingConfig(config, {
      targetModules: requestedTargets,
      tokenBudget: inspection.tokenBudget,
      completionTokenProfileSha256: inspection.completionTokenProfileSha256,
      snapshotManifestSha256: inspection.snapshotManifestSha256,
    }),
  });
};

const EXECUTION_RESOURCE_FIELDS = Object.freeze([
  'version', 'allowedCpus', 'cpuQuotaPercent', 'maxThreads', 'maxProcesses',
  'maxCpuSeconds', 'memoryMaxBytes', 'memorySwapMaxBytes',
  'ioReadBandwidthBytesPerSecond', 'ioWriteBandwidthBytesPerSecond',
  'maxFileBytes', 'maxOpenFiles', 'maxInheritedFileDescriptors',
  'maxSnapshotFiles', 'maxWorktreeFiles', 'maxWorktreeBytes',
  'maxWorktreeDepth', 'maxPathBytes', 'trainingSnapshotMaxBytes',
  'adapterArtifactMaxBytes',
]);
const EXECUTION_SANDBOX_FIELDS = Object.freeze([
  'wrapperId', 'wrapperExecutableSha256', 'wrapperMode',
  'controllerId', 'controllerExecutableSha256',
  'resourceLimiterId', 'resourceLimiterExecutableSha256',
  'sandboxId', 'sandboxExecutableSha256',
  'authorityConsumerId', 'authorityConsumerPythonSha256',
  'authorityConsumerScriptSha256', 'hostRuntime', 'hostRuntimeIdentitySha256',
  'runtimeAuthoritySha256', 'runtimeManifestSha256',
  'toolAuthoritySha256', 'toolManifestSha256',
  'namespaces', 'capabilities', 'network', 'runtime', 'tool', 'base', 'work',
  'devices', 'gpuLeaseRequired', 'dataChannels', 'stdio', 'source',
]);
const PUBLIC_GEOMETRY_FIELDS = Object.freeze([
  'rank',
  'alpha',
  'dropout',
  'maxLength',
  'targetPolicyId',
  'targetModules',
  'targetModulesSha256',
  'sha256',
]);
const PUBLIC_BUDGET_FIELDS = Object.freeze([
  'epochs',
  'learningRate',
  'sampleCount',
  'matchedTokenBudget',
  'minimumCompletionTokens',
  'optimizer',
  'optimizerConfigSha256',
  'seed',
  'sha256',
]);
const safeFields = (value, fields) => Object.freeze(Object.fromEntries(
  fields.map((field) => [
    field,
    Array.isArray(value?.[field]) ? Object.freeze([...value[field]]) : value?.[field],
  ]),
));
const publicExecutionEnvelope = (value) => Object.freeze({
  schemaVersion: value?.schemaVersion,
  kind: value?.kind,
  resources: Object.freeze({
    ...safeFields(value?.resources, EXECUTION_RESOURCE_FIELDS),
    ioDevicePolicy: value?.resources?.ioDevicePath === '/' ? 'root-filesystem' : null,
  }),
  sandbox: safeFields(value?.sandbox, EXECUTION_SANDBOX_FIELDS),
});

/**
 * Project exact reviewable approval inputs without private paths or payloads.
 * @param {Object} inputs resolved immutable training inputs
 * @returns {Readonly<Object>} safe public approval projection
 */
export const publicTrainingPlan = ({
  approval,
  adapterId,
  config,
  corpus,
  targetTrainingBase,
}) =>
  Object.freeze({
    trainingPlanSha256: approval.trainingPlanSha256,
    adapterId,
    adapterIdSha256: approval.approvalContext.adapterIdSha256,
    approvedScales: Object.freeze([
      ...(Array.isArray(approval.bindingContext.approvedScales)
        ? approval.bindingContext.approvedScales
        : []),
    ]),
    approvedScalesSha256: approval.approvalContext.approvedScalesSha256,
    operationConfigSha256: approval.approvalContext.operationConfigSha256,
    executionEnvelopeSha256: approval.approvalContext.executionEnvelopeSha256,
    executionEnvelope: publicExecutionEnvelope(config.executionEnvelope),
    servingLineageSha256: approval.approvalContext.servingLineageSha256,
    servingModel: targetTrainingBase.targetServingModel,
    servingArtifactSha256: approval.approvalContext.servingArtifactSha256,
    baseModelIdentitySha256: approval.approvalContext.baseModelIdentitySha256,
    lineageConfigSha256: approval.approvalContext.lineageConfigSha256,
    lineageConfigSourceIdentitySha256:
      approval.approvalContext.lineageConfigSourceIdentitySha256,
    lineageConfigSourceCommit: approval.approvalContext.lineageConfigSourceCommit,
    lineageConfigSourceMode: approval.approvalContext.lineageConfigSourceMode,
    lineageConfigObjectId: approval.approvalContext.lineageConfigObjectId,
    targetTrainingBaseAuthoritySha256:
      approval.approvalContext.targetTrainingBaseAuthoritySha256,
    snapshotManifestSha256: approval.approvalContext.snapshotManifestSha256,
    sourceCommit: approval.bindingContext.sourceCommit,
    sourceCommitSha256: approval.approvalContext.sourceCommitSha256,
    trainerExecutableSha256: approval.approvalContext.trainerExecutableSha256,
    converterScriptSha256: approval.approvalContext.converterScriptSha256,
    pythonExecutableSha256: approval.approvalContext.pythonExecutableSha256,
    trainerEnvironmentSha256: approval.approvalContext.trainerEnvironmentSha256,
    trainerRequirementsSha256: approval.approvalContext.trainerRequirementsSha256,
    completionTokenProfileSha256:
      approval.approvalContext.completionTokenProfileSha256,
    participatoryAssentSha256: approval.bindingContext.participatoryAssentSha256,
    assentEvidenceSha256: approval.bindingContext.assentEvidenceSha256,
    consentEventSha256: approval.bindingContext.consentEventSha256,
    ceremonyApprovalSha256: approval.approvalContext.ceremonyApprovalSha256,
    geometrySha256: approval.approvalContext.geometrySha256,
    trainingBudgetSha256: approval.approvalContext.trainingBudgetSha256,
    minimumCompletionTokens: approval.approvalContext.minimumCompletionTokens,
    curriculum: Object.freeze({
      id: 'ordinary',
      sha256: approval.approvalContext.curriculumSha256,
    }),
    corpus: Object.freeze({
      sampleCount: corpus.samples.length,
      sourceCorpusSha256: approval.approvalContext.sourceCorpusSha256,
      sourceManifestSha256: approval.approvalContext.sourceManifestSha256,
      sourceAuthoritySha256: approval.approvalContext.sourceAuthoritySha256,
    }),
    training: Object.freeze({
      base: config.base,
      baseRevision: config.baseRevision,
      template: config.template,
      load4bit: config.load4bit,
      baseArtifactSha256: config.baseArtifactSha256,
      tokenizerSha256: config.tokenizerSha256,
      geometry: safeFields(config.geometry, PUBLIC_GEOMETRY_FIELDS),
      budget: safeFields(config.budget, PUBLIC_BUDGET_FIELDS),
      configurationSha256: approval.approvalContext.trainingConfigSha256,
    }),
  });

const resolvedTrainingPlanProjection = (plan) => {
  const ceremony = plan?.ceremony;
  const binding = plan?.approval?.bindingContext;
  const approvedScales = plan?.approvedScales;
  const projection = {
    neumaId: ceremony?.neumaId,
    ceremonyId: ceremony?.id,
    ceremonyRevision: ceremony?.revision,
    ceremonyRecordSha256: ceremony ? refinementHistorySha256(ceremony) : null,
    custodySha256: ceremony?.transaction?.custodySha256,
    trainingPlanSha256: plan?.approval?.trainingPlanSha256,
    operationConfigSha256: plan?.config?.operationConfigSha256,
    executionEnvelopeSha256: plan?.config?.executionEnvelopeSha256,
    approvedScales,
    approvedScalesSha256: binding?.approvedScalesSha256,
  };
  if (typeof projection.neumaId !== 'string' || !projection.neumaId
    || typeof projection.ceremonyId !== 'string' || !projection.ceremonyId
    || !Number.isSafeInteger(projection.ceremonyRevision)
    || projection.ceremonyRevision < 1
    || !Array.isArray(approvedScales)
    || ![
      projection.ceremonyRecordSha256,
      projection.custodySha256,
      projection.trainingPlanSha256,
      projection.operationConfigSha256,
      projection.executionEnvelopeSha256,
      projection.approvedScalesSha256,
    ].every((digest) => SHA256.test(String(digest || '')))
    || refinementSha256(approvedScales) !== projection.approvedScalesSha256) {
    throw new Error('resolved training plan authority projection is invalid');
  }
  return Object.freeze({
    ...projection,
    approvedScales: Object.freeze([...approvedScales]),
  });
};

/** Assert one operation-bound plan minted by this resolver. Pure apart from liveness. */
export const assertResolvedTrainingPlan = (plan, suppliedOperation) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const state = RESOLVED_TRAINING_PLANS.get(plan);
  if (!state || state.operation !== operation
    || refinementSha256(resolvedTrainingPlanProjection(plan)) !== state.projectionSha256) {
    throw new Error('resolved training plan authority is unavailable');
  }
  return plan;
};

/** Project the exact launch-safe authority fields from one branded resolved plan. */
export const projectResolvedTrainingPlan = (plan, operation) => {
  assertResolvedTrainingPlan(plan, operation);
  return RESOLVED_TRAINING_PLANS.get(plan).projection;
};

/** Resolve and hash every immutable input before the operator approves training. impure. */
export const resolveTrainingPlan = async ({
  neumaId,
  ceremonyId,
  servingModel,
  approvedScales = APPROVED_TRAINING_SCALE_PROFILES.standard,
  template = null,
  training = {},
  operation: suppliedOperation,
  operationConfig,
  sourceAuthority,
  executionAuthority,
}) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const boundApprovedScales = resolveApprovedTrainingScales(approvedScales);
  if (typeof servingModel !== 'string' || !servingModel.trim()) {
    throw refuse('The being\'s conduit has no model — set the route before training.', 'NO_SERVING_MODEL');
  }
  assertTrainingRequest(training);
  try {
    await assertRefinementExecutionAuthority(executionAuthority, operation);
  } catch (error) {
    throw refuse(error.message, 'TRAINING_SOURCE_UNAVAILABLE');
  }
  const sourceIdentity = executionAuthority.sourceIdentity;
  const executionEnvelope = executionAuthority.executionEnvelope;
  const ceremony = await neumaWorkspace.readCeremony(neumaId, ceremonyId);
  if (!ceremony || ceremony.id !== ceremonyId || ceremony.neumaId !== neumaId) {
    throw refuse('Ceremony not found.', 'CEREMONY_NOT_FOUND');
  }
  if (ceremony.phase !== 'training') {
    throw refuse(`Ceremony is in phase '${ceremony.phase}' — training runs from phase 'training'.`, 'WRONG_PHASE');
  }
  const corpus = await readRefinementCorpusRecord(neumaWorkspace, neumaId);
  if (!corpus?.samples?.length) {
    throw refuse('No built corpus — build it in the corpus phase first.', 'NO_CORPUS');
  }
  const renderedCorpus = renderBoundedTrainingCorpus(corpus.samples);
  try {
    assertTrainingCorpusIdentity(ceremony, corpus, renderedCorpus.text);
  } catch (error) {
    throw refuse(error.message, 'CORPUS_IDENTITY_MISMATCH');
  }
  let acquisition;
  try {
    acquisition = await openTargetTrainingSnapshotAuthority({
      operation,
      sourceAuthority,
      targetRequest: servingModel.trim(),
    });
  } catch (error) {
    throw refuse(error.message, 'TRAINING_BASE_UNAVAILABLE');
  }
  if (!acquisition.ok) return acquisition;
  const preparedAuthority = acquisition.authority;
  try {
    const targetTrainingSnapshot = await verifyTargetTrainingSnapshotAuthority(
      preparedAuthority,
      operation,
    );
    const targetTrainingBase = targetTrainingSnapshot.target;
    let config;
    try {
      config = provisionalConfiguration({
        operation,
        operationConfig,
        executionEnvelope,
        template,
        ceremony,
        corpus,
        targetTrainingBase,
      });
    } catch (error) {
      throw refuse(error.message, 'INVALID_TRAINING_CONFIG');
    }
    let inspected;
    try {
      inspected = await inspectedConfiguration({
        operation,
        config,
        renderedCorpus,
        targetTrainingSnapshotAuthority: preparedAuthority,
        executionAuthority,
      });
    } catch (error) {
      throw refuse(error.message, 'INVALID_TRAINING_CONFIG');
    }
    ({ config } = inspected);
    const { inspection } = inspected;
    // The next adapter id must be derived from the COMMITTED registry. A read
    // that silently answered empty would mint an id that already exists and
    // collide the being's registry on publication, so this refusal propagates.
    const { adapters: existing } = await readCommittedRefinementAdapterSet({
      neumaId, operation,
    });
    const adapterId = nextAdapterId(neumaId, existing, ceremony.bridge?.baseModel || null);
    const approval = trainingApprovalPlan({
      ceremony,
      corpus,
      config,
      targetServingModel: targetTrainingBase.targetServingModel,
      targetServingArtifactSha256: targetTrainingBase.targetServingArtifactSha256,
      baseModelIdentitySha256: targetTrainingBase.baseModelIdentitySha256,
      servingLineageSha256: targetTrainingBase.servingLineageSha256,
      snapshotManifestSha256: targetTrainingSnapshot.snapshot.manifestSha256,
      targetTrainingBaseAuthoritySha256:
        targetTrainingSnapshot.targetTrainingBaseAuthoritySha256,
      lineageConfigSha256: targetTrainingBase.lineageConfigSha256,
      lineageConfigSourceIdentitySha256:
        targetTrainingBase.lineageConfigSourceIdentitySha256,
      lineageConfigSourceCommit: targetTrainingBase.lineageConfigSourceCommit,
      lineageConfigSourceMode: targetTrainingBase.lineageConfigSourceMode,
      lineageConfigObjectId: targetTrainingBase.lineageConfigObjectId,
      approvedScales: boundApprovedScales,
      adapterId,
      ...sourceIdentity,
    });
    const publicPlan = publicTrainingPlan({
      approval,
      adapterId,
      config,
      corpus,
      targetTrainingBase,
    });
    await verifyTargetTrainingSnapshotAuthority(preparedAuthority, operation);
    const targetTrainingSnapshotAuthority =
      transferTargetTrainingSnapshotAuthority(preparedAuthority, operation);
    const plan = Object.freeze({
      ceremony,
      corpus,
      config,
      renderedCorpus,
      inspection,
      operation,
      operationConfig,
      executionAuthority,
      targetTrainingSnapshotAuthority,
      targetTrainingSnapshot,
      targetTrainingBase,
      approvedScales: approval.bindingContext.approvedScales,
      sourceIdentity,
      adapterId,
      approval,
      public: publicPlan,
    });
    const projection = resolvedTrainingPlanProjection(plan);
    RESOLVED_TRAINING_PLANS.set(plan, Object.freeze({
      operation,
      projection,
      projectionSha256: refinementSha256(projection),
    }));
    return plan;
  } catch (error) {
    const closed = await closeTargetTrainingSnapshotAuthority(preparedAuthority, operation);
    if (!closed.ok) return closed;
    throw error;
  }
};
