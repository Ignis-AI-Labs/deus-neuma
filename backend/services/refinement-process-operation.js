import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const READ_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const HASH_CHUNK_BYTES = 256 * 1024;
const MAX_OPERATION_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const OPERATIONS = new WeakSet();

const sameState = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mode === right.mode
  && left.uid === right.uid
  && left.gid === right.gid
  && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

const positiveBound = (value, field, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be a positive bounded integer`);
  }
  return value;
};

const operationOptions = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return keys.every((key) => typeof key === 'string'
    && ['signal', 'timeoutMs'].includes(key)
    && Object.hasOwn(descriptors[key], 'value'));
};

const abortSignal = (value) => {
  if (value != null && (!(value instanceof AbortSignal)
    || !(value instanceof EventTarget)
    || typeof value.addEventListener !== 'function'
    || typeof value.removeEventListener !== 'function')) {
    throw new Error('operation signal is invalid');
  }
  return value;
};

/** Create the one monotonic deadline and AbortSignal shared by an operation. Pure apart from timer. */
export const createRefinementProcessOperation = (options = {}) => {
  if (!operationOptions(options)) {
    throw new Error('refinement process operation options are invalid');
  }
  const signal = options.signal ?? null;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const external = abortSignal(signal);
  const duration = positiveBound(timeoutMs, 'operation timeout', MAX_OPERATION_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(duration);
  const operationSignal = external
    ? AbortSignal.any([external, timeoutSignal])
    : timeoutSignal;
  const monotonicDeadline = performance.now() + duration;
  const epochDeadline = Date.now() + duration;
  const assertActive = () => {
    if (operationSignal.aborted) {
      throw Object.assign(new Error('refinement process operation was aborted'), { code: 'ABORT_ERR' });
    }
    if (performance.now() >= monotonicDeadline) {
      throw Object.assign(new Error('refinement process operation exceeded its deadline'), {
        code: 'DIGEST_DEADLINE',
      });
    }
  };
  const operation = Object.freeze({
    kind: 'refinement-process-operation',
    signal: operationSignal,
    monotonicDeadline,
    epochDeadline,
    assertActive,
  });
  OPERATIONS.add(operation);
  operation.assertActive();
  return operation;
};

/** Assert one current-process operation identity without requiring it to remain active. Pure. */
export const assertRefinementProcessOperationIdentity = (value) => {
  if (!value || typeof value !== 'object' || !OPERATIONS.has(value)) {
    throw new Error('refinement process operation is not current-process authority');
  }
  return value;
};

/** Assert one current-process operation identity and its active deadline. Pure. */
export const assertRefinementProcessOperation = (value) => {
  const operation = assertRefinementProcessOperationIdentity(value);
  operation.assertActive();
  return operation;
};


const assertRegularBounded = (stat, maximumBytes, label) => {
  const maximum = BigInt(positiveBound(maximumBytes, `${label} byte ceiling`));
  if (!stat.isFile() || stat.size < 0n || stat.size > maximum) {
    throw new Error(`${label} is not a bounded regular file`);
  }
};

/** Hash one already-open descriptor under one operation without path access. Impure. */
export const hashRefinementHandle = async ({
  handle,
  maximumBytes,
  label = 'refinement input',
  operation,
}) => {
  const controls = assertRefinementProcessOperation(operation);
  controls.assertActive();
  const before = await handle.stat({ bigint: true });
  assertRegularBounded(before, maximumBytes, label);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let offset = 0n;
  while (offset < before.size) {
    controls.assertActive();
    const remaining = before.size - offset;
    const length = Number(remaining < BigInt(buffer.length) ? remaining : BigInt(buffer.length));
    const { bytesRead } = await handle.read(buffer, 0, length, Number(offset));
    if (!bytesRead) throw new Error(`${label} ended before its declared size`);
    hash.update(buffer.subarray(0, bytesRead));
    offset += BigInt(bytesRead);
  }
  const trailing = Buffer.allocUnsafe(1);
  if ((await handle.read(trailing, 0, 1, Number(offset))).bytesRead !== 0) {
    throw new Error(`${label} grew beyond its declared size`);
  }
  controls.assertActive();
  const after = await handle.stat({ bigint: true });
  if (!sameState(before, after)) throw new Error(`${label} changed while being hashed`);
  return Object.freeze({
    sha256: hash.digest('hex'),
    bytes: Number(before.size),
    state: before,
  });
};

/** Read one already-open bounded descriptor under the operation that owns it. Impure. */
const readRefinementHandle = async ({
  handle,
  maximumBytes,
  label = 'refinement input',
  operation,
}) => {
  const controls = assertRefinementProcessOperation(operation);
  const identity = await hashRefinementHandle({ handle, maximumBytes, label, operation: controls });
  const bytes = Buffer.alloc(identity.bytes);
  let offset = 0;
  while (offset < bytes.length) {
    controls.assertActive();
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!result.bytesRead) throw new Error(`${label} ended before its declared size`);
    offset += result.bytesRead;
  }
  controls.assertActive();
  if (!sameState(identity.state, await handle.stat({ bigint: true }))) {
    throw new Error(`${label} changed while being read`);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== identity.sha256) {
    throw new Error(`${label} changed between hashing and reading`);
  }
  return Object.freeze({ bytes, sha256: identity.sha256, state: identity.state });
};


const recoverableHandleCloseError = (errors, handle, label) => {
  const failure = new AggregateError(errors, `${label} cleanup failed`);
  Object.defineProperty(failure, 'recovery', {
    enumerable: false,
    value: Object.freeze({ close: () => handle.close() }),
  });
  return failure;
};

/** Open and read a bounded regular file without ever following its final component. Impure. */
const readRefinementFile = async ({ filePath, maximumBytes, label, operation }) => {
  const controls = assertRefinementProcessOperation(operation);
  const handle = await fs.open(filePath, READ_FLAGS);
  let result;
  let readError = null;
  try {
    result = await readRefinementHandle({ handle, maximumBytes, label, operation: controls });
  } catch (error) {
    readError = error;
  }
  try {
    await handle.close();
  } catch (closeError) {
    throw recoverableHandleCloseError(
      readError ? [readError, closeError] : [closeError],
      handle,
      label,
    );
  }
  if (readError) throw readError;
  return result;
};

/** Parse one generated bounded JSON file through one no-follow stable read. Impure. */
export const readRefinementJsonFile = async ({
  filePath,
  maximumBytes,
  label = 'refinement JSON',
  operation,
}) => {
  const result = await readRefinementFile({ filePath, maximumBytes, label, operation });
  if (!result.bytes.length) throw new Error(`${label} is empty`);
  return JSON.parse(result.bytes.toString('utf8'));
};


