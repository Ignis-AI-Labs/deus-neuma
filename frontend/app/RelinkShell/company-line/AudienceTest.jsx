// AudienceTest — an audience checked against companies its operator already knows are right for it (backend
// services/sales/audience-test.js). Name a handful of companies that ARE this audience; the house screens exactly
// those from their own pages. Most kept: the audience says what you mean. Many lost: it is too narrow, and each lost
// one says which part of the first sign its page did not show.
// impure — starts the test through the revenue routes; the result comes with the audience's standing.
import { useState } from 'react';
import { testAudience } from '../../../services/revenue-client.js';

const VERDICT = Object.freeze({ holds: 'on', narrow: 'alert' });

/** @param {{audience: {id: string, name: string, examples: ?object}, busy?: boolean, onStarted?: () => void}} props */
export const AudienceTest = ({ audience, busy = false, onStarted = () => {} }) => {
  const [companies, setCompanies] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const [said, setSaid] = useState(null);
  const ex = audience.examples;
  const start = async () => {
    setWorking(true); setError(null); setSaid(null);
    try { const r = await testAudience(audience.id, companies); setSaid(`SCREENING ${r.companies.length} COMPANIES NOW — THE RESULT SHOWS HERE WHEN THE RUN ENDS.`); onStarted(); } catch (e) { setError(e.message); } finally { setWorking(false); }
  };
  return (
    <div className="spl-standing" data-audience-test={audience.id}>
      <p className="spl-note label-data">TEST THIS AUDIENCE AGAINST COMPANIES YOU KNOW ARE RIGHT FOR IT: NAME THREE OR MORE BY THEIR SITE. THEY ARE SCREENED NOW, FROM THEIR OWN PAGES, AND NOTHING IS SPENT.</p>
      <div className="spl-run-row">
        <input className="cline-input" value={companies} onChange={(e) => setCompanies(e.target.value)} disabled={busy || working} placeholder="radical.vc, airstreet.com, conviction.com" aria-label={`Companies that are the audience ${audience.name}, by their site, commas between them`} data-audience-test-companies="" />
        <button type="button" className="sec-scan label-data" disabled={busy || working || !companies.trim()} data-audience-test-start="" onClick={start}>{working ? 'STARTING…' : 'TEST THE AUDIENCE'}</button>
      </div>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {said ? <p className="spl-note label-data" role="status">{said}</p> : null}
      {ex ? (
        <>
          <p className="spl-standing-next" data-audience-test-verdict={ex.verdict} data-tone={VERDICT[ex.verdict]}>{ex.words}</p>
          {ex.lost.length ? (
            <ol className="spl-standing-src" aria-label={`your examples that ${audience.name} did not keep, with why`}>
              <li className="label-data">LOST, AND WHAT ITS PAGE DID NOT SHOW:</li>
              {ex.lost.map((c) => <li key={c.domain} data-audience-test-lost={c.domain}><b>{c.name}</b> ({c.domain}) — {c.why}</li>)}
            </ol>
          ) : null}
          {ex.kept.length ? <p className="spl-note label-data">KEPT: {ex.kept.map((c) => c.domain).join(', ').toUpperCase()}</p> : null}
          {ex.unread.length ? <p className="spl-note label-data">COULD NOT BE READ: {ex.unread.join(', ').toUpperCase()}</p> : null}
          {ex.elsewhere?.length ? <p className="spl-note label-data">NOT JUDGED HERE — ALREADY UNDER ANOTHER AUDIENCE: {ex.elsewhere.map((c) => `${c.domain} (${c.audience})`).join(', ').toUpperCase()}</p> : null}
        </>
      ) : null}
    </div>
  );
};
