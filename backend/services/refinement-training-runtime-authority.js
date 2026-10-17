import fs from 'node:fs/promises';
import path from 'node:path';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { sha256FileStable } from './file-digest.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';

const SHA256 = /^[0-9a-f]{64}$/u;
export const REFINEMENT_RUNTIME_AUTHORITY_LIMITS = Object.freeze({
  maximumFiles: 89_998,
  maximumDirectories: 10_000,
  maximumBytes: 32 * 1024 ** 3,
  maximumConverterBytes: 256 * 1024 ** 2,
});
const maximumEntries = REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumFiles
  + REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumDirectories;
const exactKeys = (value, fields) => {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === 'string')
    && keys.sort().join(',') === fields;
};
export const refinementRuntimeUnavailable = (cause) => Object.assign(
  new Error('committed refinement runtime authority is unavailable'),
  { code: 'TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE', ...(cause && { cause }) },
);

const pythonRuntime = async (pythonExecutable, operation) => {
  if (typeof pythonExecutable !== 'string' || !path.isAbsolute(pythonExecutable)
    || pythonExecutable.length > 4096 || pythonExecutable.includes('\0')
    || path.basename(path.dirname(pythonExecutable)) !== 'bin'
    || !/^python(?:3(?:\.\d+)?)?$/u.test(path.basename(pythonExecutable))) {
    throw refinementRuntimeUnavailable();
  }
  operation.assertActive();
  const venvRoot = path.dirname(path.dirname(pythonExecutable));
  const [resolvedPath, resolvedRoot] = await Promise.all([
    fs.realpath(pythonExecutable), fs.realpath(venvRoot),
  ]);
  if (resolvedRoot !== venvRoot) throw refinementRuntimeUnavailable();
  const markerPath = path.join(venvRoot, 'pyvenv.cfg');
  if (await fs.realpath(markerPath) !== markerPath) throw refinementRuntimeUnavailable();
  const executableSha256 = await sha256FileStable(resolvedPath, {
    maximumBytes: 256 * 1024 ** 2,
    signal: operation.signal,
    deadline: operation.epochDeadline,
  });
  const markerSha256 = await sha256FileStable(markerPath, {
    maximumBytes: 1024 ** 2,
    signal: operation.signal,
    deadline: operation.epochDeadline,
  });
  return Object.freeze({
    venvRoot, resolvedPath, markerPath, executableSha256, markerSha256,
  });
};

const boundedDirectoryEntries = async (directory, maximum, operation) => {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw refinementRuntimeUnavailable();
  const opened = await fs.opendir(directory);
  const entries = [];
  let primary = null;
  try {
    while (true) {
      operation.assertActive();
      const entry = await opened.read();
      if (entry === null) break;
      if (entries.length >= maximum) throw refinementRuntimeUnavailable();
      entries.push(entry);
    }
  } catch (error) {
    primary = error;
  }
  let cleanup = null;
  try { await opened.close(); } catch (error) { cleanup = error; }
  if (cleanup) {
    throw refinementRuntimeUnavailable(new AggregateError(
      primary ? [primary, cleanup] : [cleanup],
      'runtime directory read and cleanup failed',
    ));
  }
  if (primary) throw primary;
  return entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
};

const sitePackagesRoot = async (venvRoot, operation) => {
  operation.assertActive();
  const libRoot = path.join(venvRoot, 'lib');
  const entries = await boundedDirectoryEntries(libRoot, 64, operation);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^python3\.\d+$/u.test(entry.name)) continue;
    const candidate = path.join(libRoot, entry.name, 'site-packages');
    if (await fs.realpath(candidate) !== candidate
      || !(await fs.lstat(candidate)).isDirectory()) throw refinementRuntimeUnavailable();
    candidates.push(candidate);
  }
  if (candidates.length !== 1) throw refinementRuntimeUnavailable();
  return candidates[0];
};

const environmentFiles = async (root, operation) => {
  const files = [];
  const pending = [{ directory: root, depth: 0 }];
  let totalBytes = 0n;
  let totalEntries = 0;
  let directoryCount = 1;
  while (pending.length) {
    operation.assertActive();
    const { directory, depth } = pending.pop();
    if (depth > 64) throw refinementRuntimeUnavailable();
    const entries = await boundedDirectoryEntries(
      directory,
      maximumEntries - totalEntries,
      operation,
    );
    totalEntries += entries.length;
    for (const entry of entries.reverse()) {
      operation.assertActive();
      if (entry.name !== entry.name.normalize('NFC')
        || Buffer.byteLength(entry.name, 'utf8') > 255) throw refinementRuntimeUnavailable();
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw refinementRuntimeUnavailable();
      if (entry.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumDirectories) {
          throw refinementRuntimeUnavailable();
        }
        pending.push({ directory: target, depth: depth + 1 });
      } else if (entry.isFile()) {
        const state = await fs.lstat(target, { bigint: true });
        const relativePath = path.relative(root, target).split(path.sep).join('/');
        if (!state.isFile() || state.size < 0n || state.size > BigInt(Number.MAX_SAFE_INTEGER)
          || files.length >= REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumFiles
          || totalBytes > BigInt(REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumBytes) - state.size
          || Buffer.byteLength(relativePath, 'utf8') > 512) throw refinementRuntimeUnavailable();
        totalBytes += state.size;
        files.push(Object.freeze({
          sourcePath: target,
          relativePath,
          bytes: Number(state.size),
        }));
      } else {
        throw refinementRuntimeUnavailable();
      }
    }
  }
  return Object.freeze(files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath))));
};

const packageAuthority = async (root, operation) => {
  const files = await environmentFiles(root, operation);
  const rows = [];
  for (const file of files) {
    rows.push(Object.freeze({
      ...file,
      sha256: await sha256FileStable(file.sourcePath, {
        maximumBytes: Math.max(1, file.bytes),
        signal: operation.signal,
        deadline: operation.epochDeadline,
      }),
    }));
  }
  return Object.freeze(rows);
};

const lockedDistribution = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !exactKeys(value, 'bytes,relativePath,sha256')
    || typeof value.relativePath !== 'string' || !value.relativePath
    || path.posix.isAbsolute(value.relativePath) || value.relativePath.includes('\\')
    || value.relativePath.split('/').some((part) => !part || part === '.' || part === '..')
    || Buffer.byteLength(value.relativePath, 'utf8') > 512
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0
    || value.bytes > REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumBytes
    || !SHA256.test(String(value.sha256 || ''))) throw refinementRuntimeUnavailable();
  return Object.freeze({
    relativePath: value.relativePath,
    bytes: value.bytes,
    sha256: value.sha256,
  });
};

const parseRuntimeLock = (value, resolver) => {
  const keys = 'buildRecipeSha256,converter,distributions,kind,pythonExecutableSha256,rootTreeId,schemaVersion,sourceCommit';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !exactKeys(value, keys)
    || value.schemaVersion !== 1 || value.kind !== 'neuma-refinement-runtime-authority'
    || value.sourceCommit !== resolver.sourceCommit || value.rootTreeId !== resolver.rootTreeId
    || !SHA256.test(String(value.pythonExecutableSha256 || ''))
    || !SHA256.test(String(value.buildRecipeSha256 || ''))
    || !Array.isArray(value.distributions)
    || value.distributions.length > REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumFiles
    || !value.converter || typeof value.converter !== 'object'
    || Array.isArray(value.converter)
    || !exactKeys(value.converter, 'bytes,relativePath,sha256')
    || !Number.isSafeInteger(value.converter.bytes) || value.converter.bytes < 1
    || value.converter.bytes > REFINEMENT_RUNTIME_AUTHORITY_LIMITS.maximumConverterBytes
    || !SHA256.test(String(value.converter.sha256 || ''))) throw refinementRuntimeUnavailable();
  const distributions = value.distributions.map(lockedDistribution);
  const relativePaths = distributions.map(({ relativePath }) => relativePath);
  if (relativePaths.length !== new Set(relativePaths).size
    || relativePaths.some((relativePath, index) => index > 0 && Buffer.compare(
      Buffer.from(relativePaths[index - 1]), Buffer.from(relativePath),
    ) >= 0)) throw refinementRuntimeUnavailable();
  return Object.freeze({
    ...value,
    converter: Object.freeze({ ...value.converter }),
    distributions: Object.freeze(distributions),
  });
};

const converterAuthority = async (runtime, declaration, operation) => {
  const sourcePath = path.join(runtime.venvRoot, declaration.relativePath);
  let resolved;
  let before;
  try {
    [resolved, before] = await Promise.all([
      fs.realpath(sourcePath),
      fs.lstat(sourcePath, { bigint: true }),
    ]);
  } catch (error) {
    throw refinementRuntimeUnavailable(error);
  }
  if (resolved !== sourcePath || !before.isFile()
    || before.size !== BigInt(declaration.bytes)) throw refinementRuntimeUnavailable();
  const sha256 = await sha256FileStable(sourcePath, {
    maximumBytes: declaration.bytes,
    signal: operation.signal,
    deadline: operation.epochDeadline,
  }).catch((error) => { throw refinementRuntimeUnavailable(error); });
  const after = await fs.lstat(sourcePath, { bigint: true });
  if (sha256 !== declaration.sha256 || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mode !== after.mode
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    throw refinementRuntimeUnavailable();
  }
  return Object.freeze({
    sourcePath,
    relativePath: declaration.relativePath,
    bytes: declaration.bytes,
    sha256,
  });
};

/** Resolve and hash the bounded runtime named by the committed source lock. Impure. */
export const resolveRefinementRuntimeAuthorityInputs = async ({
  lock,
  resolver,
  operation: suppliedOperation,
}) => {
  const operation = assertRefinementProcessOperation(suppliedOperation);
  const runtimeLock = parseRuntimeLock(lock, resolver);
  let runtime;
  let siteRoot;
  let packages;
  let converter;
  try {
    runtime = await pythonRuntime(process.env.NEUMA_REFINEMENT_PYTHON, operation);
    siteRoot = await sitePackagesRoot(runtime.venvRoot, operation);
    packages = await packageAuthority(siteRoot, operation);
    if (runtimeLock.pythonExecutableSha256 !== runtime.executableSha256
      || refinementSha256(runtimeLock.distributions) !== refinementSha256(
        packages.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 })),
      )) throw refinementRuntimeUnavailable();
    converter = await converterAuthority(runtime, runtimeLock.converter, operation);
  } catch (error) {
    if (error?.code === 'TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE') throw error;
    throw refinementRuntimeUnavailable(error);
  }
  return Object.freeze({ runtime, siteRoot, packages, converter });
};
