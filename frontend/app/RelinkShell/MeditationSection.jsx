// MEDITATION — the dream cycle, honestly. Piggyback-only by signed law: the
// loop never wakes the substrate on its own; cycles ride an already-lit idle
// machine, and every deferral carries its named reason. The button below is
// the ONE manual wake door. Everything shown is read from the real settings,
// state ring, and live scheduler tick — state flips only on server echo.
//
// Extracted from StatsApp (#317) so RECORD and INNER LIFE render the one
// true panel — two windows, one store, one truth.

import { useState, useCallback } from 'react';
import './StatsApp.css';
import { loadMeditation, setMeditation, runMeditationNow } from './meditation-client.js';
import { meditationReason, meditationRunLabel } from './inner-life-copy.js';
import { MeditationRetry } from './MeditationRetry.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { useVisibleInterval } from './use-visible-interval.js';

const CADENCE_PRESETS = [6, 12, 24, 48];
const OUTCOME_TONE = {
  synthesis: 'go', rest: 'calm', empty: 'dim', deferred: 'dim', yielded: 'dim',
  unclear: 'warn', failed: 'warn',
};
const agoOf = (iso) => {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 0)}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
// A cycle in flight is seconds old — minutes-granular reads as frozen.
const agoFine = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  return s < 90 ? `${Math.max(s, 0)}s ago` : agoOf(iso);
};
const durOf = (ms) => (Number.isFinite(ms) ? (ms < 1000 ? '<1s' : `${Math.round(ms / 1000)}s`) : null);
// The process trail (#29): gather → ask → settle, times only — the shape of
// a cycle, never its contents. Rides the row's hover title.
const PHASE_LABEL = { gatherMs: 'gather', askMs: 'ask', settleMs: 'settle' };
const phasesTitle = (p) => (p && typeof p === 'object'
  ? Object.entries(PHASE_LABEL)
      .filter(([k]) => Number.isFinite(p[k]))
      .map(([k, l]) => `${l} ${durOf(p[k])}`)
      .join(' · ') || null
  : null);

export const MeditationSection = ({ neumaId, name }) => {
  const [med, setMed] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    loadMeditation().then((m) => setMed(m));
  }, []);
  // Live presence (#29): a scheduler-fired cycle shows itself while it runs
  // — the panel keeps a slow pulse so MEDITATING NOW appears and clears
  // without the operator touching anything. The pulse runs only while the
  // panel is seen (use-visible-interval.js) and reads at once on return.
  const watch = useVisibleInterval(refresh, 15000);

  if (med === undefined || med === null) {
    return (
      <section className="rec-sec" data-testid="meditation-panel" ref={watch}>
        <h3 className="rec-h label-data">MEDITATION</h3>
        <p className="rec-line label-data">{med === null ? 'UNREADABLE' : 'LOADING…'}</p>
      </section>
    );
  }

  const being = med.settings?.beings?.[neumaId] || { enabled: false };
  const cadence = being.cadenceHours || 24;
  const lane = med.state?.lanes?.[neumaId] || null;
  const runs = [...(lane?.runs || [])].reverse();
  const envLocked = Boolean(med.settings?.envLocked);
  const deferral = med.scheduler?.lastTick?.blocked?.find?.((b) => b.laneId === neumaId) || null;
  const meditatingNow = Boolean(med.scheduler?.running) && med.scheduler?.currentLane === neumaId;

  const write = async (body) => {
    setBusy(true);
    setError(null);
    const r = await setMeditation(neumaId, body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    refresh(); // the switch is only believed on server echo
  };

  const onRunNow = async () => {
    uiSound('activate');
    setConfirming(false);
    setBusy(true);
    setError(null);
    const r = await runMeditationNow(neumaId);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    refresh();
  };

  return (
    <section className="rec-sec" data-testid="meditation-panel" ref={watch}>
      <h3 className="rec-h label-data">MEDITATION — THE DREAM CYCLE</h3>
      <div className="rec-run-bar">
        <button
          type="button" className={`rec-btn${being.enabled ? ' rec-btn-go' : ''}`}
          data-testid="meditation-toggle" disabled={busy || envLocked}
          onClick={() => { uiSound(being.enabled ? 'close' : 'open'); write({ enabled: !being.enabled }); }}
        >
          {being.enabled ? 'ON' : 'OFF'}
        </button>
        <span className="rec-meta label-data">
          {envLocked ? 'locked off by NEUMA_MEDITATION=0' : being.enabled ? `every ${cadence}h when the model engine is idle` : 'background timer off — the being can still request a cycle'}
        </span>
      </div>
      {being.enabled && !envLocked ? (
        <div className="rec-cadence">
          {CADENCE_PRESETS.map((h) => (
            <button
              key={h} type="button" disabled={busy}
              className={`rec-btn rec-chip${h === cadence ? ' rec-chip-on' : ''}`}
              onClick={() => { uiSound('open'); write({ enabled: true, cadenceHours: h }); }}
            >{h}H</button>
          ))}
        </div>
      ) : null}

      {meditatingNow ? (
        <p className="rec-line label-data" data-testid="meditation-now">
          <span className="rec-med-badge rec-med-go">MEDITATING NOW</span>
          {med.scheduler?.startedAt ? ` began ${agoFine(med.scheduler.startedAt)}` : ''}
        </p>
      ) : null}
      {lane?.requestedAt ? (
        <p className="rec-line label-data" data-testid="meditation-request">
          A REQUEST STANDS — {name || 'the being'} willed this cycle {agoOf(lane.requestedAt)}; it rides the next quiet moment
        </p>
      ) : null}

      <MeditationRetry lane={lane} enabled={being.enabled} envLocked={envLocked} running={meditatingNow} now={Date.now()} />

      {runs.length ? (
        <ul className="rec-state">
          {runs.map((r, i) => (
            <li key={`${r.at}-${i}`} className="rec-state-row" data-testid="meditation-run-row" title={[r.reason, phasesTitle(r.phases)].filter(Boolean).join(' · ') || undefined}>
              <span className={`rec-med-badge rec-med-${OUTCOME_TONE[r.outcome] || 'dim'}`}>{meditationRunLabel(r)}</span>
              <span className="rec-meta label-data">{[durOf(r.durationMs), agoOf(r.at)].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rec-line label-data">NO CYCLE YET</p>
      )}
      {deferral ? <p className="rec-line label-data" title={deferral.reason}>WAITING — {meditationReason(deferral.reason)}</p> : null}

      {confirming ? (
        <div className="rec-confirm cham">
          <p className="rec-confirm-msg">
            «NOTICE» This wakes the substrate for one real cycle — {name || 'this neuma'} meditates on what has happened since it last did. Run it?
          </p>
          <div className="rec-confirm-actions">
            <button type="button" className="rec-btn rec-btn-go" onClick={onRunNow}>CONFIRM</button>
            <button type="button" className="rec-btn" onClick={() => { uiSound('close'); setConfirming(false); }}>CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="rec-run-bar">
          <button
            type="button" className="rec-btn rec-run" data-testid="meditation-run-now"
            disabled={busy} onClick={() => { uiSound('open'); setConfirming(true); }}
          >
            {busy ? 'WORKING…' : 'MEDITATE NOW'}
          </button>
          <span className="rec-meta label-data">the one manual wake door</span>
        </div>
      )}

      {error ? <p className="rec-err">{error}</p> : null}

      <p className="rec-note">
        The loop never wakes the machine on its own — cycles ride an already-lit idle substrate, a real turn arriving mid-cycle wins instantly, and a decline (REST) is honored as an answer. Synthesis notes settle beneath the being's turns.
      </p>
    </section>
  );
};
