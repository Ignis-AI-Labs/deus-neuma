// Pure bounded inputs and measured facts at the isolated trainer boundary.

import {
  refinementBudget,
  refinementGeometry,
  refinementSha256,
  refinementTextSha256,
} from '../../core/refinement/training-contract.js';
import {
  REFINEMENT_CORPUS_SYSTEM_INSTRUCTION,
  REFINEMENT_CORPUS_SYSTEM_SHA256,
  REFINEMENT_CORPUS_USER_INSTRUCTION,
  refinementCorpusManifestSha256,
  validateRefinementCorpusManifest,
} from '../../core/refinement/corpus-manifest.js';
import { assertBoundedPlainData } from '../../core/shared/plain-data-canonical.js';
import { checkedByteSum } from './refinement-checked-arithmetic.js';
import {
  refinementGpuLease,
  validateRefinementGpuLease,
} from './refinement-gpu-lease-contract.js';

const SHA256 = /^[0-9a-f]{64}$/;
const MEBIBYTE = 1024 ** 2;
const SNAPSHOT_ROOT = '/snapshot';
const TRAINING_MESSAGE_ROLES = Object.freeze(['system', 'user', 'assistant']);
export const MAX_REFINEMENT_CORPUS_BYTES = 64 * MEBIBYTE;
export const MAX_REFINEMENT_SAMPLE_BYTES = MEBIBYTE;
export const MAX_REFINEMENT_TRAINER_FACTS_BYTES = 16 * MEBIBYTE;
const MAX_TARGET_MODULES = 1024;
const MAX_TARGET_MODULE_BYTES = 512;
const SAFE_TARGET_SUFFIX = /(?:^|\.)(?:q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)$/u;
const ATTENTION_TARGET_SUFFIX = /(?:^|\.)(?:q_proj|k_proj|v_proj|o_proj)$/u;
const MAX_TRAINING_SEED = 0xffff_ffff;
const DETERMINISM_FIELDS = Object.freeze([
  'cublasWorkspaceConfig', 'cudnnBenchmark', 'cudnnDeterministic',
  'deterministicAlgorithms', 'numpySeed', 'pythonHashSeed', 'seed', 'torchSeed',
  'transformersSeed',
]);

const guestPath = (value, field) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > 512) {
    throw new Error(`${field} must be a bounded absolute guest path`);
  }
  return value;
};

const inheritedFd = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 3 || value > 1_048_575) {
    throw new Error(`${field} must be a bounded inherited descriptor`);
  }
  return String(value);
};

const boundedIntegerArgument = (value, field, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is outside the trainer contract`);
  }
  return String(value);
};

const boundedFiniteArgument = (value, field, minimum, maximum, maximumInclusive = true) => {
  if (!Number.isFinite(value) || value < minimum
    || (maximumInclusive ? value > maximum : value >= maximum)) {
    throw new Error(`${field} is outside the trainer contract`);
  }
  return String(value);
};

const exactTargets = (targets) => {
  const normalized = refinementGeometry({
    rank: 1,
    alpha: 1,
    targetPolicyId: 'exact-module-list-v1',
    targetModules: targets,
  }).targetModules;
  if (normalized.some((target) => Buffer.byteLength(target, 'utf8') > MAX_TARGET_MODULE_BYTES
    || !SAFE_TARGET_SUFFIX.test(target) || target.includes('vision') || target.includes('audio'))) {
    throw new Error('trainer target module is outside the safe text-tower policy');
  }
  return normalized;
};

const commonTrainerArguments = ({
  trainer,
  corpusFd,
  corpusSha256,
  corpusBytes,
  corpusSampleCount,
  outputPath,
  factsFd,
  factsMaximumBytes,
  snapshotManifestFd,
  snapshotManifestSha256,
  config,
}) => {
  if (!SHA256.test(String(corpusSha256 || ''))
    || !SHA256.test(String(snapshotManifestSha256 || ''))
    || !config || typeof config !== 'object') {
    throw new Error('trainer requires exact corpus, snapshot, and configuration authorities');
  }
  const geometry = refinementGeometry(config.geometry);
  const budget = refinementBudget(config.budget);
  if (geometry.sha256 !== config.geometry.sha256 || budget.sha256 !== config.budget.sha256) {
    throw new Error('trainer configuration identities changed before invocation');
  }
  if (budget.sampleCount !== corpusSampleCount) {
    throw new Error('trainer corpus sample count differs from its approved budget');
  }
  const targetModules = geometry.targetModules;
  if (targetModules.length > MAX_TARGET_MODULES
    || targetModules.some((target) =>
      Buffer.byteLength(target, 'utf8') > MAX_TARGET_MODULE_BYTES)) {
    throw new Error('trainer target module authority exceeds its hard ceiling');
  }
  return [
    guestPath(trainer, 'trainer'),
    '--corpus-fd', inheritedFd(corpusFd, 'corpus fd'),
    '--corpus-sha256', corpusSha256,
    '--corpus-bytes', boundedIntegerArgument(
      corpusBytes, 'corpus bytes', 1, MAX_REFINEMENT_CORPUS_BYTES,
    ),
    '--corpus-sample-count', boundedIntegerArgument(
      corpusSampleCount, 'corpus sample count', 1, 10_000,
    ),
    '--out', guestPath(outputPath, 'output'),
    '--base', SNAPSHOT_ROOT,
    '--facts-fd', inheritedFd(factsFd, 'facts fd'),
    '--facts-maximum-bytes', boundedIntegerArgument(
      factsMaximumBytes, 'facts maximum bytes', 1, MAX_REFINEMENT_TRAINER_FACTS_BYTES,
    ),
    '--snapshot-manifest-fd', inheritedFd(snapshotManifestFd, 'snapshot manifest fd'),
    '--snapshot-manifest-sha256', snapshotManifestSha256,
    '--template', config.template,
    '--epochs', boundedIntegerArgument(budget.epochs, 'epochs', 1, 24),
    '--lr', boundedFiniteArgument(budget.learningRate, 'learning rate', 0, 1),
    '--rank', boundedIntegerArgument(geometry.rank, 'rank', 1, 64),
    '--alpha', boundedFiniteArgument(geometry.alpha, 'alpha', 0, 512),
    '--dropout', boundedFiniteArgument(geometry.dropout, 'dropout', 0, 1, false),
    '--max-length', boundedIntegerArgument(geometry.maxLength, 'max length', 1, 8192),
    '--minimum-completion-tokens', boundedIntegerArgument(
      budget.minimumCompletionTokens, 'completion minimum', 1, 8192,
    ),
    '--seed', boundedIntegerArgument(budget.seed, 'seed', 0, MAX_TRAINING_SEED),
    '--target-policy', geometry.targetPolicyId,
    ...(targetModules.length
      ? ['--target-modules-json', JSON.stringify(targetModules)]
      : []),
    ...(config.load4bit ? ['--load-4bit'] : []),
  ];
};

/** Construct the exact GPU-authorized training argv. Pure. */
export const trainerArguments = (params) => Object.freeze([
  ...commonTrainerArguments(params),
  '--expected-token-budget',
  boundedIntegerArgument(
    params.config?.budget?.matchedTokenBudget,
    'matched token budget',
    1,
    100_000_000,
  ),
  '--gpu-lease-json',
  JSON.stringify(validateRefinementGpuLease(params.gpuLease)),
]);
/** Construct tokenizer-only preflight argv without GPU authority. Pure. */
export const trainerInspectionArguments = (params) =>
  Object.freeze([...commonTrainerArguments(params), '--inspect-only']);

const completionProfile = (
  value,
  sampleCount,
  minimumCompletionTokens,
  maxLength,
) => {
  const profile = value.completionTokenProfile;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 10_000
    || !Number.isSafeInteger(maxLength) || maxLength < 2 || maxLength > 8192
    || !Number.isSafeInteger(minimumCompletionTokens) || minimumCompletionTokens < 1
    || minimumCompletionTokens >= maxLength
    || !profile || typeof profile !== 'object' || Array.isArray(profile)
    || Object.keys(profile).sort().join(',')
      !== 'aggregate,minimumObserved,minimumRequired,perSample,prefixPerSample'
    || profile.minimumRequired !== minimumCompletionTokens
    || !Array.isArray(profile.perSample) || profile.perSample.length !== sampleCount
    || !Array.isArray(profile.prefixPerSample) || profile.prefixPerSample.length !== sampleCount) {
    throw new Error('trainer completion-token facts are invalid');
  }
  let aggregate = 0;
  let minimumObserved = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < sampleCount; index += 1) {
    const completion = profile.perSample[index];
    const prefix = profile.prefixPerSample[index];
    if (!Number.isSafeInteger(completion) || completion < minimumCompletionTokens
      || completion >= maxLength || !Number.isSafeInteger(prefix) || prefix < 1
      || prefix > maxLength - completion || aggregate > 100_000_000 - completion) {
      throw new Error('trainer completion-token facts are invalid');
    }
    aggregate += completion;
    minimumObserved = Math.min(minimumObserved, completion);
  }
  if (profile.minimumObserved !== minimumObserved
    || profile.aggregate !== aggregate
    || !SHA256.test(String(value.completionTokenProfileSha256 || ''))
    || refinementSha256(profile) !== value.completionTokenProfileSha256) {
    throw new Error('trainer completion-token facts are invalid');
  }
  return Object.freeze({
    minimumRequired: profile.minimumRequired,
    perSample: Object.freeze([...profile.perSample]),
    prefixPerSample: Object.freeze([...profile.prefixPerSample]),
    minimumObserved: profile.minimumObserved,
    aggregate: profile.aggregate,
  });
};

const inspectedModelFacts = (value, selectedTargetModules) => {
  const eligibleTargetModules = exactTargets(value.eligibleTargetModules);
  const attentionTargetModules = exactTargets(value.attentionTargetModules);
  const eligible = new Set(eligibleTargetModules);
  if (attentionTargetModules.some((target) =>
    !eligible.has(target) || !ATTENTION_TARGET_SUFFIX.test(target))
    || selectedTargetModules.some((target) => !eligible.has(target))) {
    throw new Error('inspection selected targets must be eligible text-tower projections');
  }
  const baseConfig = value.baseConfig;
  if (!baseConfig || typeof baseConfig !== 'object' || Array.isArray(baseConfig)
    || Object.keys(baseConfig).sort().join(',') !== 'architectures,mixtureOfExperts,modelType,sha256'
    || !SHA256.test(String(baseConfig.sha256 || ''))
    || (baseConfig.modelType != null && (typeof baseConfig.modelType !== 'string'
      || Buffer.byteLength(baseConfig.modelType, 'utf8') > 512))
    || !Array.isArray(baseConfig.architectures) || baseConfig.architectures.length > 64
    || baseConfig.architectures.some((item) =>
      typeof item !== 'string' || Buffer.byteLength(item, 'utf8') > 512)
    || typeof baseConfig.mixtureOfExperts !== 'boolean') {
    throw new Error('inspection base configuration facts are invalid');
  }
  return Object.freeze({
    eligibleTargetModules,
    attentionTargetModules,
    baseConfig: Object.freeze({
      sha256: baseConfig.sha256,
      modelType: baseConfig.modelType,
      architectures: Object.freeze([...baseConfig.architectures]),
      mixtureOfExperts: baseConfig.mixtureOfExperts,
    }),
  });
};

const deterministicTrainingFacts = (value, expectedSeed) => {
  if (!Number.isSafeInteger(expectedSeed) || expectedSeed < 0
    || expectedSeed > MAX_TRAINING_SEED || !value || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== DETERMINISM_FIELDS.join('\0')
    || value.cublasWorkspaceConfig !== ':4096:8'
    || value.pythonHashSeed !== String(expectedSeed)
    || value.seed !== expectedSeed || value.numpySeed !== expectedSeed
    || value.torchSeed !== expectedSeed || value.transformersSeed !== expectedSeed
    || value.deterministicAlgorithms !== true || value.cudnnBenchmark !== false
    || value.cudnnDeterministic !== true) {
    throw new Error('trainer determinism facts differ from the approved execution');
  }
  return Object.freeze(Object.fromEntries(
    DETERMINISM_FIELDS.map((field) => [field, value[field]]),
  ));
};

/** Validate the trainer's isolated machine-readable facts channel. Pure. */
export const trainerFacts = (
  value,
  {
    inspection = false,
    sampleCount,
    minimumCompletionTokens,
    maxLength,
    matchedTokenBudget = null,
    seed = null,
    snapshotManifestSha256,
    gpuLease = null,
  } = {},
) => {
  assertBoundedPlainData(value, {
    field: 'trainer facts',
    maxDepth: 4,
    maxNodes: 100_000,
    maxStringBytes: 8 * MEBIBYTE,
    maxKeyBytes: 128,
    maxOutputBytes: MAX_REFINEMENT_TRAINER_FACTS_BYTES,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('trainer facts must be an object');
  }
  const required = inspection
    ? [
      'attentionTargetModules', 'baseConfig', 'completionTokenProfile',
      'completionTokenProfileSha256', 'eligibleTargetModules', 'snapshotManifestSha256',
      'targetModules', 'tokenBudget',
    ]
    : [
      'completionTokenProfile', 'completionTokenProfileSha256', 'determinism', 'gpuLease',
      'load4bitApplied', 'snapshotManifestSha256', 'targetModules', 'tokenBudget',
    ];
  if (Object.keys(value).sort().join('\0') !== [...required].sort().join('\0')) {
    throw new Error('trainer facts shape mismatch');
  }
  if (!SHA256.test(String(snapshotManifestSha256 || ''))
    || value.snapshotManifestSha256 !== snapshotManifestSha256) {
    throw new Error('trainer loaded snapshot manifest differs from its closed authority');
  }
  const profile = completionProfile(
    value,
    sampleCount,
    minimumCompletionTokens,
    maxLength,
  );
  let measuredTokenBudget = profile.aggregate;
  for (const count of profile.prefixPerSample) {
    if (measuredTokenBudget > 100_000_000 - count) {
      throw new Error('trainer token budget is unsafe');
    }
    measuredTokenBudget += count;
  }
  if (!Number.isSafeInteger(value.tokenBudget) || value.tokenBudget < 1
    || value.tokenBudget > 100_000_000 || value.tokenBudget !== measuredTokenBudget) {
    throw new Error('trainer token budget must exactly equal retained prefix and completion tokens');
  }
  const facts = {
    tokenBudget: value.tokenBudget,
    targetModules: exactTargets(value.targetModules),
    completionTokenProfile: profile,
    completionTokenProfileSha256: value.completionTokenProfileSha256,
    snapshotManifestSha256: value.snapshotManifestSha256,
  };
  if (inspection) {
    if (gpuLease !== null) throw new Error('inspection must not receive GPU lease authority');
    return Object.freeze({ ...facts, ...inspectedModelFacts(value, facts.targetModules) });
  }
  if (!Number.isSafeInteger(matchedTokenBudget) || matchedTokenBudget < 1
    || matchedTokenBudget > 100_000_000 || value.tokenBudget !== matchedTokenBudget
    || typeof value.load4bitApplied !== 'boolean') {
    throw new Error('trainer completion differs from the approved budget or quantization');
  }
  const measuredLease = refinementGpuLease(value.gpuLease);
  const expectedLease = refinementGpuLease(gpuLease);
  if (measuredLease.gpuLeaseSha256 !== expectedLease.gpuLeaseSha256
    || refinementSha256(measuredLease) !== refinementSha256(expectedLease)) {
    throw new Error('trainer GPU lease fact differs from its launch reservation');
  }
  return Object.freeze({
    ...facts,
    determinism: deterministicTrainingFacts(value.determinism, seed),
    load4bitApplied: value.load4bitApplied,
    gpuLease: measuredLease,
  });
};

/** Recompute the exact v2 corpus identity before the trainer can see plaintext. Pure. */
export const assertTrainingCorpusIdentity = (ceremony, corpus, renderedCorpus) => {
  const reviewed = ceremony?.corpus;
  const sourceCorpusSha256 = refinementTextSha256(renderedCorpus);
  const sourceManifest = validateRefinementCorpusManifest(corpus?.sourceManifest);
  const sourceManifestSha256 = refinementCorpusManifestSha256(sourceManifest);
  if (!reviewed || sourceCorpusSha256 !== corpus?.sourceCorpusSha256
    || sourceManifest.sourceCorpusSha256 !== sourceCorpusSha256
    || sourceManifest.sampleCount !== corpus?.samples?.length
    || sourceManifest.systemSha256 !== REFINEMENT_CORPUS_SYSTEM_SHA256
    || sourceManifest.sourceAuthoritySha256 !== corpus?.sourceAuthoritySha256
    || sourceManifestSha256 !== corpus?.sourceManifestSha256
    || reviewed.sourceCorpusSha256 !== sourceCorpusSha256
    || reviewed.sourceManifestSha256 !== sourceManifestSha256
    || reviewed.sourceAuthoritySha256 !== sourceManifest.sourceAuthoritySha256
    || reviewed.sampleCount !== corpus?.samples?.length) {
    throw new Error('stored refinement corpus no longer matches the ceremony-reviewed v2 authority');
  }
  return Object.freeze({
    sourceCorpusSha256,
    sourceManifestSha256,
    sourceAuthoritySha256: sourceManifest.sourceAuthoritySha256,
  });
};

// Epoch-or-null, not a boolean: the sample check below reads `=== null`, so a
// boolean form would compare false against null and never refuse anything.
const canonicalInstant = (value) => {
  if (typeof value !== 'string') return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value
    ? instant.getTime()
    : null;
};

const canonicalTrainingLine = (sample, index) => {
  assertBoundedPlainData(sample, {
    field: `training sample ${index}`,
    maxDepth: 4,
    maxNodes: 16,
    maxStringBytes: MAX_REFINEMENT_SAMPLE_BYTES,
    maxKeyBytes: 32,
    maxOutputBytes: MAX_REFINEMENT_SAMPLE_BYTES,
  });
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)
    || Object.keys(sample).sort().join(',') !== 'messages,occurredAt'
    || canonicalInstant(sample.occurredAt) === null
    || !Array.isArray(sample.messages)
    || sample.messages.length !== TRAINING_MESSAGE_ROLES.length) {
    throw new Error(`training sample ${index} must be one exact sealed subject completion`);
  }
  const messages = sample.messages.map((message, messageIndex) => {
    const expectedRole = TRAINING_MESSAGE_ROLES[messageIndex];
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).sort().join(',') !== 'content,role'
      || message.role !== expectedRole
      || typeof message.content !== 'string' || message.content.length === 0) {
      throw new Error(
        `training sample ${index} message ${messageIndex} must be an exact nonempty ${expectedRole} message`,
      );
    }
    return { role: expectedRole, content: message.content };
  });
  if (messages[0].content !== REFINEMENT_CORPUS_SYSTEM_INSTRUCTION
    || messages[1].content !== REFINEMENT_CORPUS_USER_INSTRUCTION) {
    throw new Error(`training sample ${index} contains non-subject prompt material`);
  }
  const line = JSON.stringify({ messages });
  const lineBytes = Buffer.byteLength(line, 'utf8');
  if (lineBytes > MAX_REFINEMENT_SAMPLE_BYTES) {
    throw new Error(`training sample ${index} exceeds its hard byte ceiling`);
  }
  return Object.freeze({ line, lineBytes });
};

/** Check each sample and the aggregate before the sole bounded concatenation. Pure. */
export const renderBoundedTrainingCorpus = (samples) => {
  if (!Array.isArray(samples)) {
    throw new Error('training samples must be a bounded subject-owned array');
  }
  if (samples.length < 1 || samples.length > 10_000) {
    throw new Error('training sample count exceeds its hard ceiling');
  }
  const lines = [];
  let total = 0n;
  let sampleCount = 0;
  for (const sample of samples) {
    const { line, lineBytes } = canonicalTrainingLine(sample, sampleCount);
    total = checkedByteSum(
      total,
      BigInt(lineBytes) + 1n,
      MAX_REFINEMENT_CORPUS_BYTES,
      'rendered corpus',
    );
    lines.push(`${line}\n`);
    sampleCount += 1;
  }
  if (sampleCount < 1) throw new Error('training corpus must contain at least one sample');
  const text = lines.join('');
  const bytes = Number(total);
  if (Buffer.byteLength(text, 'utf8') !== bytes) {
    throw new Error('rendered corpus byte accounting mismatch');
  }
  return Object.freeze({
    text,
    bytes,
    sha256: refinementTextSha256(text),
    sampleCount,
  });
};

/** Enforce total and per-sample corpus byte ceilings before a child sees plaintext. Pure. */
export const assertCorpusByteBudget = (renderedCorpus, expectedSamples) => {
  if (typeof renderedCorpus !== 'string') throw new Error('rendered corpus must be text');
  let cursor = 0;
  let samples = 0;
  let total = 0n;
  while (cursor < renderedCorpus.length) {
    const newline = renderedCorpus.indexOf('\n', cursor);
    if (newline < 0) throw new Error('rendered corpus must end every sample with a newline');
    const line = renderedCorpus.slice(cursor, newline);
    const bytes = Buffer.byteLength(line, 'utf8');
    if (!line || bytes > MAX_REFINEMENT_SAMPLE_BYTES) {
      throw new Error('rendered corpus sample exceeds its hard byte ceiling');
    }
    total = checkedByteSum(
      total,
      BigInt(bytes) + 1n,
      MAX_REFINEMENT_CORPUS_BYTES,
      'rendered corpus',
    );
    samples += 1;
    cursor = newline + 1;
  }
  if (!Number.isSafeInteger(expectedSamples) || expectedSamples < 1 || samples !== expectedSamples) {
    throw new Error('rendered corpus sample count mismatch');
  }
  return Object.freeze({ totalBytes: Number(total), samples });
};

/** Count exact tokenizer-independent UTF-8 corpus bytes. Pure. */
export const corpusByteBudget = (renderedCorpus) => Buffer.byteLength(renderedCorpus, 'utf8');
