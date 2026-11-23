// PastRuns — every lead run on record (Design note, 2026-11-21: […]). A run cleared off the list above, or from before a
// restart, is still here: one a line with what it found, and its row opens onto EVERY line it said, in order.
// The sheet saves as a spreadsheet like every other.
// impure — reads the record through the revenue routes.
import { useEffect, useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { getRunHistory, getRunLines } from '../../../services/revenue-client.js';

const when = (iso) => (iso ? `${String(iso).slice(0, 10)} ${String(iso).slice(11, 16)}` : null);
const n = (v) => (v == null ? null : Number(v).toLocaleString('en-US'));
const minutes = (r) => (r.endedAt ? Math.max(1, Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 60000)) : null);

// Every line one run said, read when its row is opened.
const RunLines = ({ id }) => {
  const [lines, setLines] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { let on = true; getRunLines(id).then((r) => { if (on) setLines(r?.lines ?? []); }, (e) => { if (on) setError(e.message); }); return () => { on = false; }; }, [id]);
  if (error) return <p className="sec-error" role="alert">{error}</p>;
  if (!lines) return <p className="spl-note label-data" role="status">READING WHAT IT DID…</p>;
  if (!lines.length) return <p className="spl-note label-data">NO LINES WERE KEPT FOR THIS RUN — IT RAN BEFORE EVERY LINE WAS KEPT. ITS COUNTS ABOVE STAND.</p>;
  return <ol className="spl-run-log spl-run-log-whole" aria-label={`every line run ${id} said, in order: ${lines.length}`}>{lines.map((l, i) => <li key={`${i}:${l.at}`}>{String(l.at).slice(11, 19)} {l.line}</li>)}</ol>;
};

/** @param {{stamp: string}} props - changes when a run starts, ends or is cleared: the record is read again */
export const PastRuns = ({ stamp }) => {
  const [runs, setRuns] = useState([]);
  useEffect(() => { let on = true; getRunHistory().then((r) => { if (on) setRuns(r?.runs ?? []); }, () => {}); return () => { on = false; }; }, [stamp]);
  if (!runs.length) return null;
  const leads = runs.reduce((t, r) => t + (Number(r.counts?.leads) || 0), 0);
  const c = (key) => (r) => n(r.counts?.[key]);
  return (
    <Fold id="lead-run-past" title="PAST RUNS" level={2} stats={[`${n(runs.length)} RUN${runs.length === 1 ? '' : 'S'}`, `${n(leads)} LEADS`, 'ALL KEPT']}>
      <Sheet label="past lead runs" rows={runs} rowKey={(r) => r.id} rowName={(r) => `the run of ${when(r.startedAt)}`} rowAttrs={(r) => ({ 'data-past-run': r.id })}
        detail={(r) => <RunLines id={r.id} />} detailLabel={() => 'every line it said'}
        columns={[
          { head: 'STARTED', cell: (r) => when(r.startedAt), sort: (r) => String(r.startedAt) },
          { head: 'AUDIENCE', cell: (r) => r.segment ?? r.segmentId },
          { head: 'ENDED', cell: (r) => (r.endedAt ? String(r.ended ?? '').toUpperCase() : 'CUT OFF — THE DESK STOPPED BEFORE IT ENDED'), tone: (r) => (r.endedAt ? undefined : 'alert') },
          { head: 'MINUTES', cell: (r) => minutes(r) },
          { head: 'LEADS', cell: (r) => (r.counts ? `${n(r.counts.leads)} OF ${n(r.want)}` : null), sort: (r) => Number(r.counts?.leads) || 0 },
          { head: 'CREDITS', cell: (r) => n(r.spent) },
          { head: 'LOOKED AT', cell: c('looked') },
          { head: 'DEAD', cell: c('dead') },
          { head: 'A FIT', cell: c('fit') },
          { head: 'SIDE SIGNS ONLY', cell: c('weak') },
          { head: 'NO FIT', cell: c('nofit') },
          { head: 'MOVED', cell: c('moved') },
          { head: 'NO ADDRESS', cell: c('noAddress') },
          { head: 'COUNTRY TO FIND', cell: c('countryOpen') },
          { head: 'VALIDATED', cell: (r) => (r.counts?.checked ? `${n(r.counts.checked)} (${n(r.counts.held)} HOLD, ${n(r.counts.out)} OUT)` : null) },
        ]} />
      <p className="spl-note label-data">EVERY RUN IS KEPT, WITH EVERY LINE IT SAID. WHAT EACH COMPANY WAS SCORED, AND THE WORDS IT WAS SCORED ON, IS ON THE COMPANY&apos;S OWN ROW UNDER FILTER AND VALIDATE.</p>
    </Fold>
  );
};
