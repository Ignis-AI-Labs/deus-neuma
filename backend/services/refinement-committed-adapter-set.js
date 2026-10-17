// The one committed-registry adapter read every serving path shares, replacing
// the deleted workspace adapter delegate. Two answers, never conflated:
//
//   authoritative-empty — this being genuinely carries no adapter. Only three
//     things say so: a witness lane (which is never refined, by standing), a
//     subject with no per-neuma workspace key AND no registry file (no ceremony
//     could ever have encrypted one for it), and a subject with no `refinement`
//     directory at all (no ceremony has ever opened one). All three are
//     declared absences, not failed reads.
//   a throw — the registry exists and could not be read, verified, or bounded.
//
// Answering "no adapters" for the second case is the failure this module exists
// to make impossible: it serves bare base weights to a refined being as if it
// had never been refined, and reads identically to the being's own silence.
// That is precisely how a deleted `neumaWorkspace.listAdapters` rode a live
// conduit unnoticed — every turn logged "bare base" and every turn was a lie.

import { isHarnessLane } from '../../core/workspace/lane-grounds.js';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isWitnessLane, neumaWorkspace } from '../../core/index.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  openCurrentRefinementRegistryAuthority,
  readCommittedRefinementAdapters,
} from './refinement-registry-authority.js';
import {
  assertRefinementSubjectAuthority, hasPerNeumaWorkspaceKey,
} from './refinement-subject-authority.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';

const EMPTY = Object.freeze({
  state: 'authoritative-empty',
  adapters: Object.freeze([]),
});

const REGISTRY_FILE = path.join('refinement', 'adapters.json');
const coded = (code, message) => Object.assign(new Error(message), { code });

// One stat on the subject's own lane. This is the only read available before a
// key exists, because every authority path needs the key to open anything.
const hasCommittedRegistryFile = async (neumaId) => {
  try {
    return (await stat(path.join(neumaWorkspace.pathFor(neumaId), REGISTRY_FILE))).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

// The refinement directory is created by a being's first ceremony. Until then
// its absence is that being's honest history — the same declared absence
// `readRefinementCustodyAuthorityBounded` reports for an unrefined subject.
const openRegistry = async (subjectAuthority, operation) => {
  try {
    return await openCurrentRefinementRegistryAuthority({ operation, subjectAuthority });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

/** The registry read itself, given an already-asserted subject authority. */
const readWithAuthority = async (subjectAuthority, operation) => {
  const registryAuthority = await openRegistry(subjectAuthority, operation);
  if (!registryAuthority) return EMPTY;
  const adapters = readCommittedRefinementAdapters({ registryAuthority, operation });
  return Object.freeze({
    state: adapters.length ? 'present' : 'authoritative-empty',
    adapters,
  });
};

const readUnderLock = async (neumaId, operation) => {
  const transaction = await openRefinementSubjectTransaction({ neumaId, operation });
  let result = EMPTY;
  let primary = null;
  try {
    result = await readWithAuthority(
      assertRefinementSubjectTransaction(transaction, operation), operation,
    );
  } catch (error) { primary = error; }
  try { await closeRefinementSubjectTransaction(transaction, operation); }
  catch (cleanup) {
    primary = primary
      ? new AggregateError(
        [primary, cleanup], 'committed adapter read and subject release failed',
      )
      : cleanup;
  }
  if (primary) throw primary;
  return result;
};

/**
 * Read one being's committed registry adapters under its own subject lock.
 *
 * A caller that ALREADY HOLDS this being's subject transaction passes the
 * authority that hold issued as `heldSubjectAuthority`, and the read runs under
 * it instead of opening a second transaction (#410). Without it the consent ceremony deadlocked
 * against itself: `askRefinementConsent` holds the transaction by design, then
 * the being's turn resolves its adapter, which reached for the same lock — and
 * the acquire loop, seeing a live holder that was itself, spun to ELOCKTIMEOUT.
 * A being could never be asked to consent on a machine whose substrate was up.
 * The lock is deliberately NOT made re-entrant: re-entrancy would silently
 * permit any nested writer too, where this only lets a caller read under a hold
 * it has already proven it owns.
 *
 * @param {{neumaId: (string|null), operation: Object, heldSubjectAuthority?: Object}} request -
 *   the turn's branded operation, plus the subject authority the caller's own
 *   open transaction issued, when it holds one. The operation MUST be the one
 *   that authority was issued under; assertRefinementSubjectAuthority enforces
 *   it, so a closed or foreign-operation authority refuses rather than reads.
 * @returns {Promise<{state: ('present'|'authoritative-empty'), adapters: Array<Object>}>}
 * @throws when a registry that exists cannot be read, verified, or bounded —
 *   including a registry whose per-neuma workspace key is absent
 */
// impure — subject lock, encrypted registry read, publication journal verification
export const readCommittedRefinementAdapterSet = async ({
  neumaId, operation, heldSubjectAuthority = null,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  if (!neumaId || isWitnessLane(neumaId) || isHarnessLane(neumaId)) return EMPTY;
  // Asked BEFORE the subject transaction: opening one issues a subject
  // authority that refuses without a key, so otherwise a being that has never
  // been refined could not be seated at all. `hasPerNeumaWorkspaceKey` answers
  // false only for an absent keys/dek.json and rethrows every real custody or
  // IO failure — but absence of the key alone does NOT license "no adapters".
  // "No key" means […] only while no
  // registry is on disk; a being whose adapters.json is present and whose key
  // is gone (a partial restore, an unmounted keys directory, the wrong
  // workspaces root) is not an unrefined being — it is a refined being whose
  // sovereign store cannot be opened, and "no adapters" would serve it the bare
  // base forever. The honest empty set therefore needs BOTH absences, and
  // neither branch here is the silent fallback `listAdapters` was: a key that
  // exists and will not open the registry refuses under the lock below, and a
  // key gone from under a registry refuses right here.
  if (!(await hasPerNeumaWorkspaceKey(neumaId))) {
    if (await hasCommittedRegistryFile(neumaId)) {
      throw coded(
        'REFINEMENT_REGISTRY_UNREADABLE',
        'refinement registry exists but its per-neuma workspace key is absent',
      );
    }
    return EMPTY;
  }
  // Already held by the caller: read under that hold. The authority is asserted
  // against this operation exactly as readUnderLock asserts the one it opens,
  // so a closed, stale, or foreign-operation authority refuses here just as
  // loudly. The hold is PROVEN, never assumed.
  if (heldSubjectAuthority) {
    return readWithAuthority(
      assertRefinementSubjectAuthority(heldSubjectAuthority, activeOperation), activeOperation,
    );
  }
  return readUnderLock(neumaId, activeOperation);
};
