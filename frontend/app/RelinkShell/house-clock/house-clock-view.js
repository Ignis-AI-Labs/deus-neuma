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
 * @param {?Object|undefined} charter - the stored record; null when none was
 *   written, undefined while the window has not read it (a failed read is
 *   never "no charter")
 * @returns {{key: 'unread'|'none'|'pending'|'approved'|'paused', words: string, detail: string}}
 */
export const charterStatus = (charter) => {
  if (charter === undefined) {
    return { key: 'unread', words: 'CHARTER NOT READ YET', detail: 'The charter has not been read yet. Nothing here can change it until it is.' };
  }
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
 * What the house lacks to do its work, beside the charter — said under the
 * standing, never left for the operator to discover (2026-10-18: a house with
 * no shared ground silently lost its board, its post and its charges). Said
 * with no charter too: the header already says NO CHARTER, and these say what
 * else is missing. Whether the charter seats the Optio waits for a charter; a
 * reading not yet in says nothing. A model line of one slot is said too: the
 * house's wakes then take turns with the operator's chat (substrate-line.js). Pure.
 * @param {?Object} charter
 * @param {?{ground: ?string, optio: ?string, lineSlots?: number}} readiness - GET /charter's readiness
 * @returns {Array<{key: 'ground'|'optio'|'optio-seat'|'one-slot', words: string}>}
 */
export const readinessWarnings = (charter, readiness) => {
  if (!readiness) return [];
  const out = [];
  if (!readiness.ground) {
    out.push({ key: 'ground', words: 'NO HOUSE GROUND — the Optio cannot charge members, post, or keep the board. Set it in the HOUSE window (grounds).' });
  }
  if (!readiness.optio) {
    out.push({ key: 'optio', words: 'NO OPTIO SEATED — the review cadence wakes no one, and team plans come to you.' });
  } else if (charter && !(charter.seats ?? []).some((s) => s.laneId === readiness.optio)) {
    out.push({ key: 'optio-seat', words: 'THE OPTIO HOLDS NO SEAT IN THIS CHARTER — the review cadence wakes no one until the charter seats them.' });
  }
  if (readiness.lineSlots === 1) {
    out.push({ key: 'one-slot', words: 'ONE SLOT ON THE MODEL LINE — house wakes run one at a time and take turns with your chat, first come first served: a wake waits for a reply in progress, and your next message waits for a wake at work.' });
  }
  return out;
};

/**
 * The words beside the Optio's own seat in the charter form: what the office
 * does in house work (optio-review.js actRoute; the dispatch and the plans it
 * may approve), and that the office is the member's own to accept — the desk
 * records no yes from them, so the operator asks first.
 */
export const OPTIO_SEAT_NOTE = 'THE OPTIO — in house work it reviews the members\' gated acts the charter neither allows nor sends to you (CLEAR lets one go on, HOLD brings it to you), and assigns members their work: charges, and team plans inside this charter\'s limits when you let it approve them. The office is the member\'s own to accept: seat them in the CHIEF OF STAFF window once they have said yes — the desk does not ask them for you.';

/**
 * Whether the Optio's review cadence, as drafted, wakes her more times a day
 * than her daily limit lets her — said at save, never refused: the limit
 * still holds (wake-gate.js runGate), so a review past it waits for the next
 * local day. Null when it fits, when no cadence is on, when the Optio holds
 * no seat in the draft or none is seated, or while a number is half typed. Pure.
 * @param {ReturnType<typeof draftFromCharter>} draft
 * @param {?string} optio - the seated Optio's lane (GET /charter readiness)
 * @param {Object<string,string>} names
 * @returns {?string}
 */
export const cadenceCapWarning = (draft, optio, names) => {
  const seat = optio ? draft?.seats?.[optio] : null;
  const hours = Number(draft?.cadenceHours);
  const cap = Number(seat?.cap);
  if (!draft?.cadenceOn || !seat?.on || !(Number.isInteger(hours) && hours >= 1) || !(Number.isInteger(cap) && cap >= 1)) return null;
  const reviews = Math.ceil(24 / hours);
  if (reviews <= cap) return null;
  const name = nameOf(names, optio).toUpperCase();
  return `A REVIEW EVERY ${hours} HOURS WAKES ${name} UP TO ${reviews} TIMES A DAY — ${name}'S DAILY LIMIT IS ${cap}. Past it, a review waits for the next day, and every other wake of theirs counts against the same limit.`;
};

/**
 * The master switch's face: what pressing it does. Pure.
 * @param {?Object} charter
 * @returns {{label: 'PAUSE'|'RESUME', enabled: boolean, title: string}}
 */
export const pauseSwitch = (charter) => {
  if (charter?.paused) return { label: 'RESUME', enabled: true, title: 'Let the house wake itself again, inside the charter' };
  if (charter === undefined) return { label: 'PAUSE', enabled: false, title: 'The charter has not been read yet' };
  return { label: 'PAUSE', enabled: Boolean(charter), title: charter ? 'Stop every new wake now' : 'There is no charter to pause yet' };
};

/**
 * One poll's reads, settled one by one (Promise.allSettled): what each read
 * that answered returned, by name, and the failed ones' own words joined —
 * so one failed read never blanks the parts that did answer. Pure.
 * @param {string[]} names - one per read, in order
 * @param {Array<{status: 'fulfilled'|'rejected', value?: *, reason?: *}>} settled
 * @returns {{read: Object<string, *>, error: ?string}}
 */
export const settleReads = (names, settled) => {
  const read = {};
  const failed = [];
  names.forEach((name, i) => {
    const s = settled[i];
    if (s?.status === 'fulfilled') read[name] = s.value;
    else failed.push(s?.reason?.message || `Could not read the ${name}.`);
  });
  return { read, error: failed.length ? failed.join(' · ') : null };
};

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
  'operator-answer': 'your answer to what it filed',
  scheduled: 'its calendar said it was time',
  'charge-due': 'a charge it holds came due',
});

/** @param {string} reason @returns {string} */
export const reasonWords = (reason) => REASONS[reason] || String(reason || 'work').replace(/-/g, ' ');

/**
 * Why a queued wake waits, from the server's own reason, naming the member the
 * way the rest of the House Clock does — never its lane id. Pure.
 * @param {string} why - the queue's held reason (wake-gate.js runGate)
 * @param {?string} [name] - the member's name
 * @returns {{key: string, words: string}}
 */
export const heldWords = (why, name = null) => {
  const text = String(why || '');
  if (/paused/.test(text)) return { key: 'paused', words: 'PAUSED — the house is paused' };
  if (/unapproved|none/.test(text)) return { key: 'unapproved', words: 'NOT APPROVED — the charter waits for your approval' };
  if (/quiet hours/.test(text)) return { key: 'quiet', words: `QUIET HOURS — ${text.replace(/^quiet hours\s*/, '').replace(/[()]/g, '')}` };
  if (/spent its/.test(text)) {
    const cap = /spent its (\d+) wakes/.exec(text)?.[1];
    return { key: 'cap', words: `DAILY LIMIT REACHED — ${name || 'this member'} has spent its ${cap ? `${cap} ` : ''}wakes for today` };
  }
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
        : held.has(i.seat) ? heldWords(held.get(i.seat), nameOf(names, i.seat)) : { key: 'ready', words: 'ABOUT TO WAKE' };
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
