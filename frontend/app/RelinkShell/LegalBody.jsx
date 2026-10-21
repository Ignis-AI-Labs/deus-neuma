// LegalBody — the LEGAL window's whole office, pure rendering: the Praetor's
// seat, the watch, and the matters ledger with each matter's readings and
// the law they cite. The display law lives in legal-view.js; the IO lives in
// LegalApp.jsx. NO sound imports — renderable under node.

import './SecurityApp.css';
import './LegalApp.css';
import { formatDateTime } from '../../utils/format.js';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { TriageOverview } from './TriageOverview.jsx';
import { ageTag } from './triage-view.js';
import {
  MATTER_STATUSES,
  severityLoud, statusOwes, statusLabel, areaLabel, seatLine, holderNameFor, runLine, reportsOf,
  whereOfMatter, whereLabelMatter,
} from './legal-view.js';

export const LegalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M8 2 V14 M4.5 14 H11.5 M3 4 H13" />
    <path d="M3 4 L1.5 8.5 H4.5 Z M13 4 L11.5 8.5 H14.5 Z" />
  </svg>
);

// THE SEAT — who holds the Praetor's office; the operator's one act on it.
const SeatSection = ({ clo, lanes, pick, busy, confirmClear, onPick, onSeat, onAskClear, onClear, onCancelClear }) => (
  <section className="legal-seat">
    <p className="legal-sec-head label-data">THE SEAT — CHIEF LEGAL OFFICER</p>
    <p className="legal-note">
      One being holds the office. It reads what the watch finds against the law, cites what it read,
      and hands to a lawyer what needs one. It flags; it is not counsel.
    </p>
    <div className="legal-seat-controls">
      <Select
        fill
        ariaLabel="Chief legal officer holder"
        value={pick}
        onChange={onPick}
        disabled={busy || lanes.length === 0}
        placeholder="— choose the holder —"
        options={lanes.map((l) => ({ value: l.neumaId, label: l.name || l.neumaId }))}
      />
      <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>
        {busy ? 'WORKING…' : 'SEAT'}
      </button>
      {clo && !confirmClear ? (
        <button type="button" className="sec-scan legal-danger label-data" disabled={busy} onClick={onAskClear}>UNSEAT</button>
      ) : null}
    </div>
    {clo && confirmClear ? (
      <div className="legal-confirm">
        <span className="legal-note">«NOTICE» unseat the Praetor? The ledger stays; the watch keeps running; the office stands empty.</span>
        <button type="button" className="sec-scan legal-danger label-data" onClick={onClear} disabled={busy}>UNSEAT</button>
        <button type="button" className="sec-scan label-data" onClick={onCancelClear} disabled={busy}>CANCEL</button>
      </div>
    ) : null}
  </section>
);

// THE MATTER — whole, with the office's readings and the law they rest on.
const MatterDetail = ({ matter, onClose }) => {
  const reports = reportsOf(matter);
  return (
    <div className="sec-detail legal-detail">
      <div className="sec-detail-head">
        <span className="sec-detail-id label-data">{matter.externalId}</span>
        <span className={`sec-tag label-data ${severityLoud(matter.severity) ? 'is-loud' : ''}`}>{String(matter.severity).toUpperCase()}</span>
        <span className={`sec-tag label-data ${statusOwes(matter.status) ? 'is-loud' : ''}`}>{statusLabel(matter.status)}</span>
        <span className="sec-detail-where label-data">{areaLabel(matter.area)}{matter.repo ? ` / ${matter.repo}` : ''}</span>
        <button type="button" className="sec-detail-close label-data" onClick={onClose}>CLOSE</button>
      </div>
      <p className="sec-detail-title">{matter.title}</p>
      {matter.summary ? <p className="sec-detail-summary legal-pre">{matter.summary}</p> : null}
      {matter.regimes?.length ? <p className="sec-detail-line label-data">LAW TO READ — {matter.regimes.join(' · ')}</p> : null}
      {matter.affected?.length ? (
        <ul className="legal-affected">
          {matter.affected.map((a) => <li key={a} className="label-data">{a}</li>)}
        </ul>
      ) : null}
      <p className="sec-detail-line label-data">
        FIRST SEEN {formatDateTime(matter.ingestedAt)} · LAST SEEN {formatDateTime(matter.lastSeenAt)}
        {matter.reviewBy ? ` · REVIEW BY ${matter.reviewBy}` : ''}
      </p>
      <p className="sec-detail-reports label-data">THE PRAETOR&#39;S READINGS</p>
      {reports.length === 0 ? (
        <p className="sec-report-empty label-data">NOT YET READ.</p>
      ) : (
        <ul className="sec-reports">
          {reports.map((h, i) => (
            <li key={`${h.assessedAt}-${i}`} className="sec-report">
              <p className="sec-report-head label-data">
                <span className={`sec-tag label-data ${statusOwes(h.status) ? 'is-loud' : ''}`}>{statusLabel(h.status)}</span>
                {h.assessedBy ? ` BY ${String(h.assessedBy).toUpperCase()}` : ''} · {formatDateTime(h.assessedAt)}
                {h.reviewBy ? ` · REVIEW BY ${h.reviewBy}` : ''}
              </p>
              <p className="sec-report-body">{h.assessment}</p>
              {h.citations?.length ? (
                <ul className="legal-citations">
                  {h.citations.map((c) => <li key={c} className="label-data">{c}</li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const LegalBody = ({
  posture, watch, lanes, entries, detail, busy, error,
  pick, seatBusy, confirmClear, onPick, onSeat, onAskClear, onClear, onCancelClear,
  onPickMatter, onCloseDetail, onRunWatch,
  all, now, filters, onFilter,
}) => {
  const clo = posture?.clo || null;
  return (
    <div className="sec legal">
      <header className="sec-head">
        <span className="sec-head-label label-data">LEGAL</span>
        <span className={`sec-head-seat label-data${clo ? '' : ' legal-empty'}`}>{seatLine(clo, holderNameFor(clo, lanes))}</span>
        <button type="button" className="sec-scan label-data" onClick={onRunWatch} disabled={busy}>
          {busy ? 'READING…' : 'RUN WATCH'}
        </button>
      </header>
      {error ? <p className="sec-error label-data">{error}</p> : null}

      <section className="sec-strip">
        <p className="sec-strip-line label-data">
          {posture?.lastRunAt ? `LAST WATCH ${formatDateTime(posture.lastRunAt)}` : 'THE LEGAL WATCH HAS NEVER RUN ON THIS INSTALL'}
          {posture?.dueForReview ? ` · DUE FOR REVIEW ${posture.dueForReview}` : ''}
        </p>
      </section>

      <TriageOverview
        all={all ?? []} shown={entries.length} statuses={MATTER_STATUSES} owes={statusOwes} statusLabel={statusLabel}
        whereOf={whereOfMatter} whereLabel={whereLabelMatter} filters={filters ?? {}} onFilter={onFilter} now={now} noun="MATTERS"
      />

      <SeatSection
        clo={clo} lanes={lanes} pick={pick} busy={seatBusy} confirmClear={confirmClear}
        onPick={onPick} onSeat={onSeat} onAskClear={onAskClear} onClear={onClear} onCancelClear={onCancelClear}
      />

      <section className="sec-ledger">
        {entries.length === 0 ? (
          <EmptyState title="NOTHING UNDER THESE FILTERS" />
        ) : (
          <ul className="sec-list">
            {entries.map((m) => (
              <li key={m.id}>
                <button type="button" className={`sec-row tri-edge-${m.severity}${detail?.id === m.id ? ' is-open' : ''}`} onClick={() => onPickMatter(m)}>
                  <span className={`sec-tag label-data ${severityLoud(m.severity) ? 'is-loud' : ''}`}>{String(m.severity).toUpperCase()}</span>
                  <span className={`sec-tag label-data ${statusOwes(m.status) ? 'is-loud' : ''}`}>{statusLabel(m.status)}</span>
                  <span className="sec-row-id label-data">{areaLabel(m.area)}</span>
                  <span className="sec-row-title">{m.title}</span>
                  <span className="sec-row-where label-data">{m.repo || ''}</span>
                  <span className="sec-row-age label-data" title="days since first seen">{ageTag(m.ingestedAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {detail ? <MatterDetail matter={detail} onClose={onCloseDetail} /> : null}
      </section>

      <section className="sec-watch">
        <p className="sec-watch-head label-data">THE WATCH</p>
        <p className="sec-watch-line label-data">EVERY 24 HOURS — LICENCES SHIPPED · OUR OWN PAPERS · WHAT THE NEW WORK TOUCHES</p>
        {(watch?.runs ?? []).slice(0, 5).map((run) => (
          <p key={run.startedAt} className="sec-watch-run label-data">{runLine(run)}</p>
        ))}
      </section>
    </div>
  );
};
