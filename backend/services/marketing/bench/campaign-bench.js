// campaign-bench — the CAMPAIGN BENCHMARK (campaign plan §6.2, slice 13):
// three scores per campaign, per company and for the house, over the house's
// own real records — exact and repeatable (the same records and the same
// moment give the same numbers), beside the house-economy benchmark.
//
//   STRUCTURE  is each campaign built as the plan says one is (bench-structure.js)
//   HANDS      the operator's touches per 10 published posts, and the share of
//              drafts approved with no edit (bench-hands.js)
//   OUTCOME    KPI progress against time; conversions per 1,000 reach per
//              angle; the best and worst cell — REPORTED, never scored
//
// Honest when data is missing: an item the records cannot answer reads NOT
// MEASURED with the reason, and never counts as met or as missed; a number
// no record reports is "—", never 0.
//
// Pure.

import { entryAccountId } from '../../social/account-shape.js';
import { structureOf, structureScore } from './bench-structure.js';
import { handsOf } from './bench-hands.js';

const NOT_COUNTED = 'not counted in this build yet (tracked links and the stats sweep feed it)';

// pure — OUTCOME for one campaign: what can be read today, and "—" with the
// reason for what cannot.
const outcomeOf = (c, now, results) => {
  const start = Date.parse(`${c.window?.start}T00:00:00Z`);
  const end = Date.parse(`${c.window?.end}T23:59:59Z`);
  const time = Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.round(Math.min(1, Math.max(0, (now - start) / (end - start))) * 1000) / 10 : null;
  return {
    kpi: c.kpi?.metric ? { metric: c.kpi.metric, target: c.kpi.target ?? null, by: c.kpi.by ?? null } : null,
    timeGone: time,
    progress: null,
    perAngle: null,
    best: null,
    worst: null,
    why: results ? null : NOT_COUNTED,
    ...(time === null ? { timeWhy: 'no window declared' } : {}),
  };
};

const scoreOf = (items) => ({ items, ...structureScore(items) });

/**
 * The benchmark of one house. Pure.
 * @param {{house: string, campaigns: object[], entries: object[], accounts: object[],
 *   companies: object[], houseCheck: ?object, results?: ?object[], now: number}} input
 *   entries: the house's own queue entries; campaigns: shape v2; houseCheck: the
 *   house social check (house-check.js), probed or not
 */
export const benchHouse = ({ house, campaigns, entries, accounts, companies, houseCheck, results = null, now }) => {
  const posts = entries.map((e) => ({ ...e, recordedAccountId: e.accountId || null, accountId: entryAccountId(e) }));
  const rows = campaigns.map((c) => {
    const own = posts.filter((e) => e.campaignId === c.id);
    return {
      id: c.id,
      name: c.name,
      companyId: c.companyId || null,
      status: c.status,
      structure: scoreOf(structureOf(c, { posts: own, accounts, houseCheck, results, now })),
      hands: handsOf(own, house),
      outcome: outcomeOf(c, now, results),
    };
  });
  const companyOfAccount = new Map(accounts.map((a) => [a.id, a.companyId || null]));
  const known = new Set(companies.map((c) => c.id));
  const groups = [...companies.map((c) => ({ id: c.id, name: c.name, depth: c.depth })), { id: null, name: 'UNSORTED', depth: 0 }];
  const companyRows = groups.map((g) => {
    const theirs = rows.filter((r) => (g.id === null ? !known.has(r.companyId) : r.companyId === g.id));
    const onAccounts = posts.filter((e) => {
      const owner = companyOfAccount.get(e.accountId) ?? null;
      return g.id === null ? !known.has(owner) : owner === g.id;
    });
    return {
      id: g.id, name: g.name, depth: g.depth, campaigns: theirs.map((r) => r.id),
      structure: scoreOf(theirs.flatMap((r) => r.structure.items)),
      hands: handsOf(onAccounts, house),
    };
  }).filter((c) => c.campaigns.length || c.hands.touches || c.hands.published);
  return {
    at: new Date(now).toISOString(),
    house: {
      campaigns: rows.length,
      structure: scoreOf(rows.flatMap((r) => r.structure.items)),
      hands: handsOf(posts, house),
      houseCheck: houseCheck ? { headline: houseCheck.headline, probed: houseCheck.probed } : null,
    },
    companies: companyRows,
    campaigns: rows,
  };
};

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const num = (v) => (v === null || v === undefined ? '—' : String(v));

const structureLine = (s) => `STRUCTURE ${pct(s.share)} (${s.met} of ${s.measured} met${s.notMeasured ? ` · ${s.notMeasured} not measured` : ''})`;
const handsLine = (h) => `HANDS ${num(h.per10)} touches per 10 published (${h.touches} touches · ${h.published} published)`
  + ` · approved with no edit ${pct(h.firstTime.share)} of ${h.firstTime.approved}${h.trend ? ` · week over week ${h.trend}` : ''}`;

/**
 * The benchmark in words, for a person at a terminal. Pure.
 * @param {object} report - benchHouse output
 */
export const formatBench = (report) => {
  const lines = [
    `# CAMPAIGN BENCHMARK — ${report.at}`,
    `HOUSE · ${report.house.campaigns} campaign(s)`,
    `  ${structureLine(report.house.structure)}`,
    `  ${handsLine(report.house.hands)}`,
    `  house check: ${report.house.houseCheck ? `${report.house.houseCheck.headline}${report.house.houseCheck.probed ? '' : ' (without live probes)'}` : '—'}`,
  ];
  for (const c of report.companies) {
    lines.push('', `${'  '.repeat(c.depth)}COMPANY ${c.name} · ${c.campaigns.length} campaign(s)`,
      `${'  '.repeat(c.depth)}  ${structureLine(c.structure)}`, `${'  '.repeat(c.depth)}  ${handsLine(c.hands)}`);
  }
  for (const r of report.campaigns) {
    lines.push('', `CAMPAIGN ${r.name} [${String(r.id).slice(0, 8)}] · ${r.companyId || 'UNSORTED'} · ${r.status}`,
      `  ${structureLine(r.structure)}`);
    for (const i of r.structure.items) lines.push(`    ${i.met === null ? 'NOT MEASURED' : i.met ? 'MET' : 'NOT MET'} · ${i.label} — ${i.why}`);
    lines.push(`  ${handsLine(r.hands)}`);
    if (r.hands.weeks.length) lines.push(`    weeks: ${r.hands.weeks.map((w) => `${w.week} ${num(w.per10)}`).join(' · ')}`);
    const o = r.outcome;
    lines.push(`  OUTCOME (reported, never scored) · KPI ${o.kpi ? `${o.kpi.metric} → ${num(o.kpi.target)}` : '—'} · window ${pct(o.timeGone)} gone`
      + ` · progress — · per angle — · best/worst —${o.why ? ` (${o.why})` : ''}`);
  }
  return lines.join('\n');
};

