// house-deadlines.js — EVERY deadline the house holds, in one read: the
// operator's own list plus each owned lane's standing work and ledger,
// reduced to feed records ({id, source, title, dueDate, dueTime}). The one
// source both the desk's TASKS calendar and the ICS subscribe feed render —
// and the seam #532 (a governed roll-call read) will widen when Founder rules
// on its shape. Read-only over the stores; an unreadable lane is an empty
// page, never a failed aggregate.
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { materializeRecurrence } from '../../core/tasks/assigned-plan.js';
import { readLaneMarker, witnessLaneId, witnessLaneStatus } from './witness-lane.js';
import { listWitnesses } from '../../core/identity/ai-witness/ai-witness-service.js';
import { getUserTasks } from './user-tasks.js';

// The roster walk: every lane this wallet owns — its neumas and its
// provisioned witness lanes (the /live route's idiom, lifted whole).
export const ownedLanes = async (wallet) => {
  const lanes = [];
  for (const { neumaId } of await neumaWorkspace.listNeumaByOwner(wallet).catch(() => [])) {
    if (await readLaneMarker(neumaId)) continue;
    lanes.push({ laneId: neumaId, kind: 'neuma' });
  }
  for (const w of await listWitnesses().catch(() => [])) {
    const laneId = witnessLaneId(w.vendorSlug, w.chosenName);
    const lane = await witnessLaneStatus(laneId).catch(() => null);
    if (!lane?.provisioned) continue;
    if (lane.ownerWallet && lane.ownerWallet.toLowerCase() !== String(wallet).toLowerCase()) continue;
    lanes.push({ laneId, kind: 'witness', name: w.chosenName });
  }
  return lanes;
};

// The open, deadline-carrying tasks of ONE lane's stores — standing work and
// the lane's own ledger. Records carry the STRUCTURED lane identity
// (laneId/kind/laneName/list) the desk's calendar filters on; `source`
// stays the display string the ICS summary renders. Pure over its inputs.
const laneDeadlineRecords = async ({ laneId, kind, name }, nowIso) => {
  const label = name || laneId.slice(0, 8);
  const [plan, ledger] = await Promise.all([
    neumaWorkspace.readAssignedPlan(laneId).catch(() => null),
    neumaWorkspace.readTaskLedger(laneId).catch(() => null),
  ]);
  const live = (tasks) => materializeRecurrence({ tasks: tasks || [] }, nowIso).plan.tasks
    .filter((t) => t.status === 'open' && (t.dueDate || t.dueTime));
  return [
    ...live(plan?.tasks).map((t) => ({
      id: `${laneId}:${t.id}`, source: `${label} · STANDING`, title: t.title,
      laneId, kind, laneName: label, list: 'STANDING',
      dueDate: t.dueDate, dueTime: t.dueTime,
    })),
    ...live(ledger?.tasks).map((t) => ({
      id: `${laneId}:${t.id}`, source: `${label} · LANE`, title: t.title,
      laneId, kind, laneName: label, list: 'LANE',
      dueDate: t.dueDate, dueTime: t.dueTime,
    })),
  ];
};

/**
 * Every open deadline this wallet's house holds. Records carry the structured
 * lane identity (laneId/kind/laneName/list) the desk calendar filters on.
 * impure — disk reads.
 * @param {string} wallet
 * @param {Date} [now]
 * @returns {Promise<Array<{id: string, source: string, title: string,
 *   laneId: string, kind: 'operator'|'neuma'|'witness', laneName: string,
 *   list: 'OPERATOR'|'STANDING'|'LANE', dueDate?: string, dueTime?: string}>>}
 */
export const houseDeadlineRecords = async (wallet, now = new Date()) => {
  const nowIso = now.toISOString();
  const mine = materializeRecurrence(await getUserTasks(wallet), nowIso).plan.tasks
    .filter((t) => t.status === 'open' && (t.dueDate || t.dueTime))
    .map((t) => ({
      id: `mine:${t.id}`, source: 'OPERATOR', title: t.title,
      laneId: 'me', kind: 'operator', laneName: 'ME', list: 'OPERATOR',
      dueDate: t.dueDate, dueTime: t.dueTime,
    }));
  const laneLists = await Promise.all(
    (await ownedLanes(wallet)).map((lane) => laneDeadlineRecords(lane, nowIso)),
  );
  return [...mine, ...laneLists.flat()];
};
