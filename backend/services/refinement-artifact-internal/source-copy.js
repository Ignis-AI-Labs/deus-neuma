import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const COPY_BYTES = 1024 * 1024;
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const READ = constants.O_RDONLY | NOFOLLOW;
const uid = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
const sameState = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.size === right.size && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

const assertSourceState = (state, maximumBytes, label) => {
  if (!state.isFile() || (state.uid !== uid() && state.uid !== 0n)
    || (state.mode & 0o022n) !== 0n || state.nlink !== 1n
    || state.size < 1n || state.size > BigInt(maximumBytes)) {
    throw new Error(`${label} is not a direct protected regular file within its byte ceiling`);
  }
};

const checkSignal = (signal, label) => {
  if (signal?.aborted) throw new Error(`${label} copy was interrupted`);
};

/** Open one direct source and bind both its path identity and held inode. Impure. */
export const openStableArtifactSource = async (sourcePath, maximumBytes, label) => {
  const lexical = path.resolve(sourcePath);
  const [real, before] = await Promise.all([
    fs.realpath(lexical),
    fs.lstat(lexical, { bigint: true }),
  ]);
  if (real !== lexical) throw new Error(`${label} source path is indirect`);
  assertSourceState(before, maximumBytes, label);
  const handle = await fs.open(lexical, READ);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameState(before, opened)) throw new Error(`${label} changed while being opened`);
    return Object.freeze({ handle, before, lexical });
  } catch (error) {
    try { await handle.close(); } catch (closeError) {
      throw new AggregateError([error, closeError], `${label} open and release failed`, { cause: closeError });
    }
    throw error;
  }
};

export const assertStableArtifactSource = async (source, label) => {
  const [opened, pathState, real] = await Promise.all([
    source.handle.stat({ bigint: true }),
    fs.lstat(source.lexical, { bigint: true }),
    fs.realpath(source.lexical),
  ]);
  if (real !== source.lexical || !sameState(source.before, opened)
    || !sameState(source.before, pathState)) {
    throw new Error(`${label} changed while being copied`);
  }
};

const writeAll = async (output, buffer, bytes, position, signal, label) => {
  let offset = 0;
  while (offset < bytes) {
    checkSignal(signal, label);
    const written = await output.write(buffer, offset, bytes - offset, position + offset);
    if (!written.bytesWritten) throw new Error(`${label} destination stopped accepting bytes`);
    offset += written.bytesWritten;
  }
};

/** Copy bounded bytes from a held descriptor while computing their exact digest. Impure. */
export const copyArtifactHandle = async ({
  sourceHandle,
  output,
  maximumBytes,
  label,
  signal = null,
}) => {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(COPY_BYTES);
  let position = 0;
  for (;;) {
    checkSignal(signal, label);
    const remaining = maximumBytes - position;
    const length = Math.min(buffer.length, remaining + 1);
    const { bytesRead } = await sourceHandle.read(buffer, 0, length, position);
    if (!bytesRead) break;
    if (bytesRead > remaining) throw new Error(`${label} grew beyond its byte ceiling`);
    await writeAll(output, buffer, bytesRead, position, signal, label);
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (position < 1) throw new Error(`${label} is empty`);
  checkSignal(signal, label);
  return Object.freeze({ sha256: hash.digest('hex'), bytes: position });
};
