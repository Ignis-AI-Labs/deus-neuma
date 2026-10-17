import path from 'node:path';
import { sha256FileStable } from './file-digest.js';
import {
  openServingModelTrainingLineageFromAuthority,
  stageServingModelArtifactAuthority,
} from './serving-model-artifact-authority.js';
import {
  closeCommittedRefinementLineageConfigAuthority,
  openCommittedRefinementLineageConfigAuthority,
  projectCommittedRefinementLineageConfigAuthority,
} from './refinement-lineage-authority.js';
import { spawnServingProcessOwner } from './serving-process-owner.js';
import {
  openVerifiedArtifactFile,
  releaseStagedArtifactHandle,
  verifyStagedArtifactHandle,
} from './refinement-artifact-internal/held-authority.js';

export {
  releaseStagedArtifactHandle,
  stageArtifactAuthority,
  stageArtifactFile,
  stageArtifactHandle,
  stageGeneratedArtifactFile,
  stagedArtifactRegistryFields,
  verifyStagedArtifactHandle,
} from './refinement-artifact-internal/held-authority.js';

export const SERVING_MODEL_BYTES_MAX = 64 * 1024 ** 3;
export const SERVING_ADAPTER_BYTES_MAX = 8 * 1024 ** 3;
const preparedServingArtifacts = new WeakMap();

/**
 * The forge-base law, launch side: an adapter boards only onto the exact base
 * it was forged against. The registry records the base in one of two forms —
 * the base artifact's filename (`gemma-4-31B-it-Q8_0.gguf`) or its serving
 * lineage key (`gemma-4-31b`) — so both are accepted, and nothing else: a
 * gemma-forged adapter handed to a qwen base makes llama-server refuse the
 * whole launch (arch mismatch, witnessed 2026-08-18). With the Voice Pack
 * carrying voice across engines, a mismatched adapter simply STAYS BEHIND —
 * the launch proceeds clean. Pure.
 * @param {string} adapterBaseModel - the registry-recorded forge base
 * @param {{model?: string, servingModel?: string|null}} launch - the launch
 */
export const adapterBoardsOntoLaunch = (adapterBaseModel, launch) => {
  if (typeof adapterBaseModel !== 'string' || !adapterBaseModel) return false;
  if (typeof launch?.model === 'string' && launch.model
    && adapterBaseModel === path.basename(launch.model)) return true;
  return typeof launch?.servingModel === 'string' && launch.servingModel
    && adapterBaseModel === launch.servingModel;
};

// `map(releaseStagedArtifactHandle)` would hand the ARRAY INDEX to the second
// parameter, which is the operation — an arrow keeps the real one.
const closeArtifacts = async (artifacts, label, operation) => {
  const results = await Promise.allSettled(
    artifacts.map((artifact) => releaseStagedArtifactHandle(artifact, operation)),
  );
  const failures = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
  if (failures.length) throw new AggregateError(failures, `${label} descriptor release failed`);
};

// The held authority is minted against ONE operation and `sameOperation`
// refuses any other — so the operation that staged these handles must ride in
// the prepared state and come back out for every verify and release.
const verifyPreparedHandles = async (staged) => {
  await verifyStagedArtifactHandle(staged.model, staged.operation);
  for (const { artifact } of staged.adapters) {
    await verifyStagedArtifactHandle(artifact, staged.operation);
  }
  return true;
};
const rememberPreparedServingArtifacts = async (
  config,
  model,
  adapters,
  operation,
  lineageConfig = null,
) => {
  const unique = [...new Map(adapters.map((entry) => [entry.artifact.sha256, entry])).values()]
    .sort((left, right) => `${left.authority.neumaId}\0${left.authority.adapter.id}`
      .localeCompare(`${right.authority.neumaId}\0${right.authority.adapter.id}`));
  const prepared = Object.freeze({ kind: 'prepared-serving-artifacts-v1' });
  const state = {
    phase: 'open',
    closePromise: null,
    transferred: false,
    config,
    model,
    adapters: Object.freeze(unique),
    operation,
    lineageConfig,
  };
  preparedServingArtifacts.set(prepared, state);
  try {
    await verifyPreparedServingArtifacts(prepared);
    return prepared;
  } catch (error) {
    try {
      await releasePreparedServingArtifacts(prepared);
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'prepared serving verification and release failed', { cause: closeError },
      );
    }
    throw error;
  }
};

/** Stage the serving base only. Voice Pack replaced LoRA boarding. */
export const prepareTrustedServingArtifacts = async ({
  config,
  modelAuthority,
  lineageConfig = null,
  root,
  operation = null,
}) => {
  let model = null;
  try {
    model = await stageServingModelArtifactAuthority(modelAuthority, {
      label: 'serving model',
      root,
      maximumBytes: SERVING_MODEL_BYTES_MAX,
      operation,
    });
    await modelAuthority.verify(operation);
    return await rememberPreparedServingArtifacts(
      config, model, [], operation, lineageConfig,
    );
  } catch (error) {
    const held = model ? [model] : [];
    try { await closeArtifacts(held, 'refused serving staging', operation); }
    catch (closeError) {
      throw new AggregateError([error, closeError], 'serving staging and release failed', { cause: closeError });
    }
    throw error;
  } finally {
    await modelAuthority.close(operation);
  }
};

const prepareBaseServingArtifact = async (config, operation) => {
  if (typeof config?.model !== 'string' || !config.model) {
    throw new Error('base serving launch has no model file');
  }
  // Base weights follow the lineage path: verify and retain the source
  // descriptor instead of copying the entire model into the artifact store.
  const model = await openVerifiedArtifactFile({
    sourcePath: config.model,
    sha256: await sha256FileStable(config.model, { maximumBytes: SERVING_MODEL_BYTES_MAX }),
    maximumBytes: SERVING_MODEL_BYTES_MAX,
    label: 'base serving model (held in place)',
    operation,
  });
  return rememberPreparedServingArtifacts(config, model, [], operation);
};

/** Prepare either an explicitly base-only launch or an exact committed supervised lineage. */
export const prepareServingArtifacts = async (
  config,
  { sourceAuthority = null, operation = null } = {},
) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('serving launch configuration is invalid');
  }
  const requestedLoras = config?.loras ?? [];
  if (!Array.isArray(requestedLoras) || requestedLoras.length !== 0) {
    throw new Error('uncommitted adapter launch input refused');
  }
  if (config?.servingModel === null) {
    // Refinement SOURCE authority is what a base-only launch must never carry.
    // The operation is not that — it is the cancellation/deadline scope every
    // `stageArtifactFile` call requires, base or supervised alike. Refusing it
    // here made base-only serving impossible: the guard rejected the operation
    // and the staging primitive beneath demanded one.
    if (sourceAuthority !== null) {
      throw new Error('base-only serving launch must not carry refinement source authority');
    }
    return prepareBaseServingArtifact(config, operation);
  }
  if (typeof config?.servingModel !== 'string' || !config.servingModel) {
    throw new Error('serving launch does not declare a base-only or supervised model identity');
  }
  let lineageConfigAuthority = null;
  let modelAuthority;
  try {
    lineageConfigAuthority = await openCommittedRefinementLineageConfigAuthority({
      sourceAuthority,
      operation,
    });
    modelAuthority = await openServingModelTrainingLineageFromAuthority({
      modelPath: config.model,
      servingModel: config.servingModel,
      lineageConfigAuthority,
      operation,
    });
    const lineageConfig = projectCommittedRefinementLineageConfigAuthority(
      lineageConfigAuthority,
      operation,
    );
    return await prepareTrustedServingArtifacts({
      config,
      modelAuthority,
      lineageConfigAuthority,
      operation,
      lineageConfig,
    });
  } finally {
    if (lineageConfigAuthority) {
      await closeCommittedRefinementLineageConfigAuthority(lineageConfigAuthority, operation);
    }
  }
};

/** Rehash all immutable inputs through the sole prepared owner. */
export const verifyPreparedServingArtifacts = async (prepared) => {
  const staged = preparedServingArtifacts.get(prepared);
  if (!staged || staged.phase !== 'open' || staged.transferred) {
    throw new Error('serving artifact owner is unavailable');
  }
  return verifyPreparedHandles(staged);
};

const closePreparedState = async (prepared, staged) => {
  if (staged.phase === 'closed') return false;
  if (staged.closePromise) return staged.closePromise;
  staged.phase = 'closing';
  staged.closePromise = (async () => {
    try {
      await closeArtifacts(
        [staged.model, ...staged.adapters.map(({ artifact }) => artifact)],
        'prepared serving',
        staged.operation,
      );
      staged.phase = 'closed';
      preparedServingArtifacts.delete(prepared);
      return true;
    } catch (error) {
      staged.phase = 'cleanup-failed';
      throw error;
    }
  })();
  try {
    return await staged.closePromise;
  } finally {
    staged.closePromise = null;
  }
};

/**
 * Transfer one prepared owner directly into the opaque process owner. No
 * descriptor, child path, or verifier closure crosses the supervisor boundary.
 */
export const spawnPreparedServingArtifacts = async (
  prepared,
  { stdio, gpuAuthority, operation },
) => {
  const staged = preparedServingArtifacts.get(prepared);
  if (!staged || staged.phase !== 'open' || staged.transferred) {
    throw new Error('serving artifact owner is unavailable for spawn');
  }
  await verifyPreparedHandles(staged);
  staged.transferred = true;
  const artifacts = Object.freeze({
    model: staged.model,
    adapters: staged.adapters,
    verify: () => verifyPreparedHandles(staged),
    close: () => closePreparedState(prepared, staged),
  });
  return spawnServingProcessOwner({
    executable: staged.config.bin,
    config: staged.config,
    artifacts,
    lineageConfig: staged.lineageConfig,
    stdio,
    gpuAuthority,
    operation,
  });
};

/** Release a prepared owner that has not transferred into a child process. */
export const releasePreparedServingArtifacts = async (prepared) => {
  const staged = preparedServingArtifacts.get(prepared);
  if (!staged) return false;
  if (staged.transferred) {
    throw new Error('serving artifact ownership already transferred to the process owner');
  }
  return closePreparedState(prepared, staged);
};
