// security-view.js — the SECURITY window's pure display law. Every decision
// the pane makes about data lives here, so it is provable with nothing
// faked: severity loudness, ledger filtering, the posture and run lines.
// The impure shell (fetch, state) lives in SecurityApp.jsx.

/** The ledger's statuses, in the order the office works them. */
export const THREAT_STATUSES = Object.freeze(['new', 'not_affected', 'confirmed', 'mitigated', 'needs_operator']);

/** The watch's layers. */
export const THREAT_LAYERS = Object.freeze(['software', 'hardware', 'house']);

// pure — a severity reads loud only while it can hurt.
export const severityLoud = (severity) => severity === 'critical' || severity === 'high';

// pure — a status that still owes action stands out; settled ones dim.
export const statusOwes = (status) => status === 'new' || status === 'confirmed' || status === 'needs_operator';

/** pure — "needs_operator" → "NEEDS OPERATOR". */
export const statusLabel = (status) => (status || '').replace(/_/g, ' ').toUpperCase();

const SEVERITY_ORDER = Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);
const STATUS_ORDER = Object.freeze(['new', 'confirmed', 'needs_operator', 'mitigated', 'not_affected']);

/**
 * The ledger filtered and ordered for the operator's eye: narrow by status,
 * layer, repo (empty = all); the most dangerous and least settled first —
 * criticals, highs, the unread — so the office's debt sorts to the top.
 * Pure.
 * @param {Array<object>} entries
 * @param {{status?: string, layer?: string, repo?: string}} [filters]
 */
export const filterThreats = (entries, { status, layer, repo } = {}) => (entries ?? [])
  .filter((e) => !status || e.status === status)
  .filter((e) => !layer || e.layer === layer)
  .filter((e) => !repo || e.repo === repo)
  .slice()
  .sort((a, b) => (
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))
  ));

/**
 * The posture strip's counts line: […] — every
 * status that holds anything, in office order. Empty ledger reads honestly.
 * Pure.
 */
export const postureCountsLine = (counts) => {
  const byStatus = counts?.byStatus || {};
  const parts = THREAT_STATUSES
    .filter((s) => byStatus[s] > 0)
    .map((s) => `${statusLabel(s)} ${byStatus[s]}`);
  return parts.length ? parts.join(' · ') : 'THE LEDGER HOLDS NOTHING';
};

/**
 * One run of the watch as one line: when, what it added, what it covered.
 * Pure.
 */
export const runLine = (run) => {
  if (!run?.startedAt) return null;
  const legs = (run.repos || []).map((r) => `${r.repo}:${r.checked ?? 0}deps/${r.hits ?? 0}hits`).join(' ');
  return `${run.startedAt} — ${run.added ?? 0} NEW, ${run.seen ?? 0} known${legs ? ` · ${legs}` : ''}`;
};

/**
 * The seat line: who holds the office, or that it stands empty (the watch
 * stands either way — the posture is never person-dependent).
 * Pure.
 */
export const seatLine = (cso) => (cso?.laneId
  ? `THE SEAT — ${String(cso.laneId).toUpperCase()} · SINCE ${String(cso.designatedAt || '').slice(0, 10)}`
  : 'THE OFFICE STANDS EMPTY — THE WATCH STILL STANDS');

/** pure — the host inventory line, when the watch has probed one. */
export const hostLine = (host) => {
  if (!host) return null;
  const parts = [];
  if (host.kernel) parts.push(`KERNEL ${host.kernel}`);
  if (host.nvidiaDriver) parts.push(`NVIDIA ${host.nvidiaDriver}`);
  if (Array.isArray(host.listeners)) parts.push(`${host.listeners.length} LISTENERS`);
  return parts.length ? parts.join(' · ') : null;
};
