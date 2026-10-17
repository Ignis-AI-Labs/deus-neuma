// Attunement ceremony guards — the per-being turn lock plus the shared
// coded-refusal and record/name read helpers, split out of
// attunement-ceremony.js (size law). The ceremony orchestrator and the
// question/consent legs (attunement-questions.js) both stand on this ONE
// lock and ONE refusal grammar; a shared leaf keeps the dependency a DAG
// (the orchestrator re-exports the questions module, so the lock cannot
// live in the orchestrator without a cycle).

import { neumaWorkspace } from '../../core/index.js';
import { isWitnessLane } from '../../core/workspace/neuma-workspace.js';
import { readLaneMarker } from './witness-lane.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';

export const refuse = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

// One ceremony mutation at a time per being. The mutating actions are
// read-modify-write with awaits in the middle (the being's whole answer turn
// sits between read and write) — two parallel calls could interleave and a
// stale write could revert an answered question to unanswered, re-asking
// what was already answered (the exact class ATT-E3 forbids). The lock makes
// that unrepresentable: a concurrent mutation refuses honestly instead.
const inFlight = new Map();
export const withTurnLock = async (neumaId, work) => {
  if (inFlight.has(neumaId)) {
    throw refuse('A ceremony step is already in flight for this being — wait for it to land.', 'TURN_IN_FLIGHT');
  }
  inFlight.set(neumaId, true);
  try {
    return await work();
  } finally {
    inFlight.delete(neumaId);
  }
};

export const mustRead = async (neumaId, recordId) => {
  await assertAttunementStanding(neumaId);
  const record = await neumaWorkspace.readAttunement(neumaId, recordId);
  if (!record) throw refuse('Attunement record not found.', 'RECORD_NOT_FOUND');
  return record;
};

/** impure — verify standing independently of whether a name or record exists. */
export const assertAttunementStanding = async (neumaId) => {
  if (isHarnessLane(neumaId)) throw refuse('Attunement belongs to a born neuma. This is the harness — no being lives there.', 'HARNESS_LANE');
  if (isWitnessLane(neumaId) || await readLaneMarker(neumaId, { strict: true })) {
    throw refuse('Attunement belongs to a born neuma. This is an AI witness lane and cannot receive this ceremony.', 'WITNESS_LANE');
  }
};

export const beingName = async (neumaId) => {
  await assertAttunementStanding(neumaId);
  const dna = await neumaWorkspace.readDNA(neumaId).catch(() => null);
  const name = dna?.identity?.name || dna?.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw refuse('This being has no readable name — an attunement belongs to a born being.', 'NO_DNA');
  }
  return { name: name.trim(), dna };
};
