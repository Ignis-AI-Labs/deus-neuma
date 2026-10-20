/**
 * Owns llama-server's prepared local process, health, claims, reloads, and
 * immutable launch attestation. Planning stays pure; process work is impure.
 */
import { existsSync, mkdirSync, openSync, closeSync } from 'fs';
import { fittedLaunch } from './serving-fit.js';
import path from 'path';
import { createLogger } from './logger.js';
import {
  clearClaim, freshStopIntent, ownedByNeuma, readClaim,
  serverLogPath, STOP_INTENT_TTL_MS, writeClaim,
} from './substrate-claim-registry.js';
import { stopClaimed } from './claimed-substrate-stop.js';
import { rotateServerLog } from './server-log-rotation.js';
import { attestClaimedServing, publishServingClaimAuthority } from './serving-claim-attestation.js';
import {
  prepareServingArtifacts,
  releasePreparedServingArtifacts,
  spawnPreparedServingArtifacts,
} from './refinement-artifact-staging.js';
import { attestServingLaunch } from './serving-launch-attestation.js';
import {
  assertRefinementProcessOperation,
  createRefinementProcessOperation,
} from './refinement-process-operation.js';
import { openRefinementSourceAuthority } from './refinement-source-authority.js';
import { captureServingGpuDeviceAuthority } from './refinement-gpu-device-authority.js';
import {
  assertTextOnlySupervisedLaunch,
  SUPERVISED_PROJECTOR_REFUSAL_CODE,
  validatedServingLaunchConfig,
  sameServingLaunch, routeNamesLaunch,
} from './serving-launch-config.js';
import { activeServedModelKey, expireServedTruth, isServing, liveServedKey } from './served-model-truth.js';
import {
  heldPortFailure, launchReady, missingPrerequisites, projectSupervisorFailure,
  refusedBootCode, RELIGHT_WINDOW_MS, shouldRelight, withDiscoveredProjector,
} from './supervisor-launch-config.js';

// The read-only truth channel lives in served-model-truth.js (CQ-036 seam:
// this module COMMANDS the process; that one only READS it). Re-exported so
// every existing importer keeps its door.
export { activeServedModelKey, isServing, liveServedKey };
// The pure config/gate helpers live in supervisor-launch-config.js (size-law
// extraction, 2026-08-26) — same door law: every standing importer reads them
// from here unchanged.
export {
  selectSubstrateModel, activeLaunchConfig, binaryPresent, launchReady,
  missingPrerequisites, projectSupervisorFailure, RELIGHT_WINDOW_MS,
  RELIGHT_MAX, shouldRelight, withDiscoveredProjector,
} from './supervisor-launch-config.js';

const log = createLogger('LlamaSupervisor');

const DEFAULT_START_WAIT_MS = 120000; // a 31GB model offloads to GPU in tens of seconds
const STOP_GRACE_MS = 8000;
const HEALTH_POLL_MS = 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { resolveServingLaunchConfig, servingLaunchArguments } from './serving-launch-config.js';
export { clearClaim, ownedByNeuma, readClaim, serverLogPath, STOP_INTENT_TTL_MS, writeClaim };

// A non-null child is a server this backend actually spawned; foreign healthy servers never become attested children.
let child = null; // opaque owned serving process
let lastError = null;

// Non-deliberate exits relight under a bounded rate guard; deliberate never.
let deliberateStop = false; // set around every kill NEUMA itself intends
let relightTimes = [];      // when relights fired (rate-guard memory)

const attestation = (attested, reason) => Object.freeze({ attested, reason });
const childOwnsLaunch = (current) => {
  const claim = readClaim();
  return child === current && current?.healthy && current.owner.isLive()
    && claim?.pid === current.owner.pid && claim.port === current.owner.port;
};

/** Return one safe text-model process-generation authority or a stable refusal code. */
export const attestSupervisedServingLaunch = async (route, expected = null) => {
  const current = child;
  if (current) {
    try {
      assertTextOnlySupervisedLaunch(current.launch);
    } catch (error) {
      if (error?.code === SUPERVISED_PROJECTOR_REFUSAL_CODE) {
        return Object.freeze({ ok: false, code: SUPERVISED_PROJECTOR_REFUSAL_CODE });
      }
      throw error;
    }
  }
  return attestServingLaunch({
    route,
    expected,
    launch: current?.owner.launchFacts,
    verifyLaunch: () => current.owner.verify(),
    ownsLaunch: () => childOwnsLaunch(current),
    routeMatchesLaunch: () => routeNamesLaunch(route, current?.launch),
    isReachable: () => isServing(current?.owner.port, current?.launch?.host),
  });
};
/** Read-only proof of the physical GPU held by this live supervised child. */
export const attestActiveServingGpu = async (operation) => {
  const active = assertRefinementProcessOperation(operation);
  const current = child;
  if (!current || !childOwnsLaunch(current)) return null;
  await current.owner.verify();
  active.assertActive();
  if (child !== current || !childOwnsLaunch(current)) {
    throw Object.assign(new Error('active serving GPU changed during attestation'), {
      code: 'TRAINING_GPU_BUSY',
    });
  }
  const {
    gpuBindingSha256,
    gpuUuid,
    launchInstanceSha256,
    processIdentitySha256,
  } = current.owner.launchFacts;
  return Object.freeze({
    gpuBindingSha256,
    gpuUuid,
    launchInstanceSha256,
    processIdentitySha256,
  });
};

/** Preserve the refinement ceremony's narrow decision projection. */
export const attestSupervisedRefinementLaunch = async (route, expected) => {
  const result = await attestSupervisedServingLaunch(route, expected);
  return result.ok
    ? attestation(true, 'attested')
    : attestation(false, result.code.toLowerCase().replaceAll('_', '-'));
};
// One promise owns the entire health-checked boot; concurrent callers join it.
let bootPromise = null;

/** Start one health-checked process from a validated, immutable launch snapshot; concurrent callers join. */
export const startSupervised = async (config, { waitMs = DEFAULT_START_WAIT_MS } = {}) => {
  if (bootPromise) return bootPromise;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 10 * 60_000) {
    throw new Error('llama-server health deadline is outside its fixed bounds');
  }
  let requestedLaunch;
  try {
    // The last gate's fail-safe (#529): a base-only launch that arrives
    // projector-less is repaired here — the serving never launches blinder
    // than the model, no matter what the caller's config says.
    requestedLaunch = withDiscoveredProjector(config);
  } catch (error) {
    // The one throw before the boot corridor exists (#316) — recorded.
    lastError = { code: 'launch-not-ready', error: error.message, at: new Date().toISOString() };
    throw error;
  }
  lastError = null; // a boot reports only its own failure — never the last boot's
  bootPromise = (async () => {
    let prepared = null;
    let gpuAuthority = null;
    let operation;
    try {
      operation = createRefinementProcessOperation({ timeoutMs: 5 * 60_000 });
      // Avoid hashing and staging a model when this endpoint already serves.
      if (await isServing(requestedLaunch.port, requestedLaunch.host)) return { status: 'already-serving' };
      const held = await heldPortFailure(requestedLaunch);
      if (held) { lastError = held; throw new Error(held.error); }
      // Base-only carries no SOURCE authority; the operation rides for staging.
      const sourceAuthority = requestedLaunch.servingModel === null
        ? null : await openRefinementSourceAuthority({ operation });
      prepared = await prepareServingArtifacts(await fittedLaunch(requestedLaunch), { sourceAuthority, operation });
      gpuAuthority = await captureServingGpuDeviceAuthority(operation);
      return await bootToHealthy({
        prepared,
        cfg: requestedLaunch,
        waitMs,
        requestedLaunch,
        gpuAuthority,
        operation,
      });
    } catch (error) {
      // The pre-health corridor used to fail only into fire-and-observe's .catch — the desk saw
      // nothing igniting, nothing failed (2026-08-15). bootToHealthy's records keep their code.
      if (lastError?.error !== error.message) {
        lastError = { code: refusedBootCode(error), error: error.message, at: new Date().toISOString() };
      }
      const closers = [
        ...(prepared ? [() => releasePreparedServingArtifacts(prepared)] : []),
        ...(!prepared && gpuAuthority ? [() => gpuAuthority.close()] : []),
      ];
      const released = await Promise.allSettled(closers.map((close) => close()));
      const failures = released.filter(({ status }) => status === 'rejected')
        .map(({ reason }) => reason);
      if (failures.length) {
        throw new AggregateError(
          [error, ...failures],
          'supervised boot failed and prepared authorities could not be released', { cause: error },
        );
      }
      throw error;
    }
  })().finally(() => { bootPromise = null; });
  return bootPromise;
};

// impure — the single boot body: inherited descriptor spawn, then health proof.
const bootToHealthy = async ({
  prepared,
  cfg,
  waitMs,
  requestedLaunch,
  gpuAuthority,
  operation,
}) => {
  const ready = launchReady(cfg);
  if (!ready.ready) {
    lastError = {
      code: 'launch-not-ready',
      error: `the local substrate cannot start — ${missingPrerequisites(ready, cfg).join('; ')}`,
      detail: ready,
      at: new Date().toISOString(),
    };
    throw new Error(lastError.error);
  }
  let stdio = ['ignore', 'ignore', 'ignore'];
  let logFd = null;
  try {
    const logFile = serverLogPath();
    mkdirSync(path.dirname(logFile), { recursive: true });
    try { rotateServerLog(logFile); } catch { /* rotation is best-effort — never cost a launch */ }
    logFd = openSync(logFile, 'w');
    stdio = ['ignore', logFd, logFd];
  } catch (error) {
    log.warn('server log lane unavailable — the substrate speaks unrecorded', {
      err: error.message,
    });
  }

  deliberateStop = false;
  let owner;
  try {
    owner = await spawnPreparedServingArtifacts(prepared, {
      stdio,
      gpuAuthority,
      operation,
    });
  } finally {
    if (logFd !== null) closeSync(logFd);
  }
  const current = {
    owner,
    launch: requestedLaunch,
    requestedLaunch,
    healthy: false,
    allowRelight: true,
    closed: owner.waitClosed(),
  };
  current.closed.catch((error) => {
    log.error('supervised launch authorities did not close', { err: error.message });
  });
  child = current;
  writeClaim(owner.pid, owner.port, { model: cfg.model, servingModel: cfg.servingModel });
  log.info('llama-server spawned', {
    pid: owner.pid,
    port: owner.port,
    model: cfg.model,
    log: serverLogPath(),
  });

  owner.onExit((code, signal) => {
    const ours = child === current;
    if (ours) {
      child = null;
      clearClaim(owner.pid);
    }
    const now = Date.now();
    const deliberate = !current.allowRelight
      || deliberateStop
      || freshStopIntent(now);
    // A stop NEUMA meant (standby, a reload, the operator) is not a failure.
    if ((code || signal) && !deliberate) {
      lastError = {
        code: 'process-exited',
        error: `llama-server exited (code ${code}, signal ${signal}) — its last words: ${serverLogPath()}.prev`,
        at: new Date().toISOString(),
      };
    }
    if (!ours) return;
    if (!shouldRelight({ deliberate, recent: relightTimes, now })) {
      if (!deliberate) {
        log.error('substrate crash-looping — standing down; read its last words', {
          log: `${serverLogPath()}.prev`,
        });
      }
      return;
    }
    relightTimes = [...relightTimes.filter((time) =>
      now - time < RELIGHT_WINDOW_MS), now];
    log.error('substrate died mid-service — relighting', {
      code,
      signal,
      log: `${serverLogPath()}.prev`,
    });
    const timer = setTimeout(() => {
      if (!current.allowRelight) return;
      current.closed
        .then(() => startSupervised(current.requestedLaunch))
        .catch((error) => {
          lastError = {
            code: 'relight-failed',
            error: `relight failed: ${error.message}`,
            at: new Date().toISOString(),
          };
        });
    }, 1500);
    timer.unref?.();
  });
  owner.onError((error) => {
    current.allowRelight = false;
    if (child === current) {
      child = null;
      clearClaim(owner.pid);
    }
    lastError = {
      code: 'spawn-failed',
      error: error.message,
      at: new Date().toISOString(),
    };
  });

  try {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (child !== current || !owner.isLive()) {
        throw new Error(lastError?.error || 'llama-server exited before becoming healthy');
      }
      if (await isServing(cfg.port, cfg.host)) {
        await owner.verify();
        if (child !== current) {
          throw new Error('llama-server changed before health attestation completed');
        }
        current.healthy = true;
        lastError = null;
        // The claimed-server contract (#506): the spawner is the only witness
        // of this boot, so it pins the path-free serving authority onto its
        // claim for siblings that must attest without owning. Best-effort —
        // a boot never fails over its proof.
        publishServingClaimAuthority({
          pid: owner.pid,
          port: owner.port,
          launch: requestedLaunch,
          launchFacts: owner.launchFacts,
        });
        log.info('llama-server healthy', { pid: owner.pid, port: cfg.port });
        return { status: 'serving', pid: owner.pid };
      }
      await delay(HEALTH_POLL_MS);
    }
    throw new Error(`llama-server did not become healthy within ${waitMs / 1000}s`);
  } catch (error) {
    current.allowRelight = false;
    if (owner.isLive()) owner.kill('SIGKILL');
    const closed = await Promise.allSettled([current.closed]);
    const closeFailure = closed.find(({ status }) => status === 'rejected');
    if (closeFailure) {
      throw new AggregateError(
        [error, closeFailure.reason],
        'supervised boot failed and launch authorities could not be released', { cause: error },
      );
    }
    throw error;
  }
};

/** Ensure one validated snapshot is serving; fast no-op when already healthy. */
export const ensureServing = async (config) => {
  const cfg = validatedServingLaunchConfig(config);
  if (await isServing(cfg.port, cfg.host)) return { status: 'already-serving' };
  return startSupervised(cfg);
};

// The sibling-claimed stop lives in claimed-substrate-stop.js (size-law
// extraction, 2026-09-12); the claimed-server attestation contract in
// serving-claim-attestation.js. Both doors stay here.
export { attestClaimedServing };

// impure — stop THIS process's own supervised child: SIGTERM, SIGKILL after a
// grace window, claim and served-truth expired behind it.
const stopInProcess = async (current) => {
  const { owner } = current;
  current.allowRelight = false;
  deliberateStop = true;
  owner.kill('SIGTERM');
  const stopped = await Promise.race([
    current.closed.then(() => true),
    delay(STOP_GRACE_MS).then(() => false),
  ]);
  if (!stopped) {
    log.warn('llama-server did not exit on SIGTERM — sending SIGKILL', { pid: owner.pid });
    owner.kill('SIGKILL');
    await current.closed;
  }
  if (child === current) {
    child = null;
    clearClaim(owner.pid);
  }
  // The port's truth just changed — never let the micro-cache serve the
  // dead server's answer past the stop (friction-map T9).
  expireServedTruth();
  log.info('llama-server stopped', { pid: owner.pid });
  return { status: 'stopped' };
};

/**
 * Stop the supervised server, freeing VRAM — SIGTERM then SIGKILL after a
 * grace window. Stops a server ANY NEUMA process claimed; still refuses to
 * touch one NEUMA never started. Impure.
 */
export const stopSupervised = async () => {
  // Between "bootPromise set" and "child spawned" a stop that only checks
  // `child` sees nothing to kill and the spawn lands AFTER it — a leaked
  // server (2026-07-20). Drain the in-flight boot first, then stop its remains.
  while (bootPromise) await bootPromise.catch(() => { /* failed boot — drained */ });
  // A substrate spawned by ANOTHER NEUMA process is still NEUMA's, and the
  // forge must reclaim its memory — signalled by pid, since we have no handle.
  if (!child) {
    const claim = readClaim();
    if (claim) {
      log.info('stopping a NEUMA substrate this process did not spawn', { pid: claim.pid, port: claim.port });
      return stopClaimed(claim);
    }
    return { status: 'not-running' };
  }
  return stopInProcess(child);
};

/**
 * Stop ONLY the server THIS process spawned (#506 contract 2) — the
 * owner-bound cleanup door. A process holding no live child answers
 * `not-owned` and touches nothing: no claim read, no sibling's server, even
 * after its own child has already exited. Benchmark cleanup runs on this;
 * stopSupervised stays the operator/forge law. Impure.
 */
export const stopOwnedSupervised = async () => {
  while (bootPromise) await bootPromise.catch(() => { /* failed boot — drained */ });
  if (!child) return { status: 'not-owned' };
  return stopInProcess(child);
};

/** Restart from one newly validated snapshot after the prior process and its
 *  retained descriptors have closed. Never touches an unowned server. */
export const reloadSupervised = async (config) => {
  const cfg = validatedServingLaunchConfig(config);
  // An identical healthy launch is already serving — stop+respawn would kill it
  // mid-teardown and force the SIGKILL backstop (2026-09-18 doubled ignite).
  if (childOwnsLaunch(child) && sameServingLaunch(cfg, child.launch)) return { status: 'already-serving' };
  const serving = await isServing(cfg.port, cfg.host);
  if (serving && !child) {
    // Ownership spans NEUMA's processes (the claim law): a substrate an
    // EARLIER instance spawned is still ours to reload — child-only checking
    // killed every post-restart forge at VERIFY (Rugevil, 2026-07-22). Only a
    // server NEUMA never claimed stays untouchable.
    const claim = readClaim();
    if (!ownedByNeuma({ inProcess: false, claim, port: cfg.port })) {
      return { status: 'unowned' };
    }
    const stopped = await stopClaimed(claim);
    if (stopped.status !== 'stopped' && await isServing(cfg.port, cfg.host)) {
      return { status: 'error', error: 'claimed substrate would not stop' };
    }
  }
  // A reload landing mid-boot must not JOIN the old boot — single-flight
  // would hand back the dying bootPromise and the new model never spawns
  // (2026-07-19). Drain the boot AND its process until gone.
  while (bootPromise || child) {
    if (bootPromise) await bootPromise.catch(() => { /* aborted boot — expected */ });
    if (child) await stopSupervised();
  }
  expireServedTruth();
  return startSupervised(cfg);
};

/** Observable supervisor state for one validated launch snapshot. */
export const supervisorStatus = async (config) => {
  const cfg = validatedServingLaunchConfig(config);
  const serving = await isServing(cfg.port, cfg.host);
  return {
    serving,
    // Ownership spans NEUMA's processes — desk-spawned is still NEUMA's when
    // the daemon asks, else the forge starves beside its own model server.
    owned: ownedByNeuma({ inProcess: Boolean(child), claim: readClaim(), port: cfg.port }),
    port: cfg.port,
    booting: Boolean(bootPromise),
    startedAt: child?.startedAt ?? null,
    launch: launchReady(cfg),
    lastError: projectSupervisorFailure(lastError),
    log: Object.freeze({
      id: 'llama-server-runtime',
      available: existsSync(serverLogPath()),
    }),
  };
};
