import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractModuleRefs } from './mapview/imports.js';
import { maskNonCode } from './mapview/extract.js';

const GIT = '/usr/bin/git';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SOURCE_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const GIT_OPTIONS = Object.freeze([
  '--no-optional-locks', '--no-replace-objects',
  '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
  '-c', 'credential.helper=', '-c', 'core.askPass=',
  '-c', 'diff.external=', '-c', 'core.pager=cat',
]);
const HARD_LIMITS = Object.freeze({
  maxFiles: 1024,
  maxTreeEntries: 100_000,
  maxTreeBytes: 32 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxDepth: 64,
  maxPathBytes: 512,
  maxRoots: 128,
  maxExplicitPaths: 128,
  deadlineMs: 30_000,
});

const refusal = (code, message, cause) => Object.assign(
  new Error(`local source closure: ${message}`, cause ? { cause } : undefined),
  { code },
);
const unavailable = (message, cause) => refusal('SOURCE_CLOSURE_UNAVAILABLE', message, cause);
const mismatch = (message, cause) => refusal('SOURCE_CLOSURE_MISMATCH', message, cause);
const limited = (message, cause) => refusal('SOURCE_CLOSURE_LIMIT', message, cause);

const gitEnvironment = Object.freeze({
  HOME: '/nonexistent',
  XDG_CONFIG_HOME: '/nonexistent',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
});

const limitsOf = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !Object.hasOwn(HARD_LIMITS, key))) {
    throw mismatch('limits are invalid');
  }
  const resolved = {};
  for (const [key, ceiling] of Object.entries(HARD_LIMITS)) {
    const value = input[key] ?? ceiling;
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw mismatch(`${key} exceeds its fixed envelope`);
    }
    resolved[key] = value;
  }
  if (resolved.maxFileBytes > resolved.maxTotalBytes) {
    throw mismatch('per-file ceiling exceeds the aggregate ceiling');
  }
  return Object.freeze(resolved);
};

const controlsFor = (externalSignal, deadline, deadlineMs) => {
  if (externalSignal != null && (typeof externalSignal !== 'object'
    || typeof externalSignal.addEventListener !== 'function' || !('aborted' in externalSignal))) {
    throw mismatch('abort signal is invalid');
  }
  if (deadline != null && (!Number.isSafeInteger(deadline) || deadline < 0)) {
    throw mismatch('absolute deadline is invalid');
  }
  const remainingMs = deadline == null ? deadlineMs : Math.min(deadlineMs, deadline - Date.now());
  if (remainingMs <= 0) throw limited('operation exceeded its absolute deadline');
  const controller = new AbortController();
  const deadlineError = limited('operation exceeded its monotonic deadline');
  const externalError = unavailable('operation was aborted');
  const abortExternal = () => controller.abort(externalError);
  if (externalSignal?.aborted) abortExternal();
  else externalSignal?.addEventListener('abort', abortExternal, { once: true });
  const timer = setTimeout(() => controller.abort(deadlineError), remainingMs);
  timer.unref?.();
  const started = process.hrtime.bigint();
  const maximumNs = BigInt(remainingMs) * 1_000_000n;
  const check = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (process.hrtime.bigint() - started >= maximumNs
      || (deadline != null && Date.now() >= deadline)) {
      controller.abort(deadlineError);
      throw deadlineError;
    }
  };
  const close = () => {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortExternal);
  };
  return Object.freeze({ signal: controller.signal, check, close, deadline: Date.now() + remainingMs });
};

const runGit = (root, args, { signal, maxBuffer, allowStatusOne = false }) =>
  new Promise((resolve, reject) => {
    execFile(GIT, [...GIT_OPTIONS, ...args], {
      cwd: root,
      env: gitEnvironment,
      encoding: null,
      maxBuffer,
      signal,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (signal.aborted) return reject(signal.reason);
      if (error) {
        if (allowStatusOne && Number(error.code) === 1) {
          return resolve(Object.freeze({ status: 1, stdout: Buffer.from(stdout || []), stderr: Buffer.from(stderr || []) }));
        }
        return reject(unavailable('trusted Git query failed', error));
      }
      return resolve(Object.freeze({ status: 0, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }));
    });
  });

const oneLine = (result, label) => {
  if (result.stderr.length) throw unavailable(`${label} produced diagnostic output`);
  const value = result.stdout.toString('utf8').trim();
  if (!value || value.includes('\n') || value.includes('\r')) throw unavailable(`${label} is unavailable`);
  return value;
};

const safeRelativePath = (value, limits, label) => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > limits.maxPathBytes
    || value.includes('\\') || value.includes('\0') || value.startsWith('/')
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw mismatch(`${label} path is unsafe`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized === '..'
    || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw mismatch(`${label} path escapes the authority root`);
  }
  return normalized;
};

const declaredPath = (value, authorityRoot, limits, label) => {
  if (typeof value !== 'string' || !value) throw mismatch(`${label} is invalid`);
  if (!path.isAbsolute(value)) return safeRelativePath(value, limits, label);
  const relative = path.relative(authorityRoot, path.resolve(value)).split(path.sep).join('/');
  return safeRelativePath(relative, limits, label);
};

const parseTree = (bytes, limits) => {
  if (!bytes.length || bytes.length > limits.maxTreeBytes) throw limited('Git tree listing exceeds its byte ceiling');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    if (end < 0) throw mismatch('Git tree listing is not NUL terminated');
    let row;
    try { row = decoder.decode(bytes.subarray(offset, end)); }
    catch (error) { throw mismatch('Git tree path is not valid UTF-8', error); }
    offset = end + 1;
    if (!row) continue;
    const tab = row.indexOf('\t');
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(row.slice(0, tab));
    if (tab < 0 || !match) throw mismatch('Git tree entry is malformed');
    const relativePath = safeRelativePath(row.slice(tab + 1), limits, 'Git tree entry');
    if (entries.has(relativePath)) throw mismatch('Git tree contains a duplicate path');
    entries.set(relativePath, Object.freeze({
      relativePath,
      mode: match[1],
      type: match[2],
      objectId: match[3],
    }));
    if (entries.size > limits.maxTreeEntries) throw limited('Git tree exceeds its entry ceiling');
  }
  return entries;
};

const assertRegularEntry = (entry, label) => {
  if (!entry) throw unavailable(`${label} is absent from the declared commit`);
  if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
    throw mismatch(`${label} is a symlink, submodule, or non-regular Git entry`);
  }
  return entry;
};

const collectStream = (stream, maximumBytes, signal) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  let settled = false;
  const cleanup = () => signal.removeEventListener('abort', onAbort);
  const finish = (work, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    work(value);
  };
  const onAbort = () => finish(reject, signal.reason);
  stream.on('data', (chunk) => {
    if (settled) return;
    total += chunk.length;
    if (total > maximumBytes) return finish(reject, limited('Git diagnostic stream exceeds its byte ceiling'));
    chunks.push(chunk);
  });
  stream.once('error', (error) => finish(reject, error));
  stream.once('end', () => finish(resolve, Buffer.concat(chunks, total)));
  stream.once('close', () => finish(resolve, Buffer.concat(chunks, total)));
  signal.addEventListener('abort', onAbort, { once: true });
});

const createBatchReader = (root, controls, limits) => {
  const child = spawn(GIT, [...GIT_OPTIONS, 'cat-file', '--batch'], {
    cwd: root,
    env: gitEnvironment,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: controls.signal,
    windowsHide: true,
  });
  const stderr = collectStream(child.stderr, 64 * 1024, controls.signal);
  let stdinError = null;
  child.stdin.on('error', (error) => { stdinError = error; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', (error) => controls.signal.aborted ? reject(controls.signal.reason) : reject(unavailable('Git object reader failed', error)));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const iterator = child.stdout[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  let ended = false;
  let totalBytes = 0;
  const abort = () => {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.exitCode == null) child.kill('SIGKILL');
  };
  controls.signal.addEventListener('abort', abort, { once: true });

  const fill = async (needed) => {
    while (buffered.length < needed && !ended) {
      controls.check();
      const next = await iterator.next();
      if (next.done) ended = true;
      else buffered = buffered.length ? Buffer.concat([buffered, next.value]) : Buffer.from(next.value);
    }
    if (buffered.length < needed) throw mismatch('Git object stream ended early');
  };
  const take = async (length) => {
    await fill(length);
    const value = buffered.subarray(0, length);
    buffered = buffered.subarray(length);
    return value;
  };
  const line = async () => {
    while (true) {
      const newline = buffered.indexOf(0x0a);
      if (newline >= 0) {
        if (newline > 256) throw mismatch('Git object header exceeds its byte ceiling');
        const value = buffered.subarray(0, newline).toString('ascii');
        buffered = buffered.subarray(newline + 1);
        return value;
      }
      if (buffered.length > 256) throw mismatch('Git object header exceeds its byte ceiling');
      await fill(buffered.length + 1);
    }
  };
  const write = (value) => new Promise((resolve, reject) => {
    controls.check();
    child.stdin.write(value, (error) => {
      if (error || stdinError) reject(unavailable('Git object request failed', error || stdinError));
      else resolve();
    });
  });
  const read = async (entry) => {
    await write(`${entry.objectId}\n`);
    const header = await line();
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== entry.objectId) throw mismatch('Git object header does not match its tree entry');
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size > limits.maxFileBytes) throw limited('Git object exceeds its per-file byte ceiling');
    totalBytes += size;
    if (totalBytes > limits.maxTotalBytes) throw limited('Git object closure exceeds its aggregate byte ceiling');
    const content = Buffer.from(await take(size));
    const terminator = await take(1);
    if (terminator[0] !== 0x0a) throw mismatch('Git object response is not terminated exactly');
    return content;
  };
  const close = async () => {
    await new Promise((resolve) => child.stdin.end(resolve));
    const [status, diagnostics] = await Promise.all([exited, stderr]);
    controls.signal.removeEventListener('abort', abort);
    if (stdinError || status.code !== 0 || status.signal || diagnostics.length || buffered.length) {
      throw unavailable('Git object batch did not close cleanly', stdinError);
    }
  };
  const destroy = async () => {
    abort();
    await Promise.allSettled([exited, stderr]);
    controls.signal.removeEventListener('abort', abort);
  };
  return Object.freeze({ read, close, destroy });
};

const literalAt = (source, quoteIndex) => {
  const quote = source[quoteIndex];
  let value = '';
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      if (index + 1 >= source.length) return null;
      value += source[index + 1];
      index += 1;
    } else if (source[index] === quote) return value;
    else value += source[index];
  }
  return null;
};

const moduleSpecifiers = (source, relativePath, authorityRoot) => {
  const masked = maskNonCode(source);
  const absolute = path.join(authorityRoot, ...relativePath.split('/'));
  const specs = extractModuleRefs(source, masked, absolute, authorityRoot).map(({ spec }) => spec);
  const namedReexport = /\bexport\s*\{[^}]*\}\s*from\s*['"]/gu;
  for (const match of masked.matchAll(namedReexport)) {
    const quote = match.index + match[0].length - 1;
    const spec = literalAt(source, quote);
    if (spec == null) throw mismatch(`module specifier in ${relativePath} is malformed`);
    specs.push(spec);
  }
  for (const pattern of [/(?<![.\w$])import\s*\(/gu, /(?<![.\w$])require\s*\(/gu]) {
    for (const match of masked.matchAll(pattern)) {
      let index = match.index + match[0].length;
      while (/\s/u.test(masked[index] || '')) index += 1;
      if (!['\'', '"'].includes(masked[index])) {
        throw unavailable(`nonliteral module loading in ${relativePath} prevents exact closure`);
      }
    }
  }
  return [...new Set(specs)].sort();
};

const importCandidates = (importer, spec, limits) => {
  if (typeof spec !== 'string' || !spec || spec.includes('\\') || spec.includes('\0')) {
    throw mismatch(`module specifier in ${importer} is unsafe`);
  }
  if (!spec.startsWith('.')) {
    if (spec.startsWith('/') || spec.startsWith('#') || spec.startsWith('file:')
      || spec.startsWith('@/') || spec.startsWith('~/')) {
      throw unavailable(`package-relative module specifier in ${importer} is ambiguous`);
    }
    return [];
  }
  if (spec.includes('?') || spec.includes('#') || spec.includes('%')) {
    throw unavailable(`decorated local module specifier in ${importer} is ambiguous`);
  }
  const base = safeRelativePath(path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec)), limits, 'imported module');
  return [...new Set([
    base,
    `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.jsx`,
    `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
    ...['index.js', 'index.mjs', 'index.cjs', 'index.jsx', 'index.ts', 'index.tsx', 'index.mts', 'index.cts']
      .map((name) => `${base}/${name}`),
  ])];
};

/**
 * Resolve the exact local module closure from one reachable Git commit. No
 * worktree source bytes are read. Returned Buffers are private staging inputs.
 */
export const resolveTrackedLocalImportClosure = async ({
  sourceRoot,
  sourceCommit,
  authorityRoot,
  roots,
  explicitPaths = [],
  signal = null,
  deadline = null,
  limits: limitInput = {},
}) => {
  const limits = limitsOf(limitInput);
  if (!SOURCE_COMMIT.test(String(sourceCommit || ''))
    || !Array.isArray(roots) || roots.length > limits.maxRoots
    || !Array.isArray(explicitPaths) || explicitPaths.length > limits.maxExplicitPaths
    || roots.length + explicitPaths.length === 0
    || typeof sourceRoot !== 'string' || !sourceRoot || typeof authorityRoot !== 'string' || !authorityRoot) {
    throw mismatch('request is invalid');
  }
  const lexicalRoot = path.resolve(authorityRoot);
  const requested = [...new Set(roots.map((value) => declaredPath(value, lexicalRoot, limits, 'root')))];
  const explicit = [...new Set(explicitPaths.map((value) => declaredPath(value, lexicalRoot, limits, 'explicit')))];
  const controls = controlsFor(signal, deadline, limits.deadlineMs);
  let batch = null;
  try {
    controls.check();
    const requestedRoot = path.resolve(sourceRoot);
    const root = await fs.realpath(requestedRoot).catch((error) => { throw unavailable('trusted repository is unavailable', error); });
    if (root !== requestedRoot || !(await fs.stat(root)).isDirectory()) throw mismatch('trusted repository root is indirect');
    const [gitReal, gitStat] = await Promise.all([fs.realpath(GIT), fs.stat(GIT)]);
    if (gitReal !== GIT || !gitStat.isFile() || gitStat.uid !== 0
      || (gitStat.mode & 0o022) !== 0 || (gitStat.mode & 0o111) === 0) {
      throw unavailable('trusted Git executable is unavailable');
    }
    controls.check();
    const top = oneLine(await runGit(root, ['rev-parse', '--show-toplevel'], {
      signal: controls.signal, maxBuffer: limits.maxPathBytes + 2,
    }), 'repository root');
    if (path.resolve(top) !== root) throw mismatch('configured source root is not the repository root');
    const commit = oneLine(await runGit(root, ['rev-parse', '--verify', `${sourceCommit}^{commit}`], {
      signal: controls.signal, maxBuffer: 256,
    }), 'source commit');
    if (!OID.test(commit) || commit !== sourceCommit) throw mismatch('declared source commit is not exact');
    const reachable = await runGit(root, ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      signal: controls.signal, maxBuffer: 256, allowStatusOne: true,
    });
    if (reachable.status !== 0 || reachable.stdout.length || reachable.stderr.length) {
      throw unavailable('declared source commit is not reachable from trusted HEAD');
    }
    const rootTreeId = oneLine(await runGit(root, ['rev-parse', '--verify', `${commit}^{tree}`], {
      signal: controls.signal, maxBuffer: 256,
    }), 'root tree');
    if (!OID.test(rootTreeId)) throw mismatch('root tree identity is invalid');
    const listing = await runGit(root, ['ls-tree', '-r', '-z', '--full-tree', commit], {
      signal: controls.signal, maxBuffer: limits.maxTreeBytes,
    });
    if (listing.stderr.length) throw unavailable('Git tree listing produced diagnostic output');
    const tree = parseTree(listing.stdout, limits);
    for (const relativePath of [...requested, ...explicit]) {
      assertRegularEntry(tree.get(relativePath), relativePath);
    }

    batch = createBatchReader(root, controls, limits);
    const pending = new Map([...requested, ...explicit].map((relativePath) => [relativePath, 0]));
    const files = new Map();
    while (pending.size) {
      controls.check();
      const relativePath = [...pending.keys()].sort()[0];
      const depth = pending.get(relativePath);
      pending.delete(relativePath);
      if (files.has(relativePath)) continue;
      if (depth > limits.maxDepth) throw limited('module graph exceeds its depth ceiling');
      if (files.size >= limits.maxFiles) throw limited('module graph exceeds its file ceiling');
      const entry = assertRegularEntry(tree.get(relativePath), relativePath);
      const content = await batch.read(entry);
      const file = Object.freeze({
        relativePath,
        mode: entry.mode,
        objectId: entry.objectId,
        sha256: createHash('sha256').update(content).digest('hex'),
        bytes: content.length,
        content,
      });
      files.set(relativePath, file);
      if (!CODE_EXTENSIONS.has(path.posix.extname(relativePath))) continue;
      let source;
      try { source = new TextDecoder('utf-8', { fatal: true }).decode(content); }
      catch (error) { throw mismatch(`${relativePath} is not valid UTF-8 source`, error); }
      for (const spec of moduleSpecifiers(source, relativePath, lexicalRoot)) {
        const candidates = importCandidates(relativePath, spec, limits);
        if (!candidates.length) continue;
        const matches = candidates.filter((candidate) => tree.has(candidate));
        if (matches.length !== 1) {
          throw unavailable(`${relativePath} has an unresolved or ambiguous local import`);
        }
        const resolved = matches[0];
        assertRegularEntry(tree.get(resolved), resolved);
        const priorDepth = pending.get(resolved);
        if (!files.has(resolved) && (priorDepth == null || depth + 1 < priorDepth)) {
          pending.set(resolved, depth + 1);
        }
      }
    }
    await batch.close();
    batch = null;
    return Object.freeze({
      sourceCommit: commit,
      rootTreeId,
      files: Object.freeze([...files.values()].sort((left, right) =>
        Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)))),
    });
  } catch (error) {
    if (error?.code?.startsWith?.('SOURCE_CLOSURE_')) throw error;
    if (controls.signal.aborted) throw controls.signal.reason;
    throw mismatch('resolution failed closed', error);
  } finally {
    if (batch) await batch.destroy();
    controls.close();
  }
};
