import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { getDataRoot } from './data-root.js';
import { refinementGpuLease } from './refinement-gpu-lease-contract.js';
import { codedTrainingError } from './refinement-training-errors.js';
import {
  gpuLeaseHandleCleanup as handleCleanup,
  orderedGpuLeaseCleanup as orderedCleanup,
  throwAfterGpuLeaseCleanup as throwAfterCleanup,
} from './refinement-gpu-lease-cleanup.js';

const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const DIRECTORY = constants.O_RDONLY | NOFOLLOW
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0);
const READ = constants.O_RDONLY | NOFOLLOW;
const CREATE = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
const SHA256 = /^[0-9a-f]{64}$/u;
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_LEASE_BYTES = 16 * 1024;
const OWNER_FIELDS = Object.freeze(['bootId', 'pid', 'processStartTicks', 'uid']);

const fail = (code, diagnostic) => codedTrainingError(code, diagnostic);
const exactKeys = (value, fields) => Boolean(value && typeof value === 'object'
  && !Array.isArray(value)
  && Reflect.ownKeys(value).every((key) => typeof key === 'string')
  && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0'));
const currentUid = () => (typeof process.geteuid === 'function' ? process.geteuid() : 0);
const nonceSha256 = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const sameNode = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid
  && left.rdev === right.rdev && left.nlink === right.nlink && left.size === right.size
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const sameDirectory = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid;
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid
  && left.rdev === right.rdev;


const readBounded = async (filePath, maximumBytes) => {
  const handle = await fs.open(filePath, READ);
  const cleanup = handleCleanup(handle, 'refinement-gpu-proc-read-cleanup-v1');
  try {
    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (!offset || offset > maximumBytes) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_RECORD_SIZE_INVALID');
    }
    await cleanup.close();
    return bytes.subarray(0, offset);
  } catch (error) {
    return throwAfterCleanup(error, cleanup, 'GPU owner probe cleanup failed');
  }
};

const readHandle = async (handle) => {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_LEASE_BYTES)) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_DESCRIPTOR_INVALID');
  }
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_RECORD_TRUNCATED');
    offset += bytesRead;
  }
  if (!sameNode(before, await handle.stat({ bigint: true }))) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_DESCRIPTOR_CHANGED');
  }
  return bytes;
};

const procStartTicks = async (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_OWNER_INVALID');
  }
  const text = (await readBounded(`/proc/${pid}/stat`, 8192)).toString('utf8').trim();
  const close = text.lastIndexOf(')');
  const fields = close >= 0 ? text.slice(close + 2).split(' ') : [];
  const ticks = fields[19];
  if (!/^[1-9]\d*$/u.test(String(ticks || ''))) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_OWNER_IDENTITY_UNAVAILABLE');
  }
  return ticks;
};

const bootId = async () => {
  const value = (await readBounded('/proc/sys/kernel/random/boot_id', 128))
    .toString('utf8').trim().toLowerCase();
  if (!BOOT_ID.test(value)) throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_LEASE_BOOT_ID_INVALID');
  return value;
};

const processIdentity = async () => Object.freeze({
  bootId: await bootId(),
  pid: process.pid,
  processStartTicks: await procStartTicks(process.pid),
  uid: currentUid(),
});

const ownerAlive = async (owner, currentBootId) => {
  if (!exactKeys(owner, OWNER_FIELDS) || owner.bootId !== currentBootId
    || !Number.isSafeInteger(owner.pid) || owner.pid < 1
    || !Number.isSafeInteger(owner.uid) || owner.uid < 0
    || !/^[1-9]\d*$/u.test(String(owner.processStartTicks || ''))) return false;
  try {
    const [ticks, proc] = await Promise.all([
      procStartTicks(owner.pid),
      fs.stat(`/proc/${owner.pid}`, { bigint: true }),
    ]);
    return ticks === owner.processStartTicks && proc.uid === BigInt(owner.uid);
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error?.code)) return false;
    if (error?.code && String(error.code).startsWith('TRAINING_')) throw error;
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_OWNER_PROBE_FAILED');
  }
};

const ensurePrivateRoot = async () => {
  const root = path.join(getDataRoot(), 'runtime', 'refinement-gpu-reservation-v1');
  if (!path.isAbsolute(root) || path.normalize(root) !== root) {
    throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_LEASE_ROOT_INVALID');
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await fs.open(root, DIRECTORY);
  const lifecycle = handleCleanup(handle, 'refinement-gpu-lease-root-cleanup-v1');
  try {
    const [state, pathname, real] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(root, { bigint: true }),
      fs.realpath(root),
    ]);
    if (real !== root || !state.isDirectory() || !pathname.isDirectory()
      || !sameDirectory(state, pathname) || state.uid !== BigInt(currentUid())
      || (state.mode & 0o777n) !== 0o700n) {
      throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_LEASE_ROOT_NOT_PRIVATE');
    }
    return Object.freeze({
      root,
      handle,
      state,
      childPath: (name) => `/proc/self/fd/${handle.fd}/${name}`,
      close: lifecycle.close,
    });
  } catch (error) {
    return throwAfterCleanup(error, lifecycle, 'GPU lease root cleanup failed');
  }
};

const assertRoot = async (authority) => {
  const [held, pathname] = await Promise.all([
    authority.handle.stat({ bigint: true }),
    fs.lstat(authority.root, { bigint: true }),
  ]);
  if (!sameDirectory(authority.state, held) || !sameDirectory(authority.state, pathname)) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_ROOT_CHANGED');
  }
  return true;
};

const retainedFileCleanup = ({ rootAuthority, handle, paths, kind }) => {
  const descriptor = handleCleanup(handle, `${kind}-descriptor`);
  const remaining = new Set(paths);
  let closed = false;
  let closePromise = null;
  const cleanup = {
    kind,
    close: () => {
      if (closed) return Promise.resolve(false);
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const state = await handle.stat({ bigint: true });
        for (const filePath of [...remaining]) {
          const named = await fs.lstat(filePath, { bigint: true }).catch((error) => {
            if (error?.code === 'ENOENT') return null;
            throw error;
          });
          if (named && !sameInode(state, named)) {
            throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_CLEANUP_CAS_FAILED');
          }
          if (named) await fs.unlink(filePath);
          remaining.delete(filePath);
        }
        await assertRoot(rootAuthority);
        await rootAuthority.handle.sync();
        await descriptor.close();
        closed = true;
        return true;
      })().finally(() => { closePromise = null; });
      return closePromise;
    },
  };
  return Object.freeze(cleanup);
};

const canonicalLease = (value, diagnostic) => {
  try { return refinementGpuLease(value); }
  catch { throw fail('TRAINING_CGROUP_NOT_EMPTY', diagnostic); }
};

const leaseRecord = (owner, projection) => {
  const payload = Object.freeze({ schemaVersion: 1, state: 'held', owner, projection });
  return Object.freeze({ ...payload, recordSha256: refinementSha256(payload) });
};

const parseLeaseRecord = (bytes) => {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_RECORD_CORRUPT'); }
  if (!exactKeys(value, ['schemaVersion', 'state', 'owner', 'projection', 'recordSha256'])
    || value.schemaVersion !== 1 || value.state !== 'held'
    || !exactKeys(value.owner, OWNER_FIELDS)
    || !BOOT_ID.test(String(value.owner.bootId || ''))
    || !Number.isSafeInteger(value.owner.pid) || value.owner.pid < 1
    || !Number.isSafeInteger(value.owner.uid) || value.owner.uid < 0
    || !/^[1-9]\d*$/u.test(String(value.owner.processStartTicks || ''))
    || !SHA256.test(String(value.recordSha256 || ''))) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_RECORD_CORRUPT');
  }
  const projection = canonicalLease(value.projection, 'GPU_LEASE_RECORD_CORRUPT');
  const payload = { schemaVersion: 1, state: 'held', owner: value.owner, projection };
  if (refinementSha256(payload) !== value.recordSha256) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_RECORD_CORRUPT');
  }
  return Object.freeze({ ...payload, recordSha256: value.recordSha256 });
};

const leaseFileState = (stat) => {
  if (!stat.isFile() || stat.uid !== BigInt(currentUid()) || (stat.mode & 0o777n) !== 0o600n
    || stat.size < 1n || stat.size > BigInt(MAX_LEASE_BYTES) || stat.nlink !== 1n) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_FILE_INVALID');
  }
  return stat;
};

const recoverStaleAt = async (rootAuthority) => {
  const leasePath = rootAuthority.childPath('lease.json');
  let handle;
  try { handle = await fs.open(leasePath, READ); }
  catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ recovered: false });
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_OPEN_FAILED');
  }
  const descriptor = handleCleanup(handle, 'refinement-gpu-stale-descriptor-cleanup-v1');
  let cleanup = descriptor;
  try {
    await assertRoot(rootAuthority);
    const state = leaseFileState(await handle.stat({ bigint: true }));
    const record = parseLeaseRecord(await readHandle(handle));
    if (!sameNode(state, await fs.lstat(leasePath, { bigint: true }))) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_CAS_CHANGED');
    }
    if (await ownerAlive(record.owner, await bootId())) {
      const expired = Date.parse(record.projection.expiresAt) <= Date.now();
      throw fail('TRAINING_INFLIGHT', expired
        ? 'GPU_LEASE_EXPIRED_OWNER_ALIVE' : 'GPU_LEASE_ACTIVE');
    }
    const stalePath = rootAuthority.childPath(
      `.stale-${record.recordSha256}-${nonceSha256()}.json`,
    );
    try { await fs.rename(leasePath, stalePath); }
    catch (error) {
      if (error?.code === 'ENOENT') {
        await descriptor.close();
        return Object.freeze({ recovered: false });
      }
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_STALE_CAS_FAILED');
    }
    cleanup = retainedFileCleanup({
      rootAuthority,
      handle,
      paths: [stalePath],
      kind: 'refinement-gpu-stale-lease-cleanup-v1',
    });
    if (!sameNode(state, await fs.lstat(stalePath, { bigint: true }))) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_STALE_CAS_FAILED');
    }
    await cleanup.close();
    return Object.freeze({
      recovered: true,
      gpuLeaseSha256: record.projection.gpuLeaseSha256,
    });
  } catch (error) {
    return throwAfterCleanup(
      error,
      error?.cleanup ?? cleanup,
      'GPU stale lease cleanup failed',
    );
  }
};

/** Explicitly recover only a lease whose exact process generation is gone. */
export const recoverStaleRefinementGpuReservation = async () => {
  const rootAuthority = await ensurePrivateRoot();
  try {
    const recovered = await recoverStaleAt(rootAuthority);
    await rootAuthority.close();
    return recovered;
  } catch (error) {
    const cleanup = orderedCleanup([
      ...(error?.cleanup ? [error.cleanup] : []),
      rootAuthority,
    ], 'refinement-gpu-stale-root-cleanup-v1');
    return throwAfterCleanup(error, cleanup, 'GPU stale reservation cleanup failed');
  }
};

const publishFile = async (rootAuthority, record, bytes) => {
  const leasePath = rootAuthority.childPath('lease.json');
  const candidate = rootAuthority.childPath(
    `.candidate-${record.projection.gpuLeaseSha256}-${nonceSha256()}.json`,
  );
  const handle = await fs.open(candidate, CREATE, 0o600);
  let cleanup = retainedFileCleanup({
    rootAuthority,
    handle,
    paths: [candidate],
    kind: 'refinement-gpu-lease-candidate-cleanup-v1',
  });
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    let linked = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await fs.link(candidate, leasePath);
        linked = true;
        cleanup = retainedFileCleanup({
          rootAuthority,
          handle,
          paths: [candidate, leasePath],
          kind: 'refinement-gpu-lease-publication-cleanup-v1',
        });
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const recovered = await recoverStaleAt(rootAuthority);
        if (!recovered.recovered && attempt === 1) {
          throw fail('TRAINING_INFLIGHT', 'GPU_LEASE_ACQUIRE_RACE');
        }
      }
    }
    if (!linked) throw fail('TRAINING_INFLIGHT', 'GPU_LEASE_ACQUIRE_RACE');
    await fs.unlink(candidate);
    await rootAuthority.handle.sync();
    const state = leaseFileState(await handle.stat({ bigint: true }));
    if (!sameNode(state, await fs.lstat(leasePath, { bigint: true }))
      || !(await readHandle(handle)).equals(bytes)) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_PUBLISH_CHANGED');
    }
    return Object.freeze({ handle, leasePath, state });
  } catch (error) {
    const retained = orderedCleanup([
      ...(error?.cleanup ? [error.cleanup] : []),
      cleanup,
    ], 'refinement-gpu-lease-publish-cleanup-v1');
    const failure = error?.code && String(error.code).startsWith('TRAINING_')
      ? error
      : fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_LEASE_PUBLISH_FAILED');
    return throwAfterCleanup(failure, retained, 'GPU lease publish cleanup failed');
  }
};

/** Publish and hold one private cross-process canonical GPU lease record. */
export const publishRefinementGpuLease = async (input) => {
  const projection = canonicalLease(input, 'GPU_LEASE_PROJECTION_INVALID');
  const rootAuthority = await ensurePrivateRoot();
  try {
    const owner = await processIdentity();
    const record = leaseRecord(owner, projection);
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    if (bytes.length > MAX_LEASE_BYTES) {
      throw fail('TRAINING_CGROUP_UNAVAILABLE', 'GPU_LEASE_RECORD_SIZE_INVALID');
    }
    const published = await publishFile(rootAuthority, record, bytes);
    let phase = 'held';
    let cleanupStage = 'active';
    let fileClosed = false;
    let rootClosed = false;
    let releasePromise = null;
    const verifyRecord = async (allowExpired = false) => {
      if (!allowExpired && Date.now() >= Date.parse(projection.expiresAt)) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_EXPIRED');
      }
      const currentOwner = await processIdentity();
      await assertRoot(rootAuthority);
      if (refinementSha256(currentOwner) !== refinementSha256(owner)
        || !sameNode(published.state, await published.handle.stat({ bigint: true }))
        || !sameNode(published.state, await fs.lstat(published.leasePath, { bigint: true }))
        || !(await readHandle(published.handle)).equals(bytes)) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_OWNERSHIP_CHANGED');
      }
      return projection;
    };
    const assertOwned = async ({ allowExpired = false } = {}) => {
      if (phase !== 'held') throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_ALREADY_RELEASED');
      return verifyRecord(allowExpired);
    };
    const release = () => {
      if (phase === 'released') return Promise.resolve(false);
      if (releasePromise) return releasePromise;
      phase = 'closing';
      releasePromise = (async () => {
        const tombstone = rootAuthority.childPath(
          `.release-${projection.gpuLeaseSha256}.json`,
        );
        const failures = [];
        try {
          if (cleanupStage === 'active') {
            await verifyRecord(true);
            await fs.rename(published.leasePath, tombstone);
            cleanupStage = 'renamed';
          }
          if (cleanupStage === 'renamed') {
            if (!sameNode(published.state, await fs.lstat(tombstone, { bigint: true }))) {
              throw fail('TRAINING_CGROUP_NOT_EMPTY', 'GPU_LEASE_RELEASE_CAS_FAILED');
            }
            cleanupStage = 'rename-verified';
          }
          if (cleanupStage === 'rename-verified') {
            await rootAuthority.handle.sync();
            cleanupStage = 'rename-synced';
          }
          if (cleanupStage === 'rename-synced') {
            await fs.unlink(tombstone);
            cleanupStage = 'removed';
          }
          if (cleanupStage === 'removed') {
            await rootAuthority.handle.sync();
            cleanupStage = 'remove-synced';
          }
        } catch (error) { failures.push(error); }
        if (cleanupStage === 'remove-synced' && !fileClosed) {
          try { await published.handle.close(); fileClosed = true; }
          catch (error) { failures.push(error); }
        }
        if (fileClosed && !rootClosed) {
          try { await rootAuthority.close(); rootClosed = true; }
          catch (error) { failures.push(error); }
        }
        if (failures.length || !fileClosed || !rootClosed) {
          phase = 'cleanup-failed';
          throw new AggregateError(failures, 'GPU lease release failed');
        }
        phase = 'released';
        return true;
      })().finally(() => { releasePromise = null; });
      return releasePromise;
    };
    return Object.freeze({ projection, assertOwned, release, close: release });
  } catch (error) {
    const cleanup = orderedCleanup([
      ...(error?.cleanup ? [error.cleanup] : []),
      rootAuthority,
    ], 'refinement-gpu-lease-acquisition-cleanup-v1');
    return throwAfterCleanup(error, cleanup, 'GPU lease acquisition cleanup failed');
  }
};

/**
 * READ-ONLY: does anything stand at the training-GPU lease path? Fail-closed
 * for background gates (the meditation loop): a lease that even LOOKS
 * occupied — live, stale, or unreadable — reads as held; only a clean ENOENT
 * reads as free. Never opens, validates, or recovers; the authority paths
 * above own all of that. impure (one lstat).
 * @returns {Promise<boolean>}
 */
export const readRefinementGpuLeaseHeld = async () => {
  const leasePath = path.join(getDataRoot(), 'runtime', 'refinement-gpu-reservation-v1', 'lease.json');
  try {
    await fs.lstat(leasePath);
    return true;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
};
