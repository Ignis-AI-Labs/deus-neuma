// triage-view.js — the triage overview's display law, shared by every office
// ledger (SECURITY's threats, LEGAL's matters): what must be acted on now,
// where the open work lives, how long it has waited — what is wrong, and
// where, at a glance; open criticals and highs are never left to be found.
//
// pure — each function counts the ledger it is handed and nothing else; the
// office passes its own `owes(status)` so "open" means what that office says.

export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);

/** The status filter value meaning […]. */
export const OPEN = '@open';

const DAY_MS = 86_400_000;

/** pure — whole days since an ISO time, or null when it cannot be read. */
export const daysSince = (iso, now) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
};

const emptyBySeverity = () => Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
const severityOf = (e) => (SEVERITIES.includes(e?.severity) ? e.severity : 'unknown');

/**
 * pure — what cannot wait: the open criticals and highs, and how long the
 * oldest of each has been waiting (days since first seen).
 */
export const mustAct = (entries, owes, now) => {
  const open = (entries ?? []).filter((e) => owes(e.status));
  const of = (sev) => open.filter((e) => e.severity === sev);
  const oldest = (list) => list.reduce((m, e) => Math.max(m, daysSince(e.ingestedAt, now) ?? 0), 0);
  const critical = of('critical');
  const high = of('high');
  return Object.freeze({
    critical: critical.length,
    high: high.length,
    open: open.length,
    oldestCritical: critical.length ? oldest(critical) : null,
    oldestHigh: high.length ? oldest(high) : null,
  });
};

/**
 * pure — severity × status counts. Rows are the severities the ledger holds
 * (the four named ones always, `unknown` only when present); columns are the
 * office's statuses, open ones first. `max` scales the cell shading.
 */
export const severityMatrix = (entries, statuses, owes) => {
  const list = entries ?? [];
  const columns = [...statuses.filter(owes), ...statuses.filter((s) => !owes(s))];
  const rows = SEVERITIES
    .filter((sev) => sev !== 'unknown' || list.some((e) => severityOf(e) === 'unknown'))
    .map((severity) => {
      const cells = columns.map((status) => ({
        status,
        count: list.filter((e) => severityOf(e) === severity && e.status === status).length,
      }));
      return { severity, cells, total: cells.reduce((a, c) => a + c.count, 0) };
    });
  const max = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.count)));
  return Object.freeze({ columns, rows, max });
};

/**
 * pure — where the open work lives: one group per `whereOf(entry)`, its open
 * entries counted by severity, the settled ones counted apart. Ordered by
 * what most needs a hand: criticals, then highs, then open volume.
 */
export const whereGroups = (entries, owes, whereOf) => {
  const groups = new Map();
  for (const e of entries ?? []) {
    const where = whereOf(e) || 'other';
    const g = groups.get(where) ?? { where, open: 0, settled: 0, bySeverity: emptyBySeverity() };
    if (owes(e.status)) {
      g.open += 1;
      g.bySeverity[severityOf(e)] += 1;
    } else {
      g.settled += 1;
    }
    groups.set(where, g);
  }
  return [...groups.values()].sort((a, b) => (
    b.bySeverity.critical - a.bySeverity.critical
    || b.bySeverity.high - a.bySeverity.high
    || b.open - a.open
    || b.settled - a.settled
  ));
};

/** The age buckets, in days since first seen (upper bound exclusive). */
export const AGE_BUCKETS = Object.freeze([
  { key: 'today', label: 'TODAY', below: 1 },
  { key: 'week', label: 'UNDER 7 DAYS', below: 7 },
  { key: 'month', label: 'UNDER 30 DAYS', below: 30 },
  { key: 'older', label: '30 DAYS +', below: Infinity },
]);

/** pure — the open entries by how long they have waited, each bucket by severity. */
export const ageBuckets = (entries, owes, now) => {
  const buckets = AGE_BUCKETS.map((b) => ({ ...b, total: 0, bySeverity: emptyBySeverity() }));
  for (const e of (entries ?? []).filter((x) => owes(x.status))) {
    const d = daysSince(e.ingestedAt, now) ?? 0;
    const b = buckets.find((x) => d < x.below);
    b.total += 1;
    b.bySeverity[severityOf(e)] += 1;
  }
  return buckets;
};

/** pure — does an entry pass the overview's filters (severity, status or OPEN, where)? */
export const passesTriage = (e, { severity, status, where } = {}, owes, whereOf) => (
  (!severity || severityOf(e) === severity)
  && (!status || (status === OPEN ? owes(e.status) : e.status === status))
  && (!where || whereOf(e) === where)
);

/**
 * pure — a press on the overview: the same selection again clears it (a
 * second press on a lit cell returns the whole ledger), anything else
 * replaces the filters with the press's own.
 */
export const toggleFilters = (filters, press) => {
  const same = Object.keys(press).every((k) => (filters?.[k] || '') === (press[k] || ''))
    && Object.keys(filters ?? {}).every((k) => !filters[k] || k in press);
  return same ? {} : { ...press };
};

/** pure — a row's wait as a short tag: "TODAY", "6D". */
export const ageTag = (iso, now) => {
  const d = daysSince(iso, now);
  return d === null ? '—' : d === 0 ? 'TODAY' : `${d}D`;
};
