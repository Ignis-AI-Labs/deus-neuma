// The dailies bridge — the task ledger IS the vessel dailies.
//
// Design note, 2026-08-29: […] Before this module the two stores were strangers: a
// daily-cadence task settled on a being's ledger updated nothing, and the
// vessel's streak refused to exist until the operator hand-defined dailies
// in VESSEL — the same work entered twice. 2026-08-31: the bridge covered
// only the BEING's ledger — the operator's OWN list (the ME lane, where his
// dailies actually live) settled into nothing. A daily on the operator's
// list now carries a `vessel` flag: flagged dailies join the definition and
// settling one marks the log, same law.
//
// One law, two halves, both ADD-ONLY over the operator's vitals log:
//   • the DEFINITION — the dailies in force are the UNION of the lane's live
//     daily tasks and the operator's own vessel-flagged dailies, kept in sync
//     as `dailies-set` snapshots tagged `via: 'task-ledger'`. While either
//     list holds dailies, the task lists are the definition — the sync
//     overwrites even a hand-set VESSEL snapshot whose items drifted, because
//     a stale hand list silently breaking the operator's real dailies is the
//     exact split this module exists to end. When NEITHER list holds dailies,
//     the log is left alone (an operator who never used the task system keeps
//     the old path). The ME-settle sync has no lane in hand, so it unions the
//     operator's list alone — a being lane's next sync re-unions its own
//     dailies back in; every completion syncs before it appends, so no mark
//     ever resolves against a definition that lacks it.
//   • the COMPLETION — settling a daily task (being ledger) or a vessel-
//     flagged daily (operator's list) appends the `daily` completion to the
//     owner wallet's log, once per task per day, judged by the OPERATOR-LOCAL
//     day (core/vessel/day-key.js — the same law the streak judges by).
//     Finishing the task in the list IS the daily mark.
//
// The streak law itself (core/vessel/dailies.js) is untouched — it keeps
// reading the log it always read; this module just makes the log tell the
// truth about what the operator actually does.

import { neumaWorkspace } from '../../core/index.js';
import { materializeRecurrence } from '../../core/tasks/assigned-plan.js';
import { localDayKey } from '../../core/vessel/day-key.js';
import { getUserTasks } from './user-tasks.js';
import { appendVital, readVitals } from './user-vitals.js';
import { createLogger } from './logger.js';

const log = createLogger('DailyBridge');

/** The daily tasks that ARE dailies: cadence daily, not dropped. Pure. */
export const derivedDailies = (tasks) => (tasks || [])
  .filter((t) => t?.cadence === 'daily' && t?.status !== 'dropped')
  .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a.id || '').localeCompare(String(b.id || '')))
  .map((t) => ({ id: t.id, title: t.title }));

/**
 * The dailies union: the lane's ledger dailies, then the operator's own
 * vessel-flagged dailies — deduped by task id (first wins), stable order.
 * Pure.
 */
export const unionDailies = (ledgerTasks, mineTasks) => {
  const seen = new Set();
  const mine = (mineTasks || []).filter((t) => t?.vessel === true);
  return [...derivedDailies(ledgerTasks), ...derivedDailies(mine)]
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
};

/** Whether two definition item lists are the same. Pure. */
const sameItems = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sync the wallet's dailies definition from the task lists: the lane's live
 * daily tasks (when a lane is in hand) UNION the operator's own vessel-
 * flagged dailies. Safe to call as often as a turn likes: a no-op unless the
 * derived set actually drifted. impure (ledger + task list + vitals log).
 * @returns {Promise<Array<{id, title}>>} the dailies now in force
 */
// impure
export const ensureDerivedDailies = async ({ wallet, neumaId }) => {
  if (!wallet) return [];
  const now = new Date().toISOString();
  const ledgerTasks = neumaId
    ? materializeRecurrence(await neumaWorkspace.readTaskLedger(neumaId), now).plan.tasks
    : [];
  const mineTasks = (await getUserTasks(wallet)).tasks;
  const items = unionDailies(ledgerTasks, mineTasks);
  if (items.length === 0) return [];
  const entries = await readVitals(wallet);
  const latest = [...(entries || [])].reverse().find((e) => e?.kind === 'dailies-set');
  if (!sameItems(latest?.items, items)) {
    await appendVital(wallet, { kind: 'dailies-set', items, via: 'task-ledger' });
    log.info('dailies definition synced from task lists', { neumaId: neumaId || null, count: items.length });
  }
  return items;
};

/**
 * The completion append both settle paths share: the operator's vessel daily
 * is marked once per task per (operator-local) day — a restamp is a no-op,
 * never a double mark. The dedupe reads the log ahead of the append (the
 * semantics this bridge has always had); appendVital's per-wallet queue
 * serializes the write itself. impure (vitals log).
 * @returns {Promise<Object|null>} the appended entry, or null when already marked
 */
// impure
const appendDailyCompletion = async ({ wallet, task, now }) => {
  const entries = await readVitals(wallet);
  const today = localDayKey(now);
  const already = (entries || []).some((e) => e?.kind === 'daily'
    && e?.dailyId === task.id && localDayKey(e.occurredAt) === today);
  if (already) return null;
  return appendVital(wallet, {
    kind: 'daily',
    dailyId: task.id,
    title: task.title,
    occurredAt: now,
  });
};

/**
 * The being-ledger completion half: a daily task settled `done` on a being's
 * ledger marks the operator's vessel daily. Callers await and surface
 * failures — the bridge must never break the task settle itself, and a miss
 * is never silent. impure (vitals log).
 * @returns {Promise<Object|null>} the appended entry, or null when skipped
 */
// impure
export const bridgeDailyCompletion = async ({ wallet, neumaId, task, now }) => {
  if (!wallet || !neumaId || task?.cadence !== 'daily' || task?.status !== 'done') return null;
  await ensureDerivedDailies({ wallet, neumaId });
  return appendDailyCompletion({ wallet, task, now });
};

/**
 * The OPERATOR-LIST completion half: a vessel-flagged daily settled `done` on
 * the operator's OWN list (the ME lane) marks the vessel daily. No being lane
 * is involved — the definition sync unions the operator's list alone.
 * impure (vitals log).
 * @returns {Promise<Object|null>} the appended entry, or null when skipped
 */
// impure
export const bridgeMineCompletion = async ({ wallet, task, now }) => {
  if (!wallet || task?.cadence !== 'daily' || task?.status !== 'done' || task?.vessel !== true) return null;
  await ensureDerivedDailies({ wallet });
  return appendDailyCompletion({ wallet, task, now });
};
