// TriageOverview — an office ledger read as a map before it is read as rows:
// what cannot wait (open criticals and highs, and how long they have waited),
// severity × status, where the open work lives, and how old it is. Every
// count is a door: pressing it filters the ledger below to exactly those
// entries; pressing it again returns the whole ledger. Shared by SECURITY and
// LEGAL; the counting is triage-view.js.
//
// pure rendering — node-renderable, no sound, no IO.

import './triage.css';
import { OPEN, SEVERITIES, ageBuckets, mustAct, severityMatrix, toggleFilters, whereGroups } from './triage-view.js';

const SEV_LABEL = Object.freeze({ critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', unknown: 'UNKNOWN' });
const days = (n) => (n === null ? '—' : n === 0 ? 'TODAY' : `${n} DAY${n === 1 ? '' : 'S'}`);

/** One whole split by severity, on a shared axis `max`, so rows compare honestly. */
const SeverityBar = ({ bySeverity, max }) => (
  <span className="tri-bar">
    {SEVERITIES.filter((s) => bySeverity[s] > 0).map((s) => (
      <i key={s} className={`tri-sev-${s}`} style={{ width: `${(bySeverity[s] / max) * 100}%` }} title={`${bySeverity[s]} ${SEV_LABEL[s]}`} />
    ))}
  </span>
);

const MustAct = ({ act, noun, onFilter, filters }) => {
  if (act.critical + act.high === 0) {
    return (
      <div className="tri-must is-clear" role="status">
        <span className="tri-must-calm">NO CRITICAL OR HIGH {noun} OPEN</span>
        <span className="tri-must-sub">{act.open} OPEN AT MEDIUM OR BELOW — WORK THEM OVER TIME</span>
      </div>
    );
  }
  const press = (severity) => onFilter(toggleFilters(filters, { severity, status: OPEN }));
  return (
    <div className="tri-must" role="alert">
      <span className="tri-must-head">MUST ACT</span>
      <button type="button" className={`tri-must-count is-critical${act.critical ? '' : ' is-zero'}`} onClick={() => press('critical')} aria-label={`${act.critical} critical open`}>
        <b>{act.critical}</b><span>CRITICAL</span><small>OLDEST {days(act.oldestCritical)}</small>
      </button>
      <button type="button" className={`tri-must-count is-high${act.high ? '' : ' is-zero'}`} onClick={() => press('high')} aria-label={`${act.high} high open`}>
        <b>{act.high}</b><span>HIGH</span><small>OLDEST {days(act.oldestHigh)}</small>
      </button>
      <span className="tri-must-sub">
        OPEN {noun} AT CRITICAL OR HIGH CANNOT BE IGNORED — THEY STAND HERE UNTIL EACH IS SETTLED
      </span>
    </div>
  );
};

const Matrix = ({ matrix, owes, statusLabel, filters, onFilter }) => (
  <div className="tri-card">
    <p className="tri-card-head">SEVERITY × STATUS</p>
    <table className="tri-matrix">
      <thead>
        <tr>
          <th aria-label="severity" />
          {matrix.columns.map((s) => (
            <th key={s} className={owes(s) ? 'is-open' : 'is-settled'}>
              <button type="button" onClick={() => onFilter(toggleFilters(filters, { status: s }))}>{statusLabel(s)}</button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {matrix.rows.map((row) => (
          <tr key={row.severity}>
            <th>
              <button type="button" className={`tri-sev-tag tri-sev-${row.severity}`} onClick={() => onFilter(toggleFilters(filters, { severity: row.severity }))}>
                {SEV_LABEL[row.severity]}
              </button>
            </th>
            {row.cells.map((c) => {
              const lit = filters.severity === row.severity && filters.status === c.status;
              const loud = c.count > 0 && owes(c.status) && (row.severity === 'critical' || row.severity === 'high');
              return (
                <td key={c.status}>
                  <button
                    type="button"
                    className={`tri-cell${loud ? ' is-loud' : ''}${owes(c.status) ? '' : ' is-settled'}${lit ? ' is-lit' : ''}`}
                    style={{ '--share': matrix.max ? c.count / matrix.max : 0 }}
                    disabled={c.count === 0}
                    onClick={() => onFilter(toggleFilters(filters, { severity: row.severity, status: c.status }))}
                    aria-label={`${c.count} ${SEV_LABEL[row.severity]} ${statusLabel(c.status)}`}
                  >
                    {c.count || '·'}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Where = ({ groups, whereLabel, filters, onFilter }) => {
  const max = Math.max(1, ...groups.map((g) => g.open));
  return (
    <div className="tri-card">
      <p className="tri-card-head">WHERE THE OPEN WORK LIVES</p>
      <ul className="tri-rows">
        {groups.map((g) => (
          <li key={g.where}>
            <button
              type="button"
              className={`tri-row${filters.where === g.where ? ' is-lit' : ''}`}
              onClick={() => onFilter(toggleFilters(filters, { where: g.where, status: OPEN }))}
            >
              <span className="tri-row-name">{whereLabel(g.where)}</span>
              <SeverityBar bySeverity={g.bySeverity} max={max} />
              <span className="tri-row-n">{g.open}<small>{g.settled ? ` +${g.settled} settled` : ''}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Ages = ({ buckets }) => {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <div className="tri-card">
      <p className="tri-card-head">HOW LONG THE OPEN WORK HAS WAITED</p>
      <ul className="tri-rows">
        {buckets.map((b) => (
          <li key={b.key} className="tri-row is-static">
            <span className="tri-row-name">{b.label}</span>
            <SeverityBar bySeverity={b.bySeverity} max={max} />
            <span className="tri-row-n">{b.total}</span>
          </li>
        ))}
      </ul>
      <p className="tri-legend">
        {SEVERITIES.slice(0, 4).map((s) => <span key={s}><i className={`tri-sev-${s}`} />{SEV_LABEL[s]}</span>)}
      </p>
    </div>
  );
};

/** The active filters as one line, with the way back to the whole ledger. */
const Showing = ({ shown, total, filters, statusLabel, whereLabel, onFilter, noun }) => {
  const parts = [
    filters.severity ? SEV_LABEL[filters.severity] : null,
    filters.status ? (filters.status === OPEN ? 'OPEN' : statusLabel(filters.status)) : null,
    filters.where ? whereLabel(filters.where) : null,
  ].filter(Boolean);
  if (total === 0) return <p className="tri-showing">THE LEDGER HOLDS NOTHING</p>;
  return (
    <p className="tri-showing">
      SHOWING <b>{shown}</b> OF {total} {noun}{parts.length ? ` · ${parts.join(' · ')}` : ' · EVERYTHING'}
      {parts.length ? <button type="button" onClick={() => onFilter({})}>SHOW ALL</button> : null}
    </p>
  );
};

export const TriageOverview = ({ all, shown, statuses, owes, statusLabel, whereOf, whereLabel, filters, onFilter, now, noun }) => (
  <section className="tri" aria-label="triage overview">
    <MustAct act={mustAct(all, owes, now)} noun={noun} onFilter={onFilter} filters={filters} />
    <div className="tri-grid">
      <Matrix matrix={severityMatrix(all, statuses, owes)} owes={owes} statusLabel={statusLabel} filters={filters} onFilter={onFilter} />
      <Where groups={whereGroups(all, owes, whereOf)} whereLabel={whereLabel} filters={filters} onFilter={onFilter} />
      <Ages buckets={ageBuckets(all, owes, now)} />
    </div>
    <Showing shown={shown} total={(all ?? []).length} filters={filters} statusLabel={statusLabel} whereLabel={whereLabel} onFilter={onFilter} noun={noun} />
  </section>
);
