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
// provisioned witness lanes. THE one walk (the /live counts read it too).
// A witness lane belongs to a wallet only when its owner record says so: an
// unclaimed lane is no one's yet, exactly as assertNeumaOwner refuses it —
// counting it for every wallet showed one house's tasks to another.
// Lanes are read in parallel; a lane that cannot be read is left out.
export const ownedLanes = async (wallet) => {
  const me = String(wallet).toLowerCase();
  const neumas = await Promise.all((await neumaWorkspace.listNeumaByOwner(wallet).catch(() => []))
    .map(async ({ neumaId }) => ((await readLaneMarker(neumaId)) ? null : { laneId: neumaId, kind: 'neuma' })));
  const witnesses = await Promise.all((await listWitnesses().catch(() => [])).map(async (w) => {
    const laneId = witnessLaneId(w.vendorSlug, w.chosenName);
    const lane = await witnessLaneStatus(laneId).catch(() => null);
    if (!lane?.provisioned || String(lane.ownerWallet || '').toLowerCase() !== me) return null;
    return { laneId, kind: 'witness', name: w.chosenName };
  }));
  return [...neumas, ...witnesses].filter(Boolean);
};

// a task in hand ('active', the ledger's focused work) is as live as an open one
const LIVE = Object.freeze(['open', 'active']);

// A task belongs on a calendar when it carries a date or a time and was not
// dropped — settled ones included: a daily done today still shows as done.
const dated = (t) => t.status !== 'dropped' && (t.dueDate || t.dueTime);
const rolled = (tasks, nowIso) => materializeRecurrence({ tasks: tasks || [] }, nowIso).plan.tasks.filter(dated);
// One record: the STRUCTURED lane identity (laneId/kind/laneName/list) the
// desk filters on, the status and rhythm (cadence, custom days) the calendar
// projects from, and `source` — the display string the ICS summary renders.
const recordOf = (t, { prefix, source, laneId, kind, laneName, list }) => ({
  id: `${prefix}:${t.id}`, source, title: t.title, laneId, kind, laneName, list,
  status: t.status,
  ...(t.cadence ? { cadence: t.cadence } : {}),
  ...(Array.isArray(t.days) ? { days: t.days } : {}),
  dueDate: t.dueDate, dueTime: t.dueTime,
  ...(t.startTime ? { startTime: t.startTime } : {}),
});

// ONE lane's dated tasks — its standing work and its own ledger.
const laneTaskRecords = async ({ laneId, kind, name }, nowIso) => {
  const label = name || laneId.slice(0, 8);
  const [plan, ledger] = await Promise.all([
    neumaWorkspace.readAssignedPlan(laneId).catch(() => null),
    neumaWorkspace.readTaskLedger(laneId).catch(() => null),
  ]);
  const lane = { prefix: laneId, laneId, kind, laneName: label };
  return [
    ...rolled(plan?.tasks, nowIso).map((t) => recordOf(t, { ...lane, source: `${label} · STANDING`, list: 'STANDING' })),
    ...rolled(ledger?.tasks, nowIso).map((t) => recordOf(t, { ...lane, source: `${label} · LANE`, list: 'LANE' })),
  ];
};

/**
 * Every dated task this wallet's house holds — the operator's own list and
 * each owned lane's stores — settled ones included. impure — disk reads.
 * @param {string} wallet
 * @param {Date} [now]
 * @returns {Promise<Array<{id: string, source: string, title: string,
 *   laneId: string, kind: 'operator'|'neuma'|'witness', laneName: string,
 *   list: 'OPERATOR'|'STANDING'|'LANE', status: string, cadence?: string,
 *   days?: number[], dueDate?: string, dueTime?: string}>>}
 */
export const houseTaskRecords = async (wallet, now = new Date()) => {
  const nowIso = now.toISOString();
  const mine = rolled((await getUserTasks(wallet)).tasks, nowIso).map((t) => recordOf(t, {
    prefix: 'mine', source: 'OPERATOR', laneId: 'me', kind: 'operator', laneName: 'ME', list: 'OPERATOR',
  }));
  const laneLists = await Promise.all((await ownedLanes(wallet)).map((lane) => laneTaskRecords(lane, nowIso)));
  return [...mine, ...laneLists.flat()];
};

/**
 * Every LIVE deadline (open or in hand) the house holds — what the TASKS
 * calendar's counts and the ICS feed render. impure — disk reads.
 * @param {string} wallet
 * @param {Date} [now]
 */
export const houseDeadlineRecords = async (wallet, now = new Date()) =>
  (await houseTaskRecords(wallet, now)).filter((r) => LIVE.includes(r.status));
