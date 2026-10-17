// Held target-B lineage and model authority used only for refinement planning/training.

import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { assertBoundedPlainData } from '../../core/shared/plain-data-canonical.js';
import { openServingModelTrainingLineageFromAuthority } from './serving-model-artifact-authority.js';
import { listCatalog } from './model-catalog.js';
import {
  closeCommittedRefinementLineageConfigAuthority,
  openCommittedRefinementLineageConfigAuthority,
  projectCommittedRefinementLineageConfigAuthority,
  refinementServingLineageSha256,
  verifyCommittedRefinementLineageConfigAuthority,
} from './refinement-lineage-authority.js';
import {
  assertRefinementProcessOperation,
  assertRefinementProcessOperationIdentity,
} from './refinement-process-operation.js';
import {
  assertRefinementSourceAuthority,
  assertRefinementSourceResolver,
  projectRefinementSourceResolver,
} from './refinement-source-authority.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REVISION = /^[0-9a-f]{7,64}$/u;
const SERVING_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;
const FIELDS = Object.freeze([
  'baseArtifactSha256',
  'baseModelIdentitySha256',
  'lineageConfigObjectId',
  'lineageConfigSha256',
  'lineageConfigSourceCommit',
  'lineageConfigSourceIdentitySha256',
  'lineageConfigSourceMode',
  'schemaVersion',
  'servingLineageSha256',
  'targetServingArtifactSha256',
  'targetServingModel',
  'tokenizerSha256',
  'trainerModelId',
  'trainerRevision',
]);
const CATALOG_ENVIRONMENT = Object.freeze({
  NEUMA_MODELS_DIRS: process.env.NEUMA_MODELS_DIRS,
  LLAMA_SERVER_MODEL: process.env.LLAMA_SERVER_MODEL,
});
const TARGET_OWNERS = new WeakMap();
const CLEANUP_OWNERS = new WeakMap();

/** Validate the exact public projection bound by targetTrainingBaseAuthoritySha256. Pure. */
export const targetTrainingBaseAuthority = (value) => {
  assertBoundedPlainData(value, {
    field: 'target training base authority',
    maxDepth: 2,
    maxNodes: 32,
    maxStringBytes: 512,
    maxKeyBytes: 64,
    maxOutputBytes: 8 * 1024,
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== FIELDS.join('\0')
    || value.schemaVersion !== 2
    || !SERVING_KEY.test(String(value.targetServingModel || ''))
    || !MODEL_ID.test(String(value.trainerModelId || ''))
    || !REVISION.test(String(value.trainerRevision || ''))
    || !REVISION.test(String(value.lineageConfigSourceCommit || ''))
    || value.lineageConfigSourceMode !== '100644'
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(String(value.lineageConfigObjectId || ''))) {
    throw new Error('target training base authority shape is invalid');
  }
  for (const field of [
    'baseArtifactSha256', 'baseModelIdentitySha256', 'lineageConfigSha256',
    'lineageConfigSourceIdentitySha256', 'servingLineageSha256',
    'targetServingArtifactSha256', 'tokenizerSha256',
  ]) {
    if (!SHA256.test(String(value[field] || ''))) throw new Error(`${field} must be sha256`);
  }
  const projection = Object.freeze(Object.fromEntries(FIELDS.map((field) => [field, value[field]])));
  const lineage = Object.freeze({
    servingModel: projection.targetServingModel,
    servingArtifactSha256: projection.targetServingArtifactSha256,
    trainerModelId: projection.trainerModelId,
    trainerRevision: projection.trainerRevision,
    baseArtifactSha256: projection.baseArtifactSha256,
    tokenizerSha256: projection.tokenizerSha256,
    baseModelIdentitySha256: projection.baseModelIdentitySha256,
  });
  if (projection.baseModelIdentitySha256 !== refinementSha256({
    modelId: projection.targetServingModel,
    modelArtifactSha256: projection.baseArtifactSha256,
    tokenizerSha256: projection.tokenizerSha256,
  }) || projection.servingLineageSha256 !== refinementServingLineageSha256(lineage)) {
    throw new Error('target training base authority identities are inconsistent');
  }
  return projection;
};

/** Digest the one exact target-B training authority projection. Pure. */
export const targetTrainingBaseAuthoritySha256 = (value) =>
  refinementSha256(targetTrainingBaseAuthority(value));

const closeResources = async (state) => {
  const failures = [];
  for (let index = state.resources.length - 1; index >= 0; index -= 1) {
    const entry = state.resources[index];
    if (entry.closed) continue;
    try {
      await entry.close();
      entry.closed = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'target training base authority cleanup failed');
  }
};

const closeState = (state) => {
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.closePromise) return state.closePromise;
  if (!['open', 'cleanup-failed'].includes(state.phase)) {
    return Promise.reject(new Error(`target training base authority cleanup is ${state.phase}`));
  }
  state.phase = 'closing';
  state.closePromise = closeResources(state).then(
    () => {
      state.phase = 'closed';
      return true;
    },
    (error) => {
      state.phase = 'cleanup-failed';
      throw error;
    },
  ).finally(() => {
    state.closePromise = null;
  });
  return state.closePromise;
};

const stateFor = (authority, suppliedOperation, active = true) => {
  const operation = active
    ? assertRefinementProcessOperation(suppliedOperation)
    : assertRefinementProcessOperationIdentity(suppliedOperation);
  const bound = TARGET_OWNERS.get(authority);
  if (!bound || bound.state.operation !== operation) {
    throw new Error('target training base authority owner is invalid');
  }
  return bound;
};

const verifyState = async (state, role) => {
  if (state.owner !== role || state.phase !== 'open') {
    throw new Error(`target training base authority ${role} owner is ${state.owner}/${state.phase}`);
  }
  const operation = assertRefinementProcessOperation(state.operation);
  assertRefinementSourceAuthority(state.sourceAuthority, operation);
  assertRefinementSourceResolver(state.sourceResolver, operation);
  await verifyCommittedRefinementLineageConfigAuthority(
    state.lineageConfigAuthority,
    operation,
  );
  await state.servingAuthority.verify(operation);
  operation.assertActive();
  if (targetTrainingBaseAuthoritySha256(state.projection) !== state.sha256) {
    throw new Error('target training base authority changed');
  }
  return state.projection;
};

const authorityView = (state, role) => {
  const authority = Object.freeze({
    kind: 'refinement-target-training-base-authority-v3',
    projection: state.projection,
    sha256: state.sha256,
  });
  TARGET_OWNERS.set(authority, { state, role });
  return authority;
};

const cleanupAuthorityFor = (state) => {
  if (state.cleanupAuthority) return state.cleanupAuthority;
  const authority = Object.freeze({
    kind: 'refinement-target-training-base-cleanup-authority-v1',
  });
  state.cleanupAuthority = authority;
  CLEANUP_OWNERS.set(authority, state);
  return authority;
};

// `reason` carries WHY acquisition refused. Without it every refusal — an
// unauthorized serving tuple, an unavailable Git executable, a dirty checkout —
// collapses into one indistinguishable code, and a guard that cannot say what
// it refused for cannot be told apart from one that broke.
const failedAcquisition = (errorCode, cleanupAuthority, reason = null) => Object.freeze({
  ok: false,
  errorCode,
  cleanupAuthority,
  reason,
});

// Each layer rewraps with a generic label and keeps the specific refusal on
// `cause`; the innermost message is the one that says what actually happened.
const rootReason = (error) => {
  let current = error;
  for (let depth = 0; depth < 8 && current?.cause instanceof Error; depth += 1) {
    current = current.cause;
  }
  return typeof current?.message === 'string' && current.message ? current.message : null;
};

const acquisitionFailure = async (state, cause = null) => {
  const reason = rootReason(cause);
  const cleanupAuthority = cleanupAuthorityFor(state);
  try {
    await closeState(state);
  } catch {
    return failedAcquisition('TRAINING_EXECUTION_CLEANUP_REQUIRED', cleanupAuthority, reason);
  }
  return failedAcquisition('TARGET_TRAINING_BASE_UNAVAILABLE', cleanupAuthority, reason);
};

/** Retry one failed acquisition/owner cleanup under the same operation. Impure. */
export const retryTargetTrainingBaseAuthorityCleanup = async (
  cleanupAuthority,
  suppliedOperation,
) => {
  const operation = assertRefinementProcessOperationIdentity(suppliedOperation);
  const state = CLEANUP_OWNERS.get(cleanupAuthority);
  if (!state || state.operation !== operation) {
    throw new Error('target training base cleanup authority is unavailable');
  }
  try {
    await closeState(state);
    CLEANUP_OWNERS.delete(cleanupAuthority);
    return Object.freeze({ ok: true });
  } catch {
    return failedAcquisition('TRAINING_EXECUTION_CLEANUP_REQUIRED', cleanupAuthority);
  }
};

/** Verify the exact target lineage and held serving artifact. Impure. */
export const verifyTargetTrainingBaseAuthority = async (authority, operation) => {
  const { state, role } = stateFor(authority, operation);
  return verifyState(state, role);
};

/** Transfer one prepared target-base owner exactly once. */
export const transferTargetTrainingBaseAuthority = (authority, operation) => {
  const { state, role } = stateFor(authority, operation);
  if (role !== 'prepared' || state.owner !== role || state.phase !== 'open') {
    throw new Error('target training base authority cannot be transferred');
  }
  state.owner = 'transferred';
  return authorityView(state, 'transferred');
};

/** Close or demote one target-base owner to an opaque retry-only cleanup owner. Impure. */
export const closeTargetTrainingBaseAuthority = async (authority, suppliedOperation) => {
  const { state, role } = stateFor(authority, suppliedOperation, false);
  if (state.owner !== role) return Object.freeze({ ok: true, closed: false });
  try {
    const closed = await closeState(state);
    TARGET_OWNERS.delete(authority);
    return Object.freeze({ ok: true, closed });
  } catch {
    TARGET_OWNERS.delete(authority);
    state.owner = 'cleanup';
    return failedAcquisition(
      'TRAINING_EXECUTION_CLEANUP_REQUIRED',
      cleanupAuthorityFor(state),
    );
  }
};

const targetCatalogEntry = (targetRequest, operation) => {
  if (typeof targetRequest !== 'string' || !SERVING_KEY.test(targetRequest)
    || targetRequest !== targetRequest.normalize('NFC')
    || Buffer.byteLength(targetRequest, 'utf8') > 256) {
    throw new Error('target request must be one exact serving catalog key');
  }
  operation.assertActive();
  const matches = listCatalog(CATALOG_ENVIRONMENT)
    .filter((entry) => entry.id === targetRequest);
  operation.assertActive();
  if (matches.length !== 1 || !matches[0].path) {
    throw new Error('target request does not resolve to exactly one server catalog model');
  }
  return matches[0];
};

/** Open one server-catalog target and exact committed lineage under one branded operation. */
export const openTargetTrainingBaseAuthority = async (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'operation,sourceAuthority,targetRequest') {
    throw new Error('target training base request shape is invalid');
  }
  const operation = assertRefinementProcessOperation(input.operation);
  const sourceAuthority = assertRefinementSourceAuthority(input.sourceAuthority, operation);
  const sourceResolver = projectRefinementSourceResolver(sourceAuthority, operation);
  const state = {
    operation,
    sourceAuthority,
    sourceResolver,
    resources: [],
    lineageConfigAuthority: null,
    servingAuthority: null,
    projection: null,
    sha256: null,
    owner: 'acquiring',
    phase: 'open',
    closePromise: null,
    cleanupAuthority: null,
  };
  try {
    const catalogEntry = targetCatalogEntry(input.targetRequest, operation);
    state.lineageConfigAuthority = await openCommittedRefinementLineageConfigAuthority({
      sourceAuthority,
      operation,
    });
    state.resources.push({
      close: () => closeCommittedRefinementLineageConfigAuthority(
        state.lineageConfigAuthority,
        operation,
      ),
      closed: false,
    });
    assertRefinementSourceResolver(sourceResolver, operation);
    state.servingAuthority = await openServingModelTrainingLineageFromAuthority({
      modelPath: catalogEntry.path,
      servingModel: input.targetRequest,
      lineageConfigAuthority: state.lineageConfigAuthority,
      operation,
    });
    state.resources.push({
      close: () => state.servingAuthority.close(operation),
      closed: false,
    });
    assertRefinementSourceResolver(sourceResolver, operation);
    const lineage = state.servingAuthority.lineage;
    const lineageConfig = projectCommittedRefinementLineageConfigAuthority(
      state.lineageConfigAuthority,
      operation,
    );
    state.projection = targetTrainingBaseAuthority({
      schemaVersion: 2,
      targetServingModel: lineage.servingModel,
      targetServingArtifactSha256: lineage.servingArtifactSha256,
      baseModelIdentitySha256: lineage.baseModelIdentitySha256,
      servingLineageSha256: refinementServingLineageSha256(lineage),
      trainerModelId: lineage.trainerModelId,
      trainerRevision: lineage.trainerRevision,
      baseArtifactSha256: lineage.baseArtifactSha256,
      tokenizerSha256: lineage.tokenizerSha256,
      lineageConfigSha256: lineageConfig.lineageConfigSha256,
      lineageConfigSourceIdentitySha256: lineageConfig.lineageConfigSourceIdentitySha256,
      lineageConfigSourceCommit: lineageConfig.lineageConfigSourceCommit,
      lineageConfigSourceMode: lineageConfig.lineageConfigSourceMode,
      lineageConfigObjectId: lineageConfig.lineageConfigObjectId,
    });
    state.sha256 = targetTrainingBaseAuthoritySha256(state.projection);
    state.owner = 'prepared';
    const authority = authorityView(state, 'prepared');
    await verifyState(state, 'prepared');
    return Object.freeze({ ok: true, authority });
  } catch (error) {
    return acquisitionFailure(state, error);
  }
};
