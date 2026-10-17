import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { refinementCustodyIdentity } from '../identity/custody-identity.js';
import { canonicalAuthoritySha256 } from '../shared/plain-data-canonical.js';

export const refinementHistorySha256 = (value) => canonicalAuthoritySha256(value, {
  domain: 'neuma.refinement.history',
  schemaVersion: 2,
  maxDepth: 32,
  maxNodes: 200_000,
  maxStringBytes: 16 * 1024 * 1024,
  maxKeyBytes: 64 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});
const historySha256 = refinementHistorySha256;
const SHA256 = /^[0-9a-f]{64}$/;
const RECORD_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const DIR_FLAGS = constants.O_RDONLY
  | (typeof constants.O_DIRECTORY === 'number' ? constants.O_DIRECTORY : 0)
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
const FILE_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);

export const REFINEMENT_HISTORY_LIMITS = Object.freeze({
  maximumCiphertextBytes: 2 * 1024 * 1024,
  maximumPlaintextBytes: 4 * 1024 * 1024,
  maximumTotalCiphertextBytes: 16 * 1024 * 1024,
  maximumTotalPlaintextBytes: 32 * 1024 * 1024,
  maximumRecords: 128,
  maximumDirents: 256,
  maximumNameBytes: 64 * 1024,
  maximumDepth: 32,
  maximumNodes: 200_000,
  maximumStringBytes: 16 * 1024 * 1024,
  maximumEvents: 4_096,
  deadlineMs: 5_000,
});
const HARD_LIMITS = Object.freeze({
  maximumCiphertextBytes: 16 * 1024 * 1024,
  maximumPlaintextBytes: 32 * 1024 * 1024,
  maximumTotalCiphertextBytes: 128 * 1024 * 1024,
  maximumTotalPlaintextBytes: 256 * 1024 * 1024,
  maximumRecords: 1_024,
  maximumDirents: 2_048,
  maximumNameBytes: 1024 * 1024,
  maximumDepth: 64,
  maximumNodes: 1_000_000,
  maximumStringBytes: 128 * 1024 * 1024,
  maximumEvents: 16_384,
  deadlineMs: 30_000,
});

const refuse = (code, message, cause) => Object.assign(
  new Error(message, ...(cause === undefined ? [] : [{ cause }])), { code },
);
const positiveLimit = (value, field) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > HARD_LIMITS[field]) {
    throw refuse('REFINEMENT_HISTORY_INVALID_LIMIT', `${field} is outside the server history envelope`);
  }
  return value;
};
export const resolveRefinementHistoryLimits = (overrides = {}) => Object.freeze(
  Object.fromEntries(Object.keys(REFINEMENT_HISTORY_LIMITS).map((field) => [
    field,
    positiveLimit(overrides[field] ?? REFINEMENT_HISTORY_LIMITS[field], field),
  ])),
);
export const refinementHistoryControl = (deadlineMs = REFINEMENT_HISTORY_LIMITS.deadlineMs) => {
  const duration = positiveLimit(deadlineMs, 'deadlineMs');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), duration);
  timer.unref?.();
  return Object.freeze({
    deadline: performance.now() + duration,
    signal: controller.signal,
    close: () => clearTimeout(timer),
  });
};
const checkControl = ({ deadline, signal }) => {
  if (!signal || typeof signal.aborted !== 'boolean' || signal.aborted) {
    throw refuse('REFINEMENT_HISTORY_INTERRUPTED', 'refinement history read was interrupted');
  }
  if (!Number.isFinite(deadline) || performance.now() > deadline) {
    throw refuse('REFINEMENT_HISTORY_DEADLINE', 'refinement history read exceeded its monotonic deadline');
  }
};
const sameState = (left, right) => left.dev === right.dev
  && left.ino === right.ino && left.size === right.size && left.mode === right.mode
  && left.uid === right.uid && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const assertOwned = (state) => {
  const owner = BigInt(typeof process.geteuid === 'function' ? process.geteuid() : Number(state.uid));
  if ((state.uid !== owner && state.uid !== 0n) || (state.mode & 0o022n) !== 0n) {
    throw refuse('REFINEMENT_HISTORY_UNSAFE', 'refinement authority has unsafe ownership or permissions');
  }
};
const assertDirect = async (resolved, state, directory = false) => {
  const real = await fs.realpath(resolved);
  if (real !== resolved || (directory ? !state.isDirectory() : !state.isFile())) {
    throw refuse('REFINEMENT_HISTORY_UNSAFE', 'refinement authority is not a direct regular object');
  }
};

const readStableText = async (filePath, limits, control, { absent = false } = {}) => {
  const resolved = path.resolve(filePath);
  let before;
  try {
    before = await fs.lstat(resolved, { bigint: true });
  } catch (error) {
    if (absent && error?.code === 'ENOENT') return null;
    throw refuse('REFINEMENT_HISTORY_UNREADABLE', 'refinement authority is unreadable');
  }
  checkControl(control);
  assertOwned(before);
  if (!before.isFile() || before.size <= 0n
    || before.size > BigInt(limits.maximumCiphertextBytes)) {
    throw refuse('REFINEMENT_HISTORY_OVERFLOW', 'refinement ciphertext exceeds its byte envelope');
  }
  await assertDirect(resolved, before);
  let handle;
  try {
    handle = await fs.open(resolved, FILE_FLAGS);
    const opened = await handle.stat({ bigint: true });
    if (!sameState(before, opened)) throw refuse('REFINEMENT_HISTORY_CHANGED', 'refinement authority changed before open');
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      checkControl(control);
      const chunk = await handle.read(bytes, offset, bytes.length - offset, null);
      if (chunk.bytesRead === 0) throw refuse('REFINEMENT_HISTORY_CORRUPT', 'refinement authority ended before its declared size');
      offset += chunk.bytesRead;
    }
    if ((await handle.read(Buffer.allocUnsafe(1), 0, 1, null)).bytesRead !== 0) {
      throw refuse('REFINEMENT_HISTORY_CHANGED', 'refinement authority grew during read');
    }
    const [after, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }), fs.lstat(resolved, { bigint: true }),
    ]);
    if (!sameState(before, after) || !sameState(before, pathAfter)) {
      throw refuse('REFINEMENT_HISTORY_CHANGED', 'refinement authority changed during read');
    }
    return Object.freeze({ text: bytes.toString('utf8'), ciphertextBytes: bytes.length });
  } catch (error) {
    if (error?.code?.startsWith?.('REFINEMENT_HISTORY_')) throw error;
    throw refuse('REFINEMENT_HISTORY_UNREADABLE', 'refinement authority is unreadable', error);
  } finally {
    await handle?.close().catch(() => {});
  }
};

export const measureRefinementHistoryJson = (value, limits) => {
  const stack = [{ value, depth: 1 }];
  let nodes = 0;
  let stringBytes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > limits.maximumNodes || current.depth > limits.maximumDepth) {
      throw refuse('REFINEMENT_HISTORY_OVERFLOW', 'refinement plaintext exceeds its structural envelope');
    }
    if (typeof current.value === 'string') stringBytes += Buffer.byteLength(current.value, 'utf8');
    if (Array.isArray(current.value)) {
      current.value.forEach((child) => stack.push({ value: child, depth: current.depth + 1 }));
      Object.freeze(current.value);
    } else if (current.value && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        stringBytes += Buffer.byteLength(key, 'utf8');
        stack.push({ value: child, depth: current.depth + 1 });
      }
      Object.freeze(current.value);
    }
    if (stringBytes > limits.maximumStringBytes) {
      throw refuse('REFINEMENT_HISTORY_OVERFLOW', 'refinement plaintext exceeds its string envelope');
    }
  }
  return Object.freeze({ nodes, stringBytes });
};
const measureJson = measureRefinementHistoryJson;
export const assertRefinementEncryptedEnvelope = (text) => {
  let outer;
  try { outer = JSON.parse(text); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'refinement ciphertext is not a JSON envelope');
  }
  if (!outer || typeof outer !== 'object' || Array.isArray(outer) || outer._enc !== 1
    || Object.keys(outer).sort().join('\0') !== '_enc\0ct\0iv\0tag'
    || !['ct', 'iv', 'tag'].every((field) => typeof outer[field] === 'string')) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'refinement authority is not an exact uncompressed encrypted envelope');
  }
};
export const readRefinementEncryptedJsonBounded = async ({
  filePath, decrypt, limits: overrides, control, absent = false,
}) => {
  const limits = resolveRefinementHistoryLimits(overrides);
  checkControl(control);
  if (typeof decrypt !== 'function') throw refuse('REFINEMENT_HISTORY_INVALID_INPUT', 'server decrypt authority is required');
  const source = await readStableText(filePath, limits, control, { absent });
  if (!source) return Object.freeze({ state: 'absent', value: null, accounting: emptyAccounting() });
  assertRefinementEncryptedEnvelope(source.text);
  let value;
  try { value = await decrypt(filePath, source.text); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'refinement authority failed exact decryption or parsing');
  }
  checkControl(control);
  let plaintextBytes;
  try { plaintextBytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'refinement plaintext is not canonical JSON data');
  }
  if (plaintextBytes > limits.maximumPlaintextBytes) {
    throw refuse('REFINEMENT_HISTORY_OVERFLOW', 'refinement plaintext exceeds its byte envelope');
  }
  const measured = measureJson(value, limits);
  return Object.freeze({
    state: 'present', value,
    accounting: Object.freeze({
      ...emptyAccounting(), ciphertextBytes: source.ciphertextBytes,
      plaintextBytes, nodes: measured.nodes, stringBytes: measured.stringBytes,
    }),
  });
};

export const emptyRefinementHistoryAccounting = () => ({
  ciphertextBytes: 0, plaintextBytes: 0, records: 0, dirents: 0,
  nameBytes: 0, nodes: 0, stringBytes: 0, events: 0,
});
const emptyAccounting = emptyRefinementHistoryAccounting;
const addAccounting = (left, right) => Object.fromEntries(
  Object.keys(emptyAccounting()).map((field) => [field, left[field] + right[field]]),
);
export const assertRefinementHistoryAccounting = (value, limits) => {
  if (value.ciphertextBytes > limits.maximumTotalCiphertextBytes
    || value.plaintextBytes > limits.maximumTotalPlaintextBytes
    || value.records > limits.maximumRecords || value.dirents > limits.maximumDirents
    || value.nameBytes > limits.maximumNameBytes || value.nodes > limits.maximumNodes
    || value.stringBytes > limits.maximumStringBytes || value.events > limits.maximumEvents) {
    throw refuse('REFINEMENT_HISTORY_OVERFLOW', 'refinement history exceeds its aggregate envelope');
  }
  return Object.freeze(value);
};
const assertAggregate = assertRefinementHistoryAccounting;
export const mergeRefinementHistoryAccounting = (left, right, overrides = {}) =>
  assertRefinementHistoryAccounting(addAccounting(left, right), resolveRefinementHistoryLimits(overrides));

export const assertRefinementHistoryRecord = (record, subjectId, recordId, limits, kind) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.id !== recordId || (kind === 'ceremony' && record.neumaId !== subjectId)
    || !RECORD_ID.test(record.id) || typeof record.phase !== 'string'
    || !Array.isArray(record.events) || record.events.length > limits.maximumEvents) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', `encrypted ${kind} history contains an invalid record`);
  }
  // Custody binds a ceremony to the subject's DNA digest, and it must be exact
  // WHEN IT IS THERE. Demanding its mere presence, though, called every
  // ceremony recorded before the field existed "corrupt" — which is a lie
  // about intact data, and it hid every being's real refinement history behind
  // a decryption-failure code (measured 2026-08-13: all nine of Founder's beings
  // reported REFINEMENT_HISTORY_CORRUPT while their records decrypted, parsed,
  // and carried their full event lists).
  //
  // Absence costs nothing here, because the subject binding does not depend on
  // it: the check above already refuses any ceremony whose own `neumaId` is not
  // this subject. Custody adds the DNA-digest tie on top of that — so a record
  // that carries it is still held to it exactly, and one that predates it is
  // still bound to its subject by name.
  if (kind === 'ceremony' && record.custody !== undefined
    && (!record.custody || record.custody.subjectNeumaId !== subjectId)) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'encrypted ceremony custody is invalid');
  }
  if (record.revision !== undefined && (!Number.isSafeInteger(record.revision) || record.revision <= 0)) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'ceremony revision is invalid');
  }
  if (record.priorCeremonySha256 !== undefined && record.priorCeremonySha256 !== null
    && !SHA256.test(record.priorCeremonySha256)) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'ceremony prior digest is invalid');
  }
  return record;
};
const readHistory = async ({ lanePath, subjectId, directory, kind, decrypt, limits: overrides, control }) => {
  const limits = resolveRefinementHistoryLimits(overrides);
  checkControl(control);
  const resolved = path.resolve(lanePath, ...directory);
  let handle;
  let stream;
  try {
    handle = await fs.open(resolved, DIR_FLAGS);
    const before = await handle.stat({ bigint: true });
    assertOwned(before);
    await assertDirect(resolved, before, true);
    const anchored = process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : resolved;
    stream = await fs.opendir(anchored, { bufferSize: 32 });
    const records = [];
    let accounting = emptyAccounting();
    for await (const entry of stream) {
      checkControl(control);
      // assertAggregate FREEZES what it validates, so each step must fold into
      // a fresh tally — mutating the one it just froze threw a bare TypeError
      // on the second dirent, and the catch-all below reported that as
      // "history is unreadable" for every subject holding two or more records.
      accounting = assertAggregate(addAccounting(accounting, {
        ...emptyAccounting(),
        dirents: 1,
        nameBytes: Buffer.byteLength(entry.name, 'utf8'),
      }), limits);
      if (entry.isSymbolicLink() || !entry.isFile() || !/^[a-z0-9][a-z0-9-]{0,60}\.json$/.test(entry.name)) {
        throw refuse('REFINEMENT_HISTORY_UNSAFE', `encrypted ${kind} history contains an unsafe entry`);
      }
      const recordId = entry.name.slice(0, -5);
      const read = await readRefinementEncryptedJsonBounded({
        filePath: path.join(resolved, entry.name), decrypt, limits, control,
      });
      const record = assertRefinementHistoryRecord(read.value, subjectId, recordId, limits, kind);
      accounting = assertAggregate(addAccounting(accounting, {
        ...read.accounting, records: 1, events: record.events.length,
      }), limits);
      records.push(record);
    }
    const [after, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }), fs.lstat(resolved, { bigint: true }),
    ]);
    if (!sameState(before, after) || !sameState(before, pathAfter)) {
      throw refuse('REFINEMENT_HISTORY_CHANGED', `encrypted ${kind} history changed during enumeration`);
    }
    const dateField = kind === 'ceremony' ? 'openedAt' : 'offeredAt';
    records.sort((a, b) => String(b[dateField] || '').localeCompare(String(a[dateField] || '')));
    return Object.freeze({
      state: records.length ? 'present' : 'authoritative-empty',
      records: Object.freeze(records), accounting: Object.freeze(accounting),
      historySha256: historySha256(records),
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({
      state: 'authoritative-empty', records: Object.freeze([]),
      accounting: Object.freeze(emptyAccounting()), historySha256: historySha256([]),
    });
    if (error?.code?.startsWith?.('REFINEMENT_HISTORY_')) throw error;
    // The coded refusal is the boundary contract; the cause stays attached so a
    // real fault underneath is diagnosable instead of silently reworded.
    throw refuse('REFINEMENT_HISTORY_UNREADABLE', `encrypted ${kind} history is unreadable`, error);
  } finally {
    await stream?.close().catch(() => {});
    await handle?.close().catch(() => {});
  }
};

export const readRefinementCeremonyHistoryBounded = (request) => readHistory({
  ...request, directory: ['refinement', 'ceremonies'], kind: 'ceremony',
});
export const readRefinementAttunementHistoryBounded = (request) => readHistory({
  ...request, directory: ['attunement', 'records'], kind: 'attunement',
});
export const readRefinementCeremonyBounded = async ({
  lanePath, subjectId, ceremonyId, decrypt, limits: overrides, control,
}) => {
  if (!RECORD_ID.test(String(ceremonyId))) throw refuse('REFINEMENT_HISTORY_INVALID_INPUT', 'ceremony id is invalid');
  const limits = resolveRefinementHistoryLimits(overrides);
  const read = await readRefinementEncryptedJsonBounded({
    filePath: path.resolve(lanePath, 'refinement', 'ceremonies', `${ceremonyId}.json`),
    decrypt, limits, control, absent: true,
  });
  if (read.state === 'absent') return read;
  const record = assertRefinementHistoryRecord(read.value, subjectId, ceremonyId, limits, 'ceremony');
  const accounting = Object.freeze({
    ...read.accounting, records: 1, events: record.events.length,
  });
  assertAggregate(accounting, limits);
  return Object.freeze({
    state: 'present', record, accounting, recordSha256: historySha256(record),
  });
};

// readRefinementApprovalAuthorityBounded lived here until 2026-08-24. It
// derived a TRAINING approval — whose consent authority, whose plan, which
// corpus digests — from a ceremony record, and it was the single reason this
// reader imported core/refinement/ceremony.js. That one import carried the
// consent policy, the readiness policy, the corpus and its manifest, and the
// training-plan decision onto the identity path: six modules of retired forge
// walked through every time a being assembled a prompt. It had no callers when
// it was removed. Reading a being's ceremony history is untouched — that is
// readRefinementCeremonyHistoryBounded above, and a closed road is not an
// erased past.

export const readRefinementCustodyAuthorityBounded = async ({
  lanePath, subjectId, decrypt, limits, control,
}) => {
  const read = await readRefinementEncryptedJsonBounded({
    filePath: path.resolve(lanePath, 'dna', 'active.json'), decrypt, limits, control, absent: true,
  });
  if (read.state === 'absent') return Object.freeze({ ...read, custody: null });
  let custody;
  try { custody = refinementCustodyIdentity(subjectId, read.value); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'current sovereign DNA custody is invalid');
  }
  return Object.freeze({ state: 'present', custody, accounting: read.accounting });
};

export const readRefinementOwnerAuthorityBounded = async ({
  lanePath, subjectId, limits: overrides, control,
}) => {
  const limits = resolveRefinementHistoryLimits(overrides);
  const source = await readStableText(
    path.resolve(lanePath, 'owner.json'),
    limits,
    control,
    { absent: true },
  );
  if (!source) return Object.freeze({
    state: 'absent', owner: null, accounting: Object.freeze(emptyAccounting()),
  });
  let owner;
  try { owner = JSON.parse(source.text); } catch {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'workspace ownership authority is corrupt');
  }
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)
    || Object.keys(owner).sort().join('\0') !== 'claimedAt\0wallet'
    || typeof owner.wallet !== 'string' || owner.wallet !== owner.wallet.trim()
    || owner.wallet.length === 0 || owner.wallet.length > 256
    || !Number.isSafeInteger(owner.claimedAt) || owner.claimedAt <= 0) {
    throw refuse('REFINEMENT_HISTORY_CORRUPT', 'workspace ownership authority has an invalid shape');
  }
  const measured = measureJson(owner, limits);
  const accounting = Object.freeze({
    ...emptyAccounting(),
    plaintextBytes: source.ciphertextBytes,
    nodes: measured.nodes,
    stringBytes: measured.stringBytes,
  });
  return Object.freeze({
    state: 'present',
    owner: Object.freeze({
      subjectNeumaId: subjectId,
      wallet: owner.wallet.toLowerCase(),
      ownerSha256: historySha256(owner),
    }),
    accounting,
  });
};
