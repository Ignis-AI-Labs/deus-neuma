// Pure trainer configuration, approval-plan, and completed binding contract.

import {
  refinementApprovedScales,
  refinementBudget,
  refinementGeometry,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import {
  refinementBinding,
  refinementTrainingPlanSha256,
  refinementTrainingConfiguration,
  validateRefinementExecutionEnvelope,
} from '../../core/refinement/training-authority-contract.js';
import {
  refinementConsentAuthority,
  refinementTrainingPlanAuthority,
} from '../../core/refinement/ceremony.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
const SHA256 = /^[0-9a-f]{64}$/;
const TRAINING_OVERRIDE_FIELDS = new Set([
  'alpha', 'base', 'baseRevision', 'baseArtifactSha256', 'dropout', 'epochs',
  'learningRate', 'load4bit', 'matchedTokenBudget', 'maxLength', 'optimizer',
  'rank', 'seed', 'targetModules', 'targetPolicyId', 'template', 'tokenizerSha256',
]);
const TRAINING_CONFIG_AUTHORITIES = new WeakMap();

const envNumber = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return Number(value);
};

const envTargets = (value) => value == null || value.trim() === ''
  ? undefined
  : value.split(',').map((target) => target.trim()).filter(Boolean);

/** Resolve and brand one server-owned forge configuration before envelope binding. Impure. */
export const resolveTrainingConfig = ({
  overrides = {},
  operationConfig,
  operation: suppliedOperation,
  sampleCount,
  tokenCount,
}) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const env = operationConfig?.environment;
  if (!env || !SHA256.test(String(operationConfig?.sha256 || ''))) {
    throw new Error('training operation configuration is required');
  }
  const unknown = Object.keys(overrides).filter((field) => !TRAINING_OVERRIDE_FIELDS.has(field));
  if (unknown.length) throw new Error(`unknown training fields: ${unknown.join(', ')}`);
  const rank = overrides.rank ?? envNumber(env.NEUMA_REFINEMENT_RANK, 8);
  const geometry = refinementGeometry({
    rank,
    alpha: overrides.alpha ?? envNumber(env.NEUMA_REFINEMENT_ALPHA, rank * 2),
    dropout: overrides.dropout ?? envNumber(env.NEUMA_REFINEMENT_DROPOUT, 0),
    maxLength: overrides.maxLength ?? envNumber(env.NEUMA_REFINEMENT_MAX_LENGTH, 2048),
    targetPolicyId: overrides.targetPolicyId ?? env.NEUMA_REFINEMENT_TARGET_POLICY,
    targetModules: overrides.targetModules ?? envTargets(env.NEUMA_REFINEMENT_TARGET_MODULES),
  });
  const budget = refinementBudget({
    epochs: overrides.epochs ?? envNumber(env.NEUMA_REFINEMENT_EPOCHS, 3),
    learningRate: overrides.learningRate ?? envNumber(env.NEUMA_REFINEMENT_LR, 1e-4),
    sampleCount,
    matchedTokenBudget: overrides.matchedTokenBudget ?? tokenCount,
    minimumCompletionTokens: 8,
    optimizer: overrides.optimizer ?? env.NEUMA_REFINEMENT_OPTIMIZER,
    seed: overrides.seed ?? envNumber(env.NEUMA_REFINEMENT_SEED, 1),
  });
  if (budget.minimumCompletionTokens >= geometry.maxLength) {
    throw new Error('maxLength must leave room for the approved completion minimum and its prefix');
  }
  const base = overrides.base || env.NEUMA_REFINEMENT_BASE || 'google/gemma-4-31b-it';
  const baseRevision = overrides.baseRevision || env.NEUMA_REFINEMENT_BASE_REVISION;
  const template = overrides.template || env.NEUMA_REFINEMENT_TEMPLATE || 'gemma-channel';
  const load4bit = overrides.load4bit ?? env.NEUMA_REFINEMENT_4BIT !== '0';
  if (typeof base !== 'string' || !base.trim() || base.length > 256
    || /[\u0000-\u001f\u007f]/u.test(base)
    || !/^[0-9a-f]{7,64}$/.test(String(baseRevision || ''))
    || !['gemma-channel', 'chat'].includes(template)
    || typeof load4bit !== 'boolean') {
    throw new Error('training base, revision, template, or quantization is invalid');
  }
  const baseArtifactSha256 = overrides.baseArtifactSha256
    || env.NEUMA_REFINEMENT_BASE_ARTIFACT_SHA256 || null;
  const tokenizerSha256 = overrides.tokenizerSha256
    || env.NEUMA_REFINEMENT_TOKENIZER_SHA256 || null;
  for (const [field, value] of Object.entries({ baseArtifactSha256, tokenizerSha256 })) {
    if (!SHA256.test(String(value || ''))) throw new Error(`${field} must be sha256`);
  }
  const authority = Object.freeze({
    kind: 'resolved-refinement-training-config-authority-v1',
    base: base.trim(),
    baseRevision,
    template,
    load4bit,
    baseArtifactSha256,
    tokenizerSha256,
    operationConfigSha256: operationConfig.sha256,
    geometry,
    budget,
  });
  TRAINING_CONFIG_AUTHORITIES.set(authority, {
    operation,
    boundConfig: null,
  });
  return authority;
};
const assertTrainingConfigAuthority = (authority, suppliedOperation) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const state = TRAINING_CONFIG_AUTHORITIES.get(authority);
  if (!state || state.operation !== operation) {
    throw new Error('resolved training config authority is unavailable');
  }
  return authority;
};
/** Irreversibly attach the envelope derived from this exact config authority. Impure. */
export const bindTrainingConfigAuthorityEnvelope = (
  authority,
  executionEnvelope,
  suppliedOperation,
) => {
  const checked = assertTrainingConfigAuthority(authority, suppliedOperation);
  const state = TRAINING_CONFIG_AUTHORITIES.get(checked);
  if (state.boundConfig) throw new Error('resolved training config authority is already bound');
  const envelope = validateRefinementExecutionEnvelope(executionEnvelope);
  if (envelope.environment.PYTHONHASHSEED !== String(checked.budget.seed)) {
    throw new Error('execution envelope seed differs from resolved training config');
  }
  const bound = Object.freeze({
    ...checked,
    executionEnvelope: envelope,
    executionEnvelopeSha256: envelope.sha256,
  });
  state.boundConfig = bound;
  TRAINING_CONFIG_AUTHORITIES.set(bound, state);
  return bound;
};

/** Copy only sandbox-inspected facts into the already-resolved operation configuration. Pure. */
export const resolveInspectedTrainingConfig = (
  config,
  {
    targetModules,
    tokenBudget,
    completionTokenProfileSha256,
    snapshotManifestSha256,
  },
) => {
  const authorityState = TRAINING_CONFIG_AUTHORITIES.get(config);
  if (!authorityState || authorityState.boundConfig !== config) {
    throw new Error('inspection requires a bound training config authority');
  }
  if (!SHA256.test(String(snapshotManifestSha256 || ''))) {
    throw new Error('inspection requires the exact loaded snapshot manifest digest');
  }
  const geometry = refinementGeometry({ ...config.geometry, targetModules });
  const budget = refinementBudget({ ...config.budget, matchedTokenBudget: tokenBudget });
  const publicConfig = refinementTrainingConfiguration({
    base: config.base,
    baseRevision: config.baseRevision,
    template: config.template,
    load4bit: config.load4bit,
    baseArtifactSha256: config.baseArtifactSha256,
    tokenizerSha256: config.tokenizerSha256,
    completionTokenProfileSha256,
    operationConfigSha256: config.operationConfigSha256,
    executionEnvelope: config.executionEnvelope,
    executionEnvelopeSha256: config.executionEnvelopeSha256,
    geometry,
    budget,
  });
  return Object.freeze({ snapshotManifestSha256, ...publicConfig });
};
/** Confirm that the trainer executed the exact pre-approved configuration. Pure. */
export const resolveCompletedTrainingConfig = (
  config,
  {
    targetModules,
    tokenBudget,
    load4bitApplied,
    completionTokenProfileSha256,
    snapshotManifestSha256,
  },
) => {
  const measuredGeometry = refinementGeometry({
    ...config.geometry,
    targetModules,
  });
  if (measuredGeometry.sha256 !== config.geometry.sha256) {
    throw new Error('trainer target modules differ from the approved geometry');
  }
  if (tokenBudget !== config.budget.matchedTokenBudget) {
    throw new Error('trainer token budget differs from the approved budget');
  }
  if (load4bitApplied !== config.load4bit) {
    throw new Error('trainer quantization differs from the approved configuration');
  }
  if (completionTokenProfileSha256 !== config.completionTokenProfileSha256) {
    throw new Error('trainer completion-token profile differs from approved inspection');
  }
  if (snapshotManifestSha256 !== config.snapshotManifestSha256) {
    throw new Error('trainer snapshot manifest differs from approved inspection');
  }
  return config;
};

/** Resolve every digest an operator must approve before the forge may start. Pure. */
export const trainingApprovalPlan = ({
  ceremony,
  corpus,
  config,
  targetServingModel,
  targetServingArtifactSha256,
  baseModelIdentitySha256,
  servingLineageSha256,
  snapshotManifestSha256,
  targetTrainingBaseAuthoritySha256,
  lineageConfigSha256,
  lineageConfigSourceIdentitySha256,
  lineageConfigSourceCommit,
  lineageConfigSourceMode,
  lineageConfigObjectId,
  approvedScales = [1],
  curriculumSha256 = corpus?.sourceCorpusSha256,
  adapterId,
  sourceCommit,
  trainerExecutableSha256,
  converterScriptSha256,
  pythonExecutableSha256,
  trainerEnvironmentSha256,
  trainerRequirementsSha256,
}) => {
  const participatoryAssentSha256 = ceremony.consent?.participatoryAssentSha256;
  const ceremonyApprovalSha256 = ceremony.consent?.ceremonyApprovalSha256;
  const consentAuthority = refinementConsentAuthority(ceremony);
  const requiredDigests = {
    participatoryAssentSha256,
    ceremonyApprovalSha256,
    sourceCorpusSha256: corpus?.sourceCorpusSha256,
    sourceManifestSha256: corpus?.sourceManifestSha256,
    sourceAuthoritySha256: corpus?.sourceAuthoritySha256,
    curriculumSha256,
    baseArtifactSha256: config?.baseArtifactSha256,
    tokenizerSha256: config?.tokenizerSha256,
    servingArtifactSha256: targetServingArtifactSha256,
    servingLineageSha256,
    snapshotManifestSha256,
    targetTrainingBaseAuthoritySha256,
    lineageConfigSha256,
    lineageConfigSourceIdentitySha256,
    trainerExecutableSha256,
    converterScriptSha256,
    pythonExecutableSha256,
    trainerEnvironmentSha256,
    trainerRequirementsSha256,
    completionTokenProfileSha256: config?.completionTokenProfileSha256,
    operationConfigSha256: config?.operationConfigSha256,
    executionEnvelopeSha256: config?.executionEnvelopeSha256,
  };
  for (const [field, digest] of Object.entries(requiredDigests)) {
    if (!SHA256.test(String(digest || ''))) {
      throw new Error(`provenance-bound training requires ${field}`);
    }
  }
  if (!/^[0-9a-f]{7,64}$/.test(String(sourceCommit || ''))
    || !/^[0-9a-f]{7,64}$/.test(String(lineageConfigSourceCommit || ''))) {
    throw new Error('provenance-bound training requires exact source revisions');
  }
  for (const [field, value] of Object.entries({
    lineageConfigSourceMode,
    lineageConfigObjectId,
  })) {
    if (typeof value !== 'string' || !value || value.length > 256
      || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`provenance-bound training requires ${field}`);
    }
  }
  if (typeof adapterId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(adapterId)) {
    throw new Error('provenance-bound training requires a planned adapter id');
  }
  const expectedBaseModelIdentitySha256 = refinementSha256({
    modelId: targetServingModel,
    modelArtifactSha256: config.baseArtifactSha256,
    tokenizerSha256: config.tokenizerSha256,
  });
  if (baseModelIdentitySha256 !== expectedBaseModelIdentitySha256
    || ceremony.bridge?.baseModel !== targetServingModel) {
    throw new Error('target training lineage does not match the bridge base');
  }
  const normalizedApprovedScales = refinementApprovedScales(approvedScales);
  const approvedScalesSha256 = refinementSha256(normalizedApprovedScales);
  const sourceCommitSha256 = refinementSha256(sourceCommit);
  const adapterIdSha256 = refinementSha256(adapterId);
  const approvalContext = Object.freeze({
    ceremonyApprovalSha256,
    sourceCorpusSha256: corpus.sourceCorpusSha256,
    sourceManifestSha256: corpus.sourceManifestSha256,
    sourceAuthoritySha256: corpus.sourceAuthoritySha256,
    curriculumSha256,
    trainingConfigSha256: config.sha256,
    baseModelIdentitySha256,
    servingArtifactSha256: targetServingArtifactSha256,
    servingLineageSha256,
    snapshotManifestSha256,
    targetTrainingBaseAuthoritySha256,
    lineageConfigSha256,
    lineageConfigSourceIdentitySha256,
    lineageConfigSourceCommit,
    lineageConfigSourceMode,
    lineageConfigObjectId,
    sourceCommitSha256,
    trainerExecutableSha256,
    converterScriptSha256,
    pythonExecutableSha256,
    trainerEnvironmentSha256,
    trainerRequirementsSha256,
    completionTokenProfileSha256: config.completionTokenProfileSha256,
    operationConfigSha256: config.operationConfigSha256,
    executionEnvelopeSha256: config.executionEnvelopeSha256,
    geometrySha256: config.geometry.sha256,
    trainingBudgetSha256: config.budget.sha256,
    approvedScalesSha256,
    adapterIdSha256,
    minimumCompletionTokens: config.budget.minimumCompletionTokens,
  });
  return Object.freeze({
    trainingPlanSha256: refinementTrainingPlanSha256(approvalContext),
    approvalContext,
    bindingContext: Object.freeze({
      sourceCorpusSha256: corpus.sourceCorpusSha256,
      sourceManifestSha256: corpus.sourceManifestSha256,
      sourceAuthoritySha256: corpus.sourceAuthoritySha256,
      curriculumSha256,
      trainingConfigSha256: config.sha256,
      baseModelIdentitySha256,
      servingArtifactSha256: targetServingArtifactSha256,
      servingLineageSha256,
      baseArtifactSha256: config.baseArtifactSha256,
      tokenizerSha256: config.tokenizerSha256,
      snapshotManifestSha256,
      targetTrainingBaseAuthoritySha256,
      lineageConfigSha256,
      lineageConfigSourceIdentitySha256,
      lineageConfigSourceCommit,
      lineageConfigSourceMode,
      lineageConfigObjectId,
      sourceCommit,
      sourceCommitSha256,
      trainerExecutableSha256,
      converterScriptSha256,
      pythonExecutableSha256,
      trainerEnvironmentSha256,
      trainerRequirementsSha256,
      completionTokenProfileSha256: config.completionTokenProfileSha256,
      operationConfigSha256: config.operationConfigSha256,
      executionEnvelopeSha256: config.executionEnvelopeSha256,
      participatoryAssentSha256,
      ceremonyApprovalSha256,
      ceremonyId: consentAuthority.ceremonyId,
      assentEvidenceId: consentAuthority.assentEvidenceId,
      assentEvidenceSha256: consentAuthority.assentEvidenceSha256,
      consentEventSha256: consentAuthority.consentEventSha256,
      consentEventIndex: consentAuthority.consentEventIndex,
      consentEventRevision: consentAuthority.consentEventRevision,
      geometrySha256: config.geometry.sha256,
      trainingBudgetSha256: config.budget.sha256,
      minimumCompletionTokens: config.budget.minimumCompletionTokens,
      approvedScales: normalizedApprovedScales,
      approvedScalesSha256,
      adapterIdSha256,
    }),
  });
};

/** Bind one consumed authenticated decision to its exact recomputed plan. Pure. */
export const adapterBindingContext = (params) => {
  const { trainingPlanSha256, operatorDecisionSha256 } = params;
  const plan = trainingApprovalPlan(params);
  const authority = refinementTrainingPlanAuthority(params.ceremony);
  if (trainingPlanSha256 !== plan.trainingPlanSha256
    || authority.trainingPlanSha256 !== trainingPlanSha256
    || authority.operatorDecisionSha256 !== operatorDecisionSha256) {
    throw new Error('operator decision does not match the exact training plan');
  }
  return Object.freeze({
    ...plan.bindingContext,
    trainingPlanSha256,
    operatorDecisionSha256,
    decisionEventIndex: authority.decisionEventIndex,
    decisionEventRevision: authority.decisionEventRevision,
    consumptionEventIndex: authority.consumptionEventIndex,
    consumptionEventRevision: authority.consumptionEventRevision,
  });
};

/** Complete the context only after the real artifact has been hashed. Pure. */
export const completeAdapterBinding = ({ context, adapterId, artifactSha256, scale = 1 }) => {
  if (!context.approvedScales.includes(scale)) {
    throw new Error('adapter scale was not covered by the operator approval');
  }
  return refinementBinding({
    ...context,
    adapterId,
    adapterArtifactSha256: artifactSha256,
    adapterScale: scale,
  });
};

