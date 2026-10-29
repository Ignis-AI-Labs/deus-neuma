// kinds-fold — what a MARKETING board's FUNNEL, NEXT 7 DAYS and CMO LOG panels
// draw (marketing-panel-plan.md §3), folded from the reads the desk already
// makes: the queue, the results and links (use-marketing-overview.js), the
// mandate's DONE FOR YOU feed (use-mandate.js), the bench's asks, the house's
// locked weekly plan. Pure.
//
// A funnel reads ONE company's tree (results-fold.js treeRollup's rule): its
// steps are split by platform and never summed across two trees. A missing
// reading is null ("—"), never a drawn zero.

import { accountOf, subtreeOf } from '../marketing-overview/overview-fold.js';
import { linkTotals, postFacts } from '../marketing-overview/results-fold.js';

const DAY = 864e5;
const WEEK = 7 * DAY;

/** The funnel's steps, as the desk names them. */
export const FUNNEL_STEPS = Object.freeze([['reach', 'SEEN'], ['engaged', 'ENGAGED'], ['clicked', 'CLICKED'], ['converted', 'ACTED']]);
export const DAY_WORDS = Object.freeze(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
export const PLAN_DAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

// pure — the platforms the accounts are on, in the accounts' own order.
const platformsOf = (accounts) => [...new Set(accounts.map((a) => a.channelId))];

/**
 * pure — FUNNEL: one company and the companies under it, SEEN → ENGAGED →
 * CLICKED → ACTED over their sent posts, each step split by platform.
 * @param {{companyId: string, companies: object[], accounts: object[], queue: object[], results: object, links: object[]}} input
 * @returns {{platforms: string[], sent: number, steps: Array<{step: string, word: string, total: ?number,
 *   parts: Array<{platform: string, value: ?number, reporting: number, of: number}>}>}}
 */
export const platformFunnel = ({ companyId, companies, accounts, queue, results, links }) => {
  const tree = subtreeOf(companies, companyId);
  const mine = accounts.filter((a) => a.companyId && tree.has(a.companyId));
  const ids = new Set(mine.map((a) => a.id));
  const totals = linkTotals(links, results?.links?.counts);
  const facts = (queue || []).filter((e) => e.status === 'sent' && e.kind !== 'reply' && ids.has(accountOf(e)))
    .map((e) => ({ platform: e.channelId, ...postFacts(e, results, totals) }));
  const platforms = platformsOf(mine);
  return {
    platforms,
    sent: facts.length,
    steps: FUNNEL_STEPS.map(([step, word]) => {
      const parts = platforms.map((platform) => {
        const of = facts.filter((f) => f.platform === platform);
        const reported = of.filter((f) => f[step] !== null);
        return { platform, value: reported.length ? reported.reduce((s, f) => s + f[step], 0) : null, reporting: reported.length, of: of.length };
      });
      const read = parts.filter((p) => p.value !== null);
      return { step, word, parts, total: read.length ? read.reduce((s, p) => s + p.value, 0) : null };
    }),
  };
};

/**
 * pure — NEXT 7 DAYS: from the start of today, one lane per platform the
 * level's accounts are on, each staged post (awaiting you or scheduled) at its
 * time as a share of the week; the days, and now, on the same axis.
 * @param {{accounts: object[], queue: object[], now: number}} input - `accounts` the level's
 */
export const weekLanes = ({ accounts, queue, now }) => {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  const ids = new Set(accounts.map((a) => a.id));
  const mine = (queue || []).filter((e) => ['draft', 'approved'].includes(e.status) && !e.placeholder && e.kind !== 'reply' && ids.has(accountOf(e)));
  const staged = mine.filter((e) => { const t = Date.parse(e.scheduledFor); return t >= start && t < start + WEEK; });
  return {
    start,
    nowAt: (now - start) / WEEK,
    days: Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start + i * DAY + DAY / 2);
      return { at: i / 7, word: DAY_WORDS[day.getDay()], date: day.getDate(), today: i === 0 };
    }),
    lanes: platformsOf(accounts).map((platform) => ({
      platform,
      posts: staged.filter((e) => e.channelId === platform).map((entry) => ({ entry, at: (Date.parse(entry.scheduledFor) - start) / WEEK }))
        .sort((a, b) => a.at - b.at),
    })),
    staged: staged.length,
    unscheduled: mine.filter((e) => !e.scheduledFor).length,
  };
};

/**
 * pure — CMO LOG: who holds the seat, where the mandate stands, what it did
 * in the last 7 days (each act one mark, counted by what it was), the asks
 * open between the CMO and the operator, the locked weekly plan, and how
 * often the CMO laid out the board (`board`: {changes, lastAt, lastLevel}).
 * @param {{mandate: ?object, campaigns: object[], plan: ?object, board?: ?object, now: number}} input - `mandate` the mandate view
 */
export const cmoLog = ({ mandate, campaigns, plan, board = null, now }) => {
  const acts = (mandate?.feed || []).filter((r) => r.kind === 'act' && now - Date.parse(r.at) <= WEEK);
  const open = (campaigns || []).flatMap((c) => (c.asks || []).filter((a) => a.state === 'open').map((a) => ({ ...a, campaignId: c.id, campaign: c.name })));
  return {
    seat: mandate?.seat || null,
    standing: mandate?.standing || null,
    acts,
    byWhat: Object.entries(acts.reduce((m, r) => ({ ...m, [r.what]: (m[r.what] || 0) + 1 }), {})),
    asks: { forYou: open.filter((a) => a.from === 'cmo'), forCmo: open.filter((a) => a.from === 'operator') },
    board: board?.changes ? { changes: board.changes, lastAt: board.lastAt, lastLevel: board.lastLevel } : null,
    plan: plan ? { approvedAt: plan.approvedAt, days: PLAN_DAYS.map((day) => plan.days.find((d) => d.day === day) || { day, posts: 0, theme: null, objective: null }) } : null,
  };
};
