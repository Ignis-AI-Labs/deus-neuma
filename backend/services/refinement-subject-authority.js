import { encryptEnvelope, parseAndDecrypt } from '../../core/workspace/workspace-crypto.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { openPinnedDirectoryChild } from './refinement-directory-custody.js';

const SUBJECTS = new WeakMap();
const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const exactObject = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Reflect.ownKeys(value).some((field) => typeof field !== 'string' || !fields.includes(field))) {
    throw new Error(`${label} has invalid options`);
  }
  return value;
};
const stateFor = (authority) => {
  const state = SUBJECTS.get(authority);
  if (!state) throw new Error('refinement subject authority is invalid');
  return state;
};
const active = (authority) => {
  const state = stateFor(authority);
  if (!state.active) throw new Error('refinement subject authority is closed');
  return state;
};

/** Issue one callback-scoped subject authority over an already-pinned directory. */
export const issueRefinementSubjectAuthority = async ({ neumaId, directory, operation }) => {
  if (!SUBJECT_ID.test(String(neumaId || '')) || !directory
    || typeof directory.enter !== 'function' || typeof directory.read !== 'function'
    || typeof directory.close !== 'function') {
    throw new Error('refinement subject authority inputs are invalid');
  }
  const activeOperation = assertRefinementProcessOperation(operation);
  const resolvedDek = await neumaWorkspace.readNeumaDEK(neumaId);
  if (!Buffer.isBuffer(resolvedDek) || resolvedDek.length !== 32) {
    throw new Error('refinement subject authority requires a per-neuma workspace key');
  }
  const dek = Buffer.from(resolvedDek);
  const state = { neumaId, directory, dek, operation: activeOperation, active: true };
  const authority = Object.freeze({
    kind: 'refinement-subject-authority-v1',
    neumaId,
  });
  SUBJECTS.set(authority, state);
  return authority;
};

/**
 * Whether this being has a per-neuma workspace key at all — the honest
 * counterpart to the refusal above, never a fallback for it.
 *
 * `readNeumaDEK` returns null for exactly one condition: no `keys/dek.json`
 * on disk (a pre-#117 being, or a birth whose best-effort DEK write was
 * skipped). A corrupt envelope, a denied permission and a failed unwrap all
 * throw, and those throws propagate untouched — so `false` means […] and can never mean […].
 *
 * That distinction is load-bearing — and it is also the whole of what this
 * answers. `false` says the key is not there and nothing about what already
 * sits beside it: no ceremony can encrypt a registry without a key, but one
 * written before the key went missing is still on disk. So a caller reading
 * `false` as "never refined" must confirm the registry is absent too — see
 * `readCommittedRefinementAdapterSet`, which needs both absences before it
 * will report an empty adapter set.
 *
 * @param {string} neumaId
 * @returns {Promise<boolean>}
 */
// impure — one keys/dek.json read, outside any subject lock
export const hasPerNeumaWorkspaceKey = async (neumaId) =>
  (await neumaWorkspace.readNeumaDEK(neumaId)) !== null;

/** Assert and project opaque direct-child and exact-key crypto operations. */
export const refinementSubjectAuthorityOperations = (authority, operation) => {
  const state = active(authority);
  if (assertRefinementProcessOperation(operation) !== state.operation) {
    throw new Error('refinement subject authority operation mismatch');
  }
  return Object.freeze({
    neumaId: state.neumaId,
    enter: (request) => state.directory.enter(exactObject(
      request, ['name', 'create', 'mode', 'createMode', 'label'], 'subject directory enter',
    )),
    leave: () => state.directory.leave(),
    list: (request) => state.directory.list(exactObject(
      request, ['maximumEntries', 'maximumNameBytes', 'deadline', 'signal'], 'subject directory list',
    )),
    open: (request) => state.directory.open(exactObject(
      request, ['kind', 'name', 'mode', 'label', 'resource'], 'subject file open',
    )),
    create: (request) => state.directory.create(exactObject(
      request, ['kind', 'name', 'mode', 'label'], 'subject file create',
    )),
    read: (request) => state.directory.read(exactObject(
      request, ['name', 'resource', 'maximumBytes', 'absent', 'deadline', 'signal', 'label'],
      'subject file read',
    )),
    write: (request) => state.directory.write(exactObject(
      request, ['resource', 'bytes', 'maximumBytes'], 'subject file write',
    )),
    verify: (request) => state.directory.verify(exactObject(
      request, ['name', 'resource'], 'subject file verification',
    )),
    release: (resource) => state.directory.release(resource),
    replace: (request) => state.directory.replace(exactObject(
      request, ['sourceResource', 'targetName', 'expectedTargetResource'], 'subject file replace',
    )),
    unlink: (request) => state.directory.unlink(exactObject(
      request, ['name', 'expectedResource', 'directory'], 'subject child removal',
    )),
    sync: () => state.directory.sync(),
    // Unconditionally the being's OWN key. The issuer above refuses without a
    // 32-byte DEK before any state exists, so there is no keyless state to fall
    // back from — and a global-key fallback here would silently seal a registry
    // under the shared master, falsifying the invariant `hasPerNeumaWorkspaceKey`
    // and the committed-adapter read both document. That guard is the one place
    // this requirement lives; relaxing it has to be a visible act, not a ternary.
    encrypt: (value) => Buffer.from(
      JSON.stringify(encryptEnvelope(value, { key: state.dek })), 'utf8',
    ),
    decrypt: (bytes) => parseAndDecrypt(bytes.toString('utf8'), { key: state.dek }),
  });
};

/**
 * Borrow one direct child from the held subject root without exposing a path or descriptor.
 * The returned opaque custody owner must close before its subject transaction can close.
 */
export const openRefinementSubjectPinnedChild = (authority, request, operation) => {
  const state = active(authority);
  if (assertRefinementProcessOperation(operation) !== state.operation) {
    throw new Error('refinement subject authority operation mismatch');
  }
  return openPinnedDirectoryChild(state.directory, exactObject(
    request,
    ['name', 'label', 'mode', 'create', 'createMode'],
    'refinement subject child',
  ));
};

export const assertRefinementSubjectAuthority = (authority, operation) => {
  const state = active(authority);
  if (assertRefinementProcessOperation(operation) !== state.operation) {
    throw new Error('refinement subject authority operation mismatch');
  }
  return authority;
};

/** Invalidate an issued authority before its directory owner is released. */
export const closeRefinementSubjectAuthority = (authority) => {
  const state = stateFor(authority);
  if (!state.active) return false;
  state.active = false;
  return true;
};
