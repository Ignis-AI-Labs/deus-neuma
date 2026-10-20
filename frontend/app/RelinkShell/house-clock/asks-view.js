// asks-view.js — the ASKS tab's pure display law (Design note, 2026-10-16: […]). What one ask reads as, which answer it takes, the Optio's
// review packet in her order with the blocked asks marked, and the filters:
// open / answered / dismissed, by kind, by seat, blocked only.
//
// Pure — no React, no DOM, no fetch.

import { formatDateTime } from '../../../utils/format.js';

/** The kinds of ask, as the filter names them. */
export const ASK_KINDS = Object.freeze([
  { value: 'act', label: 'ACTS' }, { value: 'plan', label: 'PLANS' }, { value: 'decision', label: 'DECISIONS' },
]);

/** Where an ask stands, as the filter names it. Dismissed = closed without an answer. */
export const ASK_VIEWS = Object.freeze([
  { value: 'open', label: 'OPEN' }, { value: 'answered', label: 'ANSWERED' }, { value: 'closed', label: 'DISMISSED' },
]);

/** The filter a fresh window starts on: everything still open. */
export const ASK_FILTER_START = Object.freeze({ view: 'open', kind: '', seat: '', blockedOnly: false });

const KIND_WORDS = Object.freeze({ act: 'ACT', plan: 'PLAN', decision: 'DECISION' });

// pure — what the operator's answer was, in a few words
const ANSWER_WORDS = Object.freeze({
  allow: 'ALLOWED ONCE', deny: 'DENIED', approve: 'APPROVED', revise: 'SENT BACK FOR REVISION', reply: 'REPLIED',
});

const nameOf = (names, seat) => names?.[seat] || seat;

// pure — what an ask is about, in one line
const whatOf = (ask) => {
  if (ask.kind === 'plan') return `a team plan${ask.planId ? ` (${ask.planId})` : ''}`;
  if (ask.kind === 'decision') return 'a decision';
  return ask.tool || 'an act';
};

/**
 * The answer controls an open ask takes. Pure.
 * @param {Object} ask
 * @returns {'act'|'act-legacy'|'plan'|'plan-legacy'|'decision'|null}
 */
const answerControls = (ask) => {
  if (ask.status !== 'open') return null;
  if (ask.kind === 'act') return ask.argsHash ? 'act' : 'act-legacy';
  if (ask.kind === 'plan') return ask.planId ? 'plan' : 'plan-legacy';
  return ask.kind === 'decision' ? 'decision' : null;
};

/**
 * How long an ask has waited on the operator, in words. Null when either
 * moment is unknown — no age beats a wrong one. Pure.
 * @param {string} at - when it was filed (ISO)
 * @param {number} now - epoch ms
 * @returns {?string}
 */
export const waitedWords = (at, now) => {
  const ms = now - Date.parse(at ?? '');
  if (!Number.isFinite(ms)) return null;
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'WAITING UNDER A MINUTE';
  if (min < 60) return `WAITING ${min} MIN`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `WAITING ${hours} H ${min % 60} MIN`;
  return `WAITING ${Math.floor(hours / 24)} D ${hours % 24} H`;
};

/**
 * One ask as the operator reads it. Pure.
 * @param {Object} ask - an asks row (status open | answered | closed)
 * @param {Object<string,string>} names - lane id → display name
 * @param {Set<string>} [blocked] - the packet's blocked ask ids
 * @param {number} [now] - epoch ms the window last read at: an open ask's age
 */
export const askRow = (ask, names, blocked = new Set(), now) => ({
  key: ask.id,
  seat: ask.seat,
  name: nameOf(names, ask.seat),
  kind: KIND_WORDS[ask.kind] || 'ASK',
  what: whatOf(ask),
  question: ask.kind === 'decision' ? ask.question ?? '' : null,
  options: ask.kind === 'decision' ? ask.options ?? [] : [],
  scope: ask.scope ?? null,
  why: ask.why || '',
  where: ask.runId ? `team run ${ask.runId}${ask.stepId ? ` · step ${ask.stepId}` : ''}` : null,
  at: formatDateTime(ask.at),
  waited: ask.status === 'open' ? waitedWords(ask.at, now) : null,
  open: ask.status === 'open',
  blocked: blocked.has(ask.id) && ask.status === 'open',
  answered: ask.status === 'answered'
    ? `${ANSWER_WORDS[ask.answer?.decision] || 'ANSWERED'}${ask.answer?.option ? `: ${ask.answer.option}` : ''} · ${formatDateTime(ask.answeredAt)}`
    : null,
  answerText: ask.status === 'answered' ? ask.answer?.text ?? null : null,
  closed: ask.status === 'closed' ? `DISMISSED ${formatDateTime(ask.closedAt)}${ask.closeNote ? ` — ${ask.closeNote}` : ''}` : null,
  controls: answerControls(ask),
  sessionId: ask.sessionId ?? null,
});

/** How many asks still wait on the operator. Pure. */
export const openAskCount = (asks) => (asks ?? []).filter((a) => a.status === 'open').length;

/** The seats that filed anything, for the seat filter. Pure. */
export const askSeats = (asks) => [...new Set((asks ?? []).map((a) => a.seat))];

/**
 * The asks the filter shows, newest first as filed. Pure.
 * @param {Object[]} asks
 * @param {{view: string, kind: string, seat: string, blockedOnly: boolean}} filter
 * @param {Set<string>} blocked
 */
export const filterAsks = (asks, filter, blocked) => (asks ?? []).filter((a) => a.status === filter.view
  && (!filter.kind || a.kind === filter.kind)
  && (!filter.seat || a.seat === filter.seat)
  && (!filter.blockedOnly || blocked.has(a.id)));

/**
 * The Optio's review packet as the operator reads it: her summary, then her
 * asks in her order, each marked blocked or not, and where it now stands. Pure.
 * @param {?Object} packet - latest-packet.json
 * @param {Object[]} asks
 * @param {Object<string,string>} names
 * @returns {?{by: string, at: string, summary: string, items: Object[], waiting: number, blocked: number}}
 */
export const packetView = (packet, asks, names) => {
  if (!packet) return null;
  const byId = new Map((asks ?? []).map((a) => [a.id, a]));
  const blocked = new Set(packet.blocked ?? []);
  const items = (packet.order ?? []).map((id, i) => {
    const ask = byId.get(id);
    const standing = !ask ? 'GONE' : ask.status === 'open' ? 'WAITS ON YOU' : ask.status === 'answered' ? 'ANSWERED' : 'DISMISSED';
    return {
      key: id,
      n: i + 1,
      name: ask ? nameOf(names, ask.seat) : 'an ask no longer on file',
      what: ask ? (ask.kind === 'decision' ? `decision: ${ask.question}` : whatOf(ask)) : id,
      // blocked marks only what still waits: an answered ask blocks nothing
      blocked: blocked.has(id) && standing === 'WAITS ON YOU',
      standing,
    };
  });
  return {
    by: packet.byName || nameOf(names, packet.by),
    at: formatDateTime(packet.at),
    summary: packet.summary,
    items,
    waiting: items.filter((it) => it.standing === 'WAITS ON YOU').length,
    blocked: items.filter((it) => it.blocked).length,
  };
};
