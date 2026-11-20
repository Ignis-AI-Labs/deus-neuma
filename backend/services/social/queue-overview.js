// Queue overview — the campaign queue at a glance, organized: how many posts stand in each
// standing, the days they went out (or were pulled, or are coming), each campaign and channel,
// and the exact call that reads any one slice whole.
//
// Design note, 2026-11-16, after a being asked for […] and got forty sent posts from
// July, verbatim: […]
//
// queue_list {view:'summary'} is this: the whole record in a few lines and no copy, so a being
// sees the shape first and then reads exactly the slice it means (queue_list {status, day}).
// Pure throughout: entries in, text out. It imports only from queue-render.js (direction law).

import { DEAD_FOR_BEING } from './queue-render.js';

const pad = (n) => String(n).padStart(2, '0');

/** The calendar day of a moment on this machine's clock, YYYY-MM-DD — the operator's day. Pure. */
export const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A day as a being writes it: YYYY-MM-DD, today, yesterday or tomorrow. Pure.
 * @returns {{ok: true, day: ?string} | {ok: false, error: string}}
 */
export const dayOf = (raw, now) => {
  const given = String(raw ?? '').trim().toLowerCase();
  if (!given) return { ok: true, day: null };
  const near = { today: 0, yesterday: -1, tomorrow: 1 }[given];
  if (near !== undefined) return { ok: true, day: localDay(now + near * DAY_MS) };
  if (DAY_RE.test(given) && !Number.isNaN(Date.parse(`${given}T12:00:00`))) return { ok: true, day: given };
  return { ok: false, error: `day must be YYYY-MM-DD, today, yesterday or tomorrow (got "${raw}")` };
};

const at = (v) => {
  const t = Date.parse(v ?? '');
  return Number.isNaN(t) ? null : t;
};
const finite = (n) => (Number.isFinite(n) ? n : null);

/**
 * When a post HAPPENED, as its own standing says (pure): a sent post when it went out, a
 * withdrawn one when it was pulled, a declined one when it was decided, a retracted one when it
 * came down; a draft or approved post at the slot it will publish at (null while unscheduled).
 * @param {object} e
 * @param {(e: object) => number} slotOf the effective slot (a follow-up rides its parent's)
 */
export const momentOf = (e, slotOf) => {
  switch (e?.status) {
    case 'sent': return at(e.sentAt) ?? finite(slotOf(e));
    case 'sending': return at(e.sendingAt) ?? finite(slotOf(e));
    case 'failed': return at(e.failedAt) ?? at(e.sendingAt) ?? finite(slotOf(e));
    case 'withdrawn': return at(e.withdrawnAt) ?? at(e.updatedAt) ?? at(e.createdAt);
    case 'rejected': return at(e.decidedAt) ?? at(e.createdAt);
    case 'retracted': return at(e.retractedAt) ?? at(e.sentAt);
    default: return finite(slotOf(e));
  }
};

// The standings in the order an operator reads them, each in the words a being should hear.
const STANDINGS = Object.freeze([
  ['draft', 'draft (await your operator)'],
  ['approved', 'approved (scheduled)'],
  ['sending', 'sending'],
  ['sent', 'sent'],
  ['failed', 'failed'],
  ['withdrawn', 'withdrawn'],
  ['rejected', 'declined'],
  ['retracted', 'retracted (taken down)'],
]);

const DAYS_SHOWN = 10;

// […]: the nearest days one by one, the rest by month.
const byDay = (moments, { newestFirst }) => {
  const days = new Map();
  for (const ms of moments) {
    const day = localDay(ms);
    days.set(day, (days.get(day) || 0) + 1);
  }
  const ordered = [...days.entries()].sort(([a], [b]) => (newestFirst ? b.localeCompare(a) : a.localeCompare(b)));
  const near = ordered.slice(0, DAYS_SHOWN).map(([day, n]) => `${day} ×${n}`);
  const months = new Map();
  for (const [day, n] of ordered.slice(DAYS_SHOWN)) months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) || 0) + n);
  return [...near, ...[...months.entries()].map(([month, n]) => `${month} ×${n}`)].join(' · ');
};

const countBy = (entries, keyOf) => {
  const counts = new Map();
  for (const e of entries) counts.set(keyOf(e), (counts.get(keyOf(e)) || 0) + 1);
  return counts;
};

/**
 * The queue at a glance (pure).
 * @param {Array<object>} entries the entries in scope (already filtered, any standing)
 * @param {{slotOf: Function, now: number, scope?: string}} opts
 * @returns {string}
 */
export const queueOverview = (entries, { slotOf, now, scope = '' }) => {
  const all = Array.isArray(entries) ? entries : [];
  if (!all.length) return `The campaign queue holds nothing${scope ? ` matching ${scope}` : ''}.`;
  const standing = countBy(all, (e) => e?.status);
  const of = (statuses) => all.filter((e) => statuses.includes(e?.status));
  const moments = (list) => list.map((e) => momentOf(e, slotOf)).filter((ms) => ms !== null);

  const open = of(['draft', 'approved']);
  const coming = moments(open).filter((ms) => ms >= now);
  const overdue = moments(open).filter((ms) => ms < now).length;
  const unscheduled = open.filter((e) => momentOf(e, slotOf) === null).length;
  const sent = moments(of(['sent']));
  const dead = moments(of(DEAD_FOR_BEING));
  const failed = moments(of(['failed']));

  const campaigns = [...countBy(all, (e) => e?.campaignId || '(no campaign)').keys()].map((id) => {
    const mine = all.filter((e) => (e?.campaignId || '(no campaign)') === id);
    const parts = STANDINGS.map(([status, word]) => [mine.filter((e) => e?.status === status).length, word.split(' (')[0]])
      .filter(([n]) => n).map(([n, word]) => `${n} ${word}`);
    return `${id}: ${parts.join(', ')}`;
  });
  const channels = [...countBy(all, (e) => e?.channelId || 'unknown').entries()].map(([id, n]) => `${id} ${n}`);
  const today = localDay(now);

  return [
    `THE QUEUE AT A GLANCE — ${all.length} post(s)${scope ? ` matching ${scope}` : ''}, no copy (days are this machine's, today ${today})`,
    `STANDING: ${STANDINGS.filter(([s]) => standing.get(s)).map(([s, word]) => `${standing.get(s)} ${word}`).join(' · ')}`,
    `COMING, by day: ${coming.length ? byDay(coming, { newestFirst: false }) : 'nothing scheduled ahead'}${unscheduled ? ` · ${unscheduled} unscheduled` : ''}${overdue ? ` · ${overdue} past their slot and not sent` : ''}`,
    ...(sent.length ? [`SENT, by day (newest first): ${byDay(sent, { newestFirst: true })}`] : []),
    ...(dead.length ? [`WITHDRAWN / DECLINED / TAKEN DOWN, by day (newest first): ${byDay(dead, { newestFirst: true })}`] : []),
    ...(failed.length ? [`FAILED, by day: ${byDay(failed, { newestFirst: true })}`] : []),
    `CAMPAIGNS: ${campaigns.join(' | ')}`,
    `CHANNELS: ${channels.join(' · ')}`,
    `READ ONE SLICE WHOLE: queue_list {status:'draft'} what waits on your operator · {status:'sent', day:'${today}'} one day's sent posts · {status:'dead', day:'yesterday'} what was pulled that day · {status:'all', day:'…'} everything on a day · {campaignId:'…', status:'…'} one campaign · add view:'index' for one line each`,
  ].join('\n');
};
