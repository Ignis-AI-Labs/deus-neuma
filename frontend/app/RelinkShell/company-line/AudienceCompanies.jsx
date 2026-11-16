// AudienceCompanies — one audience's companies as a list a person can judge at a glance (Design note, 2026-11-16: […]). One fold under the
// audience: its line carries the counts; open, the list counted by country and by size as bars, then a table,
// one company a row: name, site, what it is, country, size, industry, traffic, where it stands. A press keeps
// only the companies with traffic; the table shows a hundred at a time. The words are audience-companies-view.js.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { companyRows, breakdown, companiesLine, pageOf, standingWords, trafficShort, isDeadEnd, contactShort, readCount } from './audience-companies-view.js';

const Bars = ({ title, rows }) => (rows.length ? (
  <div className="cline-bars" role="group" aria-label={title.toLowerCase()}>
    <p className="cline-aud-k label-data">{title}</p>
    <ul className="cline-bars-list">
      {rows.map((r) => (
        <li key={r.label} className="cline-bar" data-bar={r.label}>
          <span className="cline-bar-l">{String(r.label).toUpperCase()}</span>
          <span className="cline-bar-track" aria-hidden="true"><span className="cline-bar-fill" style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} /></span>
          <span className="cline-bar-n">{r.n.toLocaleString('en-US')}</span>
        </li>
      ))}
    </ul>
  </div>
) : null);

/**
 * @param {{segment: object, gathered: object[], pool: object[], leads: object[], detailOf?: (domain: string) => any, busy?: boolean, onRead?: ?Function}} props — onRead: have the next unread companies' own sites read — detailOf: what a
 *   scored company's row opens to (why it was scored so, who was read), so the table is the one list of them
 */
export const AudienceCompanies = ({ segment, gathered = [], pool = [], leads = [], detailOf = () => null, busy = false, onRead = null }) => {
  const [view, setView] = useState({ liveOnly: false, page: 0 });
  const [open, setOpen] = useState(null);
  const rows = companyRows({ gathered, pool, leads });
  if (!rows.length) return <p className="cline-move-t">NO COMPANY GATHERED FOR THIS AUDIENCE YET</p>;
  const counted = breakdown(rows);
  const dead = rows.filter(isDeadEnd).length;
  const sites = readCount(rows);
  const shown = pageOf(rows, view);
  return (
    <Fold id={`audience-companies:${segment.id}`} level={2} title="COMPANIES" stats={companiesLine(rows)}>
      <div className="cline-aud-two" data-company-breakdown="">
        <Bars title="GEOGRAPHY" rows={counted.geography} />
        <Bars title="COMPANY SIZE" rows={counted.size} />
      </div>
      <div className="cline-open">
        <span className="cline-move-t" data-company-range="">SHOWING {shown.from.toLocaleString('en-US')}–{shown.to.toLocaleString('en-US')} OF {shown.total.toLocaleString('en-US')}</span>
        {onRead && sites.unread ? <button type="button" className="sec-scan label-data" disabled={busy} data-read-sites="" title="Reads each company's own site: whether it is alive, what it says it is, and the addresses it publishes. Up to 40 at a press, the most visited first" onClick={() => onRead(segment)}>READ THE SITES · {sites.unread.toLocaleString('en-US')} UNREAD</button> : null}
        {dead ? <button type="button" className={`sec-scan cline-mini label-data${view.liveOnly ? ' is-on' : ''}`} aria-pressed={view.liveOnly} title="Leaves out companies whose site could not be read, and unread ones with no traffic at all" onClick={() => setView({ liveOnly: !view.liveOnly, page: 0 })}>HIDE DEAD ENDS · {dead.toLocaleString('en-US')}</button> : null}
        {shown.pages > 1 ? (
          <>
            <button type="button" className="sec-scan cline-mini label-data" disabled={shown.page === 0} onClick={() => setView({ ...view, page: shown.page - 1 })}>PREVIOUS</button>
            <button type="button" className="sec-scan cline-mini label-data" disabled={shown.page >= shown.pages - 1} onClick={() => setView({ ...view, page: shown.page + 1 })}>NEXT</button>
          </>
        ) : null}
      </div>
      <div className="cline-table-wrap">
        <table className="cline-table" aria-label={`companies for ${segment.name}`}>
          <thead><tr>{['NAME', 'SITE', 'WHAT IT IS', 'REACH', 'GEO', 'SIZE', 'INDUSTRY', 'TRAFFIC', 'STANDS'].map((h) => <th key={h} scope="col" className="label-data">{h}</th>)}</tr></thead>
          <tbody>
            {shown.rows.map((r) => {
              const [words, tone] = standingWords(r.standing);
              const detail = r.standing === 'gathered' ? null : detailOf(r.domain);
              return [
                <tr key={r.domain} data-company={r.domain} data-company-standing={r.standing}>
                  <th scope="row">{detail
                    ? <button type="button" className="cline-table-open" aria-expanded={open === r.domain} aria-label={`${r.name} — why it was scored so, and who was read`} onClick={() => setOpen(open === r.domain ? null : r.domain)}>{open === r.domain ? '▾' : '▸'} {r.name}</button>
                    : r.name}</th>
                  <td><a className="cline-link" href={r.site} target="_blank" rel="noreferrer noopener">{r.domain}</a></td>
                  <td className="cline-table-about" title={r.about}>{r.about}</td>
                  <td className={r.read && !r.read.alive ? 'is-alert' : ''} title={r.read?.why ?? r.read?.emails.join(', ') ?? ''} data-company-reach="">{contactShort(r)}</td>
                  <td>{r.country ?? '—'}</td>
                  <td>{r.size ?? '—'}</td>
                  <td>{r.industry ?? '—'}</td>
                  <td className={r.ranked && !r.rank ? 'is-alert' : ''}>{r.ranked ? trafficShort(r.rank) : '—'}</td>
                  <td><span className={`cline-chip${tone ? ` is-${tone}` : ''}`}>{words}{r.people ? ` · ${r.people}` : ''}</span></td>
                </tr>,
                detail && open === r.domain ? <tr key={`${r.domain}:why`} data-company-detail={r.domain}><td colSpan={9} className="cline-table-detail">{detail}</td></tr> : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </Fold>
  );
};
