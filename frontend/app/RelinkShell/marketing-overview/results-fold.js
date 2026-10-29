// results-fold.js — what the house's posts did, folded for the MARKETING
// overview (campaign plan §4.4, §5): each post's reading, the funnel
// reach → engaged → clicked → converted at every level, a campaign's KPI
// against its target and its time against its window, the angle × account
// matrix, and the per-tree roll-up (a tree's numbers never sum across two
// trees). Pure.
//
// SHINKEI: a value no platform reported is null and draws "—"; a sum is the
// sum of what was reported and says how many posts reported it. Attribution
// is last click by code (the site counter's), and the desk says so.

const ENGAGEMENT = Object.freeze(['likes', 'replies', 'shares', 'saves']);
const DAY = 24 * 60 * 60 * 1000;

/** Each post's clicks and downloads from the counter's counts for its codes; null when it has none. */
export const linkTotals = (links, counts) => {
  const byCode = new Map();
  for (const c of counts || []) {
    const t = byCode.get(c.code) || { click: 0, download: 0 };
    if (c.kind === 'click' || c.kind === 'download') t[c.kind] += Number(c.count) || 0;
    byCode.set(c.code, t);
  }
  const out = new Map();
  for (const l of links || []) {
    if (!l.entryId) continue;
    const t = out.get(l.entryId) || { clicks: 0, downloads: 0, codes: 0 };
    const c = byCode.get(l.code) || { click: 0, download: 0 };
    out.set(l.entryId, { clicks: t.clicks + c.click, downloads: t.downloads + c.download, codes: t.codes + 1 });
  }
  return out;
};

/**
 * One post's facts: reach (views), engaged (the reported engagement counts),
 * clicks and downloads through its codes, its series. Null where unreported.
 * @param {object} entry
 * @param {{posts?: Record<string, {latest: object, series: object[]}>}} results
 * @param {Map<string, object>} totals - linkTotals output
 */
export const postFacts = (entry, results, totals) => {
  const read = results?.posts?.[entry.id] || null;
  const m = read?.latest?.metrics || {};
  const engagedParts = ENGAGEMENT.filter((k) => Number.isFinite(m[k]));
  const link = totals.get(entry.id) || null;
  return {
    entryId: entry.id,
    reach: Number.isFinite(m.views) ? m.views : null,
    engaged: engagedParts.length ? engagedParts.reduce((s, k) => s + m[k], 0) : null,
    clicked: link ? link.clicks : (Number.isFinite(m.linkClicks) ? m.linkClicks : null),
    converted: link ? link.downloads : null,
    metrics: m,
    series: (read?.series || []).map((s) => ({ at: s.at, views: Number.isFinite(s.metrics?.views) ? s.metrics.views : null })),
    readAt: read?.latest?.at || null,
  };
};

const STEPS = Object.freeze(['reach', 'engaged', 'clicked', 'converted']);

/** The funnel over some posts' facts: each step's reported sum and how many posts reported it. */
export const funnelOf = (facts) => Object.fromEntries(STEPS.map((step) => {
  const reported = facts.filter((f) => f[step] !== null);
  return [step, { value: reported.length ? reported.reduce((s, f) => s + f[step], 0) : null, reporting: reported.length, of: facts.length }];
}));

/** A step-to-step rate, or null when either side is unreported or the base is zero. */
export const rateOf = (from, to) => (from?.value && to?.value !== null && to?.value !== undefined ? to.value / from.value : null);

/**
 * The KPI against its target: conversions are downloads for a downloads goal
 * (the only conversion the counter counts today), clicks the code clicks,
 * reach the views; followers are not measured yet. Null value draws "—".
 */
export const kpiProgress = (campaign, funnel) => {
  const kpi = campaign?.kpi;
  if (!kpi) return null;
  const value = kpi.metric === 'conversions' ? (campaign.goal?.kind === 'downloads' ? funnel.converted.value : null)
    : kpi.metric === 'clicks' ? funnel.clicked.value
      : kpi.metric === 'reach' ? funnel.reach.value
        : null;
  return { metric: kpi.metric, target: kpi.target, by: kpi.by, value, ratio: value === null ? null : Math.min(1, value / kpi.target) };
};

/** How far through its window a campaign is, 0..1, or null with no window. */
export const timeProgress = (window, now) => {
  if (!window?.start || !window?.end) return null;
  const start = Date.parse(`${window.start}T00:00:00Z`);
  const end = Date.parse(`${window.end}T00:00:00Z`) + DAY;
  if (!(end > start)) return null;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
};

/** Each sub's account, lit when a post of this campaign is staged on it for the coming 7 days. */
export const subCells = (campaign, queue, now) => (campaign?.subs || []).map((s) => ({
  accountId: s.accountId,
  staged: (queue || []).some((e) => e.campaignId === campaign.id && (e.accountId || `${e.channelId}-1`) === s.accountId
    && ['draft', 'approved'].includes(e.status) && e.scheduledFor && Date.parse(e.scheduledFor) >= now && Date.parse(e.scheduledFor) <= now + 7 * DAY),
}));

/** A campaign's card: its posts' funnel, its KPI, its time, its subs. */
export const campaignCard = (campaign, { queue, results, totals, now }) => {
  const posts = (queue || []).filter((e) => e.campaignId === campaign.id && e.status === 'sent');
  const funnel = funnelOf(posts.map((e) => postFacts(e, results, totals)));
  return {
    id: campaign.id, name: campaign.name, companyId: campaign.companyId, status: campaign.status, goal: campaign.goal,
    funnel, kpi: kpiProgress(campaign, funnel), time: timeProgress(campaign.window, now), window: campaign.window,
    subs: subCells(campaign, queue, now), sent: posts.length,
    asksForYou: (campaign.asks || []).filter((a) => a.state === 'open' && a.from === 'cmo').length,
  };
};

/**
 * Each company tree's funnel: the sum over its own companies' campaigns,
 * never across two trees.
 * @param {object[]} cards - campaignCard outputs
 * @param {Array<{id: string, rootId: string, name: string, depth: number}>} companies
 */
export const treeRollup = (cards, companies) => companies.filter((c) => c.depth === 0).map((root) => {
  const ids = new Set(companies.filter((c) => c.rootId === root.id).map((c) => c.id));
  const theirs = cards.filter((k) => ids.has(k.companyId));
  const sum = (step) => {
    const values = theirs.map((k) => k.funnel[step].value).filter((v) => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { rootId: root.id, name: root.name, campaigns: theirs.length, reach: sum('reach'), clicked: sum('clicked'), converted: sum('converted') };
});

/**
 * The ANGLE × ACCOUNT matrix: each cell's posts, reach and conversions, and
 * conversions per 1,000 reach where both were reported.
 * @param {object[]} campaigns
 * @param {object[]} queue
 * @param {(entry: object) => object} factsOf
 */
export const angleMatrix = (campaigns, queue, factsOf) => {
  const angleOf = (e, c) => c?.angles?.find((a) => a.id === e.angleId)?.name
    || c?.angles?.find((a) => a.name === e.pillar)?.name || e.pillar || null;
  const cells = new Map();
  const accounts = new Set();
  const angles = new Set();
  for (const e of queue || []) {
    if (e.status !== 'sent' || !e.campaignId) continue;
    const angle = angleOf(e, campaigns.find((c) => c.id === e.campaignId));
    if (!angle) continue;
    const accountId = e.accountId || `${e.channelId}-1`;
    accounts.add(accountId);
    angles.add(angle);
    const key = `${angle}|${accountId}`;
    const f = factsOf(e);
    const c = cells.get(key) || { posts: 0, reach: null, converted: null };
    cells.set(key, {
      posts: c.posts + 1,
      reach: f.reach === null ? c.reach : (c.reach || 0) + f.reach,
      converted: f.converted === null ? c.converted : (c.converted || 0) + f.converted,
    });
  }
  const cols = [...accounts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    cols,
    rows: [...angles].sort().map((angle) => ({
      angle,
      cells: cols.map((accountId) => {
        const c = cells.get(`${angle}|${accountId}`) || null;
        return { accountId, ...(c || { posts: 0, reach: null, converted: null }), per1k: c?.reach && c.converted !== null ? (c.converted / c.reach) * 1000 : null };
      }),
    })),
  };
};
