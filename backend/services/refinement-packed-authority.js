import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from './data-root.js';
import {
  assertRefinementProcessOperation,
  hashRefinementHandle,
} from './refinement-process-operation.js';

const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const READ = constants.O_RDONLY | NOFOLLOW;
const TMPFILE = typeof constants.O_TMPFILE === 'number' ? constants.O_TMPFILE : null;
const CHUNK_BYTES = 1024 * 1024;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const MAGIC = Buffer.alloc(16);
Buffer.from('NEUMA-PACK-V2\0', 'ascii').copy(MAGIC);
const HEADER_BYTES = MAGIC.length + 8;
const SHA256 = /^[0-9a-f]{64}$/u;

const boundedInteger = (
  value,
  field,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is not bounded`);
  }
  return value;
};
const safeRelativePath = (value, maximumDepth, maximumPathBytes) => {
  const parts = typeof value === 'string' ? value.split('/') : [];
  if (!value || value !== value.normalize('NFC') || path.posix.isAbsolute(value)
    || value.includes('\\') || Buffer.byteLength(value, 'utf8') > maximumPathBytes
    || parts.length > maximumDepth || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('packed refinement authority path is unsafe');
  }
  return value;
};
const writeAll = async (handle, bytes, position, operation) => {
  for (let offset = 0; offset < bytes.length;) {
    operation.assertActive();
    const result = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!result.bytesWritten) throw new Error('packed refinement authority write stopped');
    offset += result.bytesWritten;
  }
};
const inputFor = async (declaration, operation) => {
  if (Buffer.isBuffer(declaration.content)) {
    if (declaration.content.length > declaration.maximumBytes) {
      throw new Error('packed refinement authority input exceeds its byte ceiling');
    }
    return Object.freeze({ kind: 'buffer', bytes: declaration.content.length, content: declaration.content });
  }
  if (declaration.handle) {
    const identity = await hashRefinementHandle({
      handle: declaration.handle, maximumBytes: declaration.maximumBytes,
      label: declaration.relativePath, operation,
    });
    if (identity.sha256 !== declaration.sha256) {
      throw new Error('packed refinement authority handle digest mismatch');
    }
    return Object.freeze({
      kind: 'handle', bytes: identity.bytes, handle: declaration.handle, state: identity.state,
    });
  }
  if (typeof declaration.sourcePath !== 'string') {
    throw new Error('packed refinement authority input has no byte source');
  }
  const handle = await fs.open(declaration.sourcePath, READ);
  try {
    const identity = await hashRefinementHandle({
      handle, maximumBytes: declaration.maximumBytes, label: declaration.relativePath, operation,
    });
    if (identity.sha256 !== declaration.sha256) {
      throw new Error('packed refinement authority path digest mismatch');
    }
    return Object.freeze({
      kind: 'owned-handle', bytes: identity.bytes, handle, state: identity.state,
    });
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      const failure = new AggregateError(
        [error, closeError],
        'packed refinement authority input open and cleanup failed',
      );
      Object.defineProperty(failure, 'recovery', {
        enumerable: false,
        value: Object.freeze({ close: () => handle.close() }),
      });
      throw failure;
    }
    throw error;
  }
};
const copyInput = async (input, destination, position, expectedSha256, operation) => {
  const hash = createHash('sha256');
  if (input.kind === 'buffer') {
    await writeAll(destination, input.content, position, operation);
    hash.update(input.content);
  } else {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let offset = 0;
    while (offset < input.bytes) {
      operation.assertActive();
      const length = Math.min(buffer.length, input.bytes - offset);
      const result = await input.handle.read(buffer, 0, length, offset);
      if (!result.bytesRead) throw new Error('packed refinement authority input shortened');
      const bytes = buffer.subarray(0, result.bytesRead);
      await writeAll(destination, bytes, position + offset, operation);
      hash.update(bytes);
      offset += result.bytesRead;
    }
    const after = await input.handle.stat({ bigint: true });
    if (after.dev !== input.state.dev || after.ino !== input.state.ino
      || after.size !== input.state.size || after.mtimeNs !== input.state.mtimeNs
      || after.ctimeNs !== input.state.ctimeNs) {
      throw new Error('packed refinement authority input changed');
    }
  }
  if (hash.digest('hex') !== expectedSha256) {
    throw new Error('packed refinement authority input digest changed');
  }
};

const stagingRoot = async () => {
  const root = path.join(getDataRoot(), 'refinement-authority-staging');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700);
  const handle = await fs.open(root, READ | (constants.O_DIRECTORY || 0));
  const stat = await handle.stat({ bigint: true });
  const uid = BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077n) !== 0n) {
    try {
      await handle.close();
    } catch (closeError) {
      const failure = new AggregateError(
        [new Error('packed refinement staging root is not private'), closeError],
        'packed refinement staging root refusal and cleanup failed',
      );
      Object.defineProperty(failure, 'recovery', {
        enumerable: false,
        value: Object.freeze({ close: () => handle.close() }),
      });
      throw failure;
    }
    throw new Error('packed refinement staging root is not private');
  }
  return handle;
};

const anonymousWriter = async (root) => {
  if (TMPFILE == null) {
    throw new Error('anonymous packed refinement staging is unavailable');
  }
  return fs.open(`/proc/self/fd/${root.fd}`, constants.O_RDWR | TMPFILE, 0o600);
};

const readOnlyHeldHandle = async (writer) => {
  let held = null;
  try {
    await writer.sync();
    await writer.chmod(0o400);
    held = await fs.open(`/proc/self/fd/${writer.fd}`, constants.O_RDONLY);
    const [before, after] = await Promise.all([
      writer.stat({ bigint: true }),
      held.stat({ bigint: true }),
    ]);
    if (before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mode !== after.mode) {
      throw new Error('packed refinement authority changed while becoming read-only');
    }
    await writer.close();
    return held;
  } catch (error) {
    const failures = [error];
    if (held) {
      try { await held.close(); } catch (closeError) { failures.push(closeError); }
    }
    try { await writer.close(); } catch (closeError) { failures.push(closeError); }
    if (failures.length > 1) {
      throw cleanupFailure(
        failures,
        new Set([...(held ? [held] : []), writer]),
        'packed authority descriptor transition',
      );
    }
    throw error;
  }
};

const closePendingHandles = async (pending, label) => {
  const failures = [];
  for (const handle of [...pending]) {
    try {
      await handle.close();
      pending.delete(handle);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, `${label} cleanup failed`);
};

const cleanupFailure = (errors, pending, label) => {
  const failure = new AggregateError(errors, `${label} cleanup is incomplete`);
  Object.defineProperty(failure, 'recovery', {
    enumerable: false,
    value: Object.freeze({ close: () => closePendingHandles(pending, label) }),
  });
  return failure;
};
/** Pack a large exact runtime/tool set into one anonymous disk-backed descriptor. Impure. */
export const stagePackedRefinementAuthority = async ({
  label, manifestKind, files, maximumFiles, maximumBytes,
  maximumDepth = 32, maximumPathBytes = 512, operation: suppliedOperation,
}) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  boundedInteger(maximumFiles, 'packed authority maximumFiles');
  boundedInteger(maximumBytes, 'packed authority maximumBytes');
  boundedInteger(maximumDepth, 'packed authority maximumDepth');
  boundedInteger(maximumPathBytes, 'packed authority maximumPathBytes');
  if (typeof manifestKind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(manifestKind)
    || !Array.isArray(files) || !files.length || files.length > maximumFiles) {
    throw new Error('packed refinement authority declaration is invalid');
  }
  const declarations = files.map((file) => {
    if (!file || !SHA256.test(String(file.sha256 || '')) || ![0o400, 0o500].includes(file.mode)
      || [Buffer.isBuffer(file.content), file.handle != null, file.sourcePath != null]
        .filter(Boolean).length !== 1) {
      throw new Error('packed refinement authority file declaration is invalid');
    }
    return Object.freeze({
      ...file,
      maximumBytes: boundedInteger(
        file.maximumBytes,
        'packed file maximumBytes',
        1,
        maximumBytes,
      ),
      relativePath: safeRelativePath(file.relativePath, maximumDepth, maximumPathBytes),
    });
  }).sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)));
  if (new Set(declarations.map(({ relativePath }) => relativePath)).size !== declarations.length) {
    throw new Error('packed refinement authority paths are not unique');
  }
  const inputs = [];
  const pending = new Set();
  let root = null;
  let writer;
  let held = null;
  let result = null;
  let primary = null;
  try {
    for (const declaration of declarations) inputs.push(await inputFor(declaration, operation));
    const metadata = [];
    let totalBytes = 0;
    for (const [index, declaration] of declarations.entries()) {
      totalBytes += inputs[index].bytes;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
        throw new Error('packed refinement authority exceeds its aggregate ceiling');
      }
      metadata.push(Object.freeze({
        relativePath: declaration.relativePath,
        sha256: declaration.sha256,
        bytes: inputs[index].bytes,
        mode: declaration.mode,
      }));
    }
    const manifest = Buffer.from(JSON.stringify({
      schemaVersion: 2,
      kind: manifestKind,
      format: 'neuma-packed-authority-v2',
      files: metadata,
    }));
    if (!manifest.length || manifest.length > MANIFEST_MAX_BYTES) {
      throw new Error('packed refinement authority manifest exceeds its ceiling');
    }
    const manifestSha256 = createHash('sha256').update(manifest).digest('hex');
    root = await stagingRoot();
    pending.add(root);
    writer = await anonymousWriter(root);
    pending.add(writer);
    const manifestLength = Buffer.alloc(8);
    manifestLength.writeBigUInt64BE(BigInt(manifest.length));
    await writeAll(writer, MAGIC, 0, operation);
    await writeAll(writer, manifestLength, MAGIC.length, operation);
    await writeAll(writer, manifest, HEADER_BYTES, operation);
    let position = HEADER_BYTES + manifest.length;
    for (let index = 0; index < declarations.length; index += 1) {
      await copyInput(inputs[index], writer, position, declarations[index].sha256, operation);
      position += inputs[index].bytes;
    }
    held = await readOnlyHeldHandle(writer);
    pending.delete(writer);
    writer = null;
    pending.add(held);
    const archiveIdentity = await hashRefinementHandle({
      handle: held,
      maximumBytes: maximumBytes + MANIFEST_MAX_BYTES + HEADER_BYTES,
      label,
      operation,
    });
    let phase = 'open';
    let closePromise = null;
    const verify = async (controls = operation) => {
      if (phase !== 'open') throw new Error(`${label} is ${phase}`);
      const current = assertRefinementProcessOperation(controls);
      if (current !== operation) throw new Error(`${label} operation changed`);
      const repeated = await hashRefinementHandle({
        handle: held,
        maximumBytes: maximumBytes + MANIFEST_MAX_BYTES + HEADER_BYTES,
        label,
        operation,
      });
      if (repeated.sha256 !== archiveIdentity.sha256
        || repeated.state.dev !== archiveIdentity.state.dev
        || repeated.state.ino !== archiveIdentity.state.ino) {
        throw new Error(`${label} changed`);
      }
      return true;
    };
    const close = () => {
      if (phase === 'closed') return Promise.resolve(false);
      if (closePromise) return closePromise;
      phase = 'closing';
      closePromise = held.close().then(
        () => {
          pending.delete(held);
          phase = 'closed';
          closePromise = null;
          return true;
        },
        (error) => {
          phase = 'cleanup-failed';
          closePromise = null;
          throw error;
        },
      );
      return closePromise;
    };
    result = Object.freeze({
      kind: 'packed-refinement-authority-v2',
      format: 'neuma-packed-authority-v2',
      manifestKind,
      manifestSha256,
      fd: held.fd,
      sha256: archiveIdentity.sha256,
      bytes: archiveIdentity.bytes,
      totalBytes,
      fileCount: metadata.length,
      files: Object.freeze(metadata),
      verify,
      close,
    });
    pending.delete(held);
  } catch (error) {
    primary = error;
  }
  for (const input of inputs) {
    if (input.kind === 'owned-handle') pending.add(input.handle);
  }
  if (root) pending.add(root);
  const cleanupErrors = [];
  if (result) {
    pending.delete(held);
  } else if (held) {
    pending.add(held);
  }
  try {
    await closePendingHandles(pending, 'packed authority acquisition');
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    throw cleanupFailure(
      [...(primary ? [primary] : []), ...cleanupErrors],
      pending,
      'packed authority acquisition',
    );
  }
  if (primary) throw primary;
  return result;
};
