import {
  openPinnedDirectoryChild,
  withPinnedDirectoryView,
} from './refinement-directory-custody.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertEmptyTrainingRoot,
  clearTrainingDirectory,
  scanMaterializedAuthority,
  validateMaterializedAuthority,
} from './refinement-training-work-files-internal.js';

const ADAPTER_ID = /^[a-z0-9][a-z0-9-]{0,60}$/u;
const BORROWS = new WeakMap();
const DESCRIPTORS = new WeakMap();
const uid = () => BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
const sameNode = (left, right) => left.dev === right.dev && left.ino === right.ino
  && left.uid === right.uid && left.gid === right.gid;
const sameFile = (left, right) => sameNode(left, right)
  && left.size === right.size && left.mode === right.mode && left.nlink === right.nlink
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const boundedBytes = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is not bounded`);
  return value;
};
const assertExecution = async (authority, operation) => {
  const { assertRefinementExecutionAuthority } = await import('./refinement-execution-authority.js');
  await assertRefinementExecutionAuthority(authority, operation);
};
const closeAll = async (tasks, label, primary = null) => {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const failures = settled.filter(({ status }) => status === 'rejected')
    .map(({ reason }) => reason);
  if (failures.length) {
    throw new AggregateError(
      primary ? [primary, ...failures] : failures,
      `${label} cleanup failed`,
    );
  }
  if (primary) throw primary;
};
const assertBorrow = (borrow, executionAuthority, operation, active = true) => {
  const state = BORROWS.get(borrow);
  if (!state || state.executionAuthority !== executionAuthority || state.operation !== operation
    || (active && !state.active)) {
    throw new Error('refinement training work-file borrow is unavailable');
  }
  return state;
};
const expectedDirectoryMode = (state, id) =>
  state.sealed && ['runtimeRoot', 'toolRoot'].includes(id) ? 0o500n : 0o700n;
const descriptorState = async (record) => {
  const observed = await record.view.stat();
  if (!sameNode(record.initial, observed) || observed.uid !== uid()) {
    throw new Error(`${record.id} descriptor identity changed`);
  }
  if (record.kind === 'directory') {
    if (!observed.isDirectory()
      || (observed.mode & 0o777n) !== expectedDirectoryMode(record.state, record.id)) {
      throw new Error(`${record.id} directory state changed`);
    }
  } else if (!observed.isFile() || observed.nlink !== 1n
    || (observed.mode & 0o777n) !== 0o600n || observed.size < 0n
    || observed.size > BigInt(record.maximumBytes)) {
    throw new Error(`${record.id} file state changed`);
  }
  return observed;
};
const verifyDescriptor = async (authority, operation) => {
  const record = DESCRIPTORS.get(authority);
  if (!record || !record.state.active || record.state.operation !== operation) {
    throw new Error('refinement training work descriptor expired');
  }
  assertRefinementProcessOperation(operation).assertActive();
  await descriptorState(record);
  return true;
};
const descriptor = (state, id, view, kind, maximumBytes = null) => {
  let authority;
  authority = Object.freeze({
    kind: `refinement-training-${kind}-descriptor-v1`,
    id,
    fd: view.fd,
    ...(maximumBytes === null ? {} : { maximumBytes }),
    verify: (operation) => verifyDescriptor(authority, operation),
  });
  const record = { authority, state, id, view, kind, maximumBytes, initial: null };
  DESCRIPTORS.set(authority, record);
  return record;
};
const initializeDescriptors = async (state, views) => {
  const records = Object.freeze({
    work: descriptor(state, 'work', views.work, 'directory'),
    runtimeRoot: descriptor(state, 'runtimeRoot', views.runtimeRoot, 'directory'),
    toolRoot: descriptor(state, 'toolRoot', views.toolRoot, 'directory'),
    adapterHfRoot: descriptor(state, 'adapterHfRoot', views.adapterHfRoot, 'directory'),
    facts: descriptor(state, 'facts', views.facts, 'file', state.factsMaximumBytes),
    adapter: descriptor(state, 'adapter', views.adapter, 'file', state.adapterMaximumBytes),
  });
  for (const record of Object.values(records)) record.initial = await record.view.stat();
  state.records = records;
  return records;
};
const verifyIdentities = async (state) => {
  for (const record of Object.values(state.records)) await descriptorState(record);
  return true;
};
const borrowProjection = (state) => {
  const borrow = Object.freeze({
    kind: 'refinement-training-work-files-borrow-v1',
    ...Object.fromEntries(Object.entries(state.records)
      .map(([id, record]) => [id, record.authority])),
  });
  BORROWS.set(borrow, state);
  return borrow;
};
const removeChild = async (root, child, name) => {
  if (!child) return;
  await withPinnedDirectoryView(child, clearTrainingDirectory);
  await child.close();
  await root.unlink({ name, directory: true });
};
const removeFile = async (root, resource, name) => {
  if (!resource) return;
  await root.unlink({ name, expectedResource: resource });
  await root.release(resource);
};
const cleanupWorkFiles = async (resources, primary = null) => {
  const tasks = [
    () => removeFile(resources.root, resources.facts, 'facts.json'),
    () => removeFile(resources.root, resources.adapter, resources.adapterName),
    () => removeChild(resources.root, resources.runtimeRoot, 'runtime'),
    () => removeChild(resources.root, resources.toolRoot, 'tool'),
    () => removeChild(resources.root, resources.adapterHfRoot, 'adapter-hf'),
  ];
  return closeAll(tasks, 'refinement training work files', primary);
};

/**
 * Create every mutable training output beneath one private disk-reservation root.
 * Descriptor numbers exist only for the duration of the consumer callback.
 */
export const withRefinementTrainingWorkFiles = async (input, consumer) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',')
      !== 'adapterId,adapterMaximumBytes,executionAuthority,factsMaximumBytes,operation,root'
    || typeof consumer !== 'function' || !ADAPTER_ID.test(String(input.adapterId || ''))) {
    throw new Error('refinement training work-file request is invalid');
  }
  const operation = assertRefinementProcessOperation(input.operation);
  const adapterMaximumBytes = boundedBytes(input.adapterMaximumBytes, 'adapter maximum bytes');
  const factsMaximumBytes = boundedBytes(input.factsMaximumBytes, 'facts maximum bytes');
  await assertExecution(input.executionAuthority, operation);
  const resources = {
    root: input.root,
    runtimeRoot: null,
    toolRoot: null,
    adapterHfRoot: null,
    facts: null,
    adapter: null,
    adapterName: `${input.adapterId}.gguf`,
  };
  let result;
  let primary = null;
  try {
    resources.runtimeRoot = await openPinnedDirectoryChild(input.root, {
      name: 'runtime', label: 'training runtime root', mode: 0o700,
      create: true, createMode: 0o700,
    });
    resources.toolRoot = await openPinnedDirectoryChild(input.root, {
      name: 'tool', label: 'training tool root', mode: 0o700,
      create: true, createMode: 0o700,
    });
    resources.adapterHfRoot = await openPinnedDirectoryChild(input.root, {
      name: 'adapter-hf', label: 'training adapter HF root', mode: 0o700,
      create: true, createMode: 0o700,
    });
    resources.facts = (await input.root.create({
      kind: 'file', name: 'facts.json', mode: 0o600, label: 'training facts',
    })).resource;
    resources.adapter = (await input.root.create({
      kind: 'file', name: resources.adapterName, mode: 0o600, label: 'converted adapter',
    })).resource;
    result = await withPinnedDirectoryView(input.root, (work) =>
      withPinnedDirectoryView(resources.runtimeRoot, (runtimeRoot) =>
        withPinnedDirectoryView(resources.toolRoot, (toolRoot) =>
          withPinnedDirectoryView(resources.adapterHfRoot, (adapterHfRoot) =>
            input.root.open({
              resource: resources.facts,
              operation: (facts) => input.root.open({
                resource: resources.adapter,
                operation: async (adapter) => {
                  const state = {
                    active: true,
                    operation,
                    executionAuthority: input.executionAuthority,
                    adapterMaximumBytes,
                    factsMaximumBytes,
                    sealed: null,
                    records: null,
                  };
                  await initializeDescriptors(state, {
                    work, runtimeRoot, toolRoot, adapterHfRoot, facts, adapter,
                  });
                  const borrow = borrowProjection(state);
                  try {
                    await verifyRefinementTrainingWorkFilesBeforeSpawn(
                      borrow, input.executionAuthority, operation,
                    );
                    return await consumer(borrow);
                  } finally {
                    state.active = false;
                    BORROWS.delete(borrow);
                    for (const record of Object.values(state.records)) {
                      DESCRIPTORS.delete(record.authority);
                    }
                  }
                },
              }),
            })))));
  } catch (error) {
    primary = error;
  }
  return cleanupWorkFiles(resources, primary).then(() => result);
};

/** Bind materialized runtime/tool trees to the exact packed authority manifests. */
export const sealRefinementTrainingMaterializedRoots = async (
  borrow,
  executionAuthority,
  operation,
  declarations,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  await assertExecution(executionAuthority, assertRefinementProcessOperation(operation));
  if (state.sealed || !declarations || typeof declarations !== 'object'
    || Array.isArray(declarations)
    || Object.keys(declarations).sort().join(',') !== 'runtime,tool') {
    throw new Error('training materialized-root seal request is invalid');
  }
  const runtime = validateMaterializedAuthority(
    declarations.runtime, 'neuma-runtime-manifest',
  );
  const tool = validateMaterializedAuthority(declarations.tool, 'neuma-source-manifest');
  await scanMaterializedAuthority(state.records.runtimeRoot.view, runtime, operation);
  await scanMaterializedAuthority(state.records.toolRoot.view, tool, operation);
  state.sealed = Object.freeze({ runtime, tool });
  await verifyIdentities(state);
  return borrow;
};
/** Require already sealed exact runtime/tool roots before a workload spawn. */
export const assertRefinementTrainingMaterializedRoots = async (
  borrow,
  executionAuthority,
  operation,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  const active = assertRefinementProcessOperation(operation);
  if (!state.sealed) throw new Error('training materialized roots are not sealed');
  await assertExecution(executionAuthority, active);
  await verifyIdentities(state);
  await scanMaterializedAuthority(
    state.records.runtimeRoot.view, state.sealed.runtime, active,
  );
  await scanMaterializedAuthority(state.records.toolRoot.view, state.sealed.tool, active);
  active.assertActive();
  return borrow;
};

/** Active, content-exact pre-spawn verification for materializer/trainer/converter. */
export const verifyRefinementTrainingWorkFilesBeforeSpawn = async (
  borrow,
  executionAuthority,
  operation,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  const active = assertRefinementProcessOperation(operation);
  await assertExecution(executionAuthority, active);
  await verifyIdentities(state);
  if (state.sealed) {
    await scanMaterializedAuthority(
      state.records.runtimeRoot.view, state.sealed.runtime, active,
    );
    await scanMaterializedAuthority(state.records.toolRoot.view, state.sealed.tool, active);
  } else {
    await assertEmptyTrainingRoot(state.records.runtimeRoot.view, active);
    await assertEmptyTrainingRoot(state.records.toolRoot.view, active);
  }
  active.assertActive();
  return borrow;
};

/** Identity-only descriptor reaping proof, intentionally valid after operation abort. */
export const verifyRefinementTrainingWorkFilesAfterReap = async (
  borrow,
  executionAuthority,
  operation,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  await verifyIdentities(state);
  return borrow;
};
/** Identity-only post-materializer proof permitting the sealed-tree mode transition. */
export const verifyRefinementTrainingMaterializerAfterReap = async (
  borrow,
  executionAuthority,
  operation,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  await assertExecution(executionAuthority, assertRefinementProcessOperation(operation));
  for (const record of Object.values(state.records)) {
    const observed = await record.view.stat();
    if (!sameNode(record.initial, observed) || observed.uid !== uid()) {
      throw new Error(`${record.id} descriptor identity changed`);
    }
    if (record.kind === 'directory') {
      const expectedMode = ['runtimeRoot', 'toolRoot'].includes(record.id) ? 0o500n : 0o700n;
      if (!observed.isDirectory() || (observed.mode & 0o777n) !== expectedMode) {
        throw new Error(`${record.id} directory state changed`);
      }
    } else if (!observed.isFile() || observed.nlink !== 1n
      || (observed.mode & 0o777n) !== 0o600n || observed.size < 0n
      || observed.size > BigInt(record.maximumBytes)) {
      throw new Error(`${record.id} file state changed`);
    }
  }
  return borrow;
};

/** Read bounded canonical trainer facts only inside a same-operation callback. */
export const withRefinementTrainingFacts = async (
  borrow,
  executionAuthority,
  operation,
  consumer,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  if (typeof consumer !== 'function') throw new Error('training facts consumer is invalid');
  assertRefinementProcessOperation(operation).assertActive();
  const view = state.records.facts.view;
  const before = await descriptorState(state.records.facts);
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    operation.assertActive();
    const { bytesRead } = await view.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) throw new Error('training facts ended before its held size');
    offset += bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  if ((await view.read(trailing, 0, 1, bytes.length)).bytesRead !== 0
    || !sameFile(before, await view.stat())) {
    throw new Error('training facts changed during their bounded read');
  }
  return consumer(Object.freeze({ bytes }));
};

/** Borrow the converted adapter as a bounded read-only descriptor projection. */
export const withRefinementTrainingAdapterHandle = async (
  borrow,
  executionAuthority,
  operation,
  consumer,
) => {
  const state = assertBorrow(borrow, executionAuthority, operation);
  if (typeof consumer !== 'function') throw new Error('training adapter consumer is invalid');
  assertRefinementProcessOperation(operation).assertActive();
  const record = state.records.adapter;
  await descriptorState(record);
  const activeHandle = Object.freeze({
    fd: record.view.fd,
    read: (...args) => {
      assertBorrow(borrow, executionAuthority, operation);
      return record.view.read(...args);
    },
    stat: () => {
      assertBorrow(borrow, executionAuthority, operation);
      return record.view.stat();
    },
  });
  const result = await consumer(activeHandle);
  await descriptorState(record);
  return result;
};
