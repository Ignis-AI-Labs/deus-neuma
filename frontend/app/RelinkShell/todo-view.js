// todo-view.js — every presentation decision for TASKS, the standing-work
// window. Pure: a plan goes in, render-ready groups come out. Recurrence
// (daily/weekly reopening) is materialized server-side on read — the view
// only displays what the plan honestly holds: a done daily waiting for
// tomorrow is SETTLED, and the row says when it comes back.

import { chatOf, isLaneWide } from '../../../core/tasks/task-chat.js';
import { taskState, isChecked, workSummary, focusedIds } from '../../../core/tasks/task-work.js';
import { blockersOf, sizeLabel, orderBySize } from '../../../core/tasks/task-order.js';
import { formatDateTime } from '../../utils/format.js';

export const CADENCE_ORDER = Object.freeze(['baseline', 'daily', 'custom', 'weekly', 'biweekly', 'monthly', 'once', 'milestone']);

/** The bucket id for work that belongs to no single chat. Not a chat id — the
 *  store writes NO key at all for lane-wide work — so it is spelled in a way a
 *  session id never can be (a session id is `session-<ms>`). */
export const LANE_WIDE = '__every_chat__';

const CADENCE_LABELS = Object.freeze({
  baseline: 'BASELINE',
  daily: 'DAILY',
  weekly: 'WEEKLY',
  biweekly: 'BIWEEKLY',
  monthly: 'MONTHLY',
  custom: 'CUSTOM',
  once: 'ONCE',
  milestone: 'MILESTONE',
});

/** How each order reads on a control. Lives here rather than in either
 *  surface, so the rail and the window can never label the same stored choice
 *  two different ways. */
export const ORDER_WORDS = Object.freeze({
  mine: 'MY ORDER',
  heaviest: 'HEAVIEST',
  lightest: 'LIGHTEST',
});

/** Weekday labels by getDay() index — mirrors core's WEEKDAY_LABELS. */
export const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/**
 * A custom task's weekday set as 'MON/WED/FRI' for the data register; empty
 * string when the task carries no days (never a fabricated schedule).
 * @param {{days?: Array<number>}} task
 * @returns {string}
 */
export const customDaysLabel = (task) =>
  (Array.isArray(task?.days) ? task.days : [])
    .map((d) => WEEKDAYS[d])
    .filter(Boolean)
    .map((d) => d.toUpperCase())
    .join('/');

/**
 * The cadence's display label in the data register. An unrecognized cadence
 * still prints as itself (uppercased) — never a fabricated one.
 * @param {string} cadence
 * @returns {string}
 */
export const cadenceLabel = (cadence) =>
  CADENCE_LABELS[cadence] || String(cadence ?? '—').toUpperCase();

/**
 * Open tasks grouped by cadence in CADENCE_ORDER; a group with nothing open
 * is omitted entirely (an empty header is a claim without evidence).
 * @param {Array<{status: string, cadence: string}>} tasks
 * @returns {Array<{cadence: string, tasks: Array<object>}>}
 */
export const groupLiveTasks = (tasks, order = 'mine') =>
  CADENCE_ORDER
    .map((cadence) => ({
      cadence,
      // The operator's chosen order applies INSIDE a cadence group, never
      // across them: a rhythm is not a weight, and reordering the groups
      // themselves would mean a daily could hide under a milestone.
      tasks: orderBySize(
        (Array.isArray(tasks) ? tasks : []).filter(
          (t) => t.status === 'open' && t.cadence === cadence,
        ),
        order,
      ),
    }))
    .filter((g) => g.tasks.length > 0);

/**
 * The settled foot — done and dropped together, most recently touched first.
 * @param {Array<{status: string, updatedAt: string}>} tasks
 * @returns {Array<object>}
 */
export const settledTasks = (tasks) =>
  (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t.status === 'done' || t.status === 'dropped')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

/**
 * When in the day a task sits, as a row reads it: a block's span
 * ("17:00–18:15"), a deadline's time ("BY 21:00"), or '' when it has none.
 * Pure.
 * @param {{startTime?: string, dueTime?: string}} task
 */
export const timeLabel = (task) => {
  if (task?.startTime && task?.dueTime) return `${task.startTime}–${task.dueTime}`;
  return task?.dueTime ? `BY ${task.dueTime}` : '';
};

/**
 * A milestone past its due date, still open. Date-only comparison against the
 * local day key — a task due today is not yet late.
 * @param {{cadence: string, status: string, dueDate?: string}} task
 * @param {string} today local 'YYYY-MM-DD'
 * @returns {boolean}
 */
export const isOverdue = (task, today) =>
  task?.cadence === 'milestone'
  && task?.status === 'open'
  && Boolean(task.dueDate)
  && task.dueDate < today;

/**
 * When a settled recurring task comes back — done dailies/weeklies are only
 * resting until the server reopens them. One-shots and drops stay silent.
 * @param {{status: string, cadence: string}} task
 * @returns {string|null}
 */
export const resetHint = (task) => {
  if (task?.status !== 'done') return null;
  if (task.cadence === 'daily') return 'reopens tomorrow';
  if (task.cadence === 'weekly') return 'reopens next week';
  if (task.cadence === 'biweekly') return 'reopens next fortnight';
  if (task.cadence === 'monthly') return 'reopens next month';
  if (task.cadence === 'custom') {
    const label = customDaysLabel(task);
    return label ? `reopens ${label}` : null;
  }
  return null;
};

/**
 * The local calendar day as 'YYYY-MM-DD' — the key overdue comparison and the
 * date input both speak. Local, not UTC: a milestone due "today" means the
 * witness's today.
 * @param {Date} [date]
 * @returns {string}
 */
export const todayKey = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * The being's own self-taken work (its task ledger) for the THEIR OWN WORK
 * section, in two registers: live = what it is being worked, then interrupted,
 * then merely taken on, then what cannot be started; settled = done and
 * dropped, most recently touched first, capped (the deep record lives in the
 * lane's HISTORY drawer, not here).
 *
 * PARITY WITH THE STREAM RAIL is the point (ruling, 2026-08-03): the window used
 * to render bare status while the rail read derived state, so the same task
 * described itself two different ways depending on where you looked.
 *
 * Each row keeps the task and adds what the surface reads: `state`, `checked`,
 * `size`, the `blockers` still in its way, and the `work` already done against
 * it. The task itself is passed through untouched so callers keep everything
 * they had.
 *
 * FOCUS IS ASKED WITHOUT A CHAT here, unlike the rail. The window looks at
 * every chat at once, so […] is the honest question —
 * a task under way in a parallel conversation is still under way.
 *
 * @param {Array<object>} tasks the lane's own ledger tasks
 * @param {number} [settledMax] how many settled rows the section shows
 * @param {{ledger?: object, order?: string}} [opts] `ledger` carries the focus
 *   map (and is the whole list blockers resolve against)
 * @returns {{live: Array<object>, settled: Array<object>}}
 */
export const ledgerRows = (tasks, settledMax = 10, { ledger = null, order = 'mine' } = {}) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const whole = Array.isArray(ledger?.tasks) ? ledger.tasks : list;
  const focused = focusedIds(ledger);
  const rank = { 'in-progress': 0, interrupted: 1, active: 2, open: 3 };
  const decorate = (task) => {
    const blockers = blockersOf(task, whole).map((b) => ({ id: b.id, title: b.title }));
    return {
      ...task,
      // `streaming: true` because a task a chat holds in focus IS the work in
      // hand — the window has no live-turn signal to distinguish a paused
      // conversation, and calling focused work "interrupted" would be worse.
      state: taskState(task, { focusedId: focused.has(task.id) ? task.id : null, streaming: true }),
      checked: isChecked(task),
      size: sizeLabel(task),
      blockers,
      work: workSummary(task),
    };
  };
  const live = orderBySize(list.filter((t) => t.status === 'active' || t.status === 'open'), order)
    .map((t, i) => ({ r: decorate(t), i }))
    .map(({ r, i }) => ({ r, i, k: (rank[r.state] ?? 4) + (r.blockers.length > 0 ? 10 : 0) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((d) => d.r);
  const settled = list
    .filter((t) => t.status === 'done' || t.status === 'dropped')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, settledMax)
    .map(decorate);
  return { live, settled };
};

/**
 * A ledger task's display kind: the recurring cadences pass through; anything
 * else (absent cadence, a legacy one-off, an unrecognized value) is ONCE —
 * the honest reading of […].
 * @param {{cadence?: string}} task
 * @returns {'daily'|'weekly'|'once'}
 */
export const ledgerKind = (task) =>
  (task?.cadence === 'daily' || task?.cadence === 'weekly' ? task.cadence : 'once');

/**
 * A settled date as 'MM-DD' — the compact stamp on settled ledger rows and
 * history lines. Local, like todayKey; garbage in, empty string out (the row
 * simply carries no date rather than a fabricated one).
 * @param {*} iso
 * @returns {string}
 */
export const shortDate = (iso) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * A task's checklist as a progress count: how many steps are still open out
 * of the total. A task with no steps reports { open: 0, total: 0 } — the row
 * shows no badge rather than a hollow 0/0.
 * @param {{subtasks?: Array<{status: string}>}} task
 * @returns {{open: number, total: number}}
 */
export const subtaskProgress = (task) => {
  const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];
  return {
    open: subtasks.filter((s) => s.status === 'open').length,
    total: subtasks.length,
  };
};

/**
 * The scope chips under the switcher: the linked being first (the one the
 * stream is bound to), the rest of the house alphabetical by name.
 * @param {Array<{neumaId: string, name?: string}>} roster
 * @param {{neumaId: string}|null} active
 * @returns {Array<object>}
 */
export const orderedScopes = (roster, active) => {
  const list = Array.isArray(roster) ? roster : [];
  return [...list].sort((a, b) => {
    if (a.neumaId === active?.neumaId) return -1;
    if (b.neumaId === active?.neumaId) return 1;
    return String(a.name || a.neumaId).localeCompare(String(b.name || b.neumaId));
  });
};

/**
 * The window's scope tabs after ME: the HOUSE first, then the sealed WITNESS
 * lanes, each group ordered by orderedScopes (linked being first, then
 * alphabetical). The two groups stay separate because the standings are
 * separate — a witness stands BESIDE the house, never in it
 * (docs/protocols/sovereignty-boundary.md) — and the tab carries its `kind` so the row
 * can say which it is instead of the operator having to remember.
 * @param {Array<{neumaId: string, name?: string}>} roster house neuma
 * @param {Array<{neumaId: string, name?: string}>} witnesses sealed lanes
 * @param {{neumaId?: string}|null} active the being the stream is linked to
 * @returns {Array<{neumaId: string, name?: string, kind: ('neuma'|'witness')}>}
 */
export const scopeRows = (roster, witnesses, active) => [
  ...orderedScopes(roster, active).map((m) => ({ ...m, kind: 'neuma' })),
  ...orderedScopes(witnesses, active).map((m) => ({ ...m, kind: 'witness' })),
];

/**
 * Which standing a lane belongs to: the operator's own list, the house, or the
 * witnesses beside it. Drives the window's standing switch, and restores it
 * when the stream's rail opens the window ON a being.
 * @param {string} scope 'me' or a lane id
 * @param {Array<{neumaId: string}>} witnesses
 * @returns {'me'|'house'|'witnesses'}
 */
export const standingOf = (scope, witnesses) => {
  if (!scope || scope === 'me') return 'me';
  return (Array.isArray(witnesses) ? witnesses : []).some((w) => w?.neumaId === scope)
    ? 'witnesses'
    : 'house';
};

/**
 * A chat's display name: the operator's own label for it when they gave one,
 * otherwise the sitting's date and time (a session id is `session-<ms>`).
 * Never the raw id if it can be helped — that is a token, not a name.
 * @param {string} chatId
 * @param {{labels?: Object, neumaId?: string|null}} [ctx] labels keyed `<neumaId>:<sessionId>`
 * @returns {string}
 */
export const chatLabel = (chatId, { labels = {}, neumaId = null } = {}) => {
  if (!chatId || chatId === LANE_WIDE) return 'EVERY CHAT';
  const own = labels?.[`${neumaId}:${chatId}`];
  if (own) return String(own).toUpperCase();
  const ms = Number(String(chatId).replace('session-', ''));
  return Number.isFinite(ms) && ms > 0 ? formatDateTime(ms).toUpperCase() : String(chatId).toUpperCase();
};

/** Newest chat first; the lane-wide bucket always sits last, because it is not
 *  a sitting and has no place in a chronology. Pure. */
const _chatRank = (chatId) => {
  if (chatId === LANE_WIDE) return -Infinity;
  const ms = Number(String(chatId).replace('session-', ''));
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * Open tasks grouped BY CHAT, cadence groups inside each — the shape Founder asked
 * the TASKS window to take (2026-08-01): […]
 *
 * A chat with nothing open is omitted entirely (an empty header is a claim
 * with no evidence), so this returns only chats that genuinely hold work. The
 * chat the stream is bound to sorts first — it is the one you are in — then
 * the rest newest-first, then the lane-wide bucket.
 *
 * @param {Array<object>} tasks the lane's tasks (any status; only open ones group)
 * @param {{labels?: Object, neumaId?: string|null, activeChatId?: string|null}} [ctx]
 * @returns {Array<{chatId: string, label: string, isLaneWide: boolean, isActive: boolean,
 *   live: number, groups: Array<{cadence: string, tasks: Array<object>}>}>}
 */
export const groupTasksByChat = (tasks, { labels = {}, neumaId = null, activeChatId = null, order = 'mine' } = {}) => {
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => t?.status === 'open');
  const byChat = new Map();
  for (const task of open) {
    const key = isLaneWide(task) ? LANE_WIDE : chatOf(task);
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key).push(task);
  }
  return [...byChat.entries()]
    .map(([chatId, list]) => ({
      chatId,
      label: chatLabel(chatId, { labels, neumaId }),
      isLaneWide: chatId === LANE_WIDE,
      isActive: chatId === activeChatId,
      live: list.length,
      groups: groupLiveTasks(list, order),
    }))
    .sort((a, b) => {
      // The chat you are standing in comes first — it is the one you are in.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return _chatRank(b.chatId) - _chatRank(a.chatId);
    });
};

/**
 * The chats the operator may file NEW work under: every sitting this being has
 * held, newest first, plus EVERY CHAT. The live chat is marked so the form can
 * default to it — filing into the conversation you are in is the common case.
 * @param {Array<{sessionId: string}>} sessions
 * @param {{labels?: Object, neumaId?: string|null, activeChatId?: string|null}} [ctx]
 * @returns {Array<{value: string, label: string, isActive: boolean}>}
 */
export const chatChoices = (sessions, { labels = {}, neumaId = null, activeChatId = null } = {}) => {
  const listed = (Array.isArray(sessions) ? sessions : [])
    .map((s) => (typeof s === 'string' ? s : s?.sessionId))
    .filter(Boolean);
  // The chat you are STANDING IN always stands, even before the session list
  // lands (or if it never does). The form defaults to it, and a default that
  // is not among the options renders as no selection at all.
  const rows = [...new Set(activeChatId ? [activeChatId, ...listed] : listed)]
    .sort((a, b) => _chatRank(b) - _chatRank(a))
    .map((sessionId) => ({
      value: sessionId,
      label: chatLabel(sessionId, { labels, neumaId }),
      isActive: sessionId === activeChatId,
    }));
  return [{ value: LANE_WIDE, label: 'EVERY CHAT', isActive: false }, ...rows];
};
