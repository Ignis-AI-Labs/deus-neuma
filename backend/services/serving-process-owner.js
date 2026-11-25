import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { sha256HandleStable } from './file-digest.js';
import { modelHasMtpHeads } from './gguf-mtp.js';
import { drafterFor, engineSupportsReplay, speculativePlan } from './serving-drafter.js';
import { borrowStagedArtifactForSpawn } from './refinement-artifact-internal/held-authority.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  servingChildEnvironment,
  servingLaunchArguments,
  validatedServingLaunchConfig,
} from './serving-launch-config.js';
import {
  activateServingLoadedAdapterAuthority,
  createServingLoadedAdapterAuthority,
  releaseServingLoadedAdapterAuthority,
  verifyServingLoadedAdapters,
} from './serving-loaded-adapter-authority.js';

const MAX_EXECUTABLE_BYTES = 1024 ** 3;
const READ = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_SIGNAL = new Set(['SIGTERM', 'SIGKILL', 'SIGINT']);
const owners = new WeakMap();

const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.size === right.size && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const recoveryError = (primary, cleanup, message, recovery) => {
  const error = new AggregateError([primary, cleanup], message);
  Object.defineProperty(error, 'recovery', { value: recovery, enumerable: false });
  return error;
};
const randomSha256 = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const executablePath = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new Error('serving executable path is invalid');
  }
  return path.resolve(value);
};

const openServingExecutable = async (filePath, operation) => {
  const controls = assertRefinementProcessOperation(operation);
  const resolved = executablePath(filePath);
  const [real, before] = await Promise.all([
    fs.realpath(resolved),
    fs.lstat(resolved, { bigint: true }),
  ]);
  if (real !== resolved || !before.isFile() || before.size < 1n
    || before.size > BigInt(MAX_EXECUTABLE_BYTES) || before.uid !== BigInt(process.getuid())
    || (before.mode & 0o111n) === 0n || (before.mode & 0o022n) !== 0n) {
    throw new Error('serving executable is not an immutable owner executable');
  }
  const handle = await fs.open(resolved, READ);
  let phase = 'open';
  let closePromise = null;
  const close = () => {
    if (phase === 'closed') return Promise.resolve(false);
    if (closePromise) return closePromise;
    phase = 'closing';
    closePromise = handle.close().then(
      () => { phase = 'closed'; return true; },
      (error) => { phase = 'cleanup-failed'; throw error; },
    ).finally(() => { closePromise = null; });
    return closePromise;
  };
  const recovery = Object.freeze({ close });
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(before, opened)) throw new Error('serving executable changed before stable open');
    const sha256 = await sha256HandleStable(handle, {
      maximumBytes: MAX_EXECUTABLE_BYTES,
      signal: controls.signal,
      deadline: controls.epochDeadline,
    });
    const verify = async (verificationOperation = null) => {
      if (phase !== 'open') throw new Error(`serving executable authority is ${phase}`);
      const active = verificationOperation === null
        ? null : assertRefinementProcessOperation(verificationOperation);
      active?.assertActive();
      if (!sameFile(opened, await handle.stat({ bigint: true }))
        || await sha256HandleStable(handle, {
          maximumBytes: MAX_EXECUTABLE_BYTES,
          ...(active ? { signal: active.signal, deadline: active.epochDeadline } : {}),
        }) !== sha256
        || !sameFile(opened, await handle.stat({ bigint: true }))) {
        throw new Error('serving executable changed after launch');
      }
      active?.assertActive();
      return true;
    };
    return Object.freeze({ handle, fd: handle.fd, sha256, verify, close });
  } catch (error) {
    try { await close(); }
    catch (closeError) {
      throw recoveryError(error, closeError, 'serving executable open and recovery failed', recovery);
    }
    throw error;
  }
};

const adapterProjection = (adapters) => Object.freeze(adapters.map(({ artifact, authority }) =>
  Object.freeze({
    neumaId: authority.neumaId,
    adapterId: authority.adapter.id,
    artifactSha256: artifact.sha256,
    artifactBytes: artifact.bytes,
    scale: authority.selectedScale ?? authority.adapter.scale,
    authorizationSha256: authority.authorizationSha256,
    publicationTransactionSha256: authority.publicationTransactionSha256,
    registryGeneration: authority.registryGeneration,
    registryAppendRevision: authority.registryAppendRevision,
    registrySha256: authority.registrySha256,
    registryCurrentSelectionSha256: authority.registryCurrentSelectionSha256,
    operatorDecisionSha256: authority.operatorDecisionSha256,
  })));

const closeResources = async (state) => {
  if (state.releasing) return state.releasing;
  releaseServingLoadedAdapterAuthority(state.loadedAdapters);
  state.releasing = (async () => {
    const settled = await Promise.allSettled([
      state.executable.close(),
      state.gpu.close(),
      state.artifacts.close(),
    ]);
    const failures = settled.filter(({ status }) => status === 'rejected')
      .map(({ reason }) => reason);
    if (failures.length) {
      state.phase = 'cleanup-failed';
      throw new AggregateError(failures, 'serving process resources did not close');
    }
    state.phase = 'closed';
    return true;
  })();
  try { return await state.releasing; }
  finally { state.releasing = null; }
};

/** Spawn one child while retaining every exact executable, artifact, and GPU authority. */
export const spawnServingProcessOwner = async ({
  executable,
  config,
  artifacts,
  lineageConfig = null,
  stdio,
  gpuAuthority,
  operation,
}) => {
  const controls = assertRefinementProcessOperation(operation);
  const launchConfig = validatedServingLaunchConfig(config);
  if (process.platform !== 'linux' || !artifacts
    || typeof artifacts.verify !== 'function' || typeof artifacts.close !== 'function'
    || !artifacts.model || !Array.isArray(artifacts.adapters)
    || !Array.isArray(stdio) || stdio.length !== 3
    || typeof gpuAuthority?.verify !== 'function'
    || typeof gpuAuthority?.transfer !== 'function') {
    throw new Error('serving process launch owner request is invalid');
  }
  let executableAuthority = null;
  let gpu = null;
  let proc = null;
  let reaped = null;
  let owner = null;
  let loadedAdapters = null;
  try {
    executableAuthority = await openServingExecutable(executable, controls);
    await artifacts.verify(controls);
    await gpuAuthority.verify(controls);
    const gpuBinding = gpuAuthority.gpuBinding;
    if (!gpuBinding || !SHA256.test(String(gpuBinding.gpuBindingSha256 || ''))) {
      throw new Error('serving GPU binding authority is invalid');
    }
    const allArtifacts = [artifacts.model, ...artifacts.adapters.map(({ artifact }) => artifact)];
    // Same class as `closeArtifacts`: a bare `map(borrowStagedArtifactForSpawn)`
    // hands the ARRAY INDEX to the operation parameter, and `sameOperation` refuses it.
    const borrowed = await Promise.all(
      allArtifacts.map((artifact) => borrowStagedArtifactForSpawn(artifact, controls)),
    );
    const childFds = Object.freeze(allArtifacts.map((_, index) => index + 4));
    const childConfig = validatedServingLaunchConfig({
      ...launchConfig,
      model: `/proc/self/fd/${childFds[0]}`,
      loras: childFds.slice(1).map((fd) => `/proc/self/fd/${fd}`),
    });
    const mtp = launchConfig.model ? await modelHasMtpHeads(launchConfig.model) : false;
    const drafter = launchConfig.model ? await drafterFor(launchConfig.model) : null;
    const plan = speculativePlan({
      mtp, drafter, replay: (mtp || drafter !== null) && await engineSupportsReplay(executable),
    });
    const argv = servingLaunchArguments(childConfig, {
      mtp: plan.kind === 'mtp', drafter: plan.kind === 'dflash' ? plan.drafter : null,
    });
    const environment = servingChildEnvironment({
      disableCudaGraphs: launchConfig.disableCudaGraphs,
      disableCudaFusion: launchConfig.disableCudaFusion,
      gpuBinding,
      rsReplay: plan.rsReplay,
    });
    const adapters = adapterProjection(artifacts.adapters);
    const adapterSetSha256 = refinementSha256(adapters);
    const launchConfigurationSha256 = refinementSha256({
      serverExecutableSha256: executableAuthority.sha256,
      argv,
      environment,
      servingArtifactSha256: artifacts.model.sha256,
      adapterSetSha256,
      gpuBinding,
    });
    const launchInstanceSha256 = refinementSha256({
      launchNonceSha256: randomSha256(),
      launchConfigurationSha256,
      gpuBindingSha256: gpuBinding.gpuBindingSha256,
    });
    await Promise.all([
      executableAuthority.verify(controls), artifacts.verify(controls), gpuAuthority.verify(controls),
    ]);
    controls.assertActive();
    gpu = gpuAuthority.transfer();
    proc = spawn('/proc/self/fd/3', argv, {
      env: environment,
      stdio: [...stdio, executableAuthority.fd, ...borrowed.map(({ fd }) => fd)],
    });
    reaped = new Promise((resolve) => proc.once('close', resolve));
    await new Promise((resolve, reject) => {
      const onError = (error) => { proc.off('spawn', onSpawn); reject(error); };
      const onSpawn = () => { proc.off('error', onError); resolve(); };
      proc.once('error', onError);
      proc.once('spawn', onSpawn);
    });
    loadedAdapters = createServingLoadedAdapterAuthority({
      launchInstanceSha256,
      adapters,
      childFds: childFds.slice(1),
    });
    activateServingLoadedAdapterAuthority(loadedAdapters);
    const startedAt = new Date().toISOString();
    const processIdentitySha256 = refinementSha256({
      launchInstanceSha256,
      launchConfigurationSha256,
      gpuBindingSha256: gpuBinding.gpuBindingSha256,
      pid: proc.pid,
      startedAt,
    });
    const launchFacts = Object.freeze({
      launchInstanceSha256,
      processIdentitySha256,
      launchConfigurationSha256,
      serverExecutableSha256: executableAuthority.sha256,
      servingModel: launchConfig.servingModel,
      servingArtifactSha256: artifacts.model.sha256,
      servingArtifactBytes: artifacts.model.bytes,
      ...(lineageConfig || {}),
      adapters,
      adapterSetSha256,
      gpuUuid: gpuBinding.gpuUuid,
      gpuBindingSha256: gpuBinding.gpuBindingSha256,
    });
    const state = {
      phase: 'open', releasing: null, proc, reaped, executable: executableAuthority,
      gpu, artifacts, loadedAdapters, launchFacts,
    };
    const isLive = () => state.phase === 'open' && proc.exitCode === null
      && proc.signalCode === null && !proc.killed;
    const verify = async () => {
      if (!isLive()) throw new Error('serving process instance is not live');
      await Promise.all([executableAuthority.verify(), artifacts.verify(), gpu.verify()]);
      if (!isLive()) throw new Error('serving process instance changed during verification');
      return true;
    };
    owner = Object.freeze({
      kind: 'owned-serving-process-v1',
      pid: proc.pid,
      port: launchConfig.port,
      startedAt,
      launchFacts,
      isLive,
      verify,
      kill: (signal) => {
        if (!SAFE_SIGNAL.has(signal)) throw new Error('serving process signal is invalid');
        return proc.kill(signal);
      },
      onExit: (listener) => proc.on('exit', listener),
      onError: (listener) => proc.on('error', listener),
      waitClosed: () => state.closed,
      close: async () => { await reaped; return closeResources(state); },
      verifyLoadedAdapters: async (observed) => {
        await verify();
        const projection = verifyServingLoadedAdapters(
          loadedAdapters, launchInstanceSha256, observed,
        );
        await verify();
        return projection;
      },
    });
    owners.set(owner, state);
    state.closed = reaped.then(() => closeResources(state));
    await verify();
    controls.assertActive();
    return owner;
  } catch (error) {
    if (loadedAdapters) releaseServingLoadedAdapterAuthority(loadedAdapters);
    if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    if (reaped) await reaped.catch(() => {});
    const closers = [
      ...(executableAuthority ? [() => executableAuthority.close()] : []),
      ...(gpu ? [() => gpu.close()] : []),
      ...(!gpu && gpuAuthority ? [() => gpuAuthority.close()] : []),
      ...(artifacts ? [() => artifacts.close()] : []),
    ];
    const settled = await Promise.allSettled(closers.map((close) => close()));
    const failures = settled.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
    if (failures.length) {
      const recovery = owner || Object.freeze({
        close: async () => {
          const retried = await Promise.allSettled(closers.map((close) => close()));
          const retryFailures = retried.filter(({ status }) => status === 'rejected')
            .map(({ reason }) => reason);
          if (retryFailures.length) {
            throw new AggregateError(retryFailures, 'serving spawn recovery failed');
          }
          return true;
        },
      });
      const aggregate = new AggregateError([error, ...failures], 'serving process spawn and recovery failed');
      Object.defineProperty(aggregate, 'recovery', { value: recovery, enumerable: false });
      throw aggregate;
    }
    throw error;
  }
};
