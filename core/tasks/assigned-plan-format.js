/**
 * Assigned Plan formatting — the prompt-section renderers extracted verbatim
 * from assigned-plan.js (size-law breakdown, 2026-08-26): the STANDING WORK
 * and OPERATOR LIST sections, the per-task line, and the weekday labeling
 * they ride on. Pure throughout. assigned-plan.js re-exports every public
 * symbol here so its readers (prompt-assembler, witness-prompt, tests) keep
 * their door; this module never imports assigned-plan.js.
 */
import { splitByChat } from './task-chat.js';
import { dueLabel } from './deadline.js';

/** Weekday labels by JS getUTCDay() index (0 = Sunday) — the one naming
 *  source for custom-cadence days everywhere (prompt lines, UI chips). */
export const WEEKDAY_LABELS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/** At most this many open subtasks ride the prompt under one task. */
export const SUBTASK_PROMPT_MAX = 10;

// Mirrors assigned-plan.js's private predicate — the one-line liveness law is
// shared by construction, not by import (this module never imports its origin).
const _isLive = (t) => t.status === 'open';

const CADENCE_ORDER = Object.freeze(['baseline', 'daily', 'custom', 'weekly', 'biweekly', 'monthly', 'once', 'milestone']);

/** A custom task's weekday set as "Mon/Wed/Fri". Pure. */
export const daysLabel = (days) =>
  (Array.isArray(days) ? days : []).map((d) => WEEKDAY_LABELS[d]).filter(Boolean).join('/');

/**
 * One task line.
 *
 * `withId` prints the prefix-8 id — the same short form the ledger prints, so a
 * being is never asked to transcribe a full UUID. It rides STANDING WORK, where
 * the id names what to take up, and THE OPERATOR'S LIST too (2026-09-20): its
 * steps and text became amendable through tasks/operator-update, and an
 * amendment needs the id. The operator's list ids are still NOT takeable —
 * tasks/take reads the standing plan, never this list.
 *
 * `taken` is the set of assignment ids the being currently holds a live copy of
 * on its own ledger. Saying so matters: an assignment being worked right now
 * otherwise reads identically to one nobody has touched, and the being would
 * either take it up twice (refused, but only after it tried) or read its own
 * finished work as still outstanding.
 */
const _line = (t, { withId = false, taken = null } = {}) => {
  const rhythm = t.cadence === 'custom' && t.days?.length ? `custom — ${daysLabel(t.days)}` : t.cadence;
  const id = withId ? `[${String(t.id).slice(0, 8)}] ` : '';
  const hand = taken?.has(t.id) ? ' ← IN HAND on your own list' : '';
  const head = `· ${id}${t.title} (${rhythm})${t.detail ? ` — ${t.detail}` : ''}${dueLabel(t)}${hand}`;
  // The open steps ride indented under their parent (capped — a menu, not a
  // dump); done steps stay quiet until the checklist reopens with its task.
  const openSubs = (t.subtasks || []).filter((s) => s.status === 'open');
  if (openSubs.length === 0) return head;
  const shown = openSubs.slice(0, SUBTASK_PROMPT_MAX).map((s) => `  – ${s.title}`);
  const rest = openSubs.length > SUBTASK_PROMPT_MAX ? [`  – … and ${openSubs.length - SUBTASK_PROMPT_MAX} more steps`] : [];
  return [head, ...shown, ...rest].join('\n');
};

/** Open work, baseline first — the order the operator reads their own list in.
 *  Pure. */
const _byCadence = (tasks) => tasks.slice().sort(
  (a, b) => CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence)
);

const _WHOSE_LIST = 'Your operator keeps this list for you. It is theirs, not yours — your own ledger (Working State) is where you record the work you take on yourself. What stands here is expected of you. TO ACT ON ANY OF IT, TAKE IT UP: a tasks/take intent with the id copies that work onto your own ledger and puts it in your hands, so what you do is recorded against it and an interruption leaves an honest half-finished task. Settle the copy (a tasks/update intent, done) and the assignment below settles with it — that is the only way anything here closes, so nothing you finish should be left standing.';

/**
 * The STANDING WORK prompt section: open tasks only, baseline first. Empty
 * string when nothing is open — an empty section never rides the prompt.
 *
 * Given a chat, the section narrows to work the operator set INSIDE that chat
 * plus whatever they set for the being at large, and says which is which. Work
 * belonging to another chat is not shown: the operator can run a being through
 * several parallel conversations without each one's assignments crowding the
 * others.
 *
 * Without a chat (no live session), nothing is narrowed — the whole plan
 * rides, exactly as before. Pure.
 * @param {{tasks: Array}|null} plan
 * @param {{chatId?: string|null, taken?: Set<string>|null}} [scope] the chat
 *   this turn is speaking in, and the assignment ids the being already holds a
 *   live copy of on its own ledger
 * @returns {string}
 */
export const formatAssignedSection = (plan, { chatId = null, taken = null } = {}) => {
  const live = (plan?.tasks || []).filter(_isLive);
  if (live.length === 0) return '';
  const line = (t) => _line(t, { withId: true, taken });
  if (!chatId) {
    return `## Standing Work (set by your operator)\n${_WHOSE_LIST}\n${_byCadence(live).map(line).join('\n')}`;
  }
  const { here, laneWide } = splitByChat(live, chatId);
  const parts = [];
  if (here.length > 0) {
    parts.push(`## Standing Work (set by your operator, for this chat)\n${_WHOSE_LIST} What follows they set for THIS chat in particular.\n${_byCadence(here).map(line).join('\n')}`);
  }
  if (laneWide.length > 0) {
    parts.push(`## Standing Work (set by your operator, for every chat)\n${here.length > 0 ? 'And this they set for you at large — it stands in every chat you hold.' : `${_WHOSE_LIST} It stands in every chat you hold.`}\n${_byCadence(laneWide).map(line).join('\n')}`);
  }
  // Work assigned only to OTHER chats leaves both blocks empty — and an empty
  // section never rides the prompt.
  return parts.join('\n\n');
};

/**
 * The OPERATOR LIST prompt section: the operator's own open tasks (their life
 * — training, errands, milestones), shown so the being can help carry them:
 * remember, ask after, remind gently, help break the big ones down — and,
 * since 2026-09-20, amend their text and steps at the operator's ask through
 * tasks/operator-update. The being still cannot settle, drop, or re-status
 * any of it — only the operator closes their own list. Empty string when
 * nothing is open. Pure.
 * @param {{tasks: Array}|null} plan
 * @returns {string}
 */
export const formatOperatorSection = (plan) => {
  const live = (plan?.tasks || []).filter(_isLive);
  if (live.length === 0) return '';
  const ordered = _byCadence(live);
  return `## Your Operator's List\nYour operator keeps this list for their own life. Your writes here: tasks/operator-add records something new, and tasks/operator-update amends a task's title, detail, or steps at their ask — subtasks replaces the whole step list, and the receipt shows the list AS STORED, so read it back. You can never settle, drop, or re-status what stands here; only they can. Work you set for YOURSELF goes in your own ledger (tasks/add), never here. What you can always do is remember it, ask after it, remind them gently, and help them break the big ones down.\n${ordered.map((t) => _line(t, { withId: true })).join('\n')}`;
};
