// mandate-grant-view.js — the GRANT SCREEN's pure law: the choices, the term
// that ends it by itself, the grant as marks and numbers, and the rule of the
// red button (ruling, 2026-10-24: […]).
//
// The button arms only when every pre-flight row passed, the screen is this
// computer's own desk, and at least one account is chosen; then it must be
// HELD for HOLD_MS — let go early and nothing happens.

const DEFAULT_DAYS = 7;
export const MAX_DAYS = 90;
export const HOLD_MS = 2000;

/** The term choices: the mandate turns itself off after this many days. */
export const TERMS = Object.freeze([
  Object.freeze({ id: '7', label: '7 DAYS', days: 7 }),
  Object.freeze({ id: '30', label: '30 DAYS', days: 30 }),
  Object.freeze({ id: 'custom', label: 'OTHER', days: null }),
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const clampDays = (n) => Math.min(MAX_DAYS, Math.max(1, Math.round(Number(n) || DEFAULT_DAYS)));

/**
 * The grant screen's starting choices: every account a mandate may hold,
 * none chosen, small pace, posts + renders on, replies off, 7 days.
 * @param {Array<object>} accounts - the view's accounts
 */
export const initialGrant = (accounts = []) => ({
  accounts: Object.fromEntries(accounts.filter((a) => !a.perPostConsent).map((a) => [a.id, { on: false, pace: 2 }])),
  acts: { posts: true, renders: true, replies: false },
  term: '7',
  customDays: 14,
  replyPace: 5,
});

/** The days the draft's term names, 1 to MAX_DAYS. Pure. */
export const termDays = (draft) => {
  const term = TERMS.find((t) => t.id === draft.term) || TERMS[0];
  return term.days ?? clampDays(draft.customDays);
};

/** The day it turns itself off, if granted at `now`. Pure. */
export const endDateOf = (draft, now) => new Date(now + termDays(draft) * DAY_MS)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The accounts the draft names. Pure. */
export const chosenAccounts = (draft) => Object.entries(draft.accounts).filter(([, v]) => v.on).map(([id, v]) => ({ id, pace: v.pace }));

/** The grant screen's choices as the route's body. A grant always ends. Pure. */
export const grantBody = (draft, timeZone) => ({
  accounts: chosenAccounts(draft),
  acts: draft.acts,
  replyPace: draft.replyPace,
  days: termDays(draft),
  timeZone,
});

/**
 * What is granted, as marks and numbers — grouped by company — before the
 * yes. Pure.
 * @param {object} draft
 * @param {{accounts: object[], companies: Array<{id: string, name: string}>}} view
 * @param {number} now - epoch ms
 */
export const grantMarks = (draft, view, now) => {
  const nameOf = (id) => view.companies.find((c) => c.id === id)?.name || 'UNSORTED';
  const companies = new Map();
  for (const { id, pace } of chosenAccounts(draft)) {
    const company = nameOf(view.accounts.find((a) => a.id === id)?.companyId);
    companies.set(company, [...(companies.get(company) || []), { id, pace }]);
  }
  return {
    companies: [...companies.entries()].map(([name, accounts]) => ({ name, accounts })),
    acts: [
      { id: 'posts', label: 'POSTS', on: draft.acts.posts },
      { id: 'renders', label: 'IMAGES + VIDEOS', on: draft.acts.renders },
      { id: 'replies', label: 'REPLIES', on: draft.acts.replies, pace: draft.acts.replies ? draft.replyPace : null },
    ],
    days: termDays(draft),
    ends: endDateOf(draft, now),
  };
};

/**
 * Is the red button armed? Pure.
 * @param {{rows: ?Array<{ok: ?boolean}>, atDesk: boolean, chosen: number}} state
 */
export const buttonArmed = ({ rows, atDesk, chosen }) =>
  Boolean(atDesk && chosen > 0 && rows?.length && rows.every((r) => r.ok === true));

/** Was the press held long enough to grant? Let go early and nothing happens. Pure. */
export const holdComplete = (downAt, at, holdMs = HOLD_MS) =>
  Number.isFinite(downAt) && Number.isFinite(at) && at - downAt >= holdMs;
