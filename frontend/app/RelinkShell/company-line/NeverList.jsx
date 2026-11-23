// NeverList — the places this house never writes to (Design note, 2026-11-22: […]).
// One record, kept by the legal office and read by the sales office at every screen, lead and email
// (backend services/legal/never-list.js): one place a line with why it is there. The operator sets the list (it
// stands at once) or answers what the legal member proposed. Until a house has its own, the baseline stands, and
// this says so plainly.
// impure — reads and writes the list through the revenue routes.
import { useEffect, useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { getNeverList, setNeverList, reviewNeverList } from '../../../services/revenue-client.js';

const when = (iso) => (iso ? String(iso).slice(0, 10) : null);
const codesOf = (text) => [...new Set(String(text).toUpperCase().match(/\b[A-Z]{2}\b/g) ?? [])];

export const NeverList = () => {
  const [list, setList] = useState(null);
  const [codes, setCodes] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const take = (l) => { setList(l); setCodes(l.countries.map((c) => c.code).join(', ')); };
  useEffect(() => { let on = true; getNeverList().then((l) => { if (on) take(l); }, () => {}); return () => { on = false; }; }, []);
  if (!list) return null;
  const press = async (work) => { setBusy(true); setError(null); try { take(await work()); setWhy(''); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  // Places already on the list keep their own reason and source; a place added here takes the reason typed.
  const save = () => press(() => setNeverList({ home: list.home ?? undefined, countries: codesOf(codes).map((code) => { const kept = list.countries.find((c) => c.code === code); return kept ? { code, why: kept.why, source: kept.source } : { code, why: why.trim() || 'The operator\'s own rule' }; }) }));
  const state = list.reviewed ? `SET ${when(list.at)}` : 'BASELINE — NOT REVIEWED FOR THIS HOUSE';
  return (
    <Fold id="never-list" title="THE NEVER-LIST" level={2} waits={Boolean(list.proposed)} stats={[`${list.countries.length} PLACES`, state, ...(list.proposed ? ['A LIST WAITS FOR YOU'] : [])]}>
      <Sheet label="the places this house never writes to" rows={list.countries} rowKey={(c) => c.code} rowName={(c) => c.name} rowAttrs={(c) => ({ 'data-never': c.code })}
        columns={[
          { head: 'PLACE', cell: (c) => c.name },
          { head: 'CODE', cell: (c) => c.code, exact: true },
          { head: 'WHY', cell: (c) => c.why, wrap: true },
          { head: 'SOURCE', cell: (c) => c.source ?? null, exact: true },
        ]} />
      {list.proposed ? (
        <div className="spl-standing" data-never-proposed="">
          <p className="spl-standing-next">YOUR LEGAL MEMBER ({String(list.proposed.by).toUpperCase()}) PROPOSES THIS LIST{list.proposed.home ? `, WORKED OUT FOR AN OPERATOR IN ${list.proposed.home}` : ''}:</p>
          <ul className="spl-standing-src" aria-label="the proposed never-list">{list.proposed.countries.map((c) => <li key={c.code}><b>{c.name}</b> [{c.code}] — {c.why}{c.source ? ` (${c.source})` : ''}</li>)}</ul>
          <div className="spl-run-row">
            <button type="button" className="sec-scan label-data" disabled={busy} data-never-approve="" onClick={() => press(() => reviewNeverList('approved'))}>APPROVE — IT REPLACES THE LIST ABOVE</button>
            <button type="button" className="sec-scan label-data" disabled={busy} data-never-return="" onClick={() => press(() => reviewNeverList('returned', why))}>RETURN IT</button>
          </div>
        </div>
      ) : null}
      <div className="spl-run-row">
        <label className="label-data" htmlFor="never-codes">THE LIST, BY CODE</label>
        <input id="never-codes" className="cline-input" value={codes} onChange={(e) => setCodes(e.target.value)} disabled={busy} aria-describedby="never-note" data-never-codes="" />
        <label className="label-data" htmlFor="never-why">WHY, FOR A PLACE YOU ADD</label>
        <input id="never-why" className="cline-input" value={why} onChange={(e) => setWhy(e.target.value)} disabled={busy} placeholder="The operator's own rule" data-never-why="" />
        <button type="button" className="sec-scan label-data" disabled={busy || !codesOf(codes).length} data-never-set="" onClick={save}>SET THE LIST</button>
      </div>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      <p id="never-note" className="spl-note label-data">NOBODY IN THESE PLACES IS FILED AS A LEAD OR WRITTEN TO, FOR ANY COMPANY OR CAMPAIGN: A COMPANY IS HELD WHEN ITS RECORD, ITS DOMAIN, ITS ADDRESS OR ITS OWN PAGES (A CITY, A PHONE CODE, &ldquo;BASED IN&rdquo;) PLACE IT IN ONE. A COMPANY WHOSE COUNTRY IS SIMPLY NOT KNOWN IS NOT HELD. TWO-LETTER COUNTRY CODES, COMMAS BETWEEN THEM; XO IS THE OCCUPIED REGIONS OF UKRAINE. YOUR LEGAL MEMBER KEEPS THIS LIST FOR WHERE YOU ARE AND PROPOSES CHANGES; YOU MAY ADD ANY PLACE BY YOUR OWN RULE.</p>
    </Fold>
  );
};
