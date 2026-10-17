import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { sha256HandleStable } from './file-digest.js';
import {
  assertRefinementProcessOperation,
  createRefinementProcessOperation,
} from './refinement-process-operation.js';
import { codedTrainingError } from './refinement-training-errors.js';

const GPU_UUID = /^GPU-[A-F0-9-]{8,80}$/u;
const DRIVER_VERSION = /^\d{3,4}(?:\.\d{1,3}){1,3}$/u;
const NVIDIA_SMI = '/usr/bin/nvidia-smi';
const MAX_EXECUTABLE_BYTES = 64 * 1024 ** 2;
const MAX_PROBE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const OPEN_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const GPU_BINDING_FIELDS = Object.freeze([
  'cudaVisibleDevices', 'deviceDescriptorsSha256', 'gpuBindingSha256', 'gpuUuid',
  'nvidiaVisibleDevices', 'schemaVersion',
]);

const fail = (code, diagnostic) => codedTrainingError(code, diagnostic);
const sameNode = (left, right) => left.dev === right.dev
  && left.ino === right.ino && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.rdev === right.rdev && left.nlink === right.nlink
  && left.size === right.size && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;
const exactKeys = (value, fields) => Boolean(value && typeof value === 'object'
  && !Array.isArray(value)
  && Reflect.ownKeys(value).every((key) => typeof key === 'string')
  && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0'));
const sameOperation = (value, operation) => {
  const checked = assertRefinementProcessOperation(value);
  if (checked !== operation) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_OPERATION_CHANGED');
  }
  return checked;
};

/** Canonical path-free logical-zero to physical-GPU binding. Pure. */
export const refinementGpuBinding = (value) => {
  if (!exactKeys(value, GPU_BINDING_FIELDS) || value.schemaVersion !== 1
    || !GPU_UUID.test(String(value.gpuUuid || ''))
    || value.cudaVisibleDevices !== value.gpuUuid
    || value.nvidiaVisibleDevices !== value.gpuUuid
    || !/^[0-9a-f]{64}$/u.test(String(value.deviceDescriptorsSha256 || ''))
    || !/^[0-9a-f]{64}$/u.test(String(value.gpuBindingSha256 || ''))) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_BINDING_INVALID');
  }
  const projection = Object.freeze(Object.fromEntries(
    GPU_BINDING_FIELDS.map((field) => [field, value[field]]),
  ));
  const payload = Object.fromEntries(
    GPU_BINDING_FIELDS.filter((field) => field !== 'gpuBindingSha256')
      .map((field) => [field, projection[field]]),
  );
  if (refinementSha256(payload) !== projection.gpuBindingSha256) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_BINDING_DIGEST_MISMATCH');
  }
  return projection;
};

const retryableHandle = (handle, diagnostic) => {
  let phase = 'open';
  let closePromise = null;
  const assertOpen = () => {
    if (phase !== 'open') throw fail('TRAINING_CGROUP_NOT_EMPTY', diagnostic);
  };
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
  return Object.freeze({ assertOpen, close });
};

const cleanupFailure = (error, closeError, cleanup, message) => Object.assign(
  new AggregateError([error, closeError], message),
  { code: error?.code || 'TRAINING_CGROUP_NOT_EMPTY', cleanup },
);

const openNvidiaSmi = async () => {
  const before = await fs.lstat(NVIDIA_SMI, { bigint: true });
  if (!before.isFile() || before.uid !== 0n || before.size < 1n
    || before.size > BigInt(MAX_EXECUTABLE_BYTES) || (before.mode & 0o111n) === 0n
    || (before.mode & 0o022n) !== 0n) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_EXECUTABLE_INVALID');
  }
  const handle = await fs.open(NVIDIA_SMI, OPEN_FLAGS);
  const lifecycle = retryableHandle(handle, 'GPU_PROBE_EXECUTABLE_CLOSED');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameNode(before, opened)) {
      throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_EXECUTABLE_CHANGED');
    }
    const sha256 = await sha256HandleStable(handle, { maximumBytes: MAX_EXECUTABLE_BYTES });
    const verify = async () => {
      lifecycle.assertOpen();
      if (!sameNode(opened, await handle.stat({ bigint: true }))
        || await sha256HandleStable(handle, { maximumBytes: MAX_EXECUTABLE_BYTES }) !== sha256) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_PROBE_EXECUTABLE_CHANGED');
      }
      return true;
    };
    return Object.freeze({ fd: handle.fd, verify, close: lifecycle.close });
  } catch (error) {
    try { await lifecycle.close(); }
    catch (closeError) {
      throw cleanupFailure(
        error,
        closeError,
        Object.freeze({ kind: 'refinement-gpu-probe-cleanup-v1', close: lifecycle.close }),
        'GPU probe executable cleanup failed',
      );
    }
    throw error;
  }
};

const probeOutput = (executable, args, operation) => new Promise((resolve, reject) => {
  const controls = assertRefinementProcessOperation(operation);
  let child;
  try {
    child = spawn('/proc/self/fd/3', args, {
      env: Object.freeze({ HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' }),
      stdio: ['ignore', 'pipe', 'pipe', executable.fd],
    });
  } catch {
    reject(fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_SPAWN_FAILED'));
    return;
  }
  const chunks = [];
  let bytes = 0;
  let failure = null;
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    controls.signal.removeEventListener('abort', onAbort);
    if (error) reject(error); else resolve(value);
  };
  const stop = (error) => {
    failure ??= error;
    child.kill('SIGKILL');
  };
  const onAbort = () => stop(fail('TRAINING_CANCELLED', 'GPU_PROBE_CANCELLED'));
  const collect = (chunk, retain) => {
    bytes += chunk.length;
    if (bytes > MAX_PROBE_BYTES) {
      stop(fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_OUTPUT_LIMIT'));
      return;
    }
    if (retain) chunks.push(Buffer.from(chunk));
  };
  child.stdout.on('data', (chunk) => collect(chunk, true));
  child.stderr.on('data', (chunk) => collect(chunk, false));
  child.once('error', () => finish(fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_SPAWN_FAILED')));
  child.once('close', (code, childSignal) => {
    if (failure) finish(failure);
    else if (code !== 0 || childSignal) {
      finish(fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_FAILED'));
    } else finish(null, Buffer.concat(chunks).toString('utf8'));
  });
  const remainingMs = Math.max(1, controls.epochDeadline - Date.now());
  const timer = setTimeout(
    () => stop(fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_TIMEOUT')),
    Math.min(PROBE_TIMEOUT_MS, remainingMs),
  );
  timer.unref?.();
  controls.signal.addEventListener('abort', onAbort, { once: true });
});

const probeGpu = async (executable, operation) => {
  await executable.verify();
  const output = await probeOutput(executable, [
    '--query-gpu=index,uuid,driver_version',
    '--format=csv,noheader,nounits',
  ], operation);
  const lines = output.trim().split(/\r?\n/u).filter(Boolean);
  if (!lines.length) throw fail('GPU_IDENTITY_UNAVAILABLE');
  if (lines.length !== 1) throw fail('GPU_IDENTITY_AMBIGUOUS');
  const [gpu] = lines.map((line) => {
    const parts = line.split(',').map((part) => part.trim());
    const deviceIndex = Number(parts[0]);
    const gpuUuid = String(parts[1] || '').toUpperCase();
    const driverVersion = parts[2];
    if (parts.length !== 3 || !/^(?:0|[1-9]\d{0,2})$/u.test(parts[0])
      || !Number.isSafeInteger(deviceIndex) || deviceIndex > 255
      || !GPU_UUID.test(gpuUuid) || !DRIVER_VERSION.test(String(driverVersion || ''))) {
      throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROBE_RESULT_INVALID');
    }
    return Object.freeze({ deviceIndex, gpuUuid, driverVersion });
  });
  return gpu;
};

const assertNoComputeProcess = async (executable, gpuUuid, operation) => {
  await executable.verify();
  const output = await probeOutput(executable, [
    '--query-compute-apps=gpu_uuid,pid',
    '--format=csv,noheader,nounits',
  ], operation);
  const lines = output.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length > 4096) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROCESS_PROBE_RESULT_INVALID');
  }
  for (const line of lines) {
    const parts = line.split(',').map((part) => part.trim());
    const observedUuid = String(parts[0] || '').toUpperCase();
    if (parts.length !== 2 || !GPU_UUID.test(observedUuid)
      || !/^[1-9]\d{0,9}$/u.test(String(parts[1] || ''))) {
      throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_PROCESS_PROBE_RESULT_INVALID');
    }
    if (observedUuid === gpuUuid) throw fail('TRAINING_GPU_BUSY', 'GPU_COMPUTE_PROCESS_ACTIVE');
  }
  return true;
};

const openDevice = async (guestPath) => {
  const before = await fs.lstat(guestPath, { bigint: true });
  const handle = await fs.open(guestPath, OPEN_FLAGS);
  const lifecycle = retryableHandle(handle, 'GPU_DEVICE_AUTHORITY_CLOSED');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!before.isCharacterDevice() || !opened.isCharacterDevice()
      || before.uid !== 0n || !sameNode(before, opened)) {
      throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_DEVICE_DESCRIPTOR_INVALID');
    }
    const identity = Object.freeze({
      guestPath,
      dev: String(opened.dev),
      ino: String(opened.ino),
      rdev: String(opened.rdev),
      mode: Number(opened.mode & 0o7777n),
      uid: Number(opened.uid),
      gid: Number(opened.gid),
    });
    const verify = async () => {
      lifecycle.assertOpen();
      if (!sameNode(opened, await handle.stat({ bigint: true }))
        || !sameNode(opened, await fs.lstat(guestPath, { bigint: true }))) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_DEVICE_DESCRIPTOR_CHANGED');
      }
      return true;
    };
    return Object.freeze({ guestPath, identity, fd: handle.fd, verify, close: lifecycle.close });
  } catch (error) {
    try { await lifecycle.close(); }
    catch (closeError) {
      throw cleanupFailure(
        error,
        closeError,
        Object.freeze({ kind: 'refinement-gpu-device-cleanup-v1', close: lifecycle.close }),
        'GPU device descriptor cleanup failed',
      );
    }
    throw error;
  }
};

const openDevices = async (deviceIndex) => {
  const paths = [`/dev/nvidia${deviceIndex}`, '/dev/nvidiactl', '/dev/nvidia-uvm'];
  try { await fs.lstat('/dev/nvidia-uvm-tools'); paths.push('/dev/nvidia-uvm-tools'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const devices = [];
  try {
    for (const guestPath of paths) devices.push(await openDevice(guestPath));
    return Object.freeze(devices);
  } catch (error) {
    const cleanup = Object.freeze({
      kind: 'refinement-gpu-devices-cleanup-v1',
      close: () => closeAll(devices),
    });
    try { await cleanup.close(); }
    catch (closeError) {
      throw cleanupFailure(error, closeError, cleanup, 'GPU device acquisition cleanup failed');
    }
    if (error?.code && String(error.code).startsWith('TRAINING_')) throw error;
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_DEVICE_DESCRIPTOR_UNAVAILABLE');
  }
};

const closeAll = async (authorities) => {
  const results = await Promise.allSettled([...authorities].reverse().map(({ close }) => close()));
  const failures = results.filter(({ status }) => status === 'rejected').map(({ reason }) => reason);
  if (failures.length) throw new AggregateError(failures, 'GPU device authority did not close');
  return true;
};

const captureGpuDevice = async (inputOperation, tenancy) => {
  const operation = assertRefinementProcessOperation(inputOperation);
  if (tenancy !== 'exclusive' && tenancy !== 'shared') {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_TENANCY_INVALID');
  }
  const executable = await openNvidiaSmi();
  let devices = Object.freeze([]);
  try {
    const gpu = await probeGpu(executable, operation);
    // Exclusivity is the forge's invariant, not the substrate's: a serving tenant
    // shares the device with the operator's compositor and every other process.
    if (tenancy === 'exclusive') {
      await assertNoComputeProcess(executable, gpu.gpuUuid, operation);
    }
    devices = await openDevices(gpu.deviceIndex);
    const deviceDescriptorsSha256 = refinementSha256(devices.map(({ identity }) => identity));
    const bindingFields = Object.freeze({
      schemaVersion: 1,
      gpuUuid: gpu.gpuUuid,
      cudaVisibleDevices: gpu.gpuUuid,
      nvidiaVisibleDevices: gpu.gpuUuid,
      deviceDescriptorsSha256,
    });
    const gpuBinding = refinementGpuBinding({
      ...bindingFields,
      gpuBindingSha256: refinementSha256(bindingFields),
    });
    let phase = 'open';
    let borrowActive = false;
    let closePromise = null;
    const verifyWithOperation = async (controls) => {
      assertRefinementProcessOperation(controls);
      if (phase !== 'open') throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_DEVICE_AUTHORITY_CLOSED');
      await executable.verify();
      for (const device of devices) await device.verify();
      const observed = await probeGpu(executable, controls);
      if (observed.deviceIndex !== gpu.deviceIndex || observed.gpuUuid !== gpu.gpuUuid
        || observed.driverVersion !== gpu.driverVersion) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_DEVICE_CHANGED');
      }
      return true;
    };
    const verifyIdentity = (nextOperation) =>
      verifyWithOperation(sameOperation(nextOperation, operation));
    const verifyDetached = () => verifyWithOperation(
      createRefinementProcessOperation({ timeoutMs: PROBE_TIMEOUT_MS }),
    );
    const assertIdle = async (nextOperation) => {
      const controls = sameOperation(nextOperation, operation);
      await verifyWithOperation(controls);
      return assertNoComputeProcess(executable, gpu.gpuUuid, controls);
    };
    const withBorrowedDevices = async (nextOperation, consumer) => {
      const controls = sameOperation(nextOperation, operation);
      if (borrowActive || typeof consumer !== 'function') {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_DEVICE_BORROW_INVALID');
      }
      await assertIdle(controls);
      borrowActive = true;
      let live = true;
      const borrowed = Object.freeze(devices.map((device) => Object.freeze({
        guestPath: device.guestPath,
        authority: Object.freeze({
          kind: 'refinement-gpu-device-v1',
          fd: device.fd,
          identity: device.identity,
          verify: async (borrowOperation) => {
            if (!live) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_DEVICE_BORROW_EXPIRED');
            sameOperation(borrowOperation, operation);
            return device.verify();
          },
        }),
      })));
      try { return await consumer(borrowed); }
      finally { live = false; borrowActive = false; }
    };
    const close = () => {
      if (phase === 'closed') return Promise.resolve(false);
      if (closePromise) return closePromise;
      if (borrowActive) {
        return Promise.reject(fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_DEVICE_BORROW_ACTIVE'));
      }
      phase = 'closing';
      closePromise = closeAll([executable, ...devices]).then(
        () => { phase = 'closed'; return true; },
        (error) => { phase = 'cleanup-failed'; throw error; },
      ).finally(() => { closePromise = null; });
      return closePromise;
    };
    return Object.freeze({
      gpuBinding,
      assertIdle,
      verifyIdentity,
      verifyDetached,
      withBorrowedDevices,
      close,
    });
  } catch (error) {
    const cleanup = Object.freeze({
      kind: 'refinement-gpu-capture-cleanup-v1',
      close: () => closeAll([executable, ...devices]),
    });
    try { await cleanup.close(); }
    catch (closeError) {
      throw cleanupFailure(error, closeError, cleanup, 'GPU device capture cleanup failed');
    }
    throw error;
  }
};

const SERVING_GPU_CODE = Object.freeze({
  TRAINING_CANCELLED: 'SERVING_GPU_CANCELLED',
  TRAINING_CGROUP_NOT_EMPTY: 'SERVING_GPU_CUSTODY_LOST',
});

// Serving refuses in its own vocabulary. The private diagnostic and any cleanup
// handle ride through, and the untranslated failure stays reachable as the cause.
const servingRefusal = (error) => {
  const code = SERVING_GPU_CODE[error?.code] ?? 'SERVING_GPU_UNAVAILABLE';
  const projected = fail(code, error?.diagnostic);
  projected.cause = error;
  if (error?.cleanup) projected.cleanup = error.cleanup;
  return projected;
};

const servingGuard = async (work) => {
  try { return await work(); }
  catch (error) { throw servingRefusal(error); }
};

const servingOwner = (captured) => {
  let custody = 'prepared';
  const requireOwner = (owner) => {
    if (custody !== owner) throw fail('SERVING_GPU_CUSTODY_LOST', 'SERVING_GPU_OWNERSHIP_CHANGED');
  };
  const closeFor = async (owner) => {
    if (custody !== owner) return false;
    const result = await captured.close();
    custody = 'closed';
    return result;
  };
  const prepared = {
    kind: 'serving-gpu-device-authority-v1',
    gpuBinding: captured.gpuBinding,
    verify: async (operation) => {
      requireOwner('prepared');
      await servingGuard(() => captured.verifyIdentity(operation));
      return prepared;
    },
    close: () => closeFor('prepared'),
    transfer: () => {
      requireOwner('prepared');
      custody = 'transferred';
      const owned = {
        kind: 'serving-gpu-device-authority-v1',
        gpuBinding: captured.gpuBinding,
        verify: async () => {
          requireOwner('transferred');
          await servingGuard(() => captured.verifyDetached());
          return owned;
        },
        close: () => closeFor('transferred'),
      };
      return Object.freeze(owned);
    },
  };
  return Object.freeze(prepared);
};

/**
 * Capture logical GPU zero once and retain its identity across one serving
 * process. Serving is an ordinary compute tenant: the device identity is proven,
 * the device is never claimed exclusively.
 */
export const captureServingGpuDeviceAuthority = async (operation) => servingOwner(
  await servingGuard(() => captureGpuDevice(operation, 'shared')),
);

/** Capture one idle scheduled GPU for the private forge reservation issuer. */
export const captureRefinementGpuDeviceAuthority = (operation) =>
  captureGpuDevice(operation, 'exclusive');
