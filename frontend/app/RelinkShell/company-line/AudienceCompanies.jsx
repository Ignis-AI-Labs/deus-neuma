// AudienceCompanies — one audience's companies as a list a person can judge at a glance (Design note, 2026-11-16: […]). One fold under the
// audience: its line carries the counts; open, the list counted by country and by size as bars, then a table,
// one company a row: name, site, what it is, the addresses Hunter holds there, country, size, industry, traffic,
// where it stands — the most addresses first. One press keeps only the companies with traffic, another only
// those where Hunter holds named people; the table shows a hundred at a time. The words are audience-companies-view.js.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { companyRows, breakdown, companiesLine, standingWords, trafficShort, isDeadEnd, contactShort, readCount, hunterShort, hasPeople } from './audience-companies-view.js';

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

const COLUMNS = Object.freeze([
  { head: 'NAME', cell: (r) => r.name },
  { head: 'SITE', cell: (r) => <a className="cline-link" href={r.site} target="_blank" rel="noreferrer noopener">{r.domain}</a>, exact: true },
  { head: 'WHAT IT IS', cell: (r) => r.about || null, tone: () => 'dim', title: (r) => r.about },
  { head: 'AT HUNTER', cell: (r) => hunterShort(r), tone: (r) => (r.addresses === 0 ? 'dim' : null), title: (r) => (r.addresses ? `${r.addresses.toLocaleString('en-US')} addresses Hunter holds there, ${(r.named ?? 0).toLocaleString('en-US')} of them named people — a lookup there costs one credit` : null), attrs: () => ({ 'data-company-hunter': '' }) },
  { head: 'REACH', cell: (r) => contactShort(r), tone: (r) => (r.read && !r.read.alive ? 'alert' : null), title: (r) => r.read?.why ?? r.read?.emails.join(', ') ?? null, attrs: () => ({ 'data-company-reach': '' }) },
  { head: 'GEO', cell: (r) => r.country },
  { head: 'SIZE', cell: (r) => r.size },
  { head: 'INDUSTRY', cell: (r) => r.industry },
  { head: 'TRAFFIC', cell: (r) => (r.ranked ? trafficShort(r.rank) : null), tone: (r) => (r.ranked && !r.rank ? 'alert' : null) },
  { head: 'STANDS', cell: (r) => `${standingWords(r.standing)[0]}${r.people ? ` · ${r.people}` : ''}`, tone: (r) => standingWords(r.standing)[1] },
]);

/**
 * @param {{segment: object, gathered: object[], pool: object[], leads: object[], detailOf?: (domain: string) => any, busy?: boolean, onRead?: ?Function}} props — onRead: have the next unread companies' own sites read — detailOf: what a
 *   scored company's row opens to (why it was scored so, who was read), so the table is the one list of them
 */
export const AudienceCompanies = ({ segment, gathered = [], pool = [], leads = [], detailOf = () => null, busy = false, onRead = null }) => {
  const [liveOnly, setLiveOnly] = useState(false);
  const [peopleOnly, setPeopleOnly] = useState(false);
  const rows = companyRows({ gathered, pool, leads });
  if (!rows.length) return <p className="cline-move-t">NO COMPANY GATHERED FOR THIS AUDIENCE YET</p>;
  const counted = breakdown(rows);
  const dead = rows.filter(isDeadEnd).length;
  const sites = readCount(rows);
  return (
    <Fold id={`audience-companies:${segment.id}`} level={2} title="COMPANIES" stats={companiesLine(rows)}>
      <div className="cline-aud-two" data-company-breakdown="">
        <Bars title="GEOGRAPHY" rows={counted.geography} />
        <Bars title="COMPANY SIZE" rows={counted.size} />
      </div>
      <div className="cline-open">
        {onRead && sites.unread ? <button type="button" className="sec-scan label-data" disabled={busy} data-read-sites="" title="Reads each company's own site: whether it is alive, what it says it is, and the addresses it publishes. Up to 40 at a press, the most visited first" onClick={() => onRead(segment)}>READ THE SITES · {sites.unread.toLocaleString('en-US')} UNREAD</button> : null}
        {rows.some(hasPeople) ? <button type="button" className={`sec-scan cline-mini label-data${peopleOnly ? ' is-on' : ''}`} aria-pressed={peopleOnly} data-people-only="" title="Keeps only companies where Hunter holds named people — the ones a lookup would find somebody at" onClick={() => setPeopleOnly(!peopleOnly)}>NAMED PEOPLE AT HUNTER · {rows.filter(hasPeople).length.toLocaleString('en-US')}</button> : null}
        {dead ? <button type="button" className={`sec-scan cline-mini label-data${liveOnly ? ' is-on' : ''}`} aria-pressed={liveOnly} title="Leaves out companies whose site could not be read, and unread ones with no traffic at all" onClick={() => setLiveOnly(!liveOnly)}>HIDE DEAD ENDS · {dead.toLocaleString('en-US')}</button> : null}
      </div>
      <Sheet label={`companies for ${segment.name}`} columns={COLUMNS} rows={rows.filter((r) => (!liveOnly || !isDeadEnd(r)) && (!peopleOnly || hasPeople(r)))} rowKey={(r) => r.domain} rowName={(r) => r.name}
        rowAttrs={(r) => ({ 'data-company': r.domain, 'data-company-standing': r.standing })}
        detail={(r) => (r.standing === 'gathered' ? null : detailOf(r.domain))} detailLabel={() => 'why it was scored so, and who was read'} />
    </Fold>
  );
};
