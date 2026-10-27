// security-view.js — the SECURITY window's pure display law. Every decision
// the pane makes about data lives here, so it is provable with nothing
// faked: severity loudness, ledger filtering, the run and seat lines.
// The impure shell (fetch, state) lives in SecurityApp.jsx; the overview's
// counting is the shared triage-view.js.

import { passesTriage } from './triage-view.js';

/** The ledger's statuses, in the order the office works them. */
export const THREAT_STATUSES = Object.freeze(['new', 'not_affected', 'confirmed', 'mitigated', 'needs_operator']);

/** pure — where a threat lives: its repo, or its layer when it belongs to no repo (hardware, house). */
export const whereOfThreat = (e) => e?.repo || e?.layer || 'other';

/** pure — the operator's word for a where. */
export const whereLabelThreat = (where) => String(where || '').toUpperCase();

// pure — a severity reads loud only while it can hurt.
export const severityLoud = (severity) => severity === 'critical' || severity === 'high';

// pure — a status that still owes action stands out; settled ones dim.
export const statusOwes = (status) => status === 'new' || status === 'confirmed' || status === 'needs_operator';

/** pure — "needs_operator" → "NEEDS OPERATOR". */
export const statusLabel = (status) => (status || '').replace(/_/g, ' ').toUpperCase();

// What a row's event says happened, where the status alone would mislead: an
// overturn's own status is `new` (it would read as a fresh find), a proof and
// a filed fix leave the status as it was.
const EVENT_LABELS = Object.freeze({ reopened: 'REOPENED', verified: 'VERIFIED', 'fix-filed': 'FIX FILED' });

// pure — what one report row says happened.
export const reportLabel = (row) => EVENT_LABELS[row?.event] || statusLabel(row?.status);

/**
 * pure — the measured grounds a verdict carries, as one line: each affected
 * package's exposure class and the dependency that pulls it in. null when the
 * verdict carries none.
 * @param {{contexts?: Array<object>, error?: string}|null|undefined} evidence
 */
export const evidenceLine = (evidence) => {
  if (!evidence) return null;
  if (evidence.error) return `ATTACK SURFACE NOT MAPPED — ${evidence.error}`;
  const parts = (evidence.contexts || []).map((c) => `${c.package}@${c.version}: ${String(c.exposure).replace(/_/g, ' ')}`
    + `${c.roots?.length ? ` (via ${c.roots.join(', ')})` : ''} · ${c.importers} importer(s) · ${c.routes} route(s)`);
  return parts.length ? parts.join(' — ') : null;
};

// pure — who wrote a report row, as the desk names people: the operator by
// role and short wallet (`operator:0x…` raw is a 49-character shout); a lane
// id or `watch` as itself. null when nobody is recorded.
export const reportActor = (by) => {
  if (!by) return null;
  const operator = /^operator:(0x[0-9a-fA-F]{40})$/.exec(String(by));
  if (operator) return `THE OPERATOR ${operator[1].slice(0, 6)}…${operator[1].slice(-4)}`.toUpperCase();
  return String(by).toUpperCase();
};

/** The characters of a threat's text the ledger keeps (threat-lifecycle.js SUMMARY_MAX — a test holds them equal). */
export const LEDGER_TEXT_KEPT = 64_000;

// a heading line opens a section: "### Details"
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;

/**
 * pure — a threat's text as the operator reads it: the lead first (the advisory's own Summary section, or what
 * stands before its first heading, or its first paragraph) and the rest folded. OSV details are GitHub's markdown
 * (### Summary, ### Details, ### PoC, fenced code); a short finding of the watch's own is all lead. `cut` when the
 * text filled what the ledger keeps, so its end is not the advisory's. null when empty.
 * @param {string|null|undefined} text
 * @returns {{lead: string, rest: string|null, cut: boolean}|null}
 */
export const threatTextParts = (text) => {
  const raw = String(text || '');
  const body = raw.replace(/\r\n?/g, '\n').trim();
  if (!body) return null;
  const cut = raw.length >= LEDGER_TEXT_KEPT;
  const lines = body.split('\n');
  const firstHeading = lines.findIndex((l) => HEADING.test(l));
  const split = (lead, rest) => ({ lead: lead.trim(), rest: rest.trim() || null, cut });
  if (firstHeading > 0) return split(lines.slice(0, firstHeading).join('\n'), lines.slice(firstHeading).join('\n'));
  if (firstHeading === 0) {
    const next = lines.findIndex((l, i) => i > 0 && HEADING.test(l));
    const end = next === -1 ? lines.length : next;
    const lead = lines.slice(1, end).join('\n');
    // a first section that is not a summary ("### Details" first) is read whole, not split under the wrong name
    if (!/^(summary|overview|description|impact)$/i.test(HEADING.exec(lines[0])[1]) || !lead.trim()) return { lead: body, rest: null, cut };
    return split(lead, lines.slice(end).join('\n'));
  }
  const [first, ...more] = body.split(/\n\s*\n/);
  return split(first, more.join('\n\n'));
};

/** pure — the advisory's own page, when the threat came from one: the operator reads it whole there. */
export const advisoryUrl = (threat) => (threat?.source === 'osv' && /^[A-Za-z0-9-]+$/.test(threat.externalId || '')
  ? `https://osv.dev/vulnerability/${threat.externalId}`
  : null);

const SEVERITY_ORDER =Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);
const STATUS_ORDER = Object.freeze(['new', 'confirmed', 'needs_operator', 'mitigated', 'not_affected']);

/**
 * The ledger filtered and ordered for the operator's eye: narrow by the
 * overview's press (severity, status or every open status, where; empty =
 * all); the most dangerous and least settled first — criticals, highs, the
 * unread — so the office's debt sorts to the top.
 * Pure.
 * @param {Array<object>} entries
 * @param {{severity?: string, status?: string, where?: string}} [filters]
 */
export const filterThreats = (entries, filters = {}) => (entries ?? [])
  .filter((e) => passesTriage(e, filters, statusOwes, whereOfThreat))
  .slice()
  .sort((a, b) => (
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))
  ));

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
