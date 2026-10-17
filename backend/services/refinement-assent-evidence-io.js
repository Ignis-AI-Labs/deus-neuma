import { randomBytes } from 'node:crypto';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { deepFreezePlainData } from '../../core/shared/plain-data-canonical.js';

export const REFINEMENT_ASSENT_EVIDENCE_STORE_VERSION = 7;
const VERSION = REFINEMENT_ASSENT_EVIDENCE_STORE_VERSION;
const SHA256 = /^[0-9a-f]{64}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const KINDS = new Set(['session', 'reserved', 'consumed']);
const MAX_VALUE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
const canonicalName = /^([0-9a-f]{64})\.(session|reserved|consumed)$/;
const temporaryName = /^\.([0-9a-f]{64})\.(session|reserved|consumed)\.([0-9a-f]{32})\.tmp$/;
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`)
  : cleanup;
const exactObject = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length
    || keys.some((field) => typeof field !== 'string' || !fields.includes(field)
      || !Object.hasOwn(descriptors[field], 'value'))) {
    throw new Error(`${label} has invalid fields`);
  }
  return value;
};
const contextFor = (context) => {
  exactObject(
    context,
    ['ceremonyId', 'issuanceRevision', 'requestNonceSha256'],
    'refinement assent generation',
  );
  if (!CEREMONY_ID.test(String(context.ceremonyId || ''))
    || !Number.isSafeInteger(context.issuanceRevision) || context.issuanceRevision < 1
    || !SHA256.test(String(context.requestNonceSha256 || ''))) {
    throw new Error('refinement assent generation is invalid');
  }
  return Object.freeze({ ...context });
};
const storeFor = (store) => {
  if (!store || typeof store !== 'object' || !store.owner
    || typeof store.owner.open !== 'function' || typeof store.owner.create !== 'function'
    || typeof store.owner.replace !== 'function' || typeof store.owner.unlink !== 'function'
    || typeof store.owner.release !== 'function' || typeof store.owner.list !== 'function'
    || typeof store.owner.verify !== 'function' || typeof store.owner.sync !== 'function'
    || typeof store.encrypt !== 'function' || typeof store.decrypt !== 'function'
    || !SHA256.test(String(store.subjectSha256 || '')) || !store.operation) {
    throw new Error('refinement assent store IO authority is invalid');
  }
  store.operation.assertActive();
  return store;
};
const control = (store) => ({
  signal: store.operation.signal,
  deadline: store.operation.monotonicDeadline,
});
const freezeValue = (value, field) => deepFreezePlainData(value, {
  field,
  maxDepth: 40,
  maxNodes: 32_768,
  maxStringBytes: 512 * 1024,
  maxKeyBytes: 512,
  maxOutputBytes: MAX_VALUE_BYTES,
});

/** Derive one subject-bound, opaque generation key. */
const refinementAssentGenerationKey = (subjectSha256, context) => {
  if (!SHA256.test(String(subjectSha256 || ''))) {
    throw new Error('refinement assent subject authority digest is invalid');
  }
  return refinementSha256({
    domain: 'neuma.refinement.assent-generation-v2',
    subjectSha256,
    ...contextFor(context),
  });
};
const nameFor = (store, context, kind) => {
  if (!KINDS.has(kind)) throw new Error('refinement assent store kind is invalid');
  return `${refinementAssentGenerationKey(store.subjectSha256, context)}.${kind}`;
};
const encode = (store, context, kind, value) => {
  const generation = contextFor(context);
  const frozen = freezeValue(value, `refinement assent ${kind}`);
  const payload = Object.freeze({
    version: VERSION,
    kind,
    subjectSha256: store.subjectSha256,
    generation,
    valueSha256: refinementSha256(frozen),
    value: frozen,
  });
  const bytes = store.encrypt(payload);
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_VALUE_BYTES) {
    throw new Error(`refinement assent ${kind} ciphertext is invalid`);
  }
  return Object.freeze({ payload, bytes });
};
const decode = (store, bytes, expectedKind, expectedKey = null) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_VALUE_BYTES) {
    throw new Error(`refinement assent ${expectedKind} ciphertext is invalid`);
  }
  const payload = store.decrypt(bytes);
  exactObject(
    payload,
    ['version', 'kind', 'subjectSha256', 'generation', 'valueSha256', 'value'],
    `refinement assent ${expectedKind}`,
  );
  const generation = contextFor(payload.generation);
  const value = freezeValue(payload.value, `refinement assent ${expectedKind}`);
  const key = refinementAssentGenerationKey(payload.subjectSha256, generation);
  if (payload.version !== VERSION || payload.kind !== expectedKind
    || payload.subjectSha256 !== store.subjectSha256
    || payload.valueSha256 !== refinementSha256(value)
    || (expectedKey && key !== expectedKey)) {
    throw new Error(`refinement assent ${expectedKind} failed authority validation`);
  }
  return Object.freeze({ generation, key, value, valueSha256: payload.valueSha256 });
};
const assertFile = (state, label) => {
  const uid = BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
  if (!state?.isFile?.() || state.uid !== uid
    || (state.mode & 0o777n) !== 0o400n || state.nlink !== 1n
    || state.size < 2n || state.size > BigInt(MAX_VALUE_BYTES)) {
    throw new Error(`${label} is not an immutable owner-protected file`);
  }
};
const readHeld = async (store, name, kind, expectedKey = null) => {
  const opened = await store.owner.open({
    kind: 'file', name, mode: 0o400, label: `refinement assent ${kind}`,
  });
  try {
    const read = await store.owner.read({
      resource: opened.resource,
      maximumBytes: MAX_VALUE_BYTES,
      ...control(store),
      label: `refinement assent ${kind}`,
    });
    assertFile(read.fileState, `refinement assent ${kind}`);
    const decoded = decode(store, read.bytes, kind, expectedKey);
    await store.owner.verify({ name, resource: opened.resource });
    return Object.freeze({
      ...decoded, resource: opened.resource, bytes: read.bytes.length, kind,
    });
  } catch (error) {
    let primary = error;
    try { await store.owner.release(opened.resource); }
    catch (cleanup) { primary = combine(primary, cleanup, `refinement assent ${kind} read`); }
    throw primary;
  }
};
const releaseHeld = async (store, held, primary = null) => {
  try {
    await store.owner.release(held.resource);
    return primary;
  } catch (cleanup) {
    return combine(primary, cleanup, `refinement assent ${held.kind} release`);
  }
};
const readIfPresent = async (store, context, kind) => {
  const key = refinementAssentGenerationKey(store.subjectSha256, context);
  let held;
  try {
    held = await readHeld(store, `${key}.${kind}`, kind, key);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const value = held.value;
  const primary = await releaseHeld(store, held);
  if (primary) throw primary;
  return value;
};
const writeFile = async (file, bytes) => {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes, offset, bytes.length - offset, offset);
    if (!written.bytesWritten) throw new Error('refinement assent store write made no progress');
    offset += written.bytesWritten;
  }
  await file.chmod(0o400);
  await file.sync();
  return file.stat();
};
const publishOnce = async (store, context, kind, value) => {
  const current = await readIfPresent(store, context, kind);
  if (current !== null) {
    if (refinementSha256(current) !== refinementSha256(value)) {
      throw new Error(`refinement assent ${kind} generation already differs`);
    }
    return current;
  }
  const key = refinementAssentGenerationKey(store.subjectSha256, context);
  const targetName = nameFor(store, context, kind);
  const tempName = `.${key}.${kind}.${randomBytes(16).toString('hex')}.tmp`;
  const encoded = encode(store, context, kind, value);
  let resource = null;
  let published = false;
  let primary = null;
  try {
    const created = await store.owner.create({
      kind: 'file', name: tempName, mode: 0o600,
      label: `refinement assent ${kind} staging`,
      operation: (file) => writeFile(file, encoded.bytes),
    });
    resource = created.resource;
    await store.owner.verify({ name: tempName, resource });
    await store.owner.replace({
      sourceResource: resource,
      targetName,
      expectedTargetResource: null,
    });
    published = true;
    await store.owner.verify({ name: targetName, resource });
  } catch (error) {
    primary = error;
  }
  if (!published && resource) {
    try {
      await store.owner.unlink({ name: tempName, expectedResource: resource });
    } catch (cleanup) {
      primary = combine(primary, cleanup, `refinement assent ${kind} staging removal`);
    }
  }
  if (resource) {
    try { await store.owner.release(resource); }
    catch (cleanup) { primary = combine(primary, cleanup, `refinement assent ${kind} publication`); }
  }
  if (primary && primary?.code !== 'EEXIST') throw primary;
  const durable = await readIfPresent(store, context, kind);
  if (durable === null || refinementSha256(durable) !== refinementSha256(value)) {
    throw primary || new Error(`refinement assent ${kind} publication is not durable`);
  }
  return durable;
};
const recoverTemporary = async (store, entry, match) => {
  const [, key, kind] = match;
  const held = await readHeld(store, entry.name, kind, key);
  let primary = null;
  try {
    const canonical = `${key}.${kind}`;
    try {
      await store.owner.replace({
        sourceResource: held.resource,
        targetName: canonical,
        expectedTargetResource: null,
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readHeld(store, canonical, kind, key);
      const conflict = existing.valueSha256 !== held.valueSha256
        ? new Error(`refinement assent ${kind} recovery conflicts with canonical value`, { cause: error })
        : null;
      const cleanup = await releaseHeld(store, existing);
      const failure = cleanup ? combine(conflict, cleanup, `refinement assent ${kind} recovery`) : conflict;
      if (failure) throw failure;
      await store.owner.unlink({ name: entry.name, expectedResource: held.resource });
    }
  } catch (error) {
    primary = error;
  }
  primary = await releaseHeld(store, held, primary);
  if (primary) throw primary;
};

/** Inspect, authenticate, and reconcile every bounded store entry once at open. */
export const inspectRefinementAssentStoreIO = async (input) => {
  const store = storeFor(input);
  const listing = await store.owner.list({
    maximumEntries: MAX_ENTRIES,
    maximumNameBytes: 256 * 1024,
    ...control(store),
  });
  let aggregateBytes = 0;
  for (const entry of listing.entries) {
    if (entry.kind !== 'file') throw new Error('refinement assent store contains a non-file');
    const canonical = canonicalName.exec(entry.name);
    const temporary = temporaryName.exec(entry.name);
    if (!canonical && !temporary) {
      throw new Error('refinement assent store contains a non-canonical entry');
    }
    if (temporary) {
      await recoverTemporary(store, entry, temporary);
      continue;
    }
    const [, key, kind] = canonical;
    const held = await readHeld(store, entry.name, kind, key);
    aggregateBytes += held.bytes;
    const primary = await releaseHeld(store, held);
    if (primary) throw primary;
    if (aggregateBytes > MAX_DIRECTORY_BYTES) {
      throw new Error('refinement assent store exceeds its aggregate byte ceiling');
    }
  }
  await store.owner.sync();
  return Object.freeze({ entries: listing.entries.length, aggregateBytes });
};

/** Read one canonical generation value without scanning another generation. */
export const readRefinementAssentStoreValue = (store, context, kind) =>
  readIfPresent(storeFor(store), contextFor(context), kind);

/** Publish or recover one immutable canonical generation value. */
export const writeRefinementAssentStoreValue = (store, context, kind, value) =>
  publishOnce(storeFor(store), contextFor(context), kind, value);
