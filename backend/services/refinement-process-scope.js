import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import {
  validateRefinementExecutionEnvelope,
} from '../../core/refinement/training-authority-contract.js';
import {
  assertRefinementExecutionAuthority,
  assertRefinementExecutionSpawnAuthority,
} from './refinement-execution-authority.js';
import { codedTrainingError } from './refinement-training-errors.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STEP_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PARTIAL_LINE_BYTES = 64 * 1024;
const CONTROLLER_OUTPUT_BYTES = 16 * 1024;
const TERMINATION_GRACE_MS = 5_000;
const TERMINATION_POLL_MS = 25;
const MAX_CHILD_FD = 255;

const processTransportEnvironment = () => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const runtime = `/run/user/${uid}`;
  return Object.freeze({
    HOME: '/nonexistent',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin',
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
  });
};

const boundedOption = (value, fallback, maximum, field) => {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw codedTrainingError('TRAINING_PROCESS_FAILED', `${field.toUpperCase()}_INVALID`);
  }
  return value;
};

const optionsFor = (signalOrOptions) => {
  if (!signalOrOptions) return Object.freeze({});
  if (typeof signalOrOptions === 'object'
    && typeof signalOrOptions.addEventListener === 'function'
    && 'aborted' in signalOrOptions) {
    return Object.freeze({ signal: signalOrOptions });
  }
  if (typeof signalOrOptions !== 'object' || Array.isArray(signalOrOptions)) {
    throw codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_OPTIONS_INVALID');
  }
  return Object.freeze({ ...signalOrOptions });
};

const descriptorPlan = (entries) => {
  if (!Array.isArray(entries) || new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw codedTrainingError('TRAINING_PROCESS_FAILED', 'DESCRIPTOR_PLAN_INVALID');
  }
  const planned = entries.map((entry, index) => {
    const sourceFd = entry?.authority?.fd;
    const childFd = index + 3;
    if (typeof entry.id !== 'string' || !entry.id || !Number.isSafeInteger(sourceFd)
      || sourceFd < 0 || childFd > MAX_CHILD_FD) {
      throw codedTrainingError('TRAINING_PROCESS_FAILED', 'DESCRIPTOR_PLAN_INVALID');
    }
    return Object.freeze({ ...entry, sourceFd, childFd });
  });
  return Object.freeze(planned);
};

const stdioFor = (descriptors) => {
  const stdio = Array.from({ length: Math.max(3, ...descriptors.map(({ childFd }) => childFd + 1)) },
    () => 'ignore');
  stdio[1] = 'pipe';
  stdio[2] = 'pipe';
  for (const descriptor of descriptors) stdio[descriptor.childFd] = descriptor.sourceFd;
  return stdio;
};

const signalError = (signal) => signal?.reason?.code === 'TRAINING_TIMEOUT'
  || signal?.reason?.name === 'TimeoutError'
  ? codedTrainingError('TRAINING_TIMEOUT', 'PROCESS_TIMEOUT')
  : codedTrainingError('TRAINING_CANCELLED', 'PROCESS_ABORTED');

// The grace is an UPPER BOUND, not a fixed cost: poll the group until it is
// genuinely gone and hard-kill only what outlived it. Sleeping the full grace
// unconditionally stalled every refusal by 5s and left a blind SIGKILL aimed
// at a pgid the kernel may already have recycled.
const processGroupGone = (pid) => {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
};

const terminateProcessGroup = async (child) => {
  const { pid } = child;
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return; // nothing in the group is signalable by us
  }
  const deadline = Date.now() + TERMINATION_GRACE_MS;
  while (Date.now() < deadline) {
    if (processGroupGone(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, TERMINATION_POLL_MS));
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch { /* exited during the grace period */ }
};

const runBoundedChild = ({
  command,
  args,
  cwd,
  env,
  descriptors = [],
  signal = null,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_OUTPUT_BYTES,
  onLine = () => {},
  terminate = null,
  afterSpawn = null,
  detached = true,
}) => new Promise((resolve, reject) => {
  const duration = boundedOption(timeoutMs, DEFAULT_STEP_TIMEOUT_MS, MAX_STEP_TIMEOUT_MS, 'timeout');
  const outputLimit = boundedOption(maxOutputBytes, DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES, 'output');
  let child;
  try {
    child = spawn(command, args, {
      stdio: stdioFor(descriptors),
      detached,
      ...(cwd && { cwd }),
      ...(env && { env }),
    });
  } catch {
    reject(codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_SPAWN_FAILED'));
    return;
  }
  const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
  const partial = { out: '', err: '' };
  let outputBytes = 0;
  let forcedError = null;
  let termination = null;
  const stop = (error) => {
    if (forcedError) return;
    forcedError = error;
    termination = Promise.resolve(terminate ? terminate(child) : terminateProcessGroup(child));
  };
  const postSpawn = afterSpawn
    ? Promise.resolve(afterSpawn()).catch(() => {
      stop(codedTrainingError('TRAINING_SANDBOX_UNAVAILABLE', 'WORK_AUTHORITY_CHANGED'));
    })
    : Promise.resolve();
  const take = (line) => {
    const value = line.trim();
    if (!value || forcedError) return;
    try {
      onLine(value);
    } catch {
      stop(codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_OUTPUT_CONSUMER_FAILED'));
    }
  };
  const feed = (chunk, key) => {
    outputBytes += chunk.length;
    if (outputBytes > outputLimit) {
      stop(codedTrainingError('TRAINING_OUTPUT_LIMIT', 'PROCESS_OUTPUT_LIMIT'));
      return;
    }
    const parts = `${partial[key]}${decoders[key].write(chunk)}`.split(/\r\n|\r|\n/u);
    partial[key] = parts.pop();
    if (Buffer.byteLength(partial[key], 'utf8') > MAX_PARTIAL_LINE_BYTES) {
      stop(codedTrainingError('TRAINING_OUTPUT_LIMIT', 'PROCESS_PARTIAL_LINE_LIMIT'));
      return;
    }
    for (const line of parts) take(line);
  };
  child.stdout.on('data', (chunk) => feed(chunk, 'out'));
  child.stderr.on('data', (chunk) => feed(chunk, 'err'));
  const onAbort = () => stop(signalError(signal));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => stop(codedTrainingError('TRAINING_TIMEOUT', 'PROCESS_TIMEOUT')), duration);
  timer.unref?.();
  child.on('error', () => {
    stop(codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_SPAWN_FAILED'));
  });
  child.on('close', async (code) => {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
    if (!forcedError) {
      partial.out += decoders.out.end();
      partial.err += decoders.err.end();
      take(partial.out);
      take(partial.err);
    }
    try {
      await postSpawn;
      await termination;
    } catch {
      forcedError = codedTrainingError('TRAINING_CGROUP_NOT_EMPTY', 'PROCESS_TERMINATION_FAILED');
    }
    if (forcedError) reject(forcedError);
    else if (code === 0) resolve(Object.freeze({
      kind: 'refinement-child-outcome-v1',
      exitCode: 0,
      outputBytes,
    }));
    else reject(codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_NONZERO_EXIT'));
  });
});

/** Stream one bounded process and kill/wait its whole direct process group on refusal. Impure. */
export const runStep = (command, args, onLine, signalOrOptions = null) => {
  const options = optionsFor(signalOrOptions);
  if (typeof command !== 'string' || !command || !Array.isArray(args)
    || args.some((value) => typeof value !== 'string' || value.includes('\0'))
    || typeof onLine !== 'function') {
    throw codedTrainingError('TRAINING_PROCESS_FAILED', 'PROCESS_INVOCATION_INVALID');
  }
  const rawDescriptors = options.descriptors ?? [];
  const descriptors = rawDescriptors.length ? descriptorPlan(rawDescriptors) : [];
  return runBoundedChild({
    command,
    args,
    onLine,
    descriptors,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    cwd: options.cwd,
    env: options.env,
    detached: true,
  });
};

const procFd = (fd) => `/proc/self/fd/${fd}`;
const property = (name, value) => ['--property', `${name}=${value}`];

const scopeArguments = ({ unit, resources, limiterFd, programFd, programArgs, timeoutMs }) => [
  '--user',
  '--scope',
  '--wait',
  '--pipe',
  '--collect',
  '--quiet',
  `--unit=${unit}`,
  ...property('AllowedCPUs', resources.allowedCpus),
  ...property('CPUQuota', `${resources.cpuQuotaPercent}%`),
  ...property('TasksMax', resources.maxProcesses),
  ...property('MemoryMax', resources.memoryMaxBytes),
  ...property('MemorySwapMax', resources.memorySwapMaxBytes),
  ...property('IOReadBandwidthMax', `${resources.ioDevicePath} ${resources.ioReadBandwidthBytesPerSecond}`),
  ...property('IOWriteBandwidthMax', `${resources.ioDevicePath} ${resources.ioWriteBandwidthBytesPerSecond}`),
  ...property('RuntimeMaxSec', `${Math.ceil(Math.min(timeoutMs, resources.maxCpuSeconds * 1000) / 1000)}s`),
  ...property('KillMode', 'control-group'),
  ...property('SendSIGKILL', 'yes'),
  ...property('TimeoutStopSec', '5s'),
  '--',
  procFd(limiterFd),
  `--nproc=${resources.maxProcesses}:${resources.maxProcesses}`,
  `--cpu=${resources.maxCpuSeconds}:${resources.maxCpuSeconds}`,
  `--fsize=${resources.maxFileBytes}:${resources.maxFileBytes}`,
  `--nofile=${resources.maxOpenFiles}:${resources.maxOpenFiles}`,
  '--',
  procFd(programFd),
  ...programArgs,
];

const controllerLines = async (controller, args, operation) => {
  await controller.verifyAfterAbort(operation);
  const descriptors = descriptorPlan([{ id: 'controller', authority: controller }]);
  const lines = [];
  await runBoundedChild({
    command: procFd(descriptors[0].childFd),
    args,
    descriptors,
    env: processTransportEnvironment(),
    timeoutMs: 5_000,
    maxOutputBytes: CONTROLLER_OUTPUT_BYTES,
    onLine: (line) => lines.push(line),
    detached: true,
  });
  return lines;
};

const settleScope = async (controller, unit, operation) => {
  for (const args of [
    ['--user', 'kill', '--kill-whom=all', '--signal=SIGKILL', unit],
    ['--user', 'stop', unit],
  ]) {
    try {
      await controllerLines(controller, args, operation);
    } catch { /* settlement below remains authoritative */ }
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let lines;
    try {
      lines = await controllerLines(controller, [
        '--user', 'show', unit,
        '--property=LoadState', '--property=ActiveState', '--property=ControlGroup',
      ], operation);
    } catch {
      throw codedTrainingError('TRAINING_CGROUP_NOT_EMPTY', 'CGROUP_STATUS_UNAVAILABLE');
    }
    const status = Object.fromEntries(lines.map((line) => {
      const separator = line.indexOf('=');
      return separator < 1 ? ['', ''] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    if (status.LoadState === 'not-found'
      || (['inactive', 'failed'].includes(status.ActiveState) && !status.ControlGroup)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw codedTrainingError('TRAINING_CGROUP_NOT_EMPTY', 'CGROUP_DID_NOT_SETTLE');
};
const SCOPE_PROGRAMS = Object.freeze({
  sandboxMaterializer: Object.freeze({
    programId: 'sandbox',
    fixedIds: Object.freeze([
      'wrapper', 'limiter', 'sandbox', 'consumerPython', 'consumerScript',
    ]),
  }),
  sandboxWorkload: Object.freeze({
    programId: 'sandbox',
    fixedIds: Object.freeze(['wrapper', 'limiter', 'sandbox', 'consumerPython', 'consumerScript']),
  }),
});

/** Execute one verified systemd-run -> prlimit child through inherited descriptors. Impure. */
export const runRefinementProcessScope = async ({
  executionAuthority,
  processAuthority,
  executionEnvelope,
  inheritedAuthorities = [],
  programKind,
  buildProgramArguments,
  cwd,
  operation: suppliedOperation,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_OUTPUT_BYTES,
  verifyWork = null,
}, onLine) => {
  const envelope = validateRefinementExecutionEnvelope(executionEnvelope);
  const scopeProgram = SCOPE_PROGRAMS[programKind];
  if (!executionAuthority || executionAuthority.executionEnvelope?.sha256 !== envelope.sha256
    || !scopeProgram
    || typeof buildProgramArguments !== 'function'
    || (verifyWork !== null && (
      typeof verifyWork?.verifyBeforeSpawn !== 'function'
      || typeof verifyWork?.verifyAfterReap !== 'function'
    ))) {
    throw codedTrainingError('TRAINING_EXECUTION_CHANGED', 'EXECUTION_AUTHORITY_MISMATCH');
  }
  const operation = assertRefinementProcessOperation(suppliedOperation);
  assertRefinementExecutionSpawnAuthority(processAuthority, operation);
  const entries = [
    ...scopeProgram.fixedIds.map((id) => ({ id, authority: processAuthority[id] })),
    ...inheritedAuthorities,
  ];
  const descriptors = descriptorPlan(entries);
  const byId = Object.freeze(Object.fromEntries(descriptors.map(({ id, childFd }) => [id, childFd])));
  const requestedDuration = boundedOption(
    timeoutMs,
    DEFAULT_STEP_TIMEOUT_MS,
    MAX_STEP_TIMEOUT_MS,
    'timeout',
  );
  const duration = Math.max(1, Math.min(
    requestedDuration,
    Math.ceil(operation.monotonicDeadline - performance.now()),
  ));
  const unit = `neuma-refinement-${randomBytes(12).toString('hex')}.scope`;
  let scopeStarted = false;
  let childFailure = null;
  let outcome = null;
  try {
    await assertRefinementExecutionAuthority(executionAuthority, operation);
    for (const { authority } of inheritedAuthorities) await authority.verify(operation);
    const programArgs = await buildProgramArguments(byId, operation);
    const args = scopeArguments({
      unit,
      resources: envelope.resources,
      limiterFd: byId.limiter,
      programFd: byId[scopeProgram.programId],
      programArgs,
      timeoutMs: duration,
    });
    await assertRefinementExecutionAuthority(executionAuthority, operation);
    for (const { authority } of inheritedAuthorities) await authority.verify(operation);
    if (verifyWork) await verifyWork.verifyBeforeSpawn(operation);
    operation.assertActive();
    scopeStarted = true;
    outcome = await runBoundedChild({
      command: procFd(byId.wrapper),
      args,
      descriptors,
      cwd,
      env: processTransportEnvironment(),
      signal: operation.signal,
      timeoutMs: duration,
      maxOutputBytes,
      onLine,
      detached: false,
      afterSpawn: verifyWork
        ? () => verifyWork.verifyBeforeSpawn(operation)
        : null,
      terminate: async (child) => {
        try { child.kill('SIGTERM'); } catch { /* already exited */ }
        await settleScope(processAuthority.controller, unit, operation);
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
      },
    });
  } catch (error) {
    childFailure = error;
  }
  let cleanupFailure = null;
  if (scopeStarted && verifyWork) {
    try {
      await verifyWork.verifyAfterReap(operation);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (scopeStarted) {
    try {
      await settleScope(processAuthority.controller, unit, operation);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (scopeStarted && verifyWork) {
    try {
      await verifyWork.verifyAfterReap(operation);
    } catch (error) {
      cleanupFailure = cleanupFailure
        ? new AggregateError(
          [cleanupFailure, error],
          'refinement cgroup and work authority verification failed',
        )
        : error;
    }
  }
  if (cleanupFailure && childFailure) {
    throw new AggregateError(
      [childFailure, cleanupFailure],
      'refinement child execution and cgroup cleanup failed',
    );
  }
  if (cleanupFailure) throw cleanupFailure;
  if (childFailure) throw childFailure;
  return outcome;
};
