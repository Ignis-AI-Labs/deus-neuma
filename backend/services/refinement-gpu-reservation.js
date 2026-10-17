import { randomBytes } from 'node:crypto';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  assertNoActiveServingGpuConflict,
} from './serving-gpu-conflict-authority.js';
import { captureRefinementGpuDeviceAuthority } from './refinement-gpu-device-authority.js';
import {
  publishRefinementGpuLease,
  recoverStaleRefinementGpuReservation,
} from './refinement-gpu-lease-store.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { refinementGpuLease } from './refinement-gpu-lease-contract.js';
import { codedTrainingError, trainingErrorProjection } from './refinement-training-errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const INPUT_FIELDS = Object.freeze(['operation', 'trainingPlanSha256']);
const CLEANUPS = new WeakSet();
const fail = (code, diagnostic) => codedTrainingError(code, diagnostic);
const exactInput = (value) => Boolean(value && typeof value === 'object'
  && !Array.isArray(value)
  && Reflect.ownKeys(value).every((key) => typeof key === 'string')
  && Object.keys(value).sort().join('\0') === INPUT_FIELDS.join('\0'));
const generation = () => randomBytes(6).readUIntBE(0, 6) || 1;

export { recoverStaleRefinementGpuReservation };

const cleanupOwner = (entries) => {
  const retained = entries.map((authority) => ({ authority, closed: false }));
  let closePromise = null;
  const cleanup = Object.freeze({
    kind: 'refinement-gpu-reservation-cleanup-v1',
    close: () => {
      if (retained.every(({ closed }) => closed)) return Promise.resolve(false);
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const failures = [];
        for (let index = retained.length - 1; index >= 0; index -= 1) {
          const item = retained[index];
          if (item.closed) continue;
          try { await item.authority.close(); item.closed = true; }
          catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'GPU reservation cleanup failed');
        return true;
      })().finally(() => { closePromise = null; });
      return closePromise;
    },
  });
  CLEANUPS.add(cleanup);
  return cleanup;
};

const failedAcquisition = (error, entries) => Object.freeze({
  ok: false,
  errorCode: trainingErrorProjection(error).code,
  cleanup: cleanupOwner([
    ...entries,
    ...(error?.cleanup ? [error.cleanup] : []),
  ]),
});

const assertNoServingConflict = async (operation, gpuBinding) => {
  const clearance = await assertNoActiveServingGpuConflict({ operation, gpuBinding });
  if (clearance?.kind !== 'serving-gpu-conflict-clearance-v1'
    || clearance.gpuBindingSha256 !== gpuBinding.gpuBindingSha256) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'SERVING_GPU_STATE_UNPROVEN');
  }
  return clearance;
};

const leaseProjection = ({ trainingPlanSha256, jobSha256, gpuBinding, operation }) => {
  const issuedAtMs = Date.now();
  const expiresAtMs = Math.min(operation.epochDeadline, issuedAtMs + 6 * 60 * 60 * 1_000);
  const fields = Object.freeze({
    schemaVersion: 1,
    gpuUuid: gpuBinding.gpuUuid,
    cudaVisibleDevices: gpuBinding.gpuUuid,
    nvidiaVisibleDevices: gpuBinding.gpuUuid,
    deviceDescriptorsSha256: gpuBinding.deviceDescriptorsSha256,
    gpuBindingSha256: gpuBinding.gpuBindingSha256,
    trainingPlanSha256,
    jobSha256,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    generation: generation(),
  });
  return refinementGpuLease({
    ...fields,
    gpuLeaseSha256: refinementSha256({ kind: 'refinement-gpu-lease-v1', lease: fields }),
  });
};

const reservationOwner = ({ gpuLease, store, device, operation }) => {
  let custody = 'prepared';
  let closePromise = null;
  const requireCustody = (owner) => {
    if (custody !== owner) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_OWNERSHIP_CHANGED');
  };
  const assertLease = async (nextOperation) => {
    const controls = assertRefinementProcessOperation(nextOperation);
    if (controls !== operation) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_OPERATION_CHANGED');
    await store.assertOwned();
    await device.verifyIdentity(controls);
    controls.assertActive();
    return gpuLease;
  };
  const withDevices = async (nextOperation, consumer) => {
    const controls = assertRefinementProcessOperation(nextOperation);
    if (controls !== operation) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_OPERATION_CHANGED');
    await assertLease(controls);
    return device.withBorrowedDevices(controls, consumer);
  };
  const closeUnderlying = () => {
    if (custody === 'closed') return Promise.resolve(false);
    if (closePromise) return closePromise;
    closePromise = (async () => {
      await device.close();
      await store.release();
      custody = 'closed';
      return true;
    })().finally(() => { closePromise = null; });
    return closePromise;
  };
  const projection = Object.freeze({
    kind: 'refinement-gpu-reservation-v1',
    gpuLease,
  });
  const prepared = {
    ...projection,
    assertHeld: async (nextOperation) => {
      requireCustody('prepared');
      return assertLease(nextOperation);
    },
    withProcessDevices: async (nextOperation, consumer) => {
      requireCustody('prepared');
      return withDevices(nextOperation, consumer);
    },
    verify: async (nextOperation) => {
      requireCustody('prepared');
      await assertLease(nextOperation);
      return prepared;
    },
    close: async () => {
      if (custody !== 'prepared') return false;
      return closeUnderlying();
    },
    transfer: () => {
      requireCustody('prepared');
      custody = 'transferred';
      const owned = {
        ...projection,
        assertHeld: async (nextOperation) => {
          requireCustody('transferred');
          return assertLease(nextOperation);
        },
        withProcessDevices: async (nextOperation, consumer) => {
          requireCustody('transferred');
          return withDevices(nextOperation, consumer);
        },
        verify: async (nextOperation) => {
          requireCustody('transferred');
          await assertLease(nextOperation);
          return owned;
        },
        close: async () => {
          if (custody !== 'transferred') return false;
          return closeUnderlying();
        },
      };
      return Object.freeze(owned);
    },
  };
  return Object.freeze(prepared);
};

/** Acquire one cross-process single-GPU reservation for one plan and operation. */
export const acquireRefinementGpuReservation = async (input) => {
  if (!exactInput(input) || !SHA256.test(String(input.trainingPlanSha256 || ''))) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_RESERVATION_INPUT_INVALID');
  }
  const operation = assertRefinementProcessOperation(input.operation);
  let device;
  let store;
  let reservation;
  try {
    device = await captureRefinementGpuDeviceAuthority(operation);
    await assertNoServingConflict(operation, device.gpuBinding);
    const jobSha256 = refinementSha256({
      kind: 'refinement-forge-job-v1',
      trainingPlanSha256: input.trainingPlanSha256,
      gpuBindingSha256: device.gpuBinding.gpuBindingSha256,
      operationExpiresAt: new Date(operation.epochDeadline).toISOString(),
    });
    const gpuLease = leaseProjection({
      trainingPlanSha256: input.trainingPlanSha256,
      jobSha256,
      gpuBinding: device.gpuBinding,
      operation,
    });
    store = await publishRefinementGpuLease(gpuLease);
    await assertNoServingConflict(operation, device.gpuBinding);
    reservation = reservationOwner({ gpuLease, store, device, operation });
    await reservation.assertHeld(operation);
    return Object.freeze({ ok: true, reservation });
  } catch (error) {
    return failedAcquisition(error, [
      ...(store ? [store] : []),
      ...(device ? [device] : []),
      ...(reservation ? [reservation] : []),
    ]);
  }
};
