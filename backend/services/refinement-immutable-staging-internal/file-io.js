import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHUNK = 1024 * 1024;
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const READ = constants.O_RDONLY | NOFOLLOW;
const closedPathInputs = new WeakSet();
const uid = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);

export const sameImmutableFileState = (left, right) => left.dev === right.dev
  && left.ino === right.ino
  && left.size === right.size
  && left.mode === right.mode
  && left.uid === right.uid
  && left.gid === right.gid
  && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

export const boundedInteger = (value, field, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} is not bounded`);
  }
  return value;
};

export const assertImmutableOperation = ({ signal = null, deadline = null } = {}) => {
  if (signal?.aborted) throw new Error('immutable authority staging was interrupted');
  if (deadline !== null && (!Number.isSafeInteger(deadline) || Date.now() > deadline)) {
    throw new Error('immutable authority staging exceeded its deadline');
  }
};

export const boundedImmutableRelativePath = (value, depth, bytes) => {
  const parts = typeof value === 'string' ? value.split('/') : [];
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  if (!value || value !== value.normalize('NFC')
    || /[\u0000-\u001f\u007f]/u.test(value) || value.includes('\\')
    || path.posix.isAbsolute(value) || Buffer.byteLength(value) > bytes || parts.length > depth
    || parts.some((part) => !part || part === '.' || part === '..'
      || part.endsWith('.') || part.endsWith(' ') || reserved.test(part))) {
    throw new Error('immutable authority path is unsafe');
  }
  return value;
};

export const assertImmutableFileState = (state, maximumBytes, label) => {
  if (!state.isFile() || (state.uid !== uid() && state.uid !== 0n)
    || (state.mode & 0o022n) !== 0n || state.nlink > 1n
    || state.size > BigInt(maximumBytes)) {
    throw new Error(`${label} is not a protected bounded regular file`);
  }
};

/** Resolve one buffer/held descriptor/direct path into exact bounded input authority. Impure. */
export const openImmutableInput = async (file, label, controls) => {
  assertImmutableOperation(controls);
  if (Buffer.isBuffer(file.content)) {
    if (file.content.length > file.maximumBytes) throw new Error(`${label} is oversized`);
    return { kind: 'buffer', handle: file.content, bytes: file.content.length };
  }
  if (file.handle) {
    const state = await file.handle.stat({ bigint: true });
    assertImmutableOperation(controls);
    assertImmutableFileState(state, file.maximumBytes, label);
    return { kind: 'handle', handle: file.handle, bytes: Number(state.size), stat: state };
  }
  if (typeof file.sourcePath !== 'string') throw new Error(`${label} has no byte authority`);
  const lexical = path.resolve(file.sourcePath);
  const [real, state] = await Promise.all([
    fs.realpath(lexical),
    fs.lstat(lexical, { bigint: true }),
  ]);
  assertImmutableOperation(controls);
  if (real !== lexical) throw new Error(`${label} path is indirect`);
  if (state.nlink !== 1n) throw new Error(`${label} source path has shared hard links`);
  assertImmutableFileState(state, file.maximumBytes, label);
  const handle = await fs.open(lexical, READ);
  try {
    if (!sameImmutableFileState(state, await handle.stat({ bigint: true }))) {
      throw new Error(`${label} changed before staging`);
    }
    assertImmutableOperation(controls);
    return { kind: 'path', handle, bytes: Number(state.size), stat: state, lexical };
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], `${label} open and release failed`, { cause: closeError });
    }
    throw error;
  }
};

const writeAll = async (handle, bytes, position, controls) => {
  for (let offset = 0; offset < bytes.length;) {
    assertImmutableOperation(controls);
    const length = Math.min(CHUNK, bytes.length - offset);
    const { bytesWritten } = await handle.write(bytes, offset, length, position + offset);
    if (!bytesWritten) throw new Error('immutable authority write stopped');
    offset += bytesWritten;
  }
  assertImmutableOperation(controls);
};

/** Copy one exact input to a held output while validating both path and inode stability. Impure. */
export const copyImmutableInput = async (
  input,
  output,
  expectedSha256,
  label,
  controls,
) => {
  const hash = createHash('sha256');
  if (input.kind === 'buffer') {
    await writeAll(output, input.handle, 0, controls);
    hash.update(input.handle);
  } else {
    const buffer = Buffer.allocUnsafe(CHUNK);
    for (let offset = 0; offset < input.bytes;) {
      assertImmutableOperation(controls);
      const length = Math.min(buffer.length, input.bytes - offset);
      const { bytesRead } = await input.handle.read(buffer, 0, length, offset);
      if (!bytesRead) throw new Error(`${label} shortened`);
      const bytes = buffer.subarray(0, bytesRead);
      await writeAll(output, bytes, offset, controls);
      hash.update(bytes);
      offset += bytesRead;
    }
    if (!sameImmutableFileState(input.stat, await input.handle.stat({ bigint: true }))) {
      throw new Error(`${label} changed while being staged`);
    }
    if (input.kind === 'path') {
      const [real, state] = await Promise.all([
        fs.realpath(input.lexical),
        fs.lstat(input.lexical, { bigint: true }),
      ]);
      if (real !== input.lexical || !sameImmutableFileState(input.stat, state)) {
        throw new Error(`${label} path changed while being staged`);
      }
    }
  }
  assertImmutableOperation(controls);
  if (hash.digest('hex') !== expectedSha256) throw new Error(`${label} digest mismatch`);
};

/** Close all service-opened path inputs; successful entries remain terminal across retries. Impure. */
export const closeImmutablePathInputs = async (inputs, label) => {
  const pending = inputs.filter(({ kind, handle }) =>
    kind === 'path' && !closedPathInputs.has(handle));
  const settled = await Promise.allSettled(pending.map(({ handle }) => handle.close()));
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') closedPathInputs.add(pending[index].handle);
    else failures.push(result.reason);
  });
  if (failures.length) throw new AggregateError(failures, `${label} source release failed`);
};
