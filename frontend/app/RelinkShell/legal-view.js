// legal-view.js — the LEGAL window's pure display law: every decision the
// pane makes about data lives here, provable with nothing faked. The impure
// shell (fetch, state) lives in LegalApp.jsx.

/** The ledger's statuses, in the order the office works them. */
export const MATTER_STATUSES = Object.freeze(['new', 'concern', 'needs_counsel', 'needs_operator', 'resolved', 'no_issue']);

/** Where a matter came from. */
export const MATTER_AREAS = Object.freeze(['license', 'posture', 'product', 'regulation']);

const AREA_LABELS = Object.freeze({
  license: 'LICENCES', posture: 'OUR PAPERS', product: 'NEW WORK', regulation: 'RESEARCH',
});

// pure — a severity reads loud only while it can hurt.
export const severityLoud = (severity) => severity === 'critical' || severity === 'high';

// pure — a status that still owes action stands out; settled ones dim.
export const statusOwes = (status) => ['new', 'concern', 'needs_counsel', 'needs_operator'].includes(status);

/** pure — "needs_counsel" → "NEEDS COUNSEL". */
export const statusLabel = (status) => (status || '').replace(/_/g, ' ').toUpperCase();

/** pure — the operator's word for an area. */
export const areaLabel = (area) => AREA_LABELS[area] || String(area || '').toUpperCase();

const SEVERITY_ORDER = Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);

/**
 * The ledger filtered and ordered for the operator's eye: narrow by status
 * and area (empty = all); what owes action first, then the most serious,
 * then the freshest. Pure.
 * @param {Array<object>} entries
 * @param {{status?: string, area?: string}} [filters]
 */
export const filterMatters = (entries, { status, area } = {}) => (entries ?? [])
  .filter((m) => !status || m.status === status)
  .filter((m) => !area || m.area === area)
  .slice()
  .sort((a, b) => (
    MATTER_STATUSES.indexOf(a.status) - MATTER_STATUSES.indexOf(b.status)
    || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))
  ));

/** pure — […], every status that holds anything. */
export const countsLine = (counts) => {
  const byStatus = counts?.byStatus || {};
  const parts = MATTER_STATUSES.filter((s) => byStatus[s] > 0).map((s) => `${statusLabel(s)} ${byStatus[s]}`);
  return parts.length ? parts.join(' · ') : 'THE LEDGER HOLDS NOTHING';
};

/** pure — the seat line: who holds the office, or that it stands empty. */
export const seatLine = (clo, holderName) => (clo?.laneId
  ? `THE PRAETOR — ${String(holderName || clo.laneId).toUpperCase()} · SINCE ${String(clo.designatedAt || '').slice(0, 10)}`
  : 'NO PRAETOR SEATED — THE WATCH STILL STANDS');

/** pure — the seat holder's name from the roster, else its lane id. */
export const holderNameFor = (clo, lanes) =>
  (clo?.laneId ? (lanes || []).find((l) => l.neumaId === clo.laneId)?.name || clo.laneId : null);

/** pure — one watch run as one line. */
export const runLine = (run) => {
  if (!run?.startedAt) return null;
  const legs = (run.repos || []).map((r) => `${r.repo}: ${r.shipped ?? 0} shipped, ${r.commits ?? 0} commits${r.error ? ' (ERROR)' : ''}`).join(' · ');
  return `${run.startedAt} — ${run.added ?? 0} NEW, ${run.seen ?? 0} known${legs ? ` · ${legs}` : ''}`;
};

/** pure — a matter's reports: its history, or its one verdict before history existed. */
export const reportsOf = (matter) => (matter?.history?.length ? matter.history : (matter?.assessment ? [{
  status: matter.status, assessment: matter.assessment, citations: matter.citations,
  reviewBy: matter.reviewBy, assessedBy: matter.assessedBy, assessedAt: matter.assessedAt,
}] : []));
