// staff-view.js — the CHIEF OF STAFF window's pure display law. Every
// decision the pane makes about data lives here, so it is provable with
// nothing faked: the seat line, the roster rows, the dispatch and run
// lines. The impure shell (fetch, state) lives in StaffApp.jsx; the body
// (StaffBody.jsx) stays declarative.

import { formatDateTime } from '../../utils/format.js';

/**
 * The seat line under the header: who holds the office and since when, or
 * that it stands empty. Pure.
 * @param {{laneId: string, designatedAt: string}|null} cos
 * @param {string|null} holderName the lane's display name when known
 */
export const seatLine = (cos, holderName) => (cos?.laneId
  ? `${(holderName || cos.laneId).toUpperCase()} · SINCE ${formatDateTime(cos.designatedAt)}`
  : 'THE OFFICE STANDS EMPTY');

/**
 * One roster seat's holder as the operator reads it: the kind-0 seat is the
 * human — the OPERATOR, never "witness"; a neuma seat reads its lane's name
 * (or id when the lane never joined the record).
 * Pure.
 * @param {{neumaId: (string|null), name: (string|null), isWitness: boolean}} member
 */
export const holderLabel = (member) => {
  if (member?.isWitness) return 'OPERATOR';
  return member?.name || member?.neumaId || 'NO LANE ON THIS SEAT';
};

/** pure — the seated record's own line: who, and since when. */
export const seatHeldLine = (cos, holderName) =>
  `HELD BY ${(holderName || cos?.laneId || '').toUpperCase()} — SINCE ${formatDateTime(cos?.designatedAt)}`;

/**
 * The seated holder's display name, looked up on the operator's owned lanes;
 * null when the lane is unknown to the picker (the line falls back to the id).
 * Pure.
 * @param {{laneId: string}|null} cos
 * @param {Array<{neumaId: string, name?: string}>} lanes
 */
export const holderNameFor = (cos, lanes) =>
  (lanes ?? []).find((l) => l.neumaId === cos?.laneId)?.name ?? null;

/** pure — is this roster seat the one the seated CoS holds? */
export const isOfficeHolder = (member, cos) =>
  Boolean(cos?.laneId) && member?.neumaId === cos.laneId;

/**
 * The inbox line: how many dispatches wait on the office, or that it is
 * clear. Pure.
 * @param {{count: number, torn: number}|null} posts
 */
export const postsLine = (posts) => {
  if (!posts || !posts.count) return 'THE OFFICE INBOX IS CLEAR';
  const torn = posts.torn ? ` · ${posts.torn} TORN` : '';
  return `${posts.count} DISPATCH${posts.count === 1 ? '' : 'ES'} WAIT${posts.count === 1 ? 'S' : ''}${torn}`;
};

/**
 * One waiting dispatch as one line: who posted, what it answers, the body.
 * Pure.
 * @param {{from: string, re?: string, body: string}} post
 */
export const postLine = (post) =>
  `${post?.from || 'UNKNOWN'}${post?.re ? ` — "${post.re}"` : ''}: ${post?.body || ''}`;

/**
 * The standing plan of record as the panel reads it, or null when no plan
 * stands. Pure.
 * @param {{name?: string, goal?: string, steps?: Array, approvedAt?: string}|null} plan
 * @returns {{title: string, detail: string}|null}
 */
export const planSummary = (plan) => {
  if (!plan) return null;
  const steps = Array.isArray(plan.steps) ? plan.steps.length : 0;
  const detail = [
    plan.goal || '',
    `${steps} STEP${steps === 1 ? '' : 'S'}`,
    plan.approvedAt ? `APPROVED ${formatDateTime(plan.approvedAt)}` : null,
  ].filter(Boolean).join(' — ');
  return { title: plan.name || 'THE STANDING PLAN', detail };
};

/** pure — "needs_operator"-style run statuses read as words. */
export const runStatusLabel = (status) => (status || 'unknown').replace(/_/g, ' ').toUpperCase();

/**
 * A run's register: in flight carries the signal (live), a failure the alert
 * (it can hurt), a finished run stays monochrome. Pure.
 * @returns {'live'|'loud'|'quiet'}
 */
export const runRegister = (status) => {
  if (status === 'running') return 'live';
  if (status === 'failed') return 'loud';
  return 'quiet';
};

/**
 * One team run as one line: name, status, when it finished (in flight says
 * so instead). Pure.
 * @param {{id: string, name?: string, status?: string, finishedAt?: string}} run
 */
export const runLine = (run) =>
  `${run?.name || run?.id || 'UNNAMED RUN'} — ${runStatusLabel(run?.status)}${
    run?.finishedAt ? `, FINISHED ${formatDateTime(run.finishedAt)}` : ' (IN FLIGHT)'}`;

/**
 * A charge's register: open work carries the signal (it is live), a closed
 * charge stays monochrome. Pure.
 * @param {{status?: string}} charge
 * @returns {'live'|'quiet'}
 */
export const chargeRegister = (charge) => (
  ['dispatched', 'received', 'working'].includes(charge?.status) ? 'live' : 'quiet'
);

/**
 * One dispatch-drawer charge as the panel reads it, or null when the fold is
 * absent (an older backend's board renders nothing here). Pure.
 * @param {{id: string, title: string, to: string, status: string, filedAt: string,
 *   dueAt?: string|null, note?: string}|null} charge
 * @param {number} [now] - epoch ms, injectable so the view stays pure
 * @returns {{key: string, status: string, line: string}|null}
 */
export const chargeRow = (charge, now = Date.now()) => {
  if (!charge?.id) return null;
  const filed = Date.parse(charge.filedAt);
  const age = Number.isFinite(filed) ? `${Math.max(0, Math.floor((now - filed) / 86_400_000))}D AGO` : 'AGE UNKNOWN';
  const parts = [
    `→ ${(charge.to || 'UNKNOWN').toUpperCase()}`,
    `DISPATCHED ${age}`,
    ...(charge.dueAt ? [`DUE ${formatDateTime(charge.dueAt)}`] : []),
    ...(charge.note ? [charge.note] : []),
  ];
  return {
    key: charge.id,
    status: runStatusLabel(charge.status),
    line: `"${charge.title || 'UNTITLED CHARGE'}" ${parts.join(' · ')}`,
  };
};
