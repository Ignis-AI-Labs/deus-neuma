import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const DIGEST_CHUNK_BYTES = 256 * 1024;
const READ_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);

const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;

const sameMutationState = (left, right) => sameIdentity(left, right)
  && left.size === right.size
  && left.mode === right.mode
  && left.uid === right.uid
  && left.gid === right.gid
  && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

const digestFailure = (code, message) => Object.assign(new Error(message), { code });

/** Identity of a regular file for digest memo — mutation changes the key. Pure. */
export const digestIdentityKey = (stat) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

const digestMemo = new Map();

/** Remembered sha256 for this inode snapshot, or null. Pure over process memory. */
export const rememberedDigest = (stat) =>
  (stat ? digestMemo.get(digestIdentityKey(stat)) : null) ?? null;

const rememberDigest = (stat, sha256) => {
  digestMemo.set(digestIdentityKey(stat), sha256);
  return sha256;
};
const assertDigestActive = ({ signal, deadline }) => {
  if (signal?.aborted) throw digestFailure('ABORT_ERR', 'digest operation was aborted');
  if (deadline != null && Date.now() >= deadline) {
    throw digestFailure('DIGEST_DEADLINE', 'digest operation exceeded its deadline');
  }
};

const assertRegular = (stat) => {
  if (!stat.isFile()) throw new Error('digest source must be a regular file');
};

const assertStableSnapshots = (snapshots) => {
  for (const snapshot of snapshots) assertRegular(snapshot);
  if (snapshots.some((snapshot) => !sameIdentity(snapshots[0], snapshot))) {
    throw new Error('digest source identity changed while being hashed');
  }
  if (snapshots.some((snapshot) => !sameMutationState(snapshots[0], snapshot))) {
    throw new Error('digest source changed while being hashed');
  }
};

const hashHandle = async (handle, maximumBytes, controls) => {
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
  const maximum = BigInt(maximumBytes);
  let total = 0n;
  while (true) {
    assertDigestActive(controls);
    const remaining = maximum - total;
    const length = Number(remaining < BigInt(chunk.length)
      ? remaining + 1n : BigInt(chunk.length));
    const { bytesRead } = await handle.read(chunk, 0, length, Number(total));
    if (bytesRead === 0) break;
    hash.update(chunk.subarray(0, bytesRead));
    total += BigInt(bytesRead);
    if (total > maximum) {
      throw digestFailure('DIGEST_TOO_LARGE', 'digest source exceeds its hard byte ceiling');
    }
  }
  assertDigestActive(controls);
  return { hash, total };
};

const hashDescriptorSync = (fd, maximumBytes, controls) => {
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
  const maximum = BigInt(maximumBytes);
  let total = 0n;
  while (true) {
    assertDigestActive(controls);
    const remaining = maximum - total;
    const length = Number(remaining < BigInt(chunk.length)
      ? remaining + 1n : BigInt(chunk.length));
    const bytesRead = readSync(fd, chunk, 0, length, Number(total));
    if (bytesRead === 0) break;
    hash.update(chunk.subarray(0, bytesRead));
    total += BigInt(bytesRead);
    if (total > maximum) {
      throw digestFailure('DIGEST_TOO_LARGE', 'digest source exceeds its hard byte ceiling');
    }
  }
  assertDigestActive(controls);
  return { hash, total };
};
const digestOptions = (options) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((field) =>
      !['maximumBytes', 'signal', 'deadline'].includes(field))) {
    throw new Error('digest options are invalid');
  }
  const { maximumBytes, signal = null, deadline = null } = options;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('digest maximumBytes must be a positive safe integer');
  }
  if (signal != null && (typeof signal !== 'object' || !('aborted' in signal))) {
    throw new Error('digest signal is invalid');
  }
  if (deadline != null && (!Number.isSafeInteger(deadline) || deadline < 0)) {
    throw new Error('digest deadline must be an absolute epoch-millisecond safe integer');
  }
  const parsed = Object.freeze({ maximumBytes, signal, deadline });
  assertDigestActive(parsed);
  return parsed;
};
const boundedSize = (stat, maxBytes) => {
  if (stat.size < 0n || stat.size > BigInt(maxBytes)) {
    throw new Error('stable read source is outside the supported envelope');
  }
};

/** Hash one bounded regular file while rejecting symlinks, replacement, or mutation. Impure. */
export const sha256FileStable = async (filePath, options) => {
  const controls = digestOptions(options);
  const maximum = controls.maximumBytes;
  const pathBefore = await lstat(filePath, { bigint: true });
  assertRegular(pathBefore);
  boundedSize(pathBefore, maximum);
  const handle = await open(filePath, READ_FLAGS);
  try {
    const fdBefore = await handle.stat({ bigint: true });
    assertStableSnapshots([pathBefore, fdBefore]);
    boundedSize(fdBefore, maximum);
    const hit = rememberedDigest(fdBefore);
    if (hit) {
      const fdAfter = await handle.stat({ bigint: true });
      const pathAfter = await lstat(filePath, { bigint: true });
      assertStableSnapshots([pathBefore, fdBefore, fdAfter, pathAfter]);
      return hit;
    }
    const { hash, total } = await hashHandle(handle, maximum, controls);
    const fdAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(filePath, { bigint: true });
    assertStableSnapshots([pathBefore, fdBefore, fdAfter, pathAfter]);
    if (total !== fdBefore.size) throw new Error('digest source changed while being hashed');
    return rememberDigest(fdBefore, hash.digest('hex'));
  } finally {
    await handle.close();
  }
};

/** Synchronous stable bounded hash for launch planning before child boarding. Impure. */
export const sha256FileStableSync = (filePath, options) => {
  const controls = digestOptions(options);
  const maximum = controls.maximumBytes;
  const pathBefore = lstatSync(filePath, { bigint: true });
  assertRegular(pathBefore);
  boundedSize(pathBefore, maximum);
  const fd = openSync(filePath, READ_FLAGS);
  try {
    const fdBefore = fstatSync(fd, { bigint: true });
    assertStableSnapshots([pathBefore, fdBefore]);
    boundedSize(fdBefore, maximum);
    const { hash, total } = hashDescriptorSync(fd, maximum, controls);
    const fdAfter = fstatSync(fd, { bigint: true });
    const pathAfter = lstatSync(filePath, { bigint: true });
    assertStableSnapshots([pathBefore, fdBefore, fdAfter, pathAfter]);
    if (total !== fdBefore.size) throw new Error('digest source changed while being hashed');
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
};

/** Hash one caller-owned descriptor without reopening or taking ownership. Impure. */
export const sha256HandleStable = async (handle, options) => {
  const controls = digestOptions(options);
  const before = await handle.stat({ bigint: true });
  assertRegular(before);
  boundedSize(before, controls.maximumBytes);
  const hit = rememberedDigest(before);
  if (hit) {
    const after = await handle.stat({ bigint: true });
    assertStableSnapshots([before, after]);
    return hit;
  }
  const { hash, total } = await hashHandle(handle, controls.maximumBytes, controls);
  const after = await handle.stat({ bigint: true });
  assertStableSnapshots([before, after]);
  if (total !== before.size) throw new Error('digest source changed while being hashed');
  return rememberDigest(before, hash.digest('hex'));
};
