// BenchRunCard — a benchmark the chat launched, watched IN the chat to its end
// (Design note, 2026-10-15: […]). Rides under the bench_run tool chip: while
// the set runs it reads the arm, items done and minutes, with a filling bar;
// when it settles it says so — every arm with ✓/✗ and its score — in the very
// conversation that started it. Polls only while the run is in flight (every
// 5s, nothing while the desk is hidden); a resumed chat reads the sealed runs
// once. OPEN LIVE raises BENCH on its LIVE tab.
import { memo, useEffect, useRef, useState } from 'react';
import { getBenchLive, getBenchReportFile, getBenchRuns } from '../../services/bench-client.js';
import { useWindows } from '../windowing/use-windows.js';
import { uiSound } from '../../services/ui-sound.js';
import { benchRunCardView, BENCH_WATCH_EVENT } from './bench-run-chip-view.js';
import './BenchRunChip.css';

const RUNNING_MS = 5_000;

const BenchRunCardView = ({ bench }) => {
  const windows = useWindows();
  const [view, setView] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer = null;
    const pull = async () => {
      let next = null;
      if (!document.hidden) {
        try {
          const [{ live, chain }, { runs }] = await Promise.all([getBenchLive(), getBenchRuns(100)]);
          next = benchRunCardView(bench, { live, chain, runs });
          if (alive.current) setView(next);
        } catch { /* the plane is away — the card keeps its last reading */ }
      }
      if (alive.current && (!next || next.state === 'running')) timer = setTimeout(pull, RUNNING_MS);
    };
    pull();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [bench.comparisonId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the set's report — the branded page, in the browser (its path, where there is no desktop shell)
  const [reportNote, setReportNote] = useState(null);
  const openReport = async () => {
    uiSound('open');
    setReportNote('pressing the report…');
    try {
      const { html } = await getBenchReportFile(bench.comparisonId);
      const shell = window.neuma;
      const opened = typeof shell?.openInBrowser === 'function' ? await shell.openInBrowser(html) : null;
      setReportNote(opened?.ok ? null : `the report: ${html}`); // no desktop shell — its path, to open by hand
    } catch (err) {
      setReportNote(err.message);
    }
  };

  const open = () => {
    uiSound('open');
    windows?.dispatch?.({ type: 'OPEN', id: 'bench' });
    window.dispatchEvent(new CustomEvent(BENCH_WATCH_EVENT));
  };

  return (
    <div className={`relink-benchcard is-${view?.state ?? 'reading'}`} data-testid="bench-run-card" role="status">
      <span className="relink-benchcard-head label-data">
        {`BENCHMARK · ${bench.cell}${view?.state === 'running' ? ' · RUNNING' : view && view.state !== 'unknown' ? ' · SETTLED' : ''}`}
      </span>
      <span className="relink-benchcard-line">{view?.line ?? 'reading the run…'}</span>
      {view?.fill !== null && view?.fill !== undefined ? (
        <span className="relink-benchchip-bar" aria-hidden="true">
          <span className="relink-benchchip-fill" style={{ transform: `scaleX(${view.fill})` }} />
        </span>
      ) : null}
      <span className="relink-benchcard-acts">
        {view && view.state !== 'running' && view.state !== 'unknown' ? (
          <button type="button" className="lc-sel-trigger relink-benchcard-open label-data" onClick={openReport} data-testid="bench-run-report">OPEN REPORT</button>
        ) : null}
        <button type="button" className="lc-sel-trigger relink-benchcard-open label-data" onClick={open}>OPEN LIVE</button>
      </span>
      {reportNote ? <span className="relink-benchcard-line">{reportNote}</span> : null}
    </div>
  );
};

export const BenchRunCard = memo(BenchRunCardView);
