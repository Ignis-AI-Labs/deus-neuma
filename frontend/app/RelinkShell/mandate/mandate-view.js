// mandate-view.js — how the CMO's MANDATE reads on the desk. Pure. (The
// grant screen's own law is mandate-grant-view.js.)
//
// CHOKKAN: the state is carried by shape and tone first — ACTING (live),
// PAUSED (alert), ENDED (idle) — and the words only confirm it. WITHDRAW is
// always the plainest thing on screen while a mandate stands.

import { grantMarks } from './mandate-grant-view.js';

/** A standing at a glance: its tone, the chip's short label, and the window's words. */
export const chipLine = (standing) => ({
  active: { tone: 'live', label: 'MANDATE ON', words: 'MANDATE · CMO ACTS FOR YOU' },
  paused: { tone: 'alert', label: 'MANDATE PAUSED', words: 'MANDATE PAUSED · DECIDE' },
  expired: { tone: 'idle', label: 'MANDATE ENDED', words: 'MANDATE ENDED' },
}[standing] || null);

/** Does WITHDRAW stand on screen? (anything not yet withdrawn) */
export const canWithdraw = (standing) => standing === 'active' || standing === 'paused' || standing === 'expired';

/** The day a mandate ends, as the bell says it; the zone it was granted in, else the desk's. */
const endDay = (iso, timeZone) => {
  const opts = { month: 'short', day: 'numeric' };
  try { return new Date(iso).toLocaleDateString('en-US', { ...opts, timeZone }); } catch { return new Date(iso).toLocaleDateString('en-US', opts); }
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The tray's MANDATE mark while one is ACTIVE (the waiting account's
 * `mandate`), or null: none, paused (that one waits as a row), withdrawn, or
 * past its end by the desk's own clock. Obvious at a glance (ruling,
 * 2026-10-24): its label carries the days left — `MANDATE · 5D` — and the
 * day it turns itself off; an unreadable end reads —, never a made-up day.
 * @param {?{expiresAt: ?string, timeZone?: string}} mark
 * @param {number} now - epoch ms
 * @returns {?{label: string, words: string}}
 */
export const bellMandate = (mark, now) => {
  if (!mark) return null;
  const ends = mark.expiresAt ? Date.parse(mark.expiresAt) : null;
  if (ends !== null && ends <= now) return null;
  const readable = ends !== null && Number.isFinite(ends);
  const left = ends === null ? 'NO END' : readable ? `${Math.ceil((ends - now) / DAY_MS)}D` : '—';
  const when = ends === null ? 'only when you withdraw it' : readable ? `on ${endDay(mark.expiresAt, mark.timeZone)}` : '—';
  return { label: `MANDATE · ${left}`, words: `Mandate on — the CMO acts for you without asking · turns itself off ${when} · WITHDRAW beside the bell` };
};

/**
 * The mandate that stands, as the grant screen drew it (grantMarks: its
 * accounts by company, each one's pace, its acts) and its term as days left
 * against the days it was granted for — a value against its own limit, so a
 * bar (show-dont-tell-audit.md finding 4). One stored before every grant had
 * an end reads NO END, and an unreadable end —, never a made-up day.
 * @param {{mandate: object, accounts: object[], companies: object[]}} view
 * @param {number} now - epoch ms
 * @returns {{marks: object, left: {value: ?number, max: ?number, text: string, title: string}}}
 */
export const standingMarks = (view, now) => {
  const m = view.mandate;
  const draft = {
    accounts: Object.fromEntries(m.accounts.map((a) => [a.id, { on: true, pace: a.pace }])),
    acts: m.acts,
    replyPace: m.replyPace,
    term: 'custom',
    customDays: m.days,
  };
  const marks = grantMarks(draft, view, now);
  const ends = m.expiresAt ? Date.parse(m.expiresAt) : null;
  if (ends === null) return { marks, left: { value: null, max: null, text: 'NO END', title: 'it stands until you withdraw it' } };
  if (!Number.isFinite(ends)) return { marks, left: { value: null, max: null, text: '—', title: 'its end could not be read' } };
  const day = endDay(m.expiresAt, m.timeZone);
  const days = Number.isFinite(m.days) ? m.days : Math.max(1, Math.round((ends - Date.parse(m.grantedAt)) / DAY_MS));
  const left = Math.max(0, (ends - now) / DAY_MS);
  return {
    marks,
    left: {
      value: left,
      max: days,
      text: left > 0 ? `${Math.ceil(left)}D · ${day}` : `ENDED · ${day}`,
      title: `${Math.ceil(left)} of ${days} days left — it turns itself off on ${day}, then everything asks you again`,
    },
  };
};
