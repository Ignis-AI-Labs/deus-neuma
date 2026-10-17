// house-clock-view.js — the HOUSE CLOCK window's pure display law (Founder,
// 2026-10-16: the house wakes itself […]). Every decision about what the
// operator reads lives here, in plain words, so it is provable with nothing
// faked: where the charter stands, why a wake waits, what a wake did, what
// came back to the operator, and the charter form going both ways.
//
// Pure — no React, no DOM, no fetch.

import { formatDateTime } from '../../../utils/format.js';

/** Money out is the operator's alone; the server always keeps it in `escalate`. */
export const MONEY_OUT = 'intents/wallet.send';

/**
 * Where the charter stands, in plain words. Pure.
 * @param {?Object} charter - the stored record (or null when none was written)
 * @returns {{key: 'none'|'pending'|'approved'|'paused', words: string, detail: string}}
 */
export const charterStatus = (charter) => {
  if (!charter) {
    return { key: 'none', words: 'NO CHARTER', detail: 'Nothing wakes until you write a charter and approve it.' };
  }
  const approvedThis = Boolean(charter.approvedAt) && charter.approvedVersion === charter.version;
  if (!approvedThis) {
    const before = charter.approvedVersion ? ` Version ${charter.approvedVersion} was approved before this edit.` : '';
    return {
      key: 'pending',
      words: `PENDING APPROVAL — VERSION ${charter.version}`,
      detail: `Nothing wakes until you approve this version.${before}`,
    };
  }
  if (charter.paused) {
    return {
      key: 'paused',
      words: `PAUSED — APPROVED AT VERSION ${charter.version}`,
      detail: 'Paused: nothing new wakes. A wake already running finishes on its own.',
    };
  }
  return {
    key: 'approved',
    words: `APPROVED AT VERSION ${charter.version}`,
    detail: `The seats below may wake for their own work. Approved ${formatDateTime(charter.approvedAt)}.`,
  };
};

/**
 * The master switch's face: what pressing it does. Pure.
 * @param {?Object} charter
 * @returns {{label: 'PAUSE'|'RESUME', enabled: boolean, title: string}}
 */
export const pauseSwitch = (charter) => (charter?.paused
  ? { label: 'RESUME', enabled: true, title: 'Let the house wake itself again, inside the charter' }
  : { label: 'PAUSE', enabled: Boolean(charter), title: charter ? 'Stop every new wake now' : 'There is no charter to pause yet' });

/** Why a seat woke, in plain words. Pure. */
const REASONS = Object.freeze({
  post: 'a house post came in',
  dispatch: 'the Optio gave it a task',
  'run-ended': 'a team run it led ended',
  'run-check-in': 'a team run checked in',
  'run-alert': 'a team run raised an alert',
  cadence: 'the Optio\'s regular review',
  'run-lost': 'a team run was cut off by a restart',
  'plan-review': 'a team plan to review',
  'plan-verdict': 'the Optio ruled on its plan',
});

/** @param {string} reason @returns {string} */
export const reasonWords = (reason) => REASONS[reason] || String(reason || 'work').replace(/-/g, ' ');

/**
 * Why a queued wake waits, from the server's own reason. Pure.
 * @param {string} why - the queue's held reason (wake-gate.js runGate)
 * @returns {{key: string, words: string}}
 */
export const heldWords = (why) => {
  const text = String(why || '');
  if (/paused/.test(text)) return { key: 'paused', words: 'PAUSED — the house is paused' };
  if (/unapproved|none/.test(text)) return { key: 'unapproved', words: 'NOT APPROVED — the charter waits for your approval' };
  if (/quiet hours/.test(text)) return { key: 'quiet', words: `QUIET HOURS — ${text.replace(/^quiet hours\s*/, '').replace(/[()]/g, '')}` };
  if (/spent its/.test(text)) return { key: 'cap', words: `DAILY LIMIT REACHED — ${text}` };
  if (/no longer a seat/.test(text)) return { key: 'seat', words: 'NOT A SEAT — the charter no longer lets it wake' };
  if (/not running/.test(text)) return { key: 'clock', words: 'THE HOUSE CLOCK IS NOT RUNNING' };
  return { key: 'other', words: text.toUpperCase() };
};

/** The words for an item whose seat is awake: one wake at a time per seat. */
export const ONE_AT_A_TIME = 'NEXT — this seat is awake now; one wake at a time';

/**
 * How a wake ended, in words and a register (signal = live, alert = failed). Pure.
 * @param {string} outcome
 * @returns {{words: string, register: 'live'|'loud'|'quiet'}}
 */
export const outcomeWords = (outcome) => {
  switch (outcome) {
    case 'done': return { words: 'DONE', register: 'quiet' };
    case 'escalated': return { words: 'SENT SOMETHING TO YOU', register: 'live' };
    case 'failed': return { words: 'FAILED', register: 'loud' };
    case 'lost': return { words: 'LOST TO A RESTART — RUNS AGAIN', register: 'loud' };
    default: return { words: String(outcome || 'unknown').toUpperCase(), register: 'quiet' };
  }
};

/** The outcomes the ledger can be filtered by. */
export const OUTCOMES = Object.freeze(['done', 'escalated', 'failed', 'lost']);

// pure — a seat's display name from the house's lanes
const nameOf = (names, seat) => names?.[seat] || seat;

/**
 * What is awake right now: one row per running seat. Pure.
 * @param {{items: Object[], running: Object}} queue
 * @param {Object<string,string>} names - lane id → display name
 */
export const runningRows = (queue, names) => Object.entries(queue?.running ?? {}).map(([seat, run]) => {
  const first = (queue.items ?? []).find((i) => run.itemIds?.includes(i.id));
  return {
    key: run.wakeId,
    seat,
    name: nameOf(names, seat),
    reason: first ? reasonWords(first.reason) : 'its queued work',
    ref: first?.ref ?? null,
    started: formatDateTime(run.startedAt),
    sessionId: run.sessionId ?? null,
    // started, but still waiting its turn for the model — not yet working
    waitingForLine: run.waitingForLine === true,
  };
});

/**
 * The queue: every waiting item with the reason it waits. Pure.
 * @param {{items: Object[], running: Object, held: Array<{seat: string, why: string}>}} queue
 * @param {Object<string,string>} names
 */
export const queueRows = (queue, names) => {
  const running = queue?.running ?? {};
  const held = new Map((queue?.held ?? []).map((h) => [h.seat, h.why]));
  return (queue?.items ?? [])
    .filter((i) => !running[i.seat]?.itemIds?.includes(i.id))
    .map((i) => {
      const wait = running[i.seat]
        ? { key: 'one-at-a-time', words: ONE_AT_A_TIME }
        : held.has(i.seat) ? heldWords(held.get(i.seat)) : { key: 'ready', words: 'ABOUT TO WAKE' };
      return {
        key: i.id, seat: i.seat, name: nameOf(names, i.seat), reason: reasonWords(i.reason),
        ref: i.ref, queued: formatDateTime(i.queuedAt), wait,
      };
    });
};

/**
 * One wake on the ledger as the operator reads it. Pure.
 * @param {Object} row - a wake-ledger row
 * @param {Object<string,string>} names
 */
export const ledgerRow = (row, names) => {
  const items = Array.isArray(row?.items) && row.items.length ? row.items : [{ reason: row?.reason, ref: row?.ref }];
  return {
    key: row.id,
    seat: row.seat,
    name: nameOf(names, row.seat),
    reasons: items.map((i) => `${reasonWords(i.reason)}${i.ref ? ` [${i.ref}]` : ''}`),
    started: formatDateTime(row.startedAt),
    ended: row.endedAt ? formatDateTime(row.endedAt) : null,
    outcome: outcomeWords(row.outcome),
    acts: (row.acts ?? []).map((a) => `${a.tool} — ${String(a.decision || a.status || '').replace(/[-_]/g, ' ')}`),
    escalations: (row.escalations ?? []).length,
    sessionId: row.sessionId ?? null,
    note: row.note ?? row.error ?? null,
  };
};

/**
 * One ask a wake sent back to the operator. Pure.
 * @param {Object} ask - an asks.jsonl row (closed ones carry status 'closed')
 * @param {Object<string,string>} names
 */
export const askRow = (ask, names) => ({
  key: ask.id,
  seat: ask.seat,
  name: nameOf(names, ask.seat),
  what: ask.kind === 'plan' ? `a team plan${ask.planId ? ` (${ask.planId})` : ''}` : ask.tool || 'an act',
  scope: ask.scope ?? null,
  why: ask.why || '',
  at: formatDateTime(ask.at),
  open: ask.status !== 'closed',
  closed: ask.status === 'closed' ? `CLOSED ${formatDateTime(ask.closedAt)}${ask.closeNote ? ` — ${ask.closeNote}` : ''}` : null,
  sessionId: ask.sessionId ?? null,
});

/** How many asks still wait on the operator. Pure. */
export const openAskCount = (asks) => (asks ?? []).filter((a) => a.status !== 'closed').length;

// pure — text area lines, trimmed, blanks dropped
const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * The charter as the form edits it. Every house lane gets a row; a lane the
 * charter names is on, with its cap. Pure.
 * @param {?Object} charter
 * @param {Array<{neumaId: string}>} lanes
 */
export const draftFromCharter = (charter, lanes) => ({
  goal: charter?.goal ?? '',
  linesOfWork: (charter?.linesOfWork ?? []).join('\n'),
  seats: Object.fromEntries([
    ...(lanes ?? []).map((l) => l.neumaId),
    ...(charter?.seats ?? []).map((s) => s.laneId),
  ].map((id) => {
    const seat = charter?.seats?.find((s) => s.laneId === id);
    return [id, { on: Boolean(seat), cap: String(seat?.dailyCap ?? 3) }];
  })),
  quietOn: Boolean(charter?.quietHours),
  quietStart: charter?.quietHours?.start ?? '22:00',
  quietEnd: charter?.quietHours?.end ?? '07:00',
  cadenceOn: Boolean(charter?.cadence),
  cadenceHours: String(charter?.cadence?.everyHours ?? 24),
  teamPlans: charter?.delegation?.teamPlans === true,
  maxMembers: String(charter?.delegation?.maxMembers ?? 4),
  maxSteps: String(charter?.delegation?.maxSteps ?? 8),
  allow: (charter?.allow ?? []).join('\n'),
  // Money out is fixed in escalate by the server; the form shows it as a rule, not a line to delete.
  escalate: (charter?.escalate ?? []).filter((id) => id !== MONEY_OUT).join('\n'),
});

/**
 * The form back into the charter's fields, exactly as the server reads them
 * (charter-shape.js judges them; the window shows its refusal). Pure.
 * @param {ReturnType<typeof draftFromCharter>} draft
 */
export const charterFromDraft = (draft) => ({
  goal: draft.goal.trim(),
  linesOfWork: lines(draft.linesOfWork),
  seats: Object.entries(draft.seats).filter(([, s]) => s.on).map(([laneId, s]) => ({ laneId, dailyCap: Number(s.cap) })),
  quietHours: draft.quietOn ? { start: draft.quietStart, end: draft.quietEnd } : null,
  cadence: draft.cadenceOn ? { everyHours: Number(draft.cadenceHours) } : null,
  delegation: { teamPlans: draft.teamPlans, maxMembers: Number(draft.maxMembers), maxSteps: Number(draft.maxSteps) },
  allow: lines(draft.allow),
  escalate: lines(draft.escalate),
});

/**
 * The charter read back in plain sentences, for the approval view. Pure.
 * @param {Object} charter
 * @param {Object<string,string>} names
 * @returns {Array<{label: string, value: string}>}
 */
export const charterLines = (charter, names) => [
  { label: 'GOAL', value: charter.goal },
  { label: 'LINES OF WORK', value: charter.linesOfWork?.length ? charter.linesOfWork.join(' · ') : 'none named' },
  {
    label: 'MAY WAKE',
    value: charter.seats.map((s) => `${nameOf(names, s.laneId)} — up to ${s.dailyCap} a day`).join(' · '),
  },
  { label: 'QUIET HOURS', value: charter.quietHours ? `${charter.quietHours.start} to ${charter.quietHours.end}, nothing wakes` : 'none' },
  { label: 'OPTIO REVIEW', value: charter.cadence ? `every ${charter.cadence.everyHours} hours` : 'no regular review' },
  {
    label: 'THE OPTIO MAY APPROVE',
    value: charter.delegation?.teamPlans
      ? `team plans of up to ${charter.delegation.maxMembers} members and ${charter.delegation.maxSteps} steps`
      : 'nothing — every plan comes to you',
  },
  { label: 'ALLOWED WITHOUT ASKING', value: charter.allow?.length ? charter.allow.join(' · ') : 'nothing' },
  { label: 'ALWAYS COMES TO YOU', value: charter.escalate.join(' · ') },
];
