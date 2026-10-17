// BenchRunChip — A BENCHMARK IS RUNNING, at the composer's eye level (Founder
// 2026-10-15: […]). Polls the light watch route while the desk is visible — every 15s at
// rest, every 5s while something runs; renders NOTHING when nothing runs.
// The label carries the cell, the arm and the items done; the thin bar fills
// with them. A click opens the BENCH window on LIVE, where the run is watched in full.
import { memo, useEffect, useRef, useState } from 'react';
import { getBenchLive } from '../../services/bench-client.js';
import { useWindows } from '../windowing/use-windows.js';
import { uiSound } from '../../services/ui-sound.js';
import { benchChipView, BENCH_WATCH_EVENT } from './bench-run-chip-view.js';
import './BenchRunChip.css';

const REST_MS = 15_000;
const RUNNING_MS = 5_000;

const BenchRunChipView = () => {
  const windows = useWindows();
  const [view, setView] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer = null;
    const pull = async () => {
      let next = null;
      if (!document.hidden) {
        try { next = benchChipView(await getBenchLive()); } catch { next = null; } // no plane here — nothing to show
        if (alive.current) setView(next);
      }
      if (alive.current) timer = setTimeout(pull, next ? RUNNING_MS : REST_MS);
    };
    pull();
    const onFocus = () => { clearTimeout(timer); pull(); };
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!view) return null;

  const open = () => {
    uiSound('open');
    windows?.dispatch?.({ type: 'OPEN', id: 'bench' });
    // an already-open window turns to LIVE; a new one lands there on its first read
    window.dispatchEvent(new CustomEvent(BENCH_WATCH_EVENT));
  };

  return (
    <button
      type="button"
      className="lc-sel-trigger relink-benchchip"
      onClick={open}
      title={`${view.detail} — open the BENCH window`}
      data-testid="bench-run-chip"
    >
      <span className="relink-benchchip-label">{view.label}</span>
      {view.fill !== null ? (
        <span className="relink-benchchip-bar" aria-hidden="true">
          <span className="relink-benchchip-fill" style={{ transform: `scaleX(${view.fill})` }} />
        </span>
      ) : null}
    </button>
  );
};

// Memoized: the composer re-renders on every keystroke; this does not need to.
export const BenchRunChip = memo(BenchRunChipView);
