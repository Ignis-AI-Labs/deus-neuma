import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256HandleStable } from './file-digest.js';

const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
const DIRECTORY = constants.O_RDONLY | NOFOLLOW
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0);
const READ = constants.O_RDONLY | NOFOLLOW;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_FILES = 100_000;
const MAX_DEPTH = 32;
const MAX_PATH_BYTES = 512;
const CLEANUP_PASS_ENTRIES = 100_000;
const uid = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);

const sameNode = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.size === right.size && left.mode === right.mode && left.uid === right.uid
  && left.gid === right.gid && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

const directName = (value) => {
  if (typeof value !== 'string' || !value || value === '.' || value === '..'
    || value !== value.normalize('NFC') || value.includes('/') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value, 'utf8') > 255) {
    throw new Error('training work directory contains an unsafe entry name');
  }
  return value;
};
const childPath = (parent, name) => `/proc/self/fd/${parent.fd}/${directName(name)}`;
const safeRelativePath = (value) => {
  const parts = typeof value === 'string' ? value.split('/') : [];
  if (!value || value !== value.normalize('NFC') || path.posix.isAbsolute(value)
    || value.includes('\\') || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
    || parts.length > MAX_DEPTH || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('materialized authority path is unsafe');
  }
  return value;
};
const exactRow = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'bytes,mode,relativePath,sha256'
    || !SHA256.test(String(value.sha256 || ''))
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0
    || ![0o400, 0o500].includes(value.mode)) {
    throw new Error('materialized authority manifest row is invalid');
  }
  return Object.freeze({
    relativePath: safeRelativePath(value.relativePath),
    sha256: value.sha256,
    bytes: value.bytes,
    mode: value.mode,
  });
};

export const validateMaterializedAuthority = (value, manifestKind) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'fileCount,files,manifestSha256,totalBytes'
    || !SHA256.test(String(value.manifestSha256 || ''))
    || !Number.isSafeInteger(value.fileCount) || value.fileCount < 1
    || value.fileCount > MAX_FILES || !Array.isArray(value.files)
    || value.files.length !== value.fileCount
    || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0) {
    throw new Error('materialized authority declaration is invalid');
  }
  const files = Object.freeze(value.files.map(exactRow));
  const paths = files.map(({ relativePath }) => relativePath);
  const ordered = [...paths].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)));
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.bytes;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new Error('materialized authority byte total is unbounded');
    }
  }
  const manifestSha256 = createHash('sha256').update(JSON.stringify({
    schemaVersion: 2,
    kind: manifestKind,
    format: 'neuma-packed-authority-v2',
    files,
  })).digest('hex');
  if (new Set(paths).size !== paths.length || paths.some((entry, index) => entry !== ordered[index])
    || totalBytes !== value.totalBytes || manifestSha256 !== value.manifestSha256) {
    throw new Error('materialized authority declaration differs from its manifest');
  }
  return Object.freeze({
    manifestSha256,
    fileCount: files.length,
    totalBytes,
    files,
  });
};

const listNames = async (handle) => {
  const stream = await fs.opendir(`/proc/self/fd/${handle.fd}`);
  const names = [];
  try {
    while (true) {
      const entry = await stream.read();
      if (entry === null) break;
      names.push(directName(entry.name));
      if (names.length > MAX_FILES * MAX_DEPTH) {
        throw new Error('materialized authority tree exceeds its entry ceiling');
      }
    }
  } finally {
    await stream.close();
  }
  return names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
};

const scanDirectory = async (handle, relative, state, operation) => {
  operation.assertActive();
  const before = await handle.stat({ bigint: true });
  if (!before.isDirectory() || before.uid !== uid() || before.nlink < 2n
    || (before.mode & 0o777n) !== 0o500n) {
    throw new Error('materialized authority directory is not sealed');
  }
  for (const name of await listNames(handle)) {
    operation.assertActive();
    const target = childPath(handle, name);
    const relativePath = relative ? `${relative}/${name}` : name;
    const pathState = await fs.lstat(target, { bigint: true });
    if (pathState.isDirectory()) {
      if (!state.directories.has(relativePath)) {
        throw new Error('materialized authority contains an undeclared directory');
      }
      const child = await fs.open(target, DIRECTORY);
      try {
        const opened = await child.stat({ bigint: true });
        if (!sameNode(pathState, opened)) {
          throw new Error('materialized authority directory changed while opened');
        }
        await scanDirectory(child, relativePath, state, operation);
      } finally {
        await child.close();
      }
      continue;
    }
    if (!pathState.isFile()) {
      throw new Error('materialized authority contains a non-file entry');
    }
    const expected = state.files.get(relativePath);
    if (!expected || state.seen.has(relativePath)) {
      throw new Error('materialized authority contains an undeclared file');
    }
    const file = await fs.open(target, READ);
    try {
      const opened = await file.stat({ bigint: true });
      if (!sameNode(pathState, opened) || opened.uid !== uid() || opened.nlink !== 1n
        || opened.size !== BigInt(expected.bytes)
        || (opened.mode & 0o777n) !== BigInt(expected.mode)) {
        throw new Error('materialized authority file identity differs from its manifest');
      }
      const sha256 = await sha256HandleStable(file, {
        maximumBytes: Math.max(1, expected.bytes),
        signal: operation.signal,
        deadline: operation.epochDeadline,
      });
      if (sha256 !== expected.sha256
        || !sameNode(opened, await file.stat({ bigint: true }))
        || !sameNode(pathState, await fs.lstat(target, { bigint: true }))) {
        throw new Error('materialized authority file bytes differ from its manifest');
      }
      state.seen.add(relativePath);
    } finally {
      await file.close();
    }
  }
  if (!sameNode(before, await handle.stat({ bigint: true }))) {
    throw new Error('materialized authority directory changed while scanned');
  }
};

export const scanMaterializedAuthority = async (rootView, declaration, operation) => {
  const files = new Map(declaration.files.map((file) => [file.relativePath, file]));
  const directories = new Set(declaration.files.flatMap(({ relativePath }) => {
    const parts = relativePath.split('/').slice(0, -1);
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
  const state = { files, directories, seen: new Set() };
  await scanDirectory(rootView, '', state, operation);
  if (state.seen.size !== files.size) {
    throw new Error('materialized authority is missing a declared file');
  }
  return true;
};

export const assertEmptyTrainingRoot = async (rootView, operation) => {
  operation.assertActive();
  const before = await rootView.stat();
  if (!before.isDirectory() || before.uid !== uid() || (before.mode & 0o777n) !== 0o700n
    || (await listNames(rootView)).length !== 0) {
    throw new Error('training materialization root is not private and empty');
  }
  operation.assertActive();
  return true;
};

const clearDirectory = async (handle, counter) => {
  await handle.chmod(0o700);
  for (const name of await listNames(handle)) {
    counter.count += 1;
    if (counter.count > CLEANUP_PASS_ENTRIES) {
      throw new Error('training work cleanup requires another bounded pass');
    }
    const target = childPath(handle, name);
    const state = await fs.lstat(target, { bigint: true });
    if (state.isDirectory()) {
      const child = await fs.open(target, DIRECTORY);
      try { await clearDirectory(child, counter); } finally { await child.close(); }
      await fs.rmdir(target);
    } else {
      await fs.unlink(target);
    }
    await handle.sync();
  }
};

export const clearTrainingDirectory = async (rootView) => {
  await clearDirectory(rootView, { count: 0 });
  return true;
};
