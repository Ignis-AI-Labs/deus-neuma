// DevRefreshBar — CHANGES WAITING, a development run only (electron/dev-refresh.cjs). Design note, 2026-11-20: […]. Main watches
// the source and owns what is shown; this bar reads it, and REFRESH rebuilds the desk and restarts the server in place,
// then every desk reloads. A change to the app itself (electron/) cannot be refreshed in place: the bar says so.

import { useEffect, useState } from 'react';
import './DevRefreshBar.css';

// impure — the desktop bridge, absent in a browser or a packaged app's older preload
const bridge = () => (typeof window !== 'undefined' ? window.neuma?.devRefresh : undefined);

/** pure — the bar's lead words for what is waiting */
export const waitingWords = (waiting) => [
  waiting.server ? `server ${waiting.server}` : null,
  waiting.desk ? `desk ${waiting.desk}` : null,
  waiting.app ? `app ${waiting.app}` : null,
].filter(Boolean).join(' · ');

const PHASE = Object.freeze({ building: 'BUILDING THE DESK…', restarting: 'RESTARTING THE SERVER…' });

/** pure render — the bar for a view, or nothing when nothing waits */
export const DevRefreshView = ({ view, pending, onAct }) => {
  const { waiting, files, phase, error, plan } = view;
  const any = waiting.server || waiting.desk || waiting.app;
  if (!any && phase !== 'failed' && !PHASE[phase]) return null;
  const busy = Boolean(PHASE[phase]) || pending;
  return (
    <div className="cham dev-refresh-bar" role="status" aria-label="Changes waiting for a refresh" data-dev-refresh={phase}>
      <span className="dev-refresh-lead label-data">CHANGES WAITING</span>
      <span className="dev-refresh-what label-data" title={files.join('\n')}>{waitingWords(waiting)}</span>
      {PHASE[phase] ? <span className="dev-refresh-phase label-data">{PHASE[phase]}</span> : null}
      {plan.reload ? (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          title="Rebuilds the desk if its code changed and restarts the server in place, then every desk reloads. A reply in progress is kept and continues after; the image engine and dictation start again on their next use."
          onClick={() => onAct('refresh')}
        >
          REFRESH
        </button>
      ) : null}
      {plan.appRestart ? <span className="dev-refresh-note">The app itself changed: quit and start it again to load that part.</span> : null}
      <button type="button" className="dev-refresh-later" disabled={busy} onClick={() => onAct('later')}>later</button>
      {error ? <pre className="dev-refresh-error">{error}</pre> : null}
    </div>
  );
};

/** The desk's mount: shown only in a development run, only while something waits. */
export const DevRefreshBar = () => {
  const [view, setView] = useState(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const dev = bridge();
    if (!dev) return undefined;
    let live = true;
    dev.state().then((v) => { if (live) setView(v); }).catch(() => {});
    const off = dev.onChange((v) => setView(v));
    return () => { live = false; off(); };
  }, []);
  if (!view || view.phase === 'off') return null;
  const act = async (action) => {
    setPending(true);
    try { await bridge()?.act(action); } finally { setPending(false); }
  };
  return <DevRefreshView view={view} pending={pending} onAct={act} />;
};
