// SecurityBody — the SECURITY window's whole office, pure rendering. The
// display law lives in security-view.js; the IO lives in SecurityApp.jsx.
// NO sound imports — the module stays renderable under node (the
// static-markup view tests).

import './SecurityApp.css';
import { formatDateTime } from '../../utils/format.js';
import { EmptyState } from './empty-state.jsx';
import { TriageOverview } from './TriageOverview.jsx';
import { ageTag } from './triage-view.js';
import {
  THREAT_STATUSES,
  severityLoud, statusOwes, statusLabel, reportLabel, reportActor, evidenceLine, runLine, seatLine, hostLine,
  whereOfThreat, whereLabelThreat,
} from './security-view.js';

export const SecurityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M8 1.5 L14 3.5 V8 C14 12 11 14.5 8 15 C5 14.5 2 12 2 8 V3.5 Z" />
    <path d="M5.5 8 L7.5 10 L10.5 6" />
  </svg>
);

// THE REPORT — one threat whole, and the office's verdicts in order.
const ThreatDetail = ({ threat, onClose, onReopen, busy }) => {
  const reports = threat.history?.length ? threat.history : (threat.assessment ? [{
    status: threat.status, assessment: threat.assessment,
    assessedBy: threat.assessedBy, assessedAt: threat.assessedAt, githubIssue: threat.githubIssue,
  }] : []);
  return (
    <div className="sec-detail">
      <div className="sec-detail-head">
        <span className="sec-detail-id label-data">{threat.externalId}</span>
        <span className={`sec-tag label-data ${severityLoud(threat.severity) ? 'is-loud' : ''}`}>{String(threat.severity).toUpperCase()}</span>
        <span className={`sec-tag label-data ${statusOwes(threat.status) ? 'is-loud' : ''}`}>{statusLabel(threat.status)}</span>
        <span className="sec-detail-where label-data">{threat.layer}{threat.repo ? ` / ${threat.repo}` : ''}</span>
        {threat.status !== 'new' ? (
          <button type="button" className="sec-detail-close label-data" onClick={onReopen} disabled={busy}>REOPEN</button>
        ) : null}
        <button type="button" className="sec-detail-close label-data" onClick={onClose}>CLOSE</button>
      </div>
      <p className="sec-detail-title">{threat.title}</p>
      {threat.summary ? <p className="sec-detail-summary">{threat.summary}</p> : null}
      {threat.remedy ? <p className="sec-detail-summary sec-detail-remedy"><span className="label-data">REMEDY — </span>{threat.remedy}</p> : null}
      {threat.status === 'mitigated' && threat.verifiedAt ? (
        <p className="sec-detail-line sec-detail-verified label-data">VERIFIED BY THE WATCH {formatDateTime(threat.verifiedAt)}</p>
      ) : null}
      {threat.affected?.length ? (
        <p className="sec-detail-line label-data">AFFECTED — {threat.affected.map((a) => `${a.package}@${a.version}`).join(', ')}</p>
      ) : null}
      {threat.surfaces?.length ? (
        <p className="sec-detail-line label-data">SURFACES — {threat.surfaces.join(' · ')}</p>
      ) : null}
      {threat.githubIssue ? (
        <p className="sec-detail-line label-data">ISSUE — <a href={threat.githubIssue} target="_blank" rel="noreferrer">{threat.githubIssue}</a></p>
      ) : null}
      <p className="sec-detail-line label-data">
        FIRST SEEN {formatDateTime(threat.ingestedAt)} · LAST SEEN {formatDateTime(threat.lastSeenAt)}
      </p>
      <p className="sec-detail-reports label-data">THE OFFICE&#39;S REPORTS</p>
      {reports.length === 0 ? (
        <p className="sec-report-empty label-data">NO VERDICT YET — THIS THREAT IS UNREAD.</p>
      ) : (
        <ul className="sec-reports">
          {reports.map((h, i) => (
            <li key={`${h.assessedAt}-${i}`} className="sec-report">
              <p className="sec-report-head label-data">
                <span className={`sec-tag label-data ${statusOwes(h.status) ? 'is-loud' : ''}`}>{reportLabel(h)}</span>
                {reportActor(h.assessedBy) ? ` BY ${reportActor(h.assessedBy)}` : ''} · {formatDateTime(h.assessedAt)}
                {h.githubIssue ? ' · ISSUE FILED' : ''}
              </p>
              <p className="sec-report-body">{h.assessment}</p>
              {evidenceLine(h.evidence) ? <p className="sec-detail-line sec-report-why label-data">WHY — {evidenceLine(h.evidence)}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const SecurityBody = ({
  posture, scan, watch, all, entries, detail, busy, error, now,
  onPickThreat, onCloseDetail, onRunScan, onReopenThreat,
  filters, onFilter,
}) => (
  <div className="sec">
    <header className="sec-head">
      <span className="sec-head-label label-data">SECURITY</span>
      <span className="sec-head-seat label-data">{seatLine(posture?.cso)}</span>
      <button type="button" className="sec-scan label-data" onClick={onRunScan} disabled={busy}>
        {busy ? 'SCANNING…' : 'RUN SCAN'}
      </button>
    </header>
    {error ? <p className="sec-error label-data">{error}</p> : null}

    <section className="sec-strip">
      <p className="sec-strip-line label-data">
        {scan?.lastRunAt ? `LAST SCAN ${formatDateTime(scan.lastRunAt)}` : 'THE WATCH HAS NEVER RUN ON THIS INSTALL'}
        {hostLine(scan?.host) ? ` · ${hostLine(scan.host)}` : ''}
      </p>
    </section>

    <TriageOverview
      all={all} shown={entries.length} statuses={THREAT_STATUSES} owes={statusOwes} statusLabel={statusLabel}
      whereOf={whereOfThreat} whereLabel={whereLabelThreat} filters={filters} onFilter={onFilter} now={now} noun="THREATS"
    />

    <section className="sec-ledger">
      {entries.length === 0 ? (
        <EmptyState title="NOTHING UNDER THESE FILTERS" />
      ) : (
        <ul className="sec-list">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`sec-row tri-edge-${e.severity}${detail?.id === e.id ? ' is-open' : ''}`}
                onClick={() => onPickThreat(e)}
              >
                <span className={`sec-tag label-data ${severityLoud(e.severity) ? 'is-loud' : ''}`}>{String(e.severity).toUpperCase()}</span>
                <span className={`sec-tag label-data ${statusOwes(e.status) ? 'is-loud' : ''}`}>{statusLabel(e.status)}</span>
                <span className="sec-row-id label-data">{e.externalId}</span>
                <span className="sec-row-title">{e.title}</span>
                <span className="sec-row-where label-data">{e.repo || e.layer}</span>
                <span className="sec-row-age label-data" title="days since first seen">{ageTag(e.ingestedAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail ? <ThreatDetail threat={detail} onClose={onCloseDetail} onReopen={onReopenThreat} busy={busy} /> : null}
    </section>

    <section className="sec-watch">
      <p className="sec-watch-head label-data">THE WATCH</p>
      {(watch?.repos ?? []).map((r) => (
        <p key={r.id} className="sec-watch-line label-data">
          {r.id.toUpperCase()} — {r.path}{r.hasLockfile === false ? ' (NO LOCKFILE — SWEEP ONLY)' : ''}
        </p>
      ))}
      {watch?.host?.expectedPorts?.length ? (
        <p className="sec-watch-line label-data">EXPECTED PORTS — {watch.host.expectedPorts.join(' · ')}</p>
      ) : null}
      {(scan?.runs ?? []).slice(0, 5).map((run) => (
        <p key={run.startedAt} className="sec-watch-run label-data">{runLine(run)}</p>
      ))}
    </section>
  </div>
);
