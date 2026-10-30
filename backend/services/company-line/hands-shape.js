// HANDS — what only a person can do for the house's company
// (docs/planning/proposals/governance/house-company-line.md §10). A house
// cannot own a company, pass an identity check, get a tax ID, sign, notarize
// or touch anything physical; the operator does, and the house asks for each
// act plainly: what, why, what it unblocks, the honest estimate, the
// deadline, the exact link, and what comes back.
//
// What comes back is never a secret: `done` (the act is done), `fact` (a
// plain fact the house needs — a file number, the state it was filed in) or
// `held` (where the operator keeps what must stay secret — a bank login is
// never written down here).
//
// The record is append-only events, folded here:
//   { type: 'raised', item, at }
//   { type: 'answered', id, status: 'done'|'declined', text, by: 'operator', at }
// PURE, but for makeHands' random id.

import crypto from 'crypto';
import { FOUNDING_LINE } from './line-stages.js';

export const ANSWERS = Object.freeze(['done', 'fact', 'held']);
export const OPEN_MAX = 20;
const WHAT_MAX = 160;
const WHY_MAX = 600;
const COST_MAX = 120;
const TEXT_MAX = 400;
const URL_MAX = 500;

const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '').slice(0, max);

// pure — an https link, or null: a link the operator is sent to is never plain http or a script.
const linkOf = (value) => {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'https:' && url.href.length <= URL_MAX ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * One HANDS item, or a thrown reason the act turns into a refusal. Pure but
 * for its random id.
 * @param {{what: unknown, why: unknown, where: unknown, answer: unknown, unblocks?: unknown,
 *   cost?: unknown, by?: unknown, raisedBy: string, now: string}} fields
 */
export const makeHands = ({ what, why, where, answer, unblocks, cost, by, raisedBy, now }) => {
  const w = clean(what, WHAT_MAX);
  const y = clean(why, WHY_MAX);
  if (!w || !y) throw new Error('a HANDS item needs {what, why}: the one act the operator must do, and what the company needs it for');
  const link = linkOf(where);
  if (!link) throw new Error('a HANDS item needs {where}: the exact https link where the operator does it');
  if (!ANSWERS.includes(answer)) throw new Error(`answer is what comes back: ${ANSWERS.join(', ')} — never a secret`);
  const stage = unblocks == null || unblocks === '' ? null : String(unblocks).trim();
  if (stage && !FOUNDING_LINE.some((s) => s.id === stage)) throw new Error(`unblocks names a stage of the line (${FOUNDING_LINE.map((s) => s.id).join(', ')})`);
  const deadline = by == null || by === '' ? null : String(by).trim();
  if (deadline && Number.isNaN(Date.parse(deadline))) throw new Error('by is a date (2026-11-30), or leave it out');
  return Object.freeze({
    id: `h-${crypto.randomBytes(4).toString('hex')}`,
    what: w,
    why: y,
    where: link,
    answer,
    unblocks: stage,
    cost: clean(cost, COST_MAX) || null,
    by: deadline,
    raisedBy,
    raisedAt: now,
  });
};

/**
 * Fold the record into the items, oldest first. An answer to an item that is
 * not open is skipped and counted. pure.
 * @param {Array<object>} events
 * @returns {{items: Array<object>, skipped: number}}
 */
export const foldHands = (events) => events.reduce((acc, e) => {
  if (e?.type === 'raised' && e.item?.id && !acc.items.some((i) => i.id === e.item.id)) {
    return { ...acc, items: [...acc.items, { ...e.item, status: 'open', answeredAt: null, text: null }] };
  }
  const open = e?.type === 'answered' && acc.items.find((i) => i.id === e.id && i.status === 'open');
  if (open && ['done', 'declined'].includes(e.status)) {
    return { ...acc, items: acc.items.map((i) => (i === open ? { ...i, status: e.status, answeredAt: e.at, text: clean(e.text, TEXT_MAX) || null } : i)) };
  }
  return { ...acc, skipped: acc.skipped + 1 };
}, { items: [], skipped: 0 });

/**
 * The operator's answer, judged. A `fact` or `held` item that is done carries
 * its text; a declined one carries why. pure.
 * @param {object} item - foldHands' item
 * @param {{status: unknown, text: unknown, now: string}} answer
 * @returns {{ok: true, event: object} | {ok: false, reason: string}}
 */
export const judgeAnswer = (item, { status, text, now }) => {
  if (!item) return { ok: false, reason: 'no such HANDS item on this company' };
  if (item.status !== 'open') return { ok: false, reason: `this item is already ${item.status}` };
  if (!['done', 'declined'].includes(status)) return { ok: false, reason: 'an answer is done or declined' };
  const t = clean(text, TEXT_MAX);
  if (status === 'declined' && !t) return { ok: false, reason: 'say why it will not be done, so the house can find another way' };
  if (status === 'done' && item.answer !== 'done' && !t) {
    return { ok: false, reason: item.answer === 'fact' ? 'type the fact the house asked for' : 'say where it is kept (never the secret itself)' };
  }
  return { ok: true, event: { type: 'answered', id: item.id, status, text: t || null, by: 'operator', at: now } };
};
