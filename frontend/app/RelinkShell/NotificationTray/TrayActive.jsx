// TrayActive — ACTIVE in the notification tray (Design note, 2026-11-21: […]). Everything working for the house right now — a lead run, clones — each with what it is, how long
// it has run, where it stands and the last things it did, read every few seconds while the desk is in view.
//   • useActiveWork — the read. An account that cannot be read is said, never drawn as […].
//   • ActiveMark    — beside the bell while anything runs: a still mark and the count (no animation: no-flash law).
//   • ActiveList    — the ACTIVE tab's rows; each opens the window where that work is watched.
import { useEffect, useState } from 'react';
import { getActiveWork } from '../../../services/active-client.js';

const POLL_MS = 4000;
const ran = (since, now) => { const m = Math.max(0, Math.floor((now - Date.parse(since)) / 60000)); return m < 1 ? 'JUST STARTED' : m < 60 ? `${m} MIN` : `${Math.floor(m / 60)} H ${m % 60} MIN`; };

/** impure — what is running, re-read while the page is visible. */
export const useActiveWork = () => {
  const [state, setState] = useState({ active: [], error: null, now: Date.now() });
  useEffect(() => {
    let live = true;
    const read = () => { if (document.hidden) return; getActiveWork().then((r) => { if (live) setState({ active: r?.active ?? [], error: null, now: Date.now() }); }, (e) => { if (live) setState((was) => ({ ...was, error: e.message })); }); };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return state;
};

/** Beside the bell while anything runs. */
export const ActiveMark = ({ count, onOpen }) => (count ? (
  <button type="button" className="ntray-active-mark" onClick={onOpen} aria-label={`${count} thing${count === 1 ? '' : 's'} running — open the list`} data-active-count={count}>
    <span className="ntray-active-dot" aria-hidden="true" />{count} RUNNING
  </button>
) : null);

/** The ACTIVE tab: one block a running thing. */
export const ActiveList = ({ work, onOpen }) => {
  if (work.error && !work.active.length) return <div className="ntray-empty">What is running could not be read: {work.error}</div>;
  if (!work.active.length) return <div className="ntray-empty">Nothing is running right now.</div>;
  return (
    <ul className="ntray-active" aria-label="what is running now">
      {work.active.map((a) => (
        <li key={a.id} className="ntray-active-row" data-active-kind={a.kind}>
          <button type="button" className="ntray-active-open" onClick={() => onOpen(a)} aria-label={`${a.kind}: ${a.title} — open where it is watched`}>
            <span className="ntray-card-kind">{a.kind} · {ran(a.since, work.now)}</span>
            <span className="ntray-card-title">{a.title}</span>
            {a.detail ? <span className="ntray-card-detail">{a.detail}</span> : null}
          </button>
          {a.last?.length ? <ol className="ntray-active-log" aria-label="the last things it did">{a.last.map((l, i) => <li key={`${i}:${l}`}>{l}</li>)}</ol> : null}
        </li>
      ))}
    </ul>
  );
};
