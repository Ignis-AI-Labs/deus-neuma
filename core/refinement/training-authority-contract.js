// Pure authority contracts for refinement custody, approval, execution, and binding.
import {
  refinementApprovedScales,
  refinementBudget,
  refinementGeometry,
  refinementSha256,
  refinementTextSha256,
} from './training-contract.js';
import {
  canonicalAuthoritySha256,
  deepFreezePlainData,
} from '../shared/plain-data-canonical.js';
import { isRefinementCustodyIdentity } from '../identity/custody-identity.js';
import { validateRefinementAdapterRecord } from './adapter-registry-contract.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const freezeJson = (value) => deepFreezePlainData(value, {
  field: 'refinement authority',
  maxDepth: 32,
  maxNodes: 100_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxKeyBytes: 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});
const positiveInteger = (value, field, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be a positive safe integer at most ${maximum}`);
  }
  return value;
};
const boundedId = (value, field) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${field} must be a bounded id`);
  }
  return value;
};
const codedError = (message, code) => Object.assign(new Error(message), { code });
// Custody moved to core/identity/custody-identity.js — it names which being a
// record belongs to and trains nothing, so keeping it here dragged this whole
// training contract onto the identity path. Re-exported so the forge's own
// callers are unaffected by where it actually lives; validateRefinementAdapter
// below still calls the predicate, so it is imported as well as re-exported.
export {
  refinementCustodyIdentity,
  refinementCustodyMatches,
} from '../identity/custody-identity.js';
export { isRefinementCustodyIdentity };
export const REFINEMENT_RESOURCE_LIMITS = freezeJson({
  version: 2,
  allowedCpus: '0-1',
  cpuQuotaPercent: 200,
  maxThreads: 2,
  maxProcesses: 64,
  maxCpuSeconds: 3600,
  memoryMaxBytes: 64 * 1024 ** 3,
  memorySwapMaxBytes: 0,
  ioDevicePath: '/',
  ioReadBandwidthBytesPerSecond: 1024 ** 3,
  ioWriteBandwidthBytesPerSecond: 512 * 1024 ** 2,
  maxFileBytes: 8 * 1024 ** 3,
  maxOpenFiles: 256,
  maxInheritedFileDescriptors: 243,
  maxSnapshotFiles: 236,
  maxWorktreeFiles: 100_000,
  maxWorktreeBytes: 32 * 1024 ** 3,
  maxWorktreeDepth: 32,
  maxPathBytes: 512,
  trainingSnapshotMaxBytes: 80 * 1024 ** 3,
  adapterArtifactMaxBytes: 8 * 1024 ** 3,
});
const MAX_PYTHON_HASH_SEED = 4_294_967_295;
const refinementChildEnvironment = (trainingSeed) => {
  if (!Number.isSafeInteger(trainingSeed)
    || trainingSeed < 0 || trainingSeed > MAX_PYTHON_HASH_SEED) {
    throw new Error('training seed must be an unsigned 32-bit integer');
  }
  return freezeJson({
    HOME: '/nonexistent', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    PATH: '/runtime/bin', TMPDIR: '/work',
    PYTHONNOUSERSITE: '1', PYTHONSAFEPATH: '1',
    PYTHONPATH: '', PYTHONHOME: '', PYTHONHASHSEED: String(trainingSeed),
    CUBLAS_WORKSPACE_CONFIG: ':4096:8',
    CUDA_VISIBLE_DEVICES: '', NVIDIA_VISIBLE_DEVICES: '',
    OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
    OPENBLAS_NUM_THREADS: '2', NUMEXPR_NUM_THREADS: '2',
    TOKENIZERS_PARALLELISM: 'false',
  });
};
export const refinementExecutionEnvelope = ({
  wrapperExecutableSha256,
  controllerExecutableSha256,
  resourceLimiterExecutableSha256,
  sandboxExecutableSha256,
  authorityConsumerPythonSha256,
  authorityConsumerScriptSha256,
  hostRuntimeIdentitySha256,
  runtimeAuthoritySha256,
  runtimeManifestSha256,
  toolAuthoritySha256,
  toolManifestSha256,
  resources,
  trainingSeed,
  sha256 = null,
} = {}) => {
  for (const [field, digest] of Object.entries({
    wrapperExecutableSha256,
    controllerExecutableSha256,
    resourceLimiterExecutableSha256,
    sandboxExecutableSha256,
    authorityConsumerPythonSha256,
    authorityConsumerScriptSha256,
    hostRuntimeIdentitySha256,
    runtimeAuthoritySha256,
    runtimeManifestSha256,
    toolAuthoritySha256,
    toolManifestSha256,
  })) {
    if (!SHA256.test(String(digest || ''))) throw new Error(`${field} must be sha256`);
  }
  if (refinementSha256(resources) !== refinementSha256(REFINEMENT_RESOURCE_LIMITS)) {
    throw new Error('refinement execution resources differ from server-owned limits');
  }
  const envelope = freezeJson({
    schemaVersion: 4,
    kind: 'refinement-execution-envelope',
    environment: refinementChildEnvironment(trainingSeed),
    resources: REFINEMENT_RESOURCE_LIMITS,
    sandbox: {
      wrapperId: 'systemd-run-scope-v1',
      wrapperExecutableSha256,
      wrapperMode: 'scope-wait-pipe-collect',
      controllerId: 'systemctl-user-cgroup-v1',
      controllerExecutableSha256,
      resourceLimiterId: 'prlimit-v1',
      resourceLimiterExecutableSha256,
      sandboxId: 'bubblewrap-v1',
      sandboxExecutableSha256,
      authorityConsumerId: 'consume-packed-authority-v2',
      authorityConsumerPythonSha256,
      authorityConsumerScriptSha256,
      hostRuntime: 'fixed-minimal-read-only-allowlist-v1',
      hostRuntimeIdentitySha256,
      runtimeAuthoritySha256,
      runtimeManifestSha256,
      toolAuthoritySha256,
      toolManifestSha256,
      namespaces: 'all',
      capabilities: 'none',
      network: 'none',
      runtime: 'exact-commit-packed-read-only',
      tool: 'exact-commit-packed-read-only',
      base: 'pinned-read-only',
      work: 'private-read-write',
      devices: 'gpu-lease-descriptor-set-or-none-v1',
      gpuLeaseRequired: true,
      dataChannels: ['corpus-read-fd', 'facts-write-fd', 'adapter-write-fd'],
      stdio: 'bounded-lines-v1',
      source: 'exact-commit-transitive-closure-v1',
    },
  });
  const digest = refinementSha256(envelope);
  if (sha256 != null && sha256 !== digest) {
    throw new Error('refinement execution envelope sha256 mismatch');
  }
  return Object.freeze({ ...envelope, sha256: digest });
};
export const validateRefinementExecutionEnvelope = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',')
      !== 'environment,kind,resources,sandbox,schemaVersion,sha256') {
    throw new Error('refinement execution envelope shape is invalid');
  }
  const seedText = value.environment?.PYTHONHASHSEED;
  if (typeof seedText !== 'string' || !/^(?:0|[1-9]\d{0,9})$/u.test(seedText)) {
    throw new Error('refinement execution envelope PYTHONHASHSEED is invalid');
  }
  const expected = refinementExecutionEnvelope({
    wrapperExecutableSha256: value.sandbox?.wrapperExecutableSha256,
    controllerExecutableSha256: value.sandbox?.controllerExecutableSha256,
    resourceLimiterExecutableSha256: value.sandbox?.resourceLimiterExecutableSha256,
    sandboxExecutableSha256: value.sandbox?.sandboxExecutableSha256,
    authorityConsumerPythonSha256: value.sandbox?.authorityConsumerPythonSha256,
    authorityConsumerScriptSha256: value.sandbox?.authorityConsumerScriptSha256,
    hostRuntimeIdentitySha256: value.sandbox?.hostRuntimeIdentitySha256,
    runtimeAuthoritySha256: value.sandbox?.runtimeAuthoritySha256,
    runtimeManifestSha256: value.sandbox?.runtimeManifestSha256,
    toolAuthoritySha256: value.sandbox?.toolAuthoritySha256,
    toolManifestSha256: value.sandbox?.toolManifestSha256,
    resources: value.resources,
    trainingSeed: Number(seedText),
    sha256: value.sha256,
  });
  if (refinementSha256(value) !== refinementSha256(expected)) {
    throw new Error('refinement execution envelope projection mismatch');
  }
  return expected;
};
const OPERATION_ENV_FIELDS = Object.freeze([
  'HF_HOME', 'NEUMA_MODELS_DIRS', 'LLAMA_SERVER_MODEL',
  'NEUMA_REFINEMENT_SNAPSHOT_MAX_DEPTH', 'NEUMA_REFINEMENT_SNAPSHOT_MAX_NODES',
  'NEUMA_REFINEMENT_SNAPSHOT_MAX_FILES', 'NEUMA_REFINEMENT_SNAPSHOT_MAX_BYTES',
  'NEUMA_REFINEMENT_SNAPSHOT_MAX_PARSED_BYTES', 'NEUMA_REFINEMENT_SNAPSHOT_MAX_KEY_BYTES',
  'NEUMA_REFINEMENT_SNAPSHOT_MAX_TENSOR_KEYS', 'NEUMA_REFINEMENT_RANK',
  'NEUMA_REFINEMENT_ALPHA', 'NEUMA_REFINEMENT_DROPOUT', 'NEUMA_REFINEMENT_MAX_LENGTH',
  'NEUMA_REFINEMENT_TARGET_POLICY', 'NEUMA_REFINEMENT_TARGET_MODULES',
  'NEUMA_REFINEMENT_SEED', 'NEUMA_REFINEMENT_BASE', 'NEUMA_REFINEMENT_BASE_REVISION',
  'NEUMA_REFINEMENT_TEMPLATE', 'NEUMA_REFINEMENT_4BIT',
  'NEUMA_REFINEMENT_BASE_ARTIFACT_SHA256', 'NEUMA_REFINEMENT_TOKENIZER_SHA256',
  'NEUMA_REFINEMENT_PYTHON', 'NEUMA_LORA_CONVERT_PY', 'NEUMA_ADAPTERS_DIR',
  'NEUMA_DATA_ROOT', 'NEUMA_BUILD_SOURCE_COMMIT', 'NEUMA_FORGE_MEM_FACTOR',
  'NEUMA_FORGE_MEM_HEADROOM_GB', 'NEUMA_FORGE_MEM_FLOOR_GB',
  'NEUMA_FORGE_MAX_DURATION_MS', 'LLAMA_SERVER_URL', 'SUBSTRATE_MODEL',
  'LLAMA_SERVER_BIN', 'LLAMA_SERVER_MMPROJ', 'SUBSTRATE_CONTEXT_LENGTH',
  'GGML_CUDA_DISABLE_GRAPHS', 'GGML_CUDA_DISABLE_FUSION', 'NEUMA_SUBSTRATE_CLAIM_DIR',
]);
const PATH_ENV_FIELDS = new Set([
  'HF_HOME', 'NEUMA_MODELS_DIRS', 'LLAMA_SERVER_MODEL', 'NEUMA_REFINEMENT_PYTHON',
  'LLAMA_SERVER_BIN', 'LLAMA_SERVER_MMPROJ', 'NEUMA_SUBSTRATE_CLAIM_DIR',
]);
const pathIdentity = (value) => value == null ? null : refinementTextSha256(value);
const exactEnvironment = (env) => Object.freeze(Object.fromEntries(
  OPERATION_ENV_FIELDS.map((field) => [field, env[field] == null ? null : String(env[field])]),
));
export const trainingOperationConfig = ({ env, provider, launchConfig }) => {
  if (!env || typeof env !== 'object' || typeof provider !== 'string' || !provider.trim()) {
    throw codedError('Training operation configuration is unavailable.', 'TRAINING_OPERATION_CHANGED');
  }
  const environment = exactEnvironment(env);
  const launch = Object.freeze({
    bin: String(launchConfig?.bin || ''),
    model: String(launchConfig?.model || ''),
    mmproj: String(launchConfig?.mmproj || ''),
    servingModel: launchConfig?.servingModel == null ? null : String(launchConfig.servingModel),
    contextLength: Number(launchConfig?.contextLength),
    host: String(launchConfig?.host || ''),
    port: Number(launchConfig?.port),
    disableCudaGraphs: Boolean(launchConfig?.disableCudaGraphs),
    disableCudaFusion: Boolean(launchConfig?.disableCudaFusion),
    loras: Object.freeze([]),
  });
  const projection = Object.freeze({
    schemaVersion: 1,
    environment: Object.freeze(Object.fromEntries(Object.entries(environment).map(([field, value]) => [
      field, PATH_ENV_FIELDS.has(field) ? pathIdentity(value) : value,
    ]))),
    provider: provider.trim(),
    launch: Object.freeze({
      binSha256: pathIdentity(launch.bin),
      modelPathSha256: pathIdentity(launch.model),
      mmprojPathSha256: pathIdentity(launch.mmproj),
      servingModel: launch.servingModel,
      contextLength: launch.contextLength,
      host: launch.host,
      port: launch.port,
      disableCudaGraphs: launch.disableCudaGraphs,
      disableCudaFusion: launch.disableCudaFusion,
    }),
  });
  return Object.freeze({
    environment,
    provider: projection.provider,
    launchConfig: launch,
    sha256: refinementSha256(projection),
  });
};

export const refinementTrainingPlanSha256 = (value) => {
  const digestFields = [
    'ceremonyApprovalSha256', 'sourceCorpusSha256', 'sourceManifestSha256',
    'sourceAuthoritySha256', 'curriculumSha256', 'trainingConfigSha256',
    'baseModelIdentitySha256', 'servingArtifactSha256', 'sourceCommitSha256',
    'trainerExecutableSha256', 'converterScriptSha256', 'pythonExecutableSha256',
    'trainerEnvironmentSha256', 'trainerRequirementsSha256', 'geometrySha256',
    'completionTokenProfileSha256',
    'trainingBudgetSha256', 'approvedScalesSha256', 'adapterIdSha256',
    'operationConfigSha256', 'executionEnvelopeSha256', 'servingLineageSha256',
    'snapshotManifestSha256', 'targetTrainingBaseAuthoritySha256',
    'lineageConfigSha256', 'lineageConfigSourceIdentitySha256',
  ];
  const scalarFields = [
    'minimumCompletionTokens', 'lineageConfigSourceCommit',
    'lineageConfigSourceMode', 'lineageConfigObjectId',
  ];
  const fields = [...digestFields, ...scalarFields];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new Error('training approval must contain the exact v2 binding authority');
  }
  for (const field of digestFields) {
    if (!SHA256.test(String(value[field] || ''))) throw new Error(`${field} must be sha256`);
  }
  positiveInteger(value.minimumCompletionTokens, 'minimumCompletionTokens', 8192);
  if (!/^[0-9a-f]{7,64}$/.test(String(value.lineageConfigSourceCommit || ''))) {
    throw new Error('lineageConfigSourceCommit must be a git revision');
  }
  for (const field of ['lineageConfigSourceMode', 'lineageConfigObjectId']) {
    if (typeof value[field] !== 'string' || !value[field] || value[field].length > 256
      || /[\u0000-\u001f\u007f]/u.test(value[field])) {
      throw new Error(`${field} must be bounded control-free text`);
    }
  }
  return canonicalAuthoritySha256(
    Object.fromEntries(fields.map((field) => [field, value[field]])),
    {
      domain: 'neuma.refinement.training-plan',
      schemaVersion: 2,
      maxDepth: 4,
      maxNodes: 128,
      maxStringBytes: 1024,
      maxKeyBytes: 128,
      maxOutputBytes: 32 * 1024,
    },
  );
};

export const refinementTrainingConfiguration = (values = {}) => {
  const allowed = new Set([
    'base', 'baseRevision', 'template', 'load4bit', 'baseArtifactSha256',
    'tokenizerSha256', 'geometry', 'budget', 'completionTokenProfileSha256',
    'operationConfigSha256', 'executionEnvelope', 'executionEnvelopeSha256', 'sha256',
  ]);
  const unknown = Object.keys(values).filter((field) => !allowed.has(field));
  if (unknown.length) throw new Error(`training configuration has unknown fields: ${unknown.join(', ')}`);
  if (typeof values.base !== 'string' || !values.base.trim() || values.base.length > 256
    || /[\u0000-\u001f\u007f]/u.test(values.base)) {
    throw new Error('base must be a bounded control-free model id');
  }
  if (!/^[0-9a-f]{7,64}$/.test(String(values.baseRevision || ''))) {
    throw new Error('baseRevision must be a git-style revision');
  }
  if (!['gemma-channel', 'chat'].includes(values.template)) {
    throw new Error('template must be gemma-channel or chat');
  }
  if (typeof values.load4bit !== 'boolean') throw new Error('load4bit must be boolean');
  for (const field of [
    'baseArtifactSha256', 'tokenizerSha256', 'completionTokenProfileSha256',
    'operationConfigSha256', 'executionEnvelopeSha256',
  ]) {
    if (!SHA256.test(String(values[field] || ''))) throw new Error(`${field} must be sha256`);
  }
  const geometry = refinementGeometry(values.geometry);
  if (values.geometry?.sha256 !== geometry.sha256) throw new Error('geometry sha256 mismatch');
  const budget = refinementBudget(values.budget);
  if (values.budget?.sha256 !== budget.sha256) throw new Error('budget sha256 mismatch');
  if (budget.minimumCompletionTokens > geometry.maxLength) {
    throw new Error('minimumCompletionTokens must not exceed maxLength');
  }
  const executionEnvelope = validateRefinementExecutionEnvelope(values.executionEnvelope);
  if (values.executionEnvelopeSha256 !== executionEnvelope.sha256) {
    throw new Error('executionEnvelopeSha256 must bind executionEnvelope');
  }
  const configuration = freezeJson({
    base: values.base.trim(),
    baseRevision: values.baseRevision,
    template: values.template,
    load4bit: values.load4bit,
    baseArtifactSha256: values.baseArtifactSha256,
    tokenizerSha256: values.tokenizerSha256,
    completionTokenProfileSha256: values.completionTokenProfileSha256,
    operationConfigSha256: values.operationConfigSha256,
    executionEnvelope,
    executionEnvelopeSha256: executionEnvelope.sha256,
    geometry,
    budget,
  });
  const sha256 = refinementSha256(configuration);
  if (values.sha256 != null && values.sha256 !== sha256) {
    throw new Error('training configuration sha256 mismatch');
  }
  return Object.freeze({ ...configuration, sha256 });
};

export const refinementBinding = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('refinement binding must be an object');
  }
  freezeJson(value);
  const requiredSha = [
    'sourceCorpusSha256', 'sourceManifestSha256', 'sourceAuthoritySha256',
    'curriculumSha256', 'trainingConfigSha256', 'baseModelIdentitySha256',
    'servingArtifactSha256', 'servingLineageSha256', 'baseArtifactSha256',
    'tokenizerSha256', 'sourceCommitSha256', 'trainerExecutableSha256',
    'converterScriptSha256', 'pythonExecutableSha256', 'trainerEnvironmentSha256',
    'trainerRequirementsSha256', 'executionEnvelopeSha256', 'operationConfigSha256',
    'adapterArtifactSha256', 'participatoryAssentSha256', 'ceremonyApprovalSha256',
    'trainingPlanSha256', 'operatorDecisionSha256', 'assentEvidenceId',
    'assentEvidenceSha256', 'consentEventSha256', 'completionTokenProfileSha256',
    'geometrySha256', 'trainingBudgetSha256', 'approvedScalesSha256', 'adapterIdSha256',
    'snapshotManifestSha256', 'targetTrainingBaseAuthoritySha256', 'lineageConfigSha256',
    'lineageConfigSourceIdentitySha256',
  ];
  const authorityFields = [
    'ceremonyId', 'consentEventIndex', 'consentEventRevision', 'decisionEventIndex',
    'decisionEventRevision', 'consumptionEventIndex', 'consumptionEventRevision',
  ];
  const allowed = new Set([
    ...requiredSha, ...authorityFields, 'sourceCommit', 'adapterId',
    'minimumCompletionTokens', 'adapterScale', 'approvedScales',
    'lineageConfigSourceCommit', 'lineageConfigSourceMode', 'lineageConfigObjectId',
  ]);
  const keys = Reflect.ownKeys(value);
  const unknown = keys.filter((key) => typeof key !== 'string' || !allowed.has(key));
  if (unknown.length || keys.length !== allowed.size) {
    throw new Error('refinement binding must contain its exact own string field set');
  }
  for (const field of requiredSha) {
    if (!SHA256.test(String(value[field] || ''))) throw new Error(`${field} must be sha256`);
  }
  boundedId(value.ceremonyId, 'ceremonyId');
  for (const field of authorityFields.slice(1)) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
  if (value.consentEventRevision !== value.consentEventIndex + 1
    || value.decisionEventRevision !== value.decisionEventIndex + 1
    || value.consumptionEventRevision !== value.consumptionEventIndex + 1
    || value.consentEventIndex > value.decisionEventIndex
    || value.decisionEventIndex >= value.consumptionEventIndex) {
    throw new Error('refinement binding event authority is inconsistent');
  }
  if (!Number.isSafeInteger(value.minimumCompletionTokens)
    || value.minimumCompletionTokens < 1 || value.minimumCompletionTokens > 8192) {
    throw new Error('minimumCompletionTokens must be an integer in [1, 8192]');
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(value.sourceCommit || ''))) {
    throw new Error('sourceCommit must be a full git object id');
  }
  if (value.sourceCommitSha256 !== refinementSha256(value.sourceCommit)) {
    throw new Error('sourceCommitSha256 must bind sourceCommit');
  }
  if (value.lineageConfigSourceCommit !== value.sourceCommit
    || value.lineageConfigSourceMode !== '100644'
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(value.lineageConfigObjectId || ''))) {
    throw new Error('lineage config source authority is invalid');
  }
  const approvedScales = refinementApprovedScales(value.approvedScales);
  if (value.approvedScalesSha256 !== refinementSha256(approvedScales)) {
    throw new Error('approvedScalesSha256 must bind approvedScales');
  }
  boundedId(value.adapterId, 'adapterId');
  if (value.adapterIdSha256 !== refinementSha256(value.adapterId)) {
    throw new Error('adapterIdSha256 must bind adapterId');
  }
  if (!Number.isFinite(value.adapterScale) || value.adapterScale < 0 || value.adapterScale > 1) {
    throw new Error('adapterScale must be finite in [0, 1]');
  }
  if (!approvedScales.includes(value.adapterScale)) {
    throw new Error('adapterScale must be covered by approvedScales');
  }
  return freezeJson(Object.fromEntries([
    ...requiredSha.map((field) => [field, value[field]]),
    ...authorityFields.map((field) => [field, value[field]]),
    ['minimumCompletionTokens', value.minimumCompletionTokens],
    ['sourceCommit', value.sourceCommit],
    ['lineageConfigSourceCommit', value.lineageConfigSourceCommit],
    ['lineageConfigSourceMode', value.lineageConfigSourceMode],
    ['lineageConfigObjectId', value.lineageConfigObjectId],
    ['adapterId', value.adapterId],
    ['adapterScale', value.adapterScale],
    ['approvedScales', approvedScales],
  ]));
};

export const validateRefinementAdapter = (adapter) =>
  validateRefinementAdapterRecord(
    adapter,
    refinementBinding,
    isRefinementCustodyIdentity,
  );
