/**
 * What the MARKETING board's slice-4 panels draw, folded from the reads the
 * desk already makes (platform-fold.js, kinds-fold.js) and the COMPANY WATCH
 * fold of a company_updates read (company-watch.js) — on the real store
 * shapes: accounts, queue entries, the results route's posts/series/
 * capability/links, the link map, the mandate view's feed, campaigns' asks, a
 * locked weekly plan, a company_updates report. Pure: real inputs, real
 * outputs, no mock. SHINKEI throughout: an unread total is null with its
 * reason, a platform's metric is only one it reports, a funnel never sums two
 * trees.
 */
import { describe, it, expect } from 'vitest';
import { CAPABILITY } from '../../backend/services/social/stats/stats-metrics.js';
import { platformView, topPosts, dayEnds, firstWords } from '../../frontend/app/RelinkShell/marketing/platform-fold.js';
import { platformFunnel, weekLanes, cmoLog } from '../../frontend/app/RelinkShell/marketing/kinds-fold.js';
import { companyWatch } from '../../backend/services/marketing/company-watch.js';

const H = 36e5;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 24, 12);
const at = (ms) => new Date(NOW + ms).toISOString();
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', companyId: 'northwind' }, { id: 'x-2', channelId: 'x', companyId: 'labs' },
  { id: 'bluesky-1', channelId: 'bluesky', companyId: 'northwind' }, { id: 'telegram-1', channelId: 'telegram', companyId: 'brookmere' },
  { id: 'x-3', channelId: 'x', companyId: 'brookmere' },
];
const COMPANIES = [
  { id: 'northwind', parentId: null, depth: 0 }, { id: 'labs', parentId: 'northwind', depth: 1 }, { id: 'brookmere', parentId: null, depth: 0 },
];
const sent = (id, accountId, text, extra = {}) => ({ id, channelId: accountId.replace(/-\d+$/, ''), accountId, text, status: 'sent', sentAt: at(-3 * D), ...extra });
const QUEUE = [
  sent('p1', 'x-1', 'the harness changed and nothing else did at all'),
  sent('p2', 'x-2', 'labs post'),
  sent('p3', 'bluesky-1', 'sky post'),
  sent('p4', 'telegram-1', 'channel post'),
  sent('p5', 'x-3', 'brookmere post'),
  sent('p6', 'x-1', 'never read'),
  { id: 'd1', channelId: 'x', accountId: 'x-1', text: 'staged thursday', status: 'draft', scheduledFor: at(2 * D) },
  { id: 'd2', channelId: 'bluesky', accountId: 'bluesky-1', text: 'scheduled one', status: 'approved', scheduledFor: at(1 * H) },
  { id: 'd3', channelId: 'x', accountId: 'x-1', text: 'no time yet', status: 'draft' },
  { id: 'd4', channelId: 'x', accountId: 'x-1', text: 'next month', status: 'draft', scheduledFor: at(20 * D) },
  { id: 'r1', channelId: 'x', accountId: 'x-1', kind: 'reply', text: 'a reply', status: 'sent' },
];
const read = (h, metrics) => ({ at: at(h), metrics });
const RESULTS = {
  capability: CAPABILITY,
  unavailable: {},
  posts: {
    p1: { latest: read(-2 * H, { views: 4100, likes: 61, replies: 4 }), series: [read(-3 * D + H, { views: 900, likes: 10, replies: 0 }), read(-2 * H, { views: 4100, likes: 61, replies: 4 })] },
    p2: { latest: read(-1 * D, { views: 300, likes: 2 }), series: [read(-1 * D, { views: 300, likes: 2 })] },
    p3: { latest: read(-2 * H, { likes: 8, shares: 2, replies: 1, quotes: 0 }), series: [read(-2 * H, { likes: 8, shares: 2, replies: 1, quotes: 0 })] },
    p5: { latest: read(-2 * H, { views: 99999 }), series: [read(-2 * H, { views: 99999 })] },
  },
  links: { at: at(-H), counts: [{ code: 'tg1', kind: 'click', day: at(0).slice(0, 10), count: 5 }, { code: 'tg1', kind: 'click', day: at(-D).slice(0, 10), count: 2 },
    { code: 'tg1', kind: 'download', day: at(0).slice(0, 10), count: 1 }, { code: 'k7', kind: 'click', day: at(0).slice(0, 10), count: 61 }, { code: 'k7', kind: 'download', day: at(0).slice(0, 10), count: 22 }] },
};
const LINKS = [{ code: 'tg1', entryId: 'p4', accountId: 'telegram-1' }, { code: 'k7', entryId: 'p1', accountId: 'x-1' }];
const northwind = ACCOUNTS.filter((a) => ['northwind', 'labs'].includes(a.companyId));
const view = (scope, extra = {}, accounts = ACCOUNTS) => platformView({ panel: { scope, ...extra }, accounts, queue: QUEUE, results: RESULTS, links: LINKS, now: NOW });

describe('PLATFORM', () => {
  it('a platform at the level: each metric it shows as a total today and a day-by-day trace of what had been read', () => {
    const v = view({ platform: 'x' }, {}, northwind);
    expect([v.kind, v.posts, v.days, v.metrics.map((m) => m.metric)]).toEqual(['metrics', 3, 7, ['views', 'likes', 'replies']]);
    const seen = v.metrics[0];
    expect(seen.current).toBe(4400);
    const ends = dayEnds(7, NOW);
    expect(seen.values).toEqual(ends.map((t) => [[NOW - 3 * D + H, 900, NOW - 2 * H, 4100], [NOW - D, 300]]
      .map((pts) => { let v2 = null; for (let i = 0; i < pts.length; i += 2) if (pts[i] <= t) v2 = pts[i + 1]; return v2; })
      .filter((x) => x !== null).reduce((a, b) => (a ?? 0) + b, null)));
    expect(seen.values.at(-1)).toBe(4400);
    expect(view({ platform: 'x' }, { show: ['linkClicks', 'views'], window: '30d' }, northwind).metrics.map((m) => [m.word, m.values.length]))
      .toEqual([['SEEN', 30], ['LINK CLICKS', 30]]);
  });

  it('one account; "—" with its reason; a metric the platform does not report is never drawn', () => {
    const one = view({ platform: 'x', accountId: 'x-2' }, { show: ['views'] });
    expect([one.posts, one.metrics[0].current]).toEqual([1, 300]);
    const shares = view({ platform: 'x', accountId: 'x-2' }, { show: ['shares'] }).metrics[0];
    expect([shares.current, shares.why]).toEqual([null, CAPABILITY.x.why]);
    expect(view({ platform: 'bluesky' }, { show: ['views', 'likes'] }).metrics.map((m) => m.metric)).toEqual(['likes']);
    const own = platformView({ panel: { scope: { platform: 'x', accountId: 'x-2' } }, accounts: ACCOUNTS, queue: QUEUE,
      results: { ...RESULTS, posts: {}, unavailable: { 'x-2': { reason: 'the X plan reads no metrics' } } }, links: [], now: NOW });
    expect(own.metrics[0]).toMatchObject({ current: null, why: 'the X plan reads no metrics' });
    expect(view({ platform: 'tiktok' })).toEqual({ kind: 'empty' });
  });

  it('a platform that reports nothing: the clicks its tracked links counted, day by day, a counted none a true 0', () => {
    const tg = view({ platform: 'telegram' });
    expect([tg.kind, tg.codes, tg.current, tg.values.length, tg.values.at(-1), tg.values.at(-2), tg.values[0]]).toEqual(['links', 1, 7, 7, 5, 2, 0]);
    const none = platformView({ panel: { scope: { platform: 'telegram' } }, accounts: ACCOUNTS, queue: QUEUE, results: RESULTS, links: [], now: NOW });
    expect([none.current, none.values.every((v) => v === null)]).toEqual([null, true]);
    expect(none.why).toMatch(/^no tracked link in its posts — a Telegram bot/);
    const unread = platformView({ panel: { scope: { platform: 'telegram' } }, accounts: ACCOUNTS, queue: QUEUE, results: { ...RESULTS, links: null }, links: LINKS, now: NOW });
    expect([unread.current, unread.why]).toEqual([null, 'the site counter has not been read yet']);
  });
});

describe('TOP POSTS', () => {
  it('the posts that did the most by one metric, the most first; unread posts counted apart; a platform filter', () => {
    const t = topPosts({ panel: { scope: { companyId: null }, sort: 'views', count: 3 }, accounts: ACCOUNTS, queue: QUEUE, results: RESULTS });
    expect([t.word, t.rows.map((r) => [r.entry.id, r.value]), t.top, t.sent, t.unranked]).toEqual(['SEEN', [['p5', 99999], ['p1', 4100], ['p2', 300]], 99999, 6, 3]);
    const level = topPosts({ panel: { scope: { companyId: 'northwind' } }, accounts: northwind, queue: QUEUE, results: RESULTS });
    expect([level.sort, level.rows.map((r) => r.entry.id)]).toEqual(['views', ['p1', 'p2']]);
    const sky = topPosts({ panel: { scope: { companyId: null, platform: 'bluesky' } }, accounts: ACCOUNTS, queue: QUEUE, results: RESULTS });
    expect([sky.sort, sky.rows.map((r) => [r.entry.id, r.value])]).toEqual(['likes', [['p3', 8]]]);
    expect(firstWords('the harness changed and nothing else did at all')).toBe('the harness changed and nothing else…');
  });
});

describe('FUNNEL', () => {
  it('one company\'s tree, each step split by platform; another tree never summed in', () => {
    const f = platformFunnel({ companyId: 'northwind', companies: COMPANIES, accounts: ACCOUNTS, queue: QUEUE, results: RESULTS, links: LINKS });
    expect([f.platforms, f.sent]).toEqual([['x', 'bluesky'], 4]);
    const step = (s) => f.steps.find((x) => x.step === s);
    expect(step('reach').parts.map((p) => [p.platform, p.value, p.reporting, p.of])).toEqual([['x', 4400, 2, 3], ['bluesky', null, 0, 1]]);
    expect(step('reach').total).toBe(4400);
    expect(step('engaged').total).toBe(61 + 4 + 2 + 8 + 2 + 1 + 0);
    expect([step('clicked').total, step('converted').total]).toEqual([61, 22]);
    const brook = platformFunnel({ companyId: 'brookmere', companies: COMPANIES, accounts: ACCOUNTS, queue: QUEUE, results: RESULTS, links: LINKS });
    expect([brook.platforms, brook.steps[0].total, brook.steps[2].parts]).toEqual([['telegram', 'x'], 99999,
      [{ platform: 'telegram', value: 7, reporting: 1, of: 1 }, { platform: 'x', value: null, reporting: 0, of: 1 }]]);
    // Every click its codes counted, whatever the day (results-fold.js linkTotals).
    expect(brook.steps[2].total).toBe(7);
  });
});

describe('NEXT 7 DAYS', () => {
  it('one lane per platform, each staged post at its share of the week, today first, now on the axis', () => {
    const w = weekLanes({ accounts: northwind, queue: QUEUE, now: NOW });
    expect(w.lanes.map((l) => [l.platform, l.posts.map((p) => p.entry.id)])).toEqual([['x', ['d1']], ['bluesky', ['d2']]]);
    expect([w.staged, w.unscheduled, w.days.length, w.days[0].today, w.days.filter((d) => d.today).length]).toEqual([2, 1, 7, true, 1]);
    const d1 = w.lanes[0].posts[0].at;
    expect(d1).toBeCloseTo((NOW + 2 * D - w.start) / (7 * D), 6);
    expect(w.nowAt).toBeGreaterThanOrEqual(0);
    expect(w.nowAt).toBeLessThan(1 / 7);
    expect(weekLanes({ accounts: [], queue: QUEUE, now: NOW }).lanes).toEqual([]);
  });
});

describe('CMO LOG', () => {
  const mandate = {
    seat: { laneId: 'kestrel', name: 'Kestrel' }, standing: 'active',
    feed: [
      { id: 'a1', at: at(-H), kind: 'act', what: 'Posted', status: 'sent' }, { id: 'a2', at: at(-2 * D), kind: 'act', what: 'Made an image', status: 'done' },
      { id: 'a3', at: at(-9 * D), kind: 'act', what: 'Posted', status: 'sent' }, { id: 'e1', at: at(-3 * D), kind: 'event', what: 'You granted the mandate', status: 'granted' },
    ],
  };
  const campaigns = [{ id: 'c1', name: 'Launch Week', asks: [{ id: 'k1', from: 'cmo', state: 'open' }, { id: 'k2', from: 'operator', state: 'open' }, { id: 'k3', from: 'cmo', state: 'done' }] }];
  const plan = { status: 'approved', approvedAt: at(-D), days: [{ day: 'monday', theme: 'proof', objective: 'show it', posts: 2 }, { day: 'friday', theme: 'speed', objective: 'race', posts: 0 }] };
  it('the seat, the mandate, the acts of these 7 days, the open asks both ways, the plan by weekday', () => {
    const log = cmoLog({ mandate, campaigns, plan, now: NOW });
    expect([log.seat.name, log.standing, log.acts.map((r) => r.id), log.byWhat]).toEqual(['Kestrel', 'active', ['a1', 'a2'], [['Posted', 1], ['Made an image', 1]]]);
    expect([log.asks.forYou.map((a) => a.id), log.asks.forCmo.map((a) => a.id), log.asks.forYou[0].campaignId]).toEqual([['k1'], ['k2'], 'c1']);
    expect(log.plan.days.map((d) => d.posts)).toEqual([2, 0, 0, 0, 0, 0, 0]);
    expect(log.plan.days[0]).toMatchObject({ day: 'monday', theme: 'proof' });
    expect(cmoLog({ mandate: null, campaigns: [], plan: null, now: NOW })).toMatchObject({ seat: null, standing: null, acts: [], plan: null });
  });
});

describe('COMPANY WATCH', () => {
  const report = {
    company: { id: 'northwind', name: 'Northwind', site: { url: 'https://northwind.example/' }, repos: [{}, {}] },
    window: { since: at(-30 * D), why: 'the date you gave' },
    held: 1,
    repos: [
      {
        path: '/repos/northwind', remote: 'https://github.com/northwind/app.git', role: 'the app', total: 3,
        commits: [{ sha: 'c3', at: at(-H), subject: 'feat(site): the download page' }, { sha: 'c2', at: at(-D), subject: 'fix: the seal' },
          { sha: 'c1', at: at(-2 * D), subject: 'chore: release 0.2.0' }],
        fragments: [{ file: 'changelog.d/download.md', sha: 'c3', text: 'Added\n- A download page for Linux.\n- And its checksum.\n' },
          { file: 'changelog.d/seal.md', sha: 'c2', text: 'Fixed\n- The seal no longer stalls.\n' }],
        notes: [{ file: 'docs/operations/release-notes-0.2.0.md', sha: 'c1', status: 'A', text: '…' }],
      },
      { path: '/repos/site', remote: null, role: 'the website', unread: 'your operator has not let you read it' },
    ],
  };
  it('newest first, a commit never twice, each row its source; an unread repo says why', () => {
    const w = companyWatch(report);
    expect(w.rows.map((r) => [r.kind, r.line, r.sha, r.more])).toEqual([
      ['added', 'A download page for Linux.', 'c3', 1], ['fixed', 'The seal no longer stalls.', 'c2', 0], ['release', 'release 0.2.0', 'c1', 0]]);
    expect(w.rows[0].href).toBe('https://github.com/northwind/app/commit/c3');
    expect(w.rows[2].href).toBe('https://github.com/northwind/app/blob/c1/docs/operations/release-notes-0.2.0.md');
    expect([w.counts, w.total, w.commits, w.repos, w.listed, w.held]).toEqual([{ added: 1, fixed: 1, release: 1 }, 3, 3, 1, 2, 1]);
    expect(w.unread).toEqual([{ repo: 'the website', why: 'your operator has not let you read it' }]);
    expect(w.company).toEqual({ id: 'northwind', name: 'Northwind', site: 'https://northwind.example/' });
    const plain = companyWatch({ ...report, repos: [{ ...report.repos[0], fragments: [], notes: [], remote: '/srv/git/app' }] }, { shown: 2 });
    expect(plain.rows.map((r) => [r.kind, r.line, r.href])).toEqual([['commit', 'the download page', null], ['commit', 'the seal', null]]);
  });
});
