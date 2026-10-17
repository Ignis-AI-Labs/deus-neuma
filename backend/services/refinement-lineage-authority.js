import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { deepFreezePlainData } from '../../core/shared/plain-data-canonical.js';
import {
  closeFixedRefinementSourceBlob,
  openFixedRefinementSourceBlob,
  projectFixedRefinementSourceBlob,
  readFixedRefinementSourceBlob,
  verifyFixedRefinementSourceBlob,
} from './refinement-source-authority.js';
import { parseBoundedStrictJson } from './refinement-strict-json.js';

const SHA256 = /^[0-9a-f]{64}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const AUTHORITY_BYTES_MAX = 256 * 1024;
const AUTHORITY_LINEAGES_MAX = 256;
const AUTHORITY_FIELDS = Object.freeze(['lineages', 'version']);
const LINEAGE_FIELDS = Object.freeze([
  'baseArtifactSha256',
  'baseModelIdentitySha256',
  'servingArtifactSha256',
  'servingModel',
  'tokenizerSha256',
  'trainerModelId',
  'trainerRevision',
]);
const SERVING_LINEAGE_DIGEST_FIELDS = Object.freeze([
  'servingModel',
  'servingArtifactSha256',
  'trainerModelId',
  'trainerRevision',
  'baseArtifactSha256',
  'tokenizerSha256',
]);
const authorityStates = new WeakMap();



const boundedLabel = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= 512
  && value.trim() === value
  && !/[\u0000-\u001f\u007f]/.test(value);

const validatedTuple = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== LINEAGE_FIELDS.join('\0')) {
    throw new Error('refinement lineage authority contains an invalid tuple shape');
  }
  if (!boundedLabel(value.servingModel)
    || !MODEL_ID.test(String(value.trainerModelId || ''))
    || !REVISION.test(String(value.trainerRevision || ''))) {
    throw new Error('refinement lineage authority contains an invalid model identity');
  }
  for (const field of [
    'servingArtifactSha256',
    'baseArtifactSha256',
    'tokenizerSha256',
    'baseModelIdentitySha256',
  ]) {
    if (!SHA256.test(String(value[field] || ''))) {
      throw new Error(`refinement lineage authority contains an invalid ${field}`);
    }
  }
  const identity = refinementSha256({
    modelId: value.servingModel,
    modelArtifactSha256: value.baseArtifactSha256,
    tokenizerSha256: value.tokenizerSha256,
  });
  if (value.baseModelIdentitySha256 !== identity) {
    throw new Error('refinement lineage authority contains an invalid base identity');
  }
  return Object.freeze(Object.fromEntries(LINEAGE_FIELDS.map((field) => [field, value[field]])));
};

/**
 * Digest the exact serving/trainer tuple without collapsing catalog identity
 * into base bytes. Callers must preserve every canonical string verbatim.
 */
export const refinementServingLineageSha256 = (value) => {
  const tuple = validatedTuple(value);
  return refinementSha256(Object.fromEntries(
    SERVING_LINEAGE_DIGEST_FIELDS.map((field) => [field, tuple[field]]),
  ));
};

const validatedLineage = (value) => Object.freeze(validatedTuple(value));

/** Strict pure validation for offline display/tooling. It mints no authority. */
export const validateRefinementLineageAuthorityDocument = (parsed) => {
  deepFreezePlainData(parsed, {
    field: 'refinement lineage authority',
    maxDepth: 32,
    maxNodes: 100_000,
    maxStringBytes: AUTHORITY_BYTES_MAX,
    maxKeyBytes: 512,
    maxOutputBytes: AUTHORITY_BYTES_MAX,
  });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Reflect.ownKeys(parsed).sort().join('\0') !== AUTHORITY_FIELDS.join('\0')
    || parsed.version !== 1 || !Array.isArray(parsed.lineages)
    || parsed.lineages.length > AUTHORITY_LINEAGES_MAX) {
    throw new Error('refinement lineage authority has an invalid document shape');
  }
  const lineages = Object.freeze(parsed.lineages.map(validatedLineage));
  const keys = lineages.map(({ servingModel }) => servingModel);
  if (new Set(keys).size !== keys.length) {
    throw new Error('refinement lineage authority contains a duplicate serving key');
  }
  return Object.freeze({ version: 1, lineages });
};



const exactOpenInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new Error('committed lineage config request is invalid');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ['operation', 'sourceAuthority'];
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length
    || keys.some((key) => typeof key !== 'string' || !fields.includes(key))
    || fields.some((field) => !Object.hasOwn(descriptors[field], 'value'))) {
    throw new Error('committed lineage config request is invalid');
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [
    field, descriptors[field].value,
  ])));
};

const liveState = (authority, operation, active = true) => {
  const state = authorityStates.get(authority);
  if (!state || state.operation !== operation) {
    throw new Error('committed refinement lineage config authority is invalid');
  }
  if (active && state.phase !== 'open') {
    throw new Error(`committed refinement lineage config authority is ${state.phase}`);
  }
  return state;
};

/** Pin the one server-declared lineage config blob from the exact committed source tree. */
export const openCommittedRefinementLineageConfigAuthority = async (input) => {
  const exact = exactOpenInput(input);
  let sourceBlob = null;
  try {
    sourceBlob = await openFixedRefinementSourceBlob({
      sourceAuthority: exact.sourceAuthority,
      operation: exact.operation,
      kind: 'lineage-config',
    });
    const read = await readFixedRefinementSourceBlob(sourceBlob, exact.operation);
    const parsed = parseBoundedStrictJson(
      new TextDecoder('utf-8', { fatal: true }).decode(read.content),
      {
        maximumBytes: AUTHORITY_BYTES_MAX,
        label: 'committed refinement lineage config',
      },
    );
    const document = validateRefinementLineageAuthorityDocument(parsed);
    await verifyFixedRefinementSourceBlob(sourceBlob, exact.operation);
    const source = projectFixedRefinementSourceBlob(sourceBlob, exact.operation);
    const projection = Object.freeze({
      lineageConfigSha256: source.sha256,
      lineageConfigSourceCommit: source.sourceCommit,
      lineageConfigSourceMode: source.mode,
      lineageConfigObjectId: source.objectId,
      lineageConfigSourceIdentitySha256: source.sourceIdentitySha256,
    });
    const authority = Object.freeze({
      kind: 'committed-refinement-lineage-config-authority-v2',
    });
    authorityStates.set(authority, {
      operation: exact.operation,
      sourceBlob,
      document,
      projection,
      phase: 'open',
      closePromise: null,
    });
    return authority;
  } catch (error) {
    if (!sourceBlob) throw error;
    try {
      await closeFixedRefinementSourceBlob(sourceBlob, exact.operation);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'committed lineage config acquisition cleanup failed', { cause: cleanupError },
      );
    }
    throw error;
  }
};

export const projectCommittedRefinementLineageConfigAuthority = (authority, operation) =>
  liveState(authority, operation).projection;

export const verifyCommittedRefinementLineageConfigAuthority = async (authority, operation) => {
  const state = liveState(authority, operation);
  await verifyFixedRefinementSourceBlob(state.sourceBlob, operation);
  return authority;
};

export const resolveRefinementLineageAuthority = async ({
  lineageConfigAuthority,
  operation,
  servingArtifactSha256,
  servingModel,
}) => {
  const state = liveState(lineageConfigAuthority, operation);
  await verifyCommittedRefinementLineageConfigAuthority(lineageConfigAuthority, operation);
  const matches = state.document.lineages.filter((lineage) =>
    lineage.servingModel === servingModel
    && lineage.servingArtifactSha256 === servingArtifactSha256);
  if (matches.length !== 1) {
    throw new Error('no committed refinement lineage authorizes the requested serving tuple');
  }
  return matches[0];
};

export const assertCommittedRefinementLineageEvidence = async ({
  evidence,
  lineageConfigAuthority,
  operation,
  servingArtifactSha256,
  servingModel,
}) => {
  const trusted = await resolveRefinementLineageAuthority({
    lineageConfigAuthority,
    operation,
    servingArtifactSha256,
    servingModel,
  });
  const candidate = validatedTuple(evidence);
  if (LINEAGE_FIELDS.some((field) => candidate[field] !== trusted[field])) {
    throw new Error('refinement lineage evidence differs from committed source authority');
  }
  return trusted;
};

/** Retryable close bound to the exact operation that acquired the held blob. */
export const closeCommittedRefinementLineageConfigAuthority = (
  authority,
  operation,
) => {
  const state = liveState(authority, operation, false);
  if (state.phase === 'closed') return Promise.resolve(false);
  if (state.closePromise) return state.closePromise;
  state.phase = 'closing';
  state.closePromise = closeFixedRefinementSourceBlob(state.sourceBlob, operation).then(
    () => {
      state.phase = 'closed';
      return true;
    },
    (error) => {
      state.phase = 'cleanup-failed';
      throw error;
    },
  ).finally(() => { state.closePromise = null; });
  return state.closePromise;
};
