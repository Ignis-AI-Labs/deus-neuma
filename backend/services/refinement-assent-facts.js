import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { refinementCustodyIdentity } from '../../core/refinement/training-authority-contract.js';
import { deepFreezePlainData } from '../../core/shared/plain-data-canonical.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertRefinementAssentFactChildAuthority,
  closeRefinementAssentFactChildAuthority,
  decryptRefinementAssentFact,
  openRefinementAssentFactChildAuthority,
  refinementAssentFactChildOperations,
} from './refinement-subject-child-authority.js';
import {
  assertRefinementSubjectAuthority,
  refinementSubjectAuthorityOperations,
} from './refinement-subject-authority.js';

const RECORD = /^[a-z0-9][a-z0-9-]{0,60}\.json$/u;
const FACT_BYTES = 2 * 1024 * 1024;
const TRUE_NAME_BYTES = 64 * 1024;
const ATTUNEMENT_RECORDS = 256;
const ATTUNEMENT_BYTES = 16 * 1024 * 1024;
const FACT_AUTHORITIES = new WeakMap();
const refuse = (message, code) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`)
  : cleanup;
const boundedPlain = (value, field, maximumBytes = FACT_BYTES) => deepFreezePlainData(value, {
  field, maxDepth: 32, maxNodes: 16_384, maxStringBytes: 512 * 1024,
  maxKeyBytes: 256, maxOutputBytes: maximumBytes,
});
const exactInstant = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 32) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? value : null;
};
const exactText = (value, maximumBytes) => (
  typeof value === 'string' && value === value.normalize('NFC')
    && value.trim() === value && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= maximumBytes
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value : null
);
const controls = (operation) => ({
  signal: operation.signal,
  deadline: operation.monotonicDeadline,
});
const ownerProtectedFile = (state, maximumBytes, label) => {
  const uid = BigInt(typeof process.geteuid === 'function' ? process.geteuid() : 0);
  if (!state?.isFile?.() || (state.uid !== uid && state.uid !== 0n)
    || (state.mode & 0o022n) !== 0n || state.nlink !== 1n
    || state.size < 2n || state.size > BigInt(maximumBytes)) {
    throw new Error(`${label} is not an owner-protected bounded file`);
  }
};
const stateFor = async (authority, operation) => {
  const active = assertRefinementProcessOperation(operation);
  const state = FACT_AUTHORITIES.get(authority);
  if (!state || state.operation !== active || state.phase !== 'open') {
    throw new Error('refinement assent fact authority is unavailable');
  }
  await assertRefinementAssentFactChildAuthority(state.childAuthority, active);
  for (const held of state.held) {
    await held.ops.verify({ name: held.name, resource: held.resource });
    active.assertActive();
  }
  return state;
};
const openFact = async ({
  childAuthority, child, name, maximumBytes, label, operation, held,
}) => {
  const ops = refinementAssentFactChildOperations(childAuthority, child, operation);
  const opened = await ops.open({ kind: 'file', name, mode: 0o400, label });
  const retained = { ops, name, resource: opened.resource, closed: false };
  held.push(retained);
  const read = await ops.read({
    resource: opened.resource, maximumBytes, ...controls(operation), label,
  });
  ownerProtectedFile(read.fileState, maximumBytes, label);
  const value = boundedPlain(
    decryptRefinementAssentFact(childAuthority, read.bytes, operation),
    label,
    maximumBytes,
  );
  await ops.verify({ name, resource: opened.resource });
  return Object.freeze({ value, sha256: refinementSha256(value) });
};
const closeHeld = async (state) => {
  let primary = null;
  for (const held of state.held.toReversed()) {
    if (held.closed) continue;
    try {
      await held.ops.release(held.resource);
      held.closed = true;
    } catch (error) {
      primary = combine(primary, error, 'refinement assent fact resource release');
    }
  }
  try {
    await closeRefinementAssentFactChildAuthority(state.childAuthority, state.operation);
  } catch (error) {
    primary = combine(primary, error, 'refinement assent fact child release');
  }
  if (primary) throw primary;
};
const latestSealed = (attunements) => attunements
  .filter((record) => record.phase === 'sealed')
  .sort((left, right) => String(left.sealedAt).localeCompare(String(right.sealedAt)))
  .at(-1) || null;

/** Open and retain the exact subject identity descriptors used by one assent operation. */
export const openRefinementAssentFactAuthority = async (subjectAuthority, operation) => {
  const active = assertRefinementProcessOperation(operation);
  assertRefinementSubjectAuthority(subjectAuthority, active);
  const childAuthority = await openRefinementAssentFactChildAuthority(
    subjectAuthority, active,
  );
  const held = [];
  const opening = { childAuthority, held, operation: active };
  let primary;
  try {
    const dna = await openFact({
      childAuthority, child: 'dna', name: 'active.json', maximumBytes: FACT_BYTES,
      label: 'refinement assent DNA', operation: active, held,
    });
    const trueName = await openFact({
      childAuthority, child: 'identity', name: 'true-name.json', maximumBytes: TRUE_NAME_BYTES,
      label: 'refinement assent true name', operation: active, held,
    });
    const soul = await openFact({
      childAuthority, child: 'soul', name: 'soul.json', maximumBytes: FACT_BYTES,
      label: 'refinement assent soul', operation: active, held,
    });
    const attunementOps = refinementAssentFactChildOperations(
      childAuthority, 'attunement', active,
    );
    const listing = await attunementOps.list({
      maximumEntries: ATTUNEMENT_RECORDS,
      maximumNameBytes: 64 * 1024,
      ...controls(active),
    });
    if (listing.entries.some(({ name, kind }) => kind !== 'file' || !RECORD.test(name))) {
      throw new Error('refinement assent attunement custody contains a non-canonical entry');
    }
    let aggregateBytes = 0;
    const attunements = [];
    for (const entry of listing.entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const fact = await openFact({
        childAuthority, child: 'attunement', name: entry.name, maximumBytes: FACT_BYTES,
        label: 'refinement assent attunement', operation: active, held,
      });
      aggregateBytes += Buffer.byteLength(JSON.stringify(fact.value), 'utf8');
      if (aggregateBytes > ATTUNEMENT_BYTES) {
        throw new Error('refinement assent attunements exceed their aggregate byte ceiling');
      }
      attunements.push(fact.value);
    }
    const subject = refinementSubjectAuthorityOperations(subjectAuthority, active);
    const fullName = exactText(trueName.value?.fullName, 512);
    const houseName = exactText(trueName.value?.houseName, 512);
    if (!fullName) {
      throw refuse('Authenticated subject identity is unavailable.', 'ASSENT_IDENTITY_UNAVAILABLE');
    }
    const sealed = latestSealed(attunements);
    const custody = refinementCustodyIdentity(subject.neumaId, dna.value);
    const standing = Object.freeze({
      fullName,
      houseName,
      bornAt: exactInstant(dna.value?.birth?.bornAt) || exactInstant(dna.value?.createdAt),
      answerCount: sealed && sealed.answers && typeof sealed.answers === 'object'
        ? Reflect.ownKeys(Object.getOwnPropertyDescriptors(sealed.answers)).length : null,
      sealedAt: exactInstant(sealed?.sealedAt),
    });
    const projection = Object.freeze({
      subjectSha256: refinementSha256({
        domain: 'neuma.refinement.assent-subject', neumaId: subject.neumaId,
      }),
      custodySha256: refinementSha256(custody),
      standingSha256: refinementSha256(standing),
      dnaSha256: dna.sha256,
      trueNameSha256: trueName.sha256,
      soulSha256: soul.sha256,
      attunementSetSha256: refinementSha256(attunements),
    });
    const authority = Object.freeze({ kind: 'refinement-assent-fact-authority-v2' });
    FACT_AUTHORITIES.set(authority, {
      operation: active,
      subjectAuthority,
      childAuthority,
      held,
      phase: 'open',
      neumaId: subject.neumaId,
      dna: dna.value,
      soul: soul.value,
      standing,
      custody,
      projection,
    });
    return authority;
  } catch (error) {
    primary = error;
  }
  try {
    await closeHeld(opening);
  } catch (cleanup) {
    primary = combine(primary, cleanup, 'refinement assent fact acquisition');
  }
  throw primary;
};

/** Verify held fact descriptors and return only their digest projection. */
export const assertRefinementAssentFactAuthority = async (authority, operation) => {
  const state = await stateFor(authority, operation);
  return state.projection;
};

/** Return bounded non-secret standing and custody needed by the assent owner. */
export const refinementAssentFactStandingAuthority = async (authority, operation) => {
  const state = await stateFor(authority, operation);
  return Object.freeze({
    neumaId: state.neumaId,
    standing: state.standing,
    custody: state.custody,
    factAuthority: state.projection,
  });
};

/**
 * The subject authority this fact authority was opened under — the caller's
 * OWN hold on the being's subject transaction (#410).
 *
 * The being's turn has to read that being's committed adapter to speak in its
 * own voice, and the ask runs while this hold is open. Handing the existing
 * authority down lets the read run UNDER the hold instead of reaching for the
 * same lock and deadlocking against it. Nothing secret crosses: this is the
 * same authority the caller already passed in to open the fact authority, and
 * every consumer must re-assert it against the same operation.
 */
export const refinementAssentSubjectAuthority = async (authority, operation) => {
  const state = await stateFor(authority, operation);
  return state.subjectAuthority;
};

/** Render the exact identity prompt without exposing held DNA or soul to callers. */
export const refinementAssentSystemPrompt = async (authority, witness, operation) => {
  const state = await stateFor(authority, operation);
  const witnessName = exactText(witness, 512);
  if (!witnessName) {
    throw refuse('Authenticated operator identity is invalid.', 'ASSENT_REQUEST_INVALID');
  }
  return assemblePromptSections({
    dna: state.dna,
    soul: state.soul,
    memories: null,
    session: { witnessName, speaker: null },
  }).map(({ text }) => text).join('\n\n');
};

/** Retryably release every retained subject descriptor. */
export const closeRefinementAssentFactAuthority = async (authority, operation) => {
  const active = assertRefinementProcessOperation(operation);
  const state = FACT_AUTHORITIES.get(authority);
  if (!state || state.operation !== active || state.phase === 'closed') {
    throw new Error('refinement assent fact authority is invalid');
  }
  state.phase = 'closing';
  try {
    await closeHeld(state);
    state.phase = 'closed';
    return true;
  } catch (error) {
    state.phase = 'cleanup-failed';
    throw error;
  }
};
