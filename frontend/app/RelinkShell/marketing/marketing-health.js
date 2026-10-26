// marketing-health.js — the MARKETING board's state in one read, atop every
// level (marketing-panel-plan.md §2.2): what waits on the operator, the
// accounts, the queue, the campaigns, the results, the site counter, the
// legal marks and the mandate — each as one level (OK, WARM, HOT, FAULT) with
// the one number that decides it, narrowed to the level's scope. The strip is
// SUBSTRATE's (HealthStrip.jsx); a cell's `door` says where its press goes.
//
// SHINKEI: a level stands only on what was read. A cell whose input could not
// be read is `unknown` and reads "—", with the reason in its title — never an
// OK it did not see.
//
// A cell's `what` (the line under its number) says only what the number and
// the level do not (SDT-3, show-dont-tell audit finding 7), in the marks the
// desk already speaks — ◇ a post to decide, ○ scheduled, ▲ failed (the
// StatusMark table), ◐ an account failing (the account grid) — and a word only
// where no mark fits. Every count stays in the cell's title.
//
// pure — reads in, cells out.

import { bandCounts, inScope, accountOf } from '../marketing-overview/overview-fold.js';
import { linkTotals, campaignCard } from '../marketing-overview/results-fold.js';
// The sweep's own schedule (pure, no imports): one rule for when a post is read, never a second copy here.
import { pullIntervalMs } from '../../../../backend/services/social/stats/stats-schedule.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// The stats sweep runs every 30 minutes (stats-sweep.js TICK_MS): a read due for less than one pass is not late.
const SWEEP_PASS_MS = 30 * MINUTE;
// The sweep reads the site counter every 6 hours (stats-sweep.js LINKS_EVERY_MS); two missed reads is not answering.
const COUNTER_QUIET_MS = 2 * 6 * HOUR;

/** How long ago, short: 0M, 4M, 3H, 2D. */
export const ageWords = (ms) => {
  if (!Number.isFinite(ms)) return null;
  const m = Math.max(0, Math.floor(ms / MINUTE));
  if (m < 60) return `${m}M`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}H`;
  return `${Math.floor(m / (24 * 60))}D`;
};

const cell = (part, label, level, value, what, title, door) => Object.freeze({ part, label, level, value, unit: '', what, title, door });
const unread = (part, label, why, door) => cell(part, label, 'unknown', null, '', `${label} — not read: ${why}`, door);

/** pure — a campaign's pace: on when its KPI share is at least its time share; null when either is not measured. */
export const paceOf = (card) => {
  if (!card?.kpi || card.kpi.ratio === null || card.time === null) return null;
  return card.kpi.ratio >= card.time ? 'on' : 'behind';
};

const POSTS = { kind: 'panel', panel: 'posts' };

const youCell = (waiting, band, house) => {
  const door = { ...POSTS, filter: { status: 'draft' } };
  if (!waiting) return unread('you', '◆ YOU', 'the desk\'s waiting account is not read yet', door);
  const n = band.drafts + band.asks;
  const kinds = [`${band.drafts} to decide`, `${band.groups} in groups`, `${band.asks} asks for you`, `${band.legal} legal marks`,
    `${band.failed} failed`, ...(house ? [`${band.unsorted} accounts with no company`] : [])];
  return cell('you', '◆ YOU', n ? 'warm' : 'ok', n, n ? `◇${band.drafts} · ${band.asks} ASKS` : '', `◆ YOU — ${kinds.join(' · ')}`, door);
};

const accountsCell = (check, scope) => {
  const door = { kind: 'tab', tab: 'accounts' };
  if (!check) return null;
  const rows = (check.accounts || []).filter((r) => inScope(scope, r.companyId));
  const inUse = rows.filter((r) => r.inUse);
  const clear = inUse.filter((r) => r.clear).length;
  const failing = inUse.length - clear;
  const level = failing === 0 ? 'ok' : clear === 0 ? 'hot' : 'warm';
  const what = failing ? `◐${failing}` : '';
  return cell('accounts', 'ACCOUNTS', level, `${clear}/${inUse.length}`, what,
    `ACCOUNTS — ${clear} clear of ${inUse.length} in use · ${failing} failing · ${rows.length - inUse.length} not in use`, door);
};

/** When a send is due, short: the time today, else the day and time. */
const sendWhen = (ms, now) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
};

const queueCell = (entries, now) => {
  const failed = entries.filter((e) => e.status === 'failed').length;
  const approved = entries.filter((e) => e.status === 'approved');
  const times = approved.map((e) => (e.scheduledFor ? Date.parse(e.scheduledFor) : now)).filter(Number.isFinite).sort((a, b) => a - b);
  const next = times.length ? (times[0] <= now ? 'next send now' : `next ${sendWhen(times[0], now)}`) : 'nothing to send';
  const scheduled = approved.length ? `○${approved.length}${times.length ? ` ${times[0] <= now ? 'NOW' : sendWhen(times[0], now)}` : ''}` : '○0';
  return cell('queue', 'QUEUE', failed ? 'hot' : 'ok', failed, failed ? `▲ · ${scheduled}` : scheduled,
    `QUEUE — ${failed} failed sends · ${approved.length} approved to send · ${next}`, { ...POSTS, filter: { status: 'failed' } });
};

const campaignsCell = (cards) => {
  const active = cards.filter((c) => c.status === 'active');
  const paces = active.map((c) => ({ id: c.id, pace: paceOf(c) }));
  const on = paces.filter((p) => p.pace === 'on').length;
  const behind = paces.filter((p) => p.pace === 'behind');
  const unmeasured = paces.length - on - behind.length;
  const first = behind[0]?.id || active[0]?.id || cards[0]?.id || null;
  const level = behind.length === 0 ? 'ok' : on === 0 ? 'hot' : 'warm';
  const what = [behind.length ? `${behind.length} BEHIND` : null, unmeasured ? `${unmeasured} UNMEASURED` : null].filter(Boolean).join(' · ');
  return cell('campaigns', 'CAMPAIGNS', level, `${on}/${active.length}`, what,
    `CAMPAIGNS — ${on} on pace of ${active.length} active (${cards.length} in all) · ${behind.length} behind · ${unmeasured} not measured (no KPI reading or no window; never counted as behind)`,
    { kind: 'panel', panel: first ? `campaign:${first}` : 'campaign:none' });
};

/** pure — the RESULTS cell's facts: the age of the last read and how late each due post is against the sweep's schedule. */
export const readSchedule = (entries, pulls, now) => {
  const posts = entries.filter((e) => e.status === 'sent' && e.postId && Number.isFinite(Date.parse(e.sentAt)));
  const reads = posts.map((e) => Date.parse(pulls?.[e.id] || '')).filter(Number.isFinite);
  const late = posts.map((e) => {
    const interval = pullIntervalMs(now - Date.parse(e.sentAt));
    if (interval === null) return null;
    const by = now - (Date.parse(pulls?.[e.id] || '') || 0) - interval;
    return by >= 0 ? { by, interval } : null;
  }).filter(Boolean);
  return { posts: posts.length, last: reads.length ? Math.max(...reads) : null, late };
};

const resultsCell = (entries, results, now) => {
  const door = { kind: 'read' };
  const s = readSchedule(entries, results?.pulls, now);
  if (!s.posts) return cell('results', 'RESULTS', 'unknown', null, 'NOTHING SENT', 'RESULTS — no sent post to read · press to READ NOW', door);
  const missed = s.late.filter((l) => l.by >= l.interval).length;
  const behind = s.late.filter((l) => l.by >= SWEEP_PASS_MS).length;
  const level = missed ? 'hot' : behind ? 'warm' : 'ok';
  const age = s.last === null ? null : ageWords(now - s.last);
  return cell('results', 'RESULTS', level, age, s.late.length ? `${s.late.length} DUE` : '',
    `RESULTS — last read ${age ? `${age} ago` : 'never'} · ${s.late.length} of ${s.posts} sent posts due a read (${missed} missed a whole read) · new posts are read every 6 hours, daily to 30 days, weekly to 90 · press to READ NOW`, door);
};

const linksCell = (site, links, results, now) => {
  const door = { kind: 'panel', panel: 'links' };
  if (!site) return null;
  if (!site.configured) return cell('links', 'LINKS', 'ok', 'OFF', '', 'LINKS — the site counter is not set up: links in posts stay exactly as written and their clicks are not counted', door);
  const waiting = links.filter((l) => !['published', 'already'].includes(l.published?.state)).length;
  const at = Date.parse(results?.links?.at || '');
  const quiet = links.length > 0 && !(now - at <= COUNTER_QUIET_MS);
  const level = waiting || quiet ? 'warm' : 'ok';
  const age = Number.isFinite(at) ? ageWords(now - at) : null;
  const what = waiting ? `${waiting} WAITING` : quiet ? 'NOT ANSWERING' : `${links.length} LINKS`;
  return cell('links', 'LINKS', level, age, what,
    `LINKS — ${links.length} links counted · ${waiting} not yet on the counter · last count read ${age ? `${age} ago` : 'never'} · the counter is read every 6 hours`, door);
};

const legalCell = (band) => cell('legal', 'LEGAL', band.legal ? 'warm' : 'ok', band.legal, '',
  `LEGAL — ${band.legal} waiting posts carry an open legal mark`, { ...POSTS, filter: { status: 'draft', legal: true } });

const DAY = 24 * HOUR;

const mandateCell = (mandate, now) => {
  const door = { kind: 'tab', tab: 'seat' };
  const view = mandate?.view;
  if (!view) return unread('mandate', 'MANDATE', mandate?.error || 'reading', door);
  const m = view.mandate;
  if (view.standing === 'paused') return cell('mandate', 'MANDATE', 'hot', 'PAUSED', m?.pause?.reason || 'paused', `MANDATE — PAUSED: ${m?.pause?.reason || 'a tripwire'} · decide on SEAT`, door);
  if (view.standing === 'active') {
    const ends = m?.expiresAt ? Date.parse(m.expiresAt) : null;
    const left = ends === null ? 'ON' : Number.isFinite(ends) ? `${Math.max(0, Math.ceil((ends - now) / DAY))}D` : null;
    return cell('mandate', 'MANDATE', 'ok', left, ends === null ? '' : 'LEFT', `MANDATE — ACTIVE · ${ends === null ? 'no end' : `${left} left`} · WITHDRAW on SEAT`, door);
  }
  return cell('mandate', 'MANDATE', 'ok', 'OFF', view.standing === 'expired' ? 'ENDED' : '', `MANDATE — OFF (${view.standing})`, door);
};

/**
 * pure — the board's health strip for one level.
 * @param {object} input
 * @param {?object} input.data - use-marketing-overview's data (null while unread)
 * @param {Record<string, string>} input.errors - what could not be read, by read
 * @param {?{items: object[]}} input.waiting - the desk's one WAITING account
 * @param {?{view: ?object, error: ?string}} input.mandate - use-mandate's read (HOUSE only)
 * @param {object[]} input.accounts - the house's accounts
 * @param {?Set<string>} input.scope - the level's companies; null = the house
 * @param {number} input.now
 */
export const marketingHealth = ({ data, errors = {}, waiting, mandate = null, accounts = [], scope = null, now }) => {
  const house = scope === null;
  const companyOf = (id) => accounts.find((a) => a.id === id)?.companyId ?? null;
  const entries = (data?.queue || []).filter((e) => inScope(scope, companyOf(accountOf(e))));
  const band = bandCounts(waiting, data?.queue || [], accounts, { scope, campaigns: data?.campaigns || [] });
  const totals = linkTotals(data?.links, data?.results?.links?.counts);
  const cards = (data?.campaigns || []).filter((c) => inScope(scope, c.companyId))
    .map((c) => campaignCard(c, { queue: data.queue, results: data.results, totals, now }));
  const or = (why, part, label, door, make) => (why ? unread(part, label, why, door) : make() || unread(part, label, 'no answer', door));
  return Object.freeze([
    errors.queue ? unread('you', '◆ YOU', errors.queue, { ...POSTS, filter: { status: 'draft' } }) : youCell(waiting, band, house),
    or(errors.check, 'accounts', 'ACCOUNTS', { kind: 'tab', tab: 'accounts' }, () => accountsCell(data?.check, scope)),
    or(errors.queue, 'queue', 'QUEUE', { ...POSTS, filter: { status: 'failed' } }, () => queueCell(entries, now)),
    or(errors.bench, 'campaigns', 'CAMPAIGNS', { kind: 'panel', panel: 'campaign:none' }, () => campaignsCell(cards)),
    or(errors.results || errors.queue, 'results', 'RESULTS', { kind: 'read' }, () => resultsCell(entries, data?.results, now)),
    ...(house ? [or(errors.links, 'links', 'LINKS', { kind: 'panel', panel: 'links' }, () => linksCell(data?.site, data?.links || [], data?.results, now))] : []),
    or(errors.queue, 'legal', 'LEGAL', { ...POSTS, filter: { status: 'draft', legal: true } }, () => legalCell(band)),
    ...(house ? [mandateCell(mandate, now)] : []),
  ]);
};
