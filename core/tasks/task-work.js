/**
 * TASK FLOW — what is in focus, what was actually worked, and what was left
 * half-finished. Pure.
 *
 * Design note, 2026-08-02: […]
 *
 * Three ideas, deliberately separate:
 *
 *   FOCUS is a POINTER, not a status. One task per (lane, chat) is the thing
 *   being worked right now. Keeping it off the task record means a task's own
 *   fields stay about the task, and two chats can hold two different focuses
 *   without either editing the other's rows.
 *
 *   WORK is a RECORD on the task — first touch, last touch, and the artifacts
 *   the being actually produced. It is appended by the platform as the being
 *   acts, because the failure this exists for happens BETWEEN turns: a crash, a
 *   rate wall, an operator going to sleep. Anything the being had to remember
 *   to declare is exactly the thing that never gets declared.
 *
 *   INTERRUPTED is DERIVED, never stored. A task that is `active`, carries
 *   work, and is not the live turn's focus IS interrupted — because a live turn
 *   would still be writing to it. Deriving it means a crash needs no cleanup
 *   handler to leave an honest state; the absence of further writes IS the
 *   signal. A stored flag would have to be cleared by the very process that
 *   died.
 */
import { blockersOf, blockedReason } from './task-order.js';

/** How many artifacts one task keeps. Enough to see the shape of the work. */
export const WORK_ARTIFACT_CAP = 40;

/** The kinds of act worth recording against a task. */
export const ARTIFACT_KINDS = Object.freeze(['wrote', 'made', 'ran', 'read', 'posted']);

/**
 * The focus map, normalized. Pure.
 * Absence is "nothing in focus" — never an error, because most chats have none.
 * @param {object} ledger
 * @returns {Record<string, string>} chatId → taskId
 */
export const focusMap = (ledger) => {
  const raw = ledger?.focus;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
};

/**
 * Which task this chat is working, or null. Pure.
 * @param {object} ledger
 * @param {string|null} chatId
 * @returns {string|null}
 */
export const focusedTaskId = (ledger, chatId) => {
  if (!chatId) return null;
  const id = focusMap(ledger)[chatId];
  return typeof id === 'string' && id ? id : null;
};

/**
 * Every task ANY chat currently has in focus. Pure.
 *
 * For surfaces that show the whole ledger at once (the TASKS window) rather
 * than standing inside one conversation. Asking […] without
 * naming a chat is the right question there — the window is looking at all of
 * them, and a task being worked in a parallel chat is still being worked.
 * @param {object} ledger
 * @returns {Set<string>}
 */
export const focusedIds = (ledger) =>
  new Set(Object.values(focusMap(ledger)).filter((id) => typeof id === 'string' && id));

/**
 * Point this chat's focus at a task, or clear it with `null`. PURE — returns a
 * new ledger.
 *
 * Setting focus on a task that is not live is refused: focusing a done task
 * would make […] answer with something already finished.
 * Focusing also flips an `open` task to `active`, because that is what focusing
 * MEANS — the operator should not have to say it twice.
 *
 * BLOCKED WORK IS REFUSED HERE, not merely sorted down (Design note, 2026-08-03: […]). This is the door that matters, because focusing
 * is what makes work start being recorded against a task — a blocked task that
 * could still be focused would collect real artifacts for work that was not
 * supposed to have begun. The refusal names what it waits on, so the answer to
 * […] arrives with the no.
 *
 * @param {{tasks: Array}} ledger
 * @param {{chatId: string, taskId: string|null}} args
 * @param {{now: string}} stamp
 * @returns {{ok: boolean, ledger: object, error?: string}}
 */
export const setFocus = (ledger, { chatId, taskId }, { now }) => {
  const base = { ...(ledger || {}), tasks: [...(ledger?.tasks || [])] };
  if (!chatId) return { ok: false, ledger: base, error: 'focus needs a chat' };

  const map = { ...focusMap(ledger) };
  if (taskId === null) {
    delete map[chatId];
    return { ok: true, ledger: { ...base, focus: map } };
  }

  const i = base.tasks.findIndex((t) => t.id === taskId);
  if (i === -1) return { ok: false, ledger: base, error: 'no such task' };
  const task = base.tasks[i];
  if (task.status === 'done' || task.status === 'dropped') {
    return { ok: false, ledger: base, error: `that task is already ${task.status}` };
  }
  const blockers = blockersOf(task, base.tasks);
  if (blockers.length > 0) {
    return { ok: false, ledger: base, error: blockedReason(blockers) };
  }

  if (task.status === 'open') {
    base.tasks[i] = { ...task, status: 'active', updatedAt: now };
  }
  map[chatId] = taskId;
  return { ok: true, ledger: { ...base, focus: map } };
};

/**
 * Record one real act against the focused task. PURE — returns a new ledger.
 *
 * A no-op when nothing is in focus: work is only attributable when the operator
 * (or the being) has said what it belongs to. Guessing an owner would put a
 * being's file write under whatever task happened to be open, which is worse
 * than recording nothing.
 *
 * Consecutive identical acts collapse into one with a count, so a loop that
 * writes the same file forty times does not evict the rest of the history.
 *
 * @param {{tasks: Array}} ledger
 * @param {{chatId: string, kind: string, target: string}} act
 * @param {{now: string}} stamp
 * @returns {{ledger: object, recorded: boolean}}
 */
export const recordWork = (ledger, { chatId, kind, target }, { now }) => {
  const base = { ...(ledger || {}), tasks: [...(ledger?.tasks || [])] };
  const taskId = focusedTaskId(ledger, chatId);
  if (!taskId) return { ledger: base, recorded: false };

  const i = base.tasks.findIndex((t) => t.id === taskId);
  if (i === -1) return { ledger: base, recorded: false };

  const cleanKind = ARTIFACT_KINDS.includes(kind) ? kind : 'ran';
  const cleanTarget = String(target ?? '').trim().slice(0, 300);
  if (!cleanTarget) return { ledger: base, recorded: false };

  const prev = base.tasks[i];
  const work = prev.work && typeof prev.work === 'object' ? prev.work : null;
  const artifacts = Array.isArray(work?.artifacts) ? [...work.artifacts] : [];

  const last = artifacts[artifacts.length - 1];
  if (last && last.kind === cleanKind && last.target === cleanTarget) {
    artifacts[artifacts.length - 1] = { ...last, count: (last.count || 1) + 1, at: now };
  } else {
    artifacts.push({ kind: cleanKind, target: cleanTarget, at: now });
  }

  base.tasks[i] = {
    ...prev,
    work: {
      firstAt: work?.firstAt || now,
      lastAt: now,
      // Newest wins on overflow: what was just being worked matters more for
      // […] than the first thing touched an hour ago.
      artifacts: artifacts.slice(-WORK_ARTIFACT_CAP),
    },
  };
  return { ledger: base, recorded: true };
};

/**
 * How a task should READ right now. Pure — the whole display law in one place.
 *
 * @param {object} task
 * @param {{focusedId?: string|null, streaming?: boolean}} ctx
 *   `focusedId` is this chat's focus; `streaming` is whether a turn is live.
 * @returns {'done'|'dropped'|'in-progress'|'interrupted'|'active'|'open'}
 */
export const taskState = (task, ctx = {}) => {
  const status = task?.status;
  if (status === 'done' || status === 'dropped') return status;

  const isFocus = Boolean(ctx.focusedId) && ctx.focusedId === task?.id;
  if (isFocus && ctx.streaming) return 'in-progress';

  // Worked, still `active`, and nothing is writing to it — the crash case. A
  // live turn would be appending; the silence is the evidence.
  const worked = Array.isArray(task?.work?.artifacts) && task.work.artifacts.length > 0;
  if (worked && status === 'active') return 'interrupted';

  return status === 'active' ? 'active' : 'open';
};

/** True when a task's box should read as ticked. Pure. */
export const isChecked = (task) => task?.status === 'done';

/**
 * The one-line summary of what was done to a task, or null. Pure.
 * Last-touch paths ride so a compacted wake still sees the files, not just
 * that "4 acts happened".
 * @param {object} task
 * @returns {{count: number, kinds: string[], firstAt: string, lastAt: string, targets: string[]}|null}
 */
export const workSummary = (task) => {
  const artifacts = task?.work?.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  const targets = [];
  for (let i = artifacts.length - 1; i >= 0 && targets.length < 6; i -= 1) {
    const target = artifacts[i]?.target;
    if (typeof target === 'string' && target && !targets.includes(target)) targets.push(target);
  }
  return {
    count: artifacts.reduce((n, a) => n + (a.count || 1), 0),
    kinds: [...new Set(artifacts.map((a) => a.kind))],
    firstAt: task.work.firstAt,
    lastAt: task.work.lastAt,
    targets,
  };
};


/**
 * Does an incoming intent already have a task? Pure.
 *
 * Design note, 2026-08-02: […] This is the machine half of that protocol — the prompt asks
 * the being to look, and this is what looking uses.
 *
 * Deliberately a LOOSE match returning candidates rather than a verdict: an
 * automatic […] would be wrong often enough to be
 * infuriating, and the being is the one who can actually tell.
 *
 * @param {Array} tasks
 * @param {string} title
 * @returns {Array<{id: string, title: string, status: string, score: number}>} best first
 */
export const findSimilarTasks = (tasks, title) => {
  const words = _words(title);
  if (words.length === 0) return [];
  const out = [];
  for (const t of tasks || []) {
    if (t.status === 'dropped') continue;
    const theirs = _words(t.title);
    if (theirs.length === 0) continue;
    const shared = words.filter((w) => theirs.includes(w));
    // Jaccard over the union, so a short title cannot score high just by being
    // short and a long one is not penalized for detail.
    const union = new Set([...words, ...theirs]).size;
    const score = shared.length / union;
    if (score >= 0.34) out.push({ id: t.id, title: t.title, status: t.status, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
};

// pure — content words, lowercased, stopwords dropped so "the"/"and" cannot
// manufacture a match between unrelated titles.
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at',
  'with', 'is', 'be', 'it', 'this', 'that', 'from', 'by', 'up', 'out', 'as', 'our']);
const _words = (s) => [...new Set(
  String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w)),
)];

/**
 * What a real tool call did, as a work artifact — or null when it is not the
 * kind of act worth remembering against a task. Pure.
 *
 * This is the translation layer between the TOOL surface (which changes as
 * tools come and go) and the WORK record (which must stay stable, because it is
 * what a crashed task is read back from months later). Keeping it pure means
 * the mapping is provable without running a single tool.
 *
 * An unrecognized tool is `ran` against its own name rather than dropped: the
 * evidence that SOMETHING happened is the point, and a new tool nobody taught
 * this function about should still leave a trace.
 *
 * @param {string} toolName
 * @param {object} [args] the call's arguments — the target is read from these
 * @returns {{kind: string, target: string}|null}
 */
export const artifactFor = (toolName, args = {}) => {
  const name = String(toolName ?? '').trim();
  if (!name) return null;

  // Task bookkeeping is not work ON a task — recording it would make every
  // ledger read look like progress, and a task would appear worked simply
  // because the being looked at its own list.
  if (name.startsWith('task_') || name === 'operator_task_add' || name === 'witness_task_add') return null;

  const a = args && typeof args === 'object' ? args : {};
  const path = [a.path, a.file_path, a.filePath, a.target, a.directory, a.url, a.query]
    .find((v) => typeof v === 'string' && v.trim());

  const kind = /^(write|edit|append|apply|patch)/.test(name) ? 'wrote'
    : /^(create|make|mkdir|generate|render|forge)/.test(name) ? 'made'
      : /^(read|list|search|fetch|get|view|map)/.test(name) ? 'read'
        : /(^post|_post$|^queue_post|^publish)/.test(name) ? 'posted'
          : 'ran';

  return { kind, target: (path || name).slice(0, 300) };
};
