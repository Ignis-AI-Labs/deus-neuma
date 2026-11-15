// THE FIRST EMAIL AND ITS PROMISE (Design note, 2026-11-14: […]). A first email to a lead is short, has a
// plain subject, asks ONE thing, and names what the house will send when they
// say yes. That promise is kept on the lead with the email, so the moment they
// reply the seat reads exactly what it owes them — and so does the operator.
// A later email is not held to this shape: an answer is as long as it needs.
// PURE.

import { SALES_DISCLOSURE } from './sales-facts.js';

export const FIRST_WORDS_MAX = 130;
export const SUBJECT_WORDS_MAX = 5;
export const PROMISE_MAX = 300;
const PROMISE_MIN = 10;

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);

/** The promise as it is kept: one line, or '' when none was made. pure. */
export const cleanPromise = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, PROMISE_MAX) : '');

/** Has the house written to this lead before? pure. */
export const writtenBefore = (lead) => (lead.touches || []).some((t) => t.direction === 'out' || (!t.direction && t.status === 'contacted'));

/**
 * Judge the shape of a FIRST email to a lead. pure.
 * @param {{subject: string, text: string, promise?: string}} email
 * @returns {string[]} what must change (empty: it may go)
 */
export const checkFirstEmail = ({ subject, text, promise }) => {
  const body = String(text ?? '').split(SALES_DISCLOSURE).join(' ');
  const length = words(body).length;
  const asks = (body.match(/\?/g) || []).length;
  return [
    ...(length > FIRST_WORDS_MAX ? [`a first email is at most ${FIRST_WORDS_MAX} words and this one is ${length} — cut it to what they need to say yes`] : []),
    ...(words(subject).length > SUBJECT_WORDS_MAX ? [`a first email's subject is at most ${SUBJECT_WORDS_MAX} plain words`] : []),
    ...(asks === 1 ? [] : [`a first email asks ONE thing (one question) and this one asks ${asks}`]),
    ...(cleanPromise(promise).length < PROMISE_MIN ? ['add promise: one line saying exactly what you will send them when they say yes (it is kept on the lead, and you deliver exactly that when they reply)'] : []),
  ];
};

/** What the house last promised this lead, or null. pure. */
export const promiseOf = (lead) => [...(lead.touches || [])].reverse().find((t) => t.promised)?.promised ?? null;
