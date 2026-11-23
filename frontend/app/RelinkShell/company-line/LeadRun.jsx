// LeadRun — LEADS ON TAP (Design note, 2026-11-21: […]). One row over DISCOVER, FILTER and VALIDATE: pick the audience, say how many leads, START. The house then
// reads each gathered company's site, screens it from its own page, finds the person, confirms one address and files
// the lead — several companies at once (backend sales/lead-run.js) — and this row says where it stands, live.
// SEVERAL RUNS CAN WORK AT ONCE (Design note, 2026-11-21: […]): one an audience, as many as the house's model has places for. Each has its own
// line, its own STOP and its own stream; START stays on the row while a place is free.
// A finished run is CLEARED off this list on a press; nothing is lost: every run, with every line it said, is kept on
// record and listed under PAST RUNS (PastRuns.jsx).
// impure — asks the backend where the run stands every few seconds while one works.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { getLeadRun, startLeadRun, stopLeadRun, clearLeadRun, getRunStanding, gatherFromList } from '../../../services/revenue-client.js';
import { RunStanding } from './RunStanding.jsx';
import { PastRuns } from './PastRuns.jsx';
import { PipelineReview } from './PipelineReview.jsx';
import { NeverList } from './NeverList.jsx';
import { RunSchedule } from './RunSchedule.jsx';
import { announceWaitingChanged } from '../waiting/waiting-changed.js';
import { rowsIn } from './sales-pipeline-view.js';

const POLL_MS = 3000;
const n = (v) => Number(v || 0).toLocaleString('en-US');

// One run: where it stands, its STOP while it works, and its stream with the newest line kept in view.
const RunBlock = ({ run, busy, onStop, onClear, elsewhere = false }) => {
  const c = run.counts;
  const stream = useRef(null);
  const lines = run.last ?? [];
  useEffect(() => { if (stream.current) stream.current.scrollTop = stream.current.scrollHeight; }, [lines.length, lines.at(-1)]);
  return (
    <div className="spl-run-one" data-run={run.active ? 'working' : 'ended'} data-run-id={run.id}>
      <div className="spl-run-row">
        <span className="spl-run-now" role={run.active ? 'status' : undefined}><b>{n(c.leads)}</b> OF {n(run.want)} LEADS · {n(run.spent)}{run.credits ? ` OF ${n(run.credits)}` : ''} CREDITS · {run.segment}{elsewhere ? ' · AN AUDIENCE OF ANOTHER CAMPAIGN' : ''}</span>
        {run.active ? <button type="button" className="sec-scan label-data" disabled={busy} data-run-stop="" aria-label={`Stop the run for ${run.segment}`} onClick={() => onStop(run.id)}>STOP</button>
          : <button type="button" className="sec-scan label-data" disabled={busy} data-run-clear="" aria-label={`Clear the finished run for ${run.segment} from this list; its record is kept`} onClick={() => onClear(run.id)}>CLEAR</button>}
      </div>
      <p className="spl-note label-data" data-run-words="">
        {run.active ? 'WORKING' : `ENDED — ${String(run.ended ?? '').toUpperCase()}`} · {n(run.spent)} CREDITS SPENT ·{c.checked ? ` ${n(c.checked)} WAITING VALIDATED (${n(c.held)} HOLD, ${n(c.out)} OUT, ${n(c.left)} LEFT AS THEY STOOD) ·` : ''} {n(c.looked)} LOOKED AT · {n(c.dead)} DEAD · {n(c.fit)} A FIT · {n(c.weak)} A FIT ONLY ON THE SIDE SIGNS · {n(c.nofit)} NO FIT{c.moved ? ` · ${n(c.moved)} MOVED TO THEIR OWN AUDIENCE` : ''} · {n(c.unclear)} LEFT FOR YOUR SALES MEMBER · {n(c.leads)} LEADS WITH A CONFIRMED ADDRESS{c.countryOpen ? ` (${n(c.countryOpen)} WITH THE COUNTRY TO FIND)` : ''} · {n(c.noAddress)} A FIT WITH NO CONFIRMED ADDRESS
      </p>
      {lines.length ? <ol className="spl-run-log" ref={stream} aria-label={`${run.active ? 'what the run is doing' : 'what the run did'} for ${run.segment}, newest last`}>{lines.map((l, i) => <li key={`${i}:${l}`}>{l}</li>)}</ol> : null}
    </div>
  );
};

/** @param {{engine: object, view: string}} props */
export const LeadRun = ({ engine, view }) => {
  const audiences = rowsIn(engine, view).map((r) => r.segment).filter((s) => s.state === 'approved');
  const [state, setState] = useState({ runs: [], room: 1 });
  const [segment, setSegment] = useState('');
  const [want, setWant] = useState(100);
  const [credits, setCredits] = useState(300);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const take = (r) => setState({ runs: r?.runs ?? (r?.run ? [r.run] : []), room: r?.room ?? 1 });
  const read = useCallback(() => getLeadRun().then(take, () => {}), []);
  useEffect(() => { read(); }, [read]);
  // Where each audience stands and what to do next: read when the row shows, and again whenever a run starts, ends or is cleared.
  const [standing, setStanding] = useState([]);
  const [gathers, setGathers] = useState([]);
  const [tick, setTick] = useState(0);
  const stamp = `${state.runs.length}:${state.runs.filter((r) => r.active).length}`;
  useEffect(() => { let on = true; getRunStanding().then((r) => { if (on) { setStanding(r?.audiences ?? []); setGathers(r?.gathers ?? []); } }, () => {}); return () => { on = false; }; }, [stamp, tick]);
  // While a gather works, the standing is read again every few seconds: the waiting counts rise as it lands.
  const gathering = gathers.some((g) => g.active);
  useEffect(() => { if (!gathering) return undefined; const timer = setInterval(() => setTick((t) => t + 1), POLL_MS * 2); return () => clearInterval(timer); }, [gathering]);
  const gather = async (audienceId, source) => { setBusy(true); setError(null); try { setGathers((await gatherFromList(audienceId, source))?.gathers ?? []); setTick((t) => t + 1); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const standingOf = (id) => standing.find((a) => a.id === id) ?? null;
  const inView = new Set(audiences.map((s) => s.id));
  const working = state.runs.filter((r) => r.active);
  const active = working.length > 0;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(read, POLL_MS);
    return () => { clearInterval(timer); announceWaitingChanged(); }; // the runs ended: every sheet reads again
  }, [active, read]);
  // An audience already being worked is not offered again; START stays while the model has a place free.
  const free = audiences.filter((s) => !working.some((r) => r.segmentId === s.id));
  const chosen = free.find((s) => s.id === segment) ?? free[0] ?? null;
  const room = working.length < state.room;
  const press = async (fn) => { setBusy(true); setError(null); try { take(await fn()); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const sum = (key) => working.reduce((t, r) => t + (Number(r[key] ?? r.counts?.[key]) || 0), 0);
  const last = state.runs[0] ?? null;
  const stats = active ? [...(working.length > 1 ? [`${working.length} RUNS`] : []), `${n(sum('leads'))} OF ${n(sum('want'))} LEADS`, `${n(sum('spent'))} CREDITS`, 'WORKING'] : last ? [`${n(last.counts.leads)} LEADS`, 'ENDED'] : ['NOT RUNNING'];
  return (
    <Fold id="lead-run" title="LEAD RUN" stats={stats} waits={active}>
    <section className="spl-run" aria-label="lead run" data-lead-run={active ? 'working' : last ? 'ended' : 'idle'} data-runs-working={working.length}>
      <div className="spl-run-row">
        <span className="spl-k label-data">{active ? 'ANOTHER RUN' : 'LEAD RUN'}</span>
        {room ? (
          <>
            <select className="cline-input" aria-label="The audience the run works" disabled={busy || !free.length} value={chosen?.id ?? ''} onChange={(e) => setSegment(e.target.value)}>
              {free.length ? free.map((s) => { const a = standingOf(s.id); return <option key={s.id} value={s.id}>{s.name}{a ? ` — ${n(a.waiting)} WAIT${a.next.kind === 'gather' ? ' · GATHER MORE FIRST' : a.next.kind === 'few' ? ' · FEW ARE A FIT' : ''}` : ''}</option>; }) : <option value="">{audiences.length ? 'EVERY APPROVED AUDIENCE IN VIEW IS BEING WORKED' : 'NO APPROVED AUDIENCE IN VIEW'}</option>}
            </select>
            <label className="spl-run-f label-data">LEADS <input className="cline-input spl-run-n" type="number" min="1" max="1000" aria-label="How many leads the run goes for" disabled={busy} value={want} onChange={(e) => setWant(e.target.value)} /></label>
            <label className="spl-run-f label-data">CREDIT LIMIT <input className="cline-input spl-run-n" type="number" min="0" aria-label="The most credits this run may spend on lookups and checks (empty: your monthly rule only)" disabled={busy} value={credits} onChange={(e) => setCredits(e.target.value)} /></label>
            <button type="button" className="sec-scan label-data" disabled={busy || !chosen} data-run-start="" onClick={() => press(() => startLeadRun(chosen.id, Number(want) || 100, Number(credits) || null))}>START THE RUN</button>
          </>
        ) : <span className="spl-note label-data" data-run-full="">{n(working.length)} RUNS ARE WORKING — EVERY PLACE YOUR MODEL HAS FOR THEM. STOP ONE, OR WAIT FOR ONE TO END.</span>}
        {working.length > 1 ? <button type="button" className="sec-scan label-data" disabled={busy} data-run-stop-all="" onClick={() => press(() => stopLeadRun())}>STOP ALL</button> : null}
        {state.runs.length - working.length > 1 ? <button type="button" className="sec-scan label-data" disabled={busy} data-run-clear-all="" onClick={() => press(() => clearLeadRun())}>CLEAR FINISHED</button> : null}
      </div>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {chosen && standingOf(chosen.id) && standingOf(chosen.id).next.kind !== 'run' ? <p className="spl-note label-data" role="status" data-run-advice={standingOf(chosen.id).next.kind}>{standingOf(chosen.id).next.words}</p> : null}
      <p className="spl-note label-data">THE HOUSE READS EACH GATHERED COMPANY, SCREENS IT FROM ITS OWN PAGE, FINDS THE PERSON, CONFIRMS ONE ADDRESS AND FILES THE LEAD — SEVERAL AT ONCE. UP TO {n(state.room)} RUN{state.room === 1 ? '' : 'S'} CAN WORK TOGETHER, ONE AN AUDIENCE; THEY SHARE YOUR MODEL, SO EACH GOES SLOWER THE MORE RUN BESIDE IT. LOOKUPS SPEND YOUR CREDITS UNDER YOUR SPENDING RULE. NOTHING IS EMAILED.</p>
      {state.runs.map((run) => <RunBlock key={run.id} run={run} busy={busy} onStop={(id) => press(() => stopLeadRun(id))} onClear={(id) => press(() => clearLeadRun(id))} elsewhere={!inView.has(run.segmentId)} />)}
      <RunStanding audiences={standing.filter((a) => inView.has(a.id))} gathers={gathers} busy={busy} onGather={gather} />
      <RunSchedule audiences={audiences.map((s) => ({ id: s.id, name: s.name }))} />
      <PipelineReview inView={inView} stamp={stamp} />
      <NeverList />
      <PastRuns stamp={stamp} />
    </section>
    </Fold>
  );
};
