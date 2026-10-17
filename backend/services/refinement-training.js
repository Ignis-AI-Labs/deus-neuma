// Refinement training runner (LORA-04) — one provenance-bound, single-flight forge.
//
// Every immutable input is already owned by the active training token before a
// single child runs: the packed execution authority, the target snapshot, the
// staged corpus, the GPU lease, and the disk quota. The forge re-verifies that
// whole union at each stage boundary instead of re-hashing files on disk — a
// path can be raced between the hash and the spawn, a held descriptor cannot.

import { createLogger } from './logger.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { recordTrainingFailure } from '../../core/refinement/ceremony.js';
import { getConfig } from './llm-provider.js';
import { activeLaunchConfig, supervisorStatus, stopSupervised } from './llama-server-supervisor.js';
import { substrateBusy } from './substrate-lifecycle.js';
import { resolveCompletedTrainingConfig } from './refinement-trainer-contract.js';
import {
  MAX_REFINEMENT_TRAINER_FACTS_BYTES,
  trainerFacts,
} from './refinement-trainer-facts.js';
import { pushTailLine } from './refinement-training-state.js';
import { hashRefinementHandle } from './refinement-process-operation.js';
import {
  releaseStagedArtifactHandle,
  stageArtifactHandle,
  verifyStagedArtifactHandle,
} from './refinement-artifact-staging.js';
import { refinementTrainingAuthority } from './refinement-training-authority.js';
import { publishForgedAdapter } from './refinement-training-publication.js';
import {
  assertTargetTrainingSnapshotAuthority,
} from './refinement-target-snapshot-authority.js';
import { withRefinementTrainingWorkRoot } from './refinement-training-reservation.js';
import {
  withRefinementTrainingAdapterHandle,
  withRefinementTrainingFacts,
  withRefinementTrainingWorkFiles,
} from './refinement-training-work-files.js';
import {
  runRefinementConverterStep,
  runRefinementMaterializerStep,
  runRefinementTrainerStep,
} from './refinement-training-process-resource.js';
import {
  activeTrainingResources,
  verifyActiveTrainingResources,
} from './refinement-active-training-token.js';
import {
  availableMemoryBytes,
  forgeMemoryVerdict,
  runWatchdogStep,
  startMemoryWatchdog,
} from './refinement-training-watchdog.js';
import {
  openRefinementTrainingLaunch,
  prepareRefinementTrainingApproval,
} from './refinement-training-launch.js';
export { runStep } from './refinement-process-scope.js';
export { baseSlug, isRedrawFrame, nextAdapterId, pushTailLine } from './refinement-training-state.js';
export { forgeMemoryVerdict, startMemoryWatchdog } from './refinement-training-watchdog.js';

const log = createLogger('RefinementTraining');

/** Cancel and await an exact forge before committing its closing transition. impure. */
export const withTrainingCancellation = (neumaId, ceremonyId, work) =>
  refinementTrainingAuthority.cancelAndRun(neumaId, ceremonyId, work);
// The one in-flight (or last finished) job. Kept whole for the status view.
let job = null;

const jobRunning = () => Boolean(job && !job.finishedAt);

/** Honest trainer progress and outcome for the desk. */
export const trainingStatus = () => {
  if (!job) return { running: false };
  return {
    running: jobRunning(),
    neumaId: job.neumaId,
    ceremonyId: job.ceremonyId,
    adapterId: job.adapterId,
    stage: job.stage,
    startedAt: job.startedAt,
    lines: [...job.lines],
    lossFirst: job.lossFirst ?? null,
    lossLast: job.lossLast ?? null,
    step: job.step ?? null,
    steps: job.steps ?? null,
    trainingConfigSha256: job.trainingConfigSha256,
    geometrySha256: job.geometrySha256,
    trainingBudgetSha256: job.trainingBudgetSha256,
    ...(job.finishedAt && { finishedAt: job.finishedAt }),
    ...(job.error && { error: job.error }),
    ...(job.code && { code: job.code }),
    ...(job.adapter && { adapter: job.adapter }),
  };
};

const onLine = (line) => {
  pushTailLine(job.lines, line);
  const m = line.match(/^step (\d+)\/(\d+) loss ([0-9.]+)$/);
  if (m) {
    job.step = Number(m[1]);
    job.steps = Number(m[2]);
    if (job.lossFirst == null) job.lossFirst = Number(m[3]);
    job.lossLast = Number(m[3]);
  }
};

/** Clear only an idle substrate this process owns. Pure. */
export const shouldClearSubstrateForTraining = ({ provider, serving, owned, busy }) =>
  provider === 'llama-server' && serving && owned && !busy;

const CLEAR_BUSY_WAIT_MS = 60_000;
const CLEAR_BUSY_POLL_MS = 3_000;

const GB = (bytes) => (bytes / 1024 ** 3).toFixed(1);
/** Refuse mixture-of-experts bases whose fused expert weights evade 4-bit loading. Pure.
 *  Reads the RAW config.json vocabulary (snake_case, expert counts) — the shapes
 *  that killed three forges arrive unnormalized, and a name-only regex misses
 *  Mixtral/DeepSeek-style configs with no 'moe' in any string (#324). */
export const quantizationOutlook = (config) => {
  const expertCount = Number(config?.num_experts ?? config?.num_local_experts
    ?? config?.n_routed_experts ?? 0);
  const moe = config?.mixtureOfExperts === true
    || expertCount > 0
    || /moe/i.test(String(config?.modelType ?? config?.model_type ?? ''))
    || (config?.architectures || []).some((architecture) => /moe/i.test(architecture));
  if (moe) {
    return {
      quantizable: false,
      reason: 'this base is a mixture-of-experts model, and 4-bit conversion does not reach expert weights — '
        + 'it would load at full precision instead',
    };
  }
  return { quantizable: true, reason: null };
};


// impure — best-effort return of the supervised substrate's memory before training.
const clearSubstrateForTraining = async () => {
  try {
    const provider = getConfig().provider;
    if (provider !== 'llama-server') return;
    const launchCfg = activeLaunchConfig(process.env);
    const deadline = Date.now() + CLEAR_BUSY_WAIT_MS;
    for (;;) {
      const st = await supervisorStatus(launchCfg);
      if (!st.serving) return;
      if (!st.owned) {
        log.warn('substrate serving but not NEUMA-owned — training proceeds beside it; memory may not fit');
        return;
      }
      const busy = await substrateBusy(launchCfg);
      if (shouldClearSubstrateForTraining({ provider, serving: st.serving, owned: st.owned, busy })) {
        await stopSupervised();
        log.info('substrate memory returned for training — verification reloads it with the artifact');
        return;
      }
      if (Date.now() >= deadline) {
        log.warn('substrate stayed mid-generation past the clear window — training proceeds; memory may not fit');
        return;
      }
      await new Promise((r) => setTimeout(r, CLEAR_BUSY_POLL_MS));
    }
  } catch (err) {
    log.warn('substrate clear before training failed — proceeding', { err: err.message });
  }
};

const refuse = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/** Refuse a forge this rig cannot hold before any child is spawned. impure. */
const assertForgeCapacity = (cfg, inspection, snapshot) => {
  if (cfg.load4bit) {
    const outlook = quantizationOutlook(inspection.baseConfig);
    if (!outlook.quantizable) {
      throw refuse(
        `${cfg.base} cannot be trained in 4-bit on this machine: ${outlook.reason}. `
        + 'Forge against a dense base of similar size instead — and note the adapter must match '
        + 'the base this being is SERVED on, so the serving conduit needs to be that base too.',
        'BASE_NOT_QUANTIZABLE',
      );
    }
  }
  const ckpt = snapshot.totalBytes;
  const avail = availableMemoryBytes();
  const verdict = forgeMemoryVerdict({ checkpointBytes: ckpt, availableBytes: avail });
  log.info('forge memory check', {
    base: cfg.base, checkpointGB: GB(ckpt), availableGB: GB(avail), requiredGB: GB(verdict.requiredBytes),
  });
  if (!verdict.fits) {
    throw refuse(
      `Not enough memory to forge: ${GB(verdict.requiredBytes)} GB needed for ${cfg.base}, `
      + `${GB(avail)} GB available — short by ${GB(verdict.shortfallBytes)} GB. `
      + 'Free memory and light the forge again (stopping the substrate returns the most, '
      + 'and closing other heavy apps returns the rest).',
      'INSUFFICIENT_MEMORY',
    );
  }
};

/** Materialize, train, convert, and stage inside one held work root. impure. */
const runForge = async ({ ceremony, plan, bindingContext, token, watchdog, workFiles }) => {
  const resources = activeTrainingResources(token);
  const { operation, executionAuthority, gpuReservation } = resources;
  const cfg = plan.config;
  const step = {
    executionAuthority,
    executionEnvelope: cfg.executionEnvelope,
    workFiles,
    adapterId: job.adapterId,
    operation,
  };

  job.stage = 'materializing';
  await runWatchdogStep(watchdog, () => runRefinementMaterializerStep(step, onLine));

  job.stage = 'training';
  await verifyActiveTrainingResources(token);
  await runWatchdogStep(watchdog, () => runRefinementTrainerStep({
    ...step,
    snapshotAuthority: resources.targetTrainingSnapshotAuthority,
    corpusAuthority: resources.corpusAuthority,
    gpuReservation,
    config: cfg,
    timeoutMs: watchdog.observed.durationMs,
  }, onLine));
  await verifyActiveTrainingResources(token);

  const facts = await withRefinementTrainingFacts(
    workFiles,
    executionAuthority,
    operation,
    ({ bytes }) => trainerFacts(JSON.parse(bytes.toString('utf8')), {
      sampleCount: cfg.budget.sampleCount,
      minimumCompletionTokens: cfg.budget.minimumCompletionTokens,
      snapshotManifestSha256: cfg.snapshotManifestSha256,
      gpuLease: gpuReservation.gpuLease,
    }),
  );
  job.tokenBudget = facts.tokenBudget;
  job.targetModules = facts.targetModules;
  const completedCfg = resolveCompletedTrainingConfig(cfg, facts);
  job.trainingConfigSha256 = completedCfg.sha256;
  job.geometrySha256 = completedCfg.geometry.sha256;
  job.trainingBudgetSha256 = completedCfg.budget.sha256;

  job.stage = 'converting';
  await runWatchdogStep(watchdog, () => runRefinementConverterStep({
    ...step,
    snapshotAuthority: resources.targetTrainingSnapshotAuthority,
    config: cfg,
    timeoutMs: watchdog.observed.durationMs,
  }, onLine));
  await verifyActiveTrainingResources(token);
  watchdog.stop();

  job.stage = 'registering';
  const maximumBytes = cfg.executionEnvelope.resources.adapterArtifactMaxBytes;
  const authority = await withRefinementTrainingAdapterHandle(
    workFiles,
    executionAuthority,
    operation,
    async (handle) => {
      const { sha256 } = await hashRefinementHandle({
        handle, maximumBytes, label: `trained adapter ${job.adapterId}`, operation,
      });
      return stageArtifactHandle({
        sourceHandle: handle,
        sha256,
        maximumBytes,
        label: `trained adapter ${job.adapterId}`,
        operation,
      });
    },
  );
  let primary = null;
  let adapter = null;
  try {
    const { sha256 } = await verifyStagedArtifactHandle(authority, operation);
    adapter = await publishForgedAdapter({
      ceremony, plan, bindingContext, token, resources, completedCfg,
      adapterId: job.adapterId,
      lossFirst: job.lossFirst ?? undefined,
      lossLast: job.lossLast ?? undefined,
      artifact: { authority, sha256 },
    });
  } catch (error) {
    primary = error;
  }
  try { await releaseStagedArtifactHandle(authority, operation); }
  catch (cleanup) {
    throw primary
      ? new AggregateError([primary, cleanup], 'adapter publication and cleanup failed')
      : cleanup;
  }
  if (primary) throw primary;
  return adapter;
};

const runJob = async ({ ceremony, plan, bindingContext, token }) => {
  const { neumaId } = ceremony;
  const resources = activeTrainingResources(token);
  const { operation } = resources;
  let watchdog = null;
  try {
    job.stage = 'clearing-substrate';
    await clearSubstrateForTraining();
    const projection = assertTargetTrainingSnapshotAuthority(
      resources.targetTrainingSnapshotAuthority,
      operation,
    );
    assertForgeCapacity(plan.config, plan.inspection, projection.snapshot);
    watchdog = startMemoryWatchdog({ cancellationSignal: operation.signal });
    const adapter = await withRefinementTrainingWorkRoot(
      resources.diskReservation,
      operation,
      (root) => withRefinementTrainingWorkFiles({
        adapterId: job.adapterId,
        adapterMaximumBytes: plan.config.executionEnvelope.resources.adapterArtifactMaxBytes,
        executionAuthority: resources.executionAuthority,
        factsMaximumBytes: MAX_REFINEMENT_TRAINER_FACTS_BYTES,
        operation,
        root,
      }, (workFiles) => runForge({
        ceremony, plan, bindingContext, token, watchdog, workFiles,
      })),
    );
    job.adapter = { id: adapter.id, baseModel: adapter.baseModel, sha256: adapter.sha256 };
    log.info('Refinement training complete', {
      neumaId, adapter: adapter.id, lossFirst: job.lossFirst, lossLast: job.lossLast,
    });
  } catch (error) {
    job.error = error.message;
    job.code = error.code ?? null;
    log.error('Refinement training failed', { neumaId, ceremonyId: ceremony.id, error: error.message });
    try {
      const current = await neumaWorkspace.readCeremony(neumaId, ceremony.id);
      if (current?.phase === 'training') {
        await neumaWorkspace.writeCeremony(
          neumaId,
          recordTrainingFailure(current, { error: error.message, at: new Date().toISOString() }),
        );
      }
    } catch (recordError) {
      log.error('Could not record training failure on the ceremony', { error: recordError.message });
    }
  } finally {
    watchdog?.stop();
    job.finishedAt = new Date().toISOString();
  }
};

/**
 * Return the exact immutable plan an authenticated operator must approve, plus
 * the single-use token that plan is bound to and the moment it expires.
 */
export const prepareTrainingApproval = (start) => prepareRefinementTrainingApproval(start);

/**
 * Consume the operator's approval exactly once, adopt every forge resource the
 * approval reserved, and attach the running forge to the active token.
 */
export const startTraining = async (start) => {
  const launch = await openRefinementTrainingLaunch(start);
  const { token, plan, decision, bindingContext } = launch;
  job = {
    neumaId: decision.neumaId,
    ceremonyId: decision.ceremonyId,
    adapterId: plan.adapterId,
    stage: 'starting',
    startedAt: new Date().toISOString(),
    lines: [],
    lossFirst: null,
    lossLast: null,
    tokenBudget: null,
    targetModules: null,
    finishedAt: null,
    error: null,
    code: null,
    adapter: null,
    trainingConfigSha256: plan.config.sha256,
    geometrySha256: plan.config.geometry.sha256,
    trainingBudgetSha256: plan.config.budget.sha256,
  };
  const record = job;
  const completion = refinementTrainingAuthority.attach(token, runJob({
    ceremony: decision.record,
    plan,
    bindingContext,
    token,
  }));
  record.completion = completion;
  // runJob absorbs its own failure into the job record, so the only rejection
  // left here is the token's resource release. A leaked GPU lease or disk quota
  // is reported on the desk and in the log — never dropped on the floor, and
  // never left as an unhandled rejection because nobody happened to abandon.
  completion.catch((error) => {
    record.error = record.error ?? error.message;
    record.code = record.code ?? error.code ?? 'TRAINING_EXECUTION_CLEANUP_REQUIRED';
    log.error('Forge resource release failed after training', {
      neumaId: record.neumaId, ceremonyId: record.ceremonyId, error: error.message,
    });
  });
  return trainingStatus();
};
