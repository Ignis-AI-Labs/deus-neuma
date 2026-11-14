// THE DO-NOT-CONTACT LIST — people and companies the house never writes to:
// whoever asked to be left alone, unsubscribed, bounced, is already a
// customer, or competes with the house. Checked when a company joins the
// prospect pool and again when one reaches the lead ledger; an entry is
// matched exactly (an email address, or a company's bare domain, which also
// covers every address at that domain). Append-only: { type: 'suppressed', entry, at }.
// PURE.

import { normalizeDomain } from './prospect-shape.js';

export const SUPPRESS_REASONS = Object.freeze(['asked', 'unsubscribed', 'bounced', 'customer', 'competitor', 'other']);

const EMAIL = /^[^\s@]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/;

/** A lower-cased email address, or ''. pure. */
export const normalizeEmail = (input) => {
  const v = String(input ?? '').trim().toLowerCase();
  return EMAIL.test(v) ? v : '';
};

/**
 * One entry, or a thrown reason.
 * @param {{target: unknown, reason: unknown, note?: unknown, by: string, now: string}} f
 */
export const makeSuppression = ({ target, reason, note, by, now }) => {
  const email = normalizeEmail(target);
  const domain = email ? '' : normalizeDomain(target);
  if (!email && !domain) throw new Error('target: an email address or a company domain');
  if (!SUPPRESS_REASONS.includes(reason)) throw new Error(`reason: one of ${SUPPRESS_REASONS.join(', ')}`);
  return Object.freeze({ kind: email ? 'email' : 'domain', value: email || domain, reason, note: String(note ?? '').trim().slice(0, 300) || null, by, at: now });
};

/** The entries, from the event log. pure. */
export const foldSuppressions = (events) => events.filter((e) => e?.type === 'suppressed' && e.entry?.value).map((e) => e.entry);

/**
 * A matcher over the entries: is this email, or this domain, suppressed? pure.
 * @returns {{email: (v: string) => boolean, domain: (v: string) => boolean}}
 */
export const suppressionMatcher = (entries) => {
  const emails = new Set(entries.filter((e) => e.kind === 'email').map((e) => e.value));
  const domains = new Set(entries.filter((e) => e.kind === 'domain').map((e) => e.value));
  return {
    domain: (v) => domains.has(normalizeDomain(v)),
    email: (v) => {
      const e = normalizeEmail(v);
      return Boolean(e) && (emails.has(e) || domains.has(e.split('@')[1]));
    },
  };
};
