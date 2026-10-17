import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { getDataRoot } from './data-root.js';
import { codedTrainingError } from './refinement-training-errors.js';

const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const DIRECTORY = constants.O_RDONLY | NOFOLLOW
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0);
const READ = constants.O_RDONLY | NOFOLLOW;
const CREATE = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LEASE_BYTES_MAX = 16 * 1024;
const RECONCILE_ATTEMPTS = 4;
const LEASE_FIELDS = Object.freeze([
  'bootId', 'jobSha256', 'leaseSha256', 'nonceSha256', 'operationExpiresAt',
  'pid', 'processStartTicks', 'reservationBytes', 'schemaVersion',
  'trainingPlanSha256', 'uid',
]);
const CLEANUP_OWNERS = new WeakSet();

const fail = (code, diagnostic) => codedTrainingError(code, diagnostic);
const currentUid = () => (typeof process.geteuid === 'function' ? process.geteuid() : 0);
const nonceSha256 = () => refinementSha256(randomBytes(32).toString('hex'));
const sameDirectory = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid;
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameFile = (left, right) => sameInode(left, right)
  && left.size === right.size && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const childPath = (root, name = '') => `/proc/self/fd/${root.handle.fd}${name ? `/${name}` : ''}`;
const exactKeys = (value, fields) => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && Reflect.ownKeys(value).every((key) => typeof key === 'string')
  && Object.keys(value).sort().join('\0') === [...fields].sort().join('\0'));

const retryableHandle = (handle) => {
  let closed = false;
  let closePromise = null;
  return Object.freeze({
    close: () => {
      if (closed) return Promise.resolve(false);
      if (closePromise) return closePromise;
      closePromise = handle.close().then(() => { closed = true; return true; })
        .finally(() => { closePromise = null; });
      return closePromise;
    },
  });
};

export const diskCleanupOwner = (entries, kind = 'refinement-training-disk-cleanup-v1') => {
  const retained = entries.map((authority) => ({ authority, closed: false }));
  let closePromise = null;
  const owner = Object.freeze({
    kind,
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
        if (failures.length) throw new AggregateError(failures, 'training disk cleanup failed');
        return true;
      })().finally(() => { closePromise = null; });
      return closePromise;
    },
  });
  CLEANUP_OWNERS.add(owner);
  return owner;
};

const readBoundedProc = async (filePath, maximumBytes) => {
  const handle = await fs.open(filePath, READ);
  const lifecycle = retryableHandle(handle);
  try {
    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (!offset || offset > maximumBytes) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'PROC_INVALID');
    await lifecycle.close();
    return bytes.subarray(0, offset);
  } catch (error) {
    try { await lifecycle.close(); } catch (closeError) {
      throw Object.assign(new AggregateError([error, closeError], 'proc cleanup failed'), {
        code: error?.code, cleanup: diskCleanupOwner([lifecycle]),
      });
    }
    throw error;
  }
};

const bootId = async () => {
  const value = (await readBoundedProc('/proc/sys/kernel/random/boot_id', 128))
    .toString('utf8').trim().toLowerCase();
  if (!BOOT_ID.test(value)) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'BOOT_ID_INVALID');
  return value;
};

export const currentProcessIdentity = async () => {
  const pid = process.pid;
  const [boot, statBytes, proc] = await Promise.all([
    bootId(), readBoundedProc(`/proc/${pid}/stat`, 8192), fs.stat(`/proc/${pid}`, { bigint: true }),
  ]);
  const text = statBytes.toString('utf8').trim();
  const close = text.lastIndexOf(')');
  const fields = close >= 0 ? text.slice(close + 2).split(' ') : [];
  const processStartTicks = fields[19];
  if (!/^[1-9]\d*$/u.test(String(processStartTicks || ''))) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'OWNER_INVALID');
  }
  return Object.freeze({ bootId: boot, pid, processStartTicks, uid: Number(proc.uid) });
};

const ownerAlive = async (lease, currentBootId) => {
  if (lease.bootId !== currentBootId) return false;
  try {
    const [statBytes, proc] = await Promise.all([
      readBoundedProc(`/proc/${lease.pid}/stat`, 8192), fs.stat(`/proc/${lease.pid}`, { bigint: true }),
    ]);
    const text = statBytes.toString('utf8').trim();
    const close = text.lastIndexOf(')');
    const fields = close >= 0 ? text.slice(close + 2).split(' ') : [];
    return fields[19] === lease.processStartTicks && proc.uid === BigInt(lease.uid);
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error?.code)) return false;
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'OWNER_PROBE_FAILED');
  }
};

export const exactDiskLease = (value) => {
  const instant = typeof value?.operationExpiresAt === 'string'
    ? new Date(value.operationExpiresAt) : null;
  if (!exactKeys(value, LEASE_FIELDS) || value.schemaVersion !== 1
    || !['trainingPlanSha256', 'jobSha256', 'nonceSha256', 'leaseSha256']
      .every((field) => /^[0-9a-f]{64}$/u.test(String(value[field] || '')))
    || !BOOT_ID.test(String(value.bootId || ''))
    || !Number.isSafeInteger(value.pid) || value.pid < 1
    || !Number.isSafeInteger(value.uid) || value.uid < 0
    || !Number.isSafeInteger(value.reservationBytes) || value.reservationBytes < 1
    || !/^[1-9]\d*$/u.test(String(value.processStartTicks || ''))
    || !instant || instant.toISOString() !== value.operationExpiresAt) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'RECORD_CORRUPT');
  }
  const lease = Object.freeze(Object.fromEntries(LEASE_FIELDS.map((field) => [field, value[field]])));
  const payload = Object.fromEntries(
    LEASE_FIELDS.filter((field) => field !== 'leaseSha256').map((field) => [field, lease[field]]),
  );
  if (refinementSha256(payload) !== lease.leaseSha256) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'RECORD_CORRUPT');
  return lease;
};

export const encodeDiskLease = (lease) => {
  const bytes = Buffer.from(`${JSON.stringify(lease)}\n`, 'utf8');
  if (bytes.length > LEASE_BYTES_MAX) throw fail('TRAINING_CGROUP_UNAVAILABLE', 'RECORD_TOO_LARGE');
  return bytes;
};

export const openDiskReservationRoot = async () => {
  const pathname = path.join(getDataRoot(), 'runtime', 'refinement-training-reservation-v1');
  await fs.mkdir(pathname, { recursive: true, mode: 0o700 });
  const handle = await fs.open(pathname, DIRECTORY);
  const lifecycle = retryableHandle(handle);
  try {
    const [state, named, real] = await Promise.all([
      handle.stat({ bigint: true }), fs.lstat(pathname, { bigint: true }), fs.realpath(pathname),
    ]);
    if (real !== pathname || !state.isDirectory() || !named.isDirectory()
      || !sameDirectory(state, named) || state.uid !== BigInt(currentUid())
      || (state.mode & 0o777n) !== 0o700n) throw fail('TRAINING_CGROUP_UNAVAILABLE', 'ROOT_UNSAFE');
    return Object.freeze({ pathname, handle, state, close: lifecycle.close });
  } catch (error) {
    try { await lifecycle.close(); } catch (closeError) {
      throw Object.assign(new AggregateError([error, closeError], 'root cleanup failed'), {
        code: error?.code, cleanup: diskCleanupOwner([lifecycle]),
      });
    }
    throw error;
  }
};

export const assertDiskReservationRoot = async (root) => {
  const [held, named] = await Promise.all([
    root.handle.stat({ bigint: true }), fs.lstat(root.pathname, { bigint: true }),
  ]);
  if (!sameDirectory(root.state, held) || !sameDirectory(root.state, named)) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'ROOT_CHANGED');
  }
  return true;
};

export const diskAvailableBytes = async (root) => {
  await assertDiskReservationRoot(root);
  const stat = await fs.statfs(childPath(root), { bigint: true });
  await assertDiskReservationRoot(root);
  return stat.bavail * stat.bsize;
};

const leaseState = (state) => {
  if (!state.isFile() || state.uid !== BigInt(currentUid())
    || (state.mode & 0o777n) !== 0o600n || state.size < 1n
    || state.size > BigInt(LEASE_BYTES_MAX) || state.nlink < 1n || state.nlink > 2n) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'FILE_UNSAFE');
  }
  return state;
};

const readLeaseHandle = async (handle) => {
  const before = leaseState(await handle.stat({ bigint: true }));
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!result.bytesRead) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'LEASE_TRUNCATED');
    offset += result.bytesRead;
  }
  if (!sameFile(before, await handle.stat({ bigint: true }))) throw fail('TRAINING_CGROUP_NOT_EMPTY', 'FILE_CHANGED');
  return Object.freeze({ bytes, state: before });
};

const cleanupFiles = ({ root, handle, names, kind }) => {
  const lifecycle = retryableHandle(handle);
  const remaining = new Set(names);
  let closed = false;
  let closePromise = null;
  const cleanup = {
    kind,
    close: () => {
      if (closed) return Promise.resolve(false);
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const descriptor = await handle.stat({ bigint: true });
        for (const name of [...remaining]) {
          const named = await fs.lstat(childPath(root, name), { bigint: true }).catch((error) => {
            if (error?.code === 'ENOENT') return null;
            throw error;
          });
          if (named && !sameInode(descriptor, named)) {
            throw fail('TRAINING_CGROUP_NOT_EMPTY', 'CLEANUP_CAS_FAILED');
          }
          if (named) await fs.unlink(childPath(root, name));
          remaining.delete(name);
        }
        await assertDiskReservationRoot(root);
        await root.handle.sync();
        await lifecycle.close();
        closed = true;
        return true;
      })().finally(() => { closePromise = null; });
      return closePromise;
    },
  };
  return Object.freeze(cleanup);
};

const recoverStale = async (root) => {
  const active = childPath(root, 'lease.json');
  let handle;
  try { handle = await fs.open(active, READ); }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const lifecycle = retryableHandle(handle);
  const closeOnly = Object.freeze({
    kind: 'refinement-stale-disk-descriptor-cleanup-v1',
    close: lifecycle.close,
  });
  let recoveryCleanup = null;
  const throwAfterCleanup = async (error) => {
    const cleanup = error?.cleanup ?? recoveryCleanup ?? closeOnly;
    try { await cleanup.close(); }
    catch (closeError) {
      throw Object.assign(
        new AggregateError([error, closeError], 'stale disk lease cleanup failed'),
        { code: error?.code, cleanup },
      );
    }
    throw error;
  };
  try {
    const read = await readLeaseHandle(handle);
    let lease;
    try { lease = exactDiskLease(JSON.parse(read.bytes.toString('utf8'))); }
    catch { throw fail('TRAINING_CGROUP_NOT_EMPTY', 'RECORD_CORRUPT'); }
    if (!sameFile(read.state, await fs.lstat(active, { bigint: true }))) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'ACTIVE_CHANGED');
    }
    if (await ownerAlive(lease, await bootId())) {
      throw fail('TRAINING_INFLIGHT', 'ACTIVE');
    }
    const staleName = `.stale-${lease.leaseSha256}-${nonceSha256()}.json`;
    try { await fs.rename(active, childPath(root, staleName)); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await closeOnly.close();
      return false;
    }
    if (!sameInode(read.state, await fs.lstat(childPath(root, staleName), { bigint: true }))) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'STALE_CAS_FAILED');
    }
    recoveryCleanup = cleanupFiles({
      root,
      handle,
      names: [staleName],
      kind: 'refinement-stale-disk-cleanup-v1',
    });
    await recoveryCleanup.close();
    return true;
  } catch (error) {
    return throwAfterCleanup(error);
  }
};

export const publishDiskLease = async (root, lease, bytes) => {
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
    const candidateName = `.candidate-${lease.nonceSha256}.json`;
    const handle = await fs.open(childPath(root, candidateName), CREATE, 0o600);
    const candidateCleanup = cleanupFiles({
      root,
      handle,
      names: [candidateName],
      kind: 'refinement-candidate-disk-cleanup-v1',
    });
    let linkedCleanup = null;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      const read = await readLeaseHandle(handle);
      if (!read.bytes.equals(bytes)
        || !sameFile(read.state, await fs.lstat(childPath(root, candidateName), { bigint: true }))) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'CANDIDATE_CHANGED');
      }
      try { await fs.link(childPath(root, candidateName), childPath(root, 'lease.json')); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await candidateCleanup.close();
        await recoverStale(root);
        continue;
      }
      linkedCleanup = cleanupFiles({
        root,
        handle,
        names: [candidateName, 'lease.json'],
        kind: 'refinement-published-disk-cleanup-v1',
      });
      const linked = leaseState(await handle.stat({ bigint: true }));
      if (linked.nlink !== 2n
        || !sameFile(linked, await fs.lstat(childPath(root, 'lease.json'), { bigint: true }))) {
        throw fail('TRAINING_CGROUP_NOT_EMPTY', 'PUBLISH_CAS_FAILED');
      }
      await fs.unlink(childPath(root, candidateName));
      await root.handle.sync();
      return Object.freeze({
        handle,
        state: leaseState(await handle.stat({ bigint: true })),
        bytes,
        name: 'lease.json',
      });
    } catch (error) {
      const cleanup = error?.cleanup ?? linkedCleanup ?? candidateCleanup;
      throw Object.assign(error, { cleanup });
    }
  }
  throw fail('TRAINING_INFLIGHT', 'ACQUIRE_RACE');
};

export const verifyPublishedDiskLease = async ({ root, published, lease, bytes }) => {
  const current = await currentProcessIdentity();
  await assertDiskReservationRoot(root);
  const [descriptor, named, read] = await Promise.all([
    published.handle.stat({ bigint: true }), fs.lstat(childPath(root, published.name), { bigint: true }),
    readLeaseHandle(published.handle),
  ]);
  if (current.bootId !== lease.bootId || current.processStartTicks !== lease.processStartTicks
    || current.uid !== lease.uid || !sameFile(published.state, descriptor)
    || !sameFile(published.state, named) || !read.bytes.equals(bytes)) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'OWNERSHIP_CHANGED');
  }
  return true;
};

export const releasePublishedDiskLease = async ({
  root,
  published,
  lease,
  releaseState,
}) => {
  const releaseName = `.release-${lease.leaseSha256}.json`;
  if (releaseState.phase === 'active') {
    await fs.rename(childPath(root, published.name), childPath(root, releaseName));
    releaseState.phase = 'renamed';
  }
  if (releaseState.phase === 'renamed') {
    if (!sameInode(published.state, await fs.lstat(childPath(root, releaseName), { bigint: true }))) {
      throw fail('TRAINING_CGROUP_NOT_EMPTY', 'RELEASE_CAS_FAILED');
    }
    releaseState.phase = 'rename-verified';
  }
  if (releaseState.phase === 'rename-verified') {
    await root.handle.sync();
    releaseState.phase = 'rename-synced';
  }
  if (releaseState.phase === 'rename-synced') {
    await fs.unlink(childPath(root, releaseName));
    releaseState.phase = 'removed';
  }
  if (releaseState.phase === 'removed') {
    await root.handle.sync();
    releaseState.phase = 'remove-synced';
  }
  if (releaseState.phase === 'remove-synced' && !releaseState.fileClosed) {
    await published.handle.close();
    releaseState.fileClosed = true;
  }
  if (releaseState.fileClosed && !releaseState.rootClosed) {
    await root.close();
    releaseState.rootClosed = true;
  }
  if (!releaseState.fileClosed || !releaseState.rootClosed) {
    throw fail('TRAINING_CGROUP_NOT_EMPTY', 'RELEASE_INCOMPLETE');
  }
  releaseState.phase = 'released';
  return true;
};
