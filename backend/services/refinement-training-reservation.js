import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { createAnonymousStagingDirectory } from './refinement-directory-custody.js';
import {
  currentProcessIdentity,
  diskAvailableBytes,
  diskCleanupOwner,
  encodeDiskLease,
  exactDiskLease,
  openDiskReservationRoot,
  assertDiskReservationRoot,
  publishDiskLease,
  releasePublishedDiskLease,
  verifyPublishedDiskLease,
} from './refinement-training-reservation-store.js';
import { codedTrainingError, trainingErrorProjection } from './refinement-training-errors.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const RESERVATION_OWNERS = new WeakMap();
const INPUT_FIELDS = Object.freeze([
  'jobSha256', 'operation', 'reservationBytes', 'trainingPlanSha256',
]);
const fail = (code, diagnostic) => codedTrainingError(code, diagnostic);
const exactInput = (value) => Boolean(value && typeof value === 'object'
  && !Array.isArray(value)
  && Reflect.ownKeys(value).every((key) => typeof key === 'string')
  && Object.keys(value).sort().join('\0') === INPUT_FIELDS.join('\0'));
const nonceSha256 = () => refinementSha256(randomBytes(32).toString('hex'));

const reservationOwner = ({ root, published, lease, bytes, operation }) => {
  let custody = 'prepared';
  let cleanupStage = 'active';
  let closePromise = null;
  let closing = false;
  let borrowPromise = null;
  let borrowSettled = null;
  let work = null;
  let workCleanupPromise = null;
  const releaseState = {
    phase: 'active',
    fileClosed: false,
    rootClosed: false,
  };
  const requireCustody = (owner) => {
    if (custody !== owner || closing) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'DISK_OWNERSHIP_CHANGED');
    }
  };
  const verifyRecord = () => verifyPublishedDiskLease({ root, published, lease, bytes });
  const assertCapacity = async (nextOperation) => {
    const controls = assertRefinementProcessOperation(nextOperation);
    if (controls !== operation) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'DISK_OPERATION_CHANGED');
    await verifyRecord();
    if (await diskAvailableBytes(root) < BigInt(lease.reservationBytes)) {
      throw fail('INSUFFICIENT_DISK', 'DISK_CAPACITY_EXHAUSTED');
    }
    controls.assertActive();
    return true;
  };
  const workName = `.work-${lease.nonceSha256}`;
  const workPath = () => `/proc/self/fd/${root.handle.fd}/${workName}`;
  const sameDirectory = (left, right) => left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid;
  const removeWorkDirectory = async () => {
    await assertDiskReservationRoot(root);
    const current = await fs.lstat(workPath(), { bigint: true }).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!current) return false;
    if (!current.isDirectory()
      || current.uid !== BigInt(process.geteuid?.() ?? current.uid)
      || (current.mode & 0o777n) !== 0o700n
      || (work?.identity && !sameDirectory(work.identity, current))) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'WORK_ROOT_CHANGED');
    }
    await fs.rmdir(workPath());
    await root.handle.sync();
    await assertDiskReservationRoot(root);
    return true;
  };
  const cleanupWork = () => {
    if (!work) return Promise.resolve(false);
    if (workCleanupPromise) return workCleanupPromise;
    workCleanupPromise = (async () => {
      if (work.owner && !work.ownerClosed) {
        await work.owner.close();
        work.ownerClosed = true;
      }
      if (!work.leafRemoved) {
        await removeWorkDirectory();
        work.leafRemoved = true;
      }
      work = null;
      return true;
    })().finally(() => { workCleanupPromise = null; });
    return workCleanupPromise;
  };
  const cleanupFailure = (primary, cleanup) => {
    const error = new AggregateError(
      primary ? [primary, cleanup] : [cleanup],
      'refinement training work root cleanup failed',
    );
    Object.defineProperties(error, {
      code: { value: primary?.code ?? cleanup?.code, enumerable: true },
      cleanup: {
        value: diskCleanupOwner([Object.freeze({
          kind: 'refinement-training-work-root-cleanup-v1',
          close: cleanupWork,
        })]),
        enumerable: false,
      },
    });
    return error;
  };
  const withWorkRoot = (role, nextOperation, consumer) => {
    requireCustody(role);
    if (typeof consumer !== 'function' || borrowPromise || work) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'WORK_ROOT_BORROW_INVALID');
    }
    const task = (async () => {
      let result;
      let primary = null;
      try {
        await assertCapacity(nextOperation);
        work = {
          identity: null,
          leafRemoved: false,
          owner: null,
          ownerClosed: false,
        };
        try {
          work.owner = await createAnonymousStagingDirectory({
            root: root.pathname,
            leafName: workName,
            prefix: 'forge',
            label: 'refinement training work root',
          });
        } catch (error) {
          if (error?.recovery && typeof error.recovery.close === 'function') {
            work.owner = error.recovery;
          }
          throw error;
        }
        const identity = await fs.lstat(workPath(), { bigint: true });
        if (!identity.isDirectory()
          || identity.uid !== BigInt(process.geteuid?.() ?? identity.uid)
          || (identity.mode & 0o777n) !== 0o700n) {
          throw fail('TRAINING_CGROUP_NOT_EMPTY', 'WORK_ROOT_UNSAFE');
        }
        work.identity = identity;
        await verifyRecord();
        operation.assertActive();
        result = await consumer(work.owner);
      } catch (error) {
        primary = error;
      }
      let cleanup = null;
      try {
        await cleanupWork();
        await verifyRecord();
      } catch (error) {
        cleanup = error;
      }
      if (cleanup) throw cleanupFailure(primary, cleanup);
      if (primary) throw primary;
      return result;
    })();
    borrowPromise = task;
    borrowSettled = task.then(() => undefined, () => undefined);
    return task.finally(() => {
      borrowPromise = null;
      borrowSettled = null;
    });
  };
  const closeUnderlying = () => {
    if (custody === 'closed') return Promise.resolve(false);
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      if (borrowSettled) await borrowSettled;
      await cleanupWork();
      if (cleanupStage === 'active') {
        await verifyRecord();
        cleanupStage = 'verified';
      }
      if (cleanupStage === 'verified') {
        await releasePublishedDiskLease({
          root,
          published,
          lease,
          releaseState,
        });
        cleanupStage = 'released';
      }
      custody = 'closed';
      return true;
    })().finally(() => {
      closing = false;
      closePromise = null;
    });
    return closePromise;
  };
  const projection = Object.freeze({
    kind: 'refinement-training-disk-quota-lease-v1',
    trainingPlanSha256: lease.trainingPlanSha256,
    jobSha256: lease.jobSha256,
    leaseSha256: lease.leaseSha256,
    reservationBytes: lease.reservationBytes,
  });
  const prepared = {
    ...projection,
    assertCapacity: async (nextOperation) => {
      requireCustody('prepared');
      return assertCapacity(nextOperation);
    },
    verify: async (nextOperation) => {
      requireCustody('prepared');
      await assertCapacity(nextOperation);
      return prepared;
    },
    close: async () => {
      if (custody !== 'prepared') return false;
      return closeUnderlying();
    },
    transfer: () => {
      requireCustody('prepared');
      if (borrowPromise || work) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'WORK_ROOT_BORROW_ACTIVE');
      }
      custody = 'transferred';
      const owned = {
        ...projection,
        assertCapacity: async (nextOperation) => {
          requireCustody('transferred');
          return assertCapacity(nextOperation);
        },
        verify: async (nextOperation) => {
          requireCustody('transferred');
          await assertCapacity(nextOperation);
          return owned;
        },
        close: async () => {
          if (custody !== 'transferred') return false;
          return closeUnderlying();
        },
      };
      const frozen = Object.freeze(owned);
      RESERVATION_OWNERS.set(frozen, Object.freeze({
        withWorkRoot: (nextOperation, consumer) =>
          withWorkRoot('transferred', nextOperation, consumer),
      }));
      return frozen;
    },
  };
  const frozen = Object.freeze(prepared);
  RESERVATION_OWNERS.set(frozen, Object.freeze({
    withWorkRoot: (nextOperation, consumer) =>
      withWorkRoot('prepared', nextOperation, consumer),
  }));
  return frozen;
};

/** Await work beneath the held quota root without exposing a path, handle, or descriptor. */
export const withRefinementTrainingWorkRoot = (reservation, operation, consumer) => {
  const owner = RESERVATION_OWNERS.get(reservation);
  if (!owner) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'DISK_RESERVATION_INVALID');
  return owner.withWorkRoot(operation, consumer);
};

const failedAcquisition = (error, entries) => Object.freeze({
  ok: false,
  errorCode: trainingErrorProjection(error).code,
  cleanup: diskCleanupOwner([
    ...entries,
    ...(error?.cleanup ? [error.cleanup] : []),
  ]),
});

/** Acquire one exact plan/job disk quota lease through one branded forge operation. */
export const reserveRefinementTrainingDisk = async (input) => {
  if (!exactInput(input)
    || !SHA256.test(String(input.trainingPlanSha256 || ''))
    || !SHA256.test(String(input.jobSha256 || ''))
    || !Number.isSafeInteger(input.reservationBytes) || input.reservationBytes < 1) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'DISK_RESERVATION_INPUT_INVALID');
  }
  const operation = assertRefinementProcessOperation(input.operation);
  let root;
  try { root = await openDiskReservationRoot(); }
  catch (error) {
    if (error?.cleanup) return failedAcquisition(error, []);
    throw error;
  }
  let reservation = null;
  try {
    const identity = await currentProcessIdentity();
    const fields = Object.freeze({
      schemaVersion: 1,
      trainingPlanSha256: input.trainingPlanSha256,
      jobSha256: input.jobSha256,
      reservationBytes: input.reservationBytes,
      pid: identity.pid,
      uid: identity.uid,
      bootId: identity.bootId,
      processStartTicks: identity.processStartTicks,
      nonceSha256: nonceSha256(),
      operationExpiresAt: new Date(operation.epochDeadline).toISOString(),
    });
    const lease = exactDiskLease({ ...fields, leaseSha256: refinementSha256(fields) });
    if (await diskAvailableBytes(root) < BigInt(lease.reservationBytes)) {
      throw fail('INSUFFICIENT_DISK', 'DISK_CAPACITY_EXHAUSTED');
    }
    const bytes = encodeDiskLease(lease);
    const published = await publishDiskLease(root, lease, bytes);
    reservation = reservationOwner({ root, published, lease, bytes, operation });
    await reservation.assertCapacity(operation);
    return Object.freeze({ ok: true, reservation });
  } catch (error) {
    return failedAcquisition(error, reservation ? [reservation] : [root]);
  }
};
