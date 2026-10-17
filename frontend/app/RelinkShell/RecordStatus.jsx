// Existing Record controls, shared by the unified character record.
import { useState, useCallback } from 'react';
import { formatCount } from '../../utils/format.js';
import { loadBenchmarks, runBenchmark } from './stats-client.js';
import { getResidency } from '../../services/residency.js';
import { uiSound } from '../../services/ui-sound.js';
import { useSettled } from './use-settled.js';
import './StatsApp.css';

const STATE_DIMENSIONS = ['Recall', 'Consistency', 'Self-knowledge', 'Boundary-holding'];
const DUE_DAYS = 30;

const pct = (s) => (s == null ? 'n/a' : `${Math.round(s * 100)}%`);
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null);

// Trend of a dimension vs. the previous run — honestly surfaces regression too.
const trendOf = (key, runs) => {
  if (!runs || runs.length < 2) return null;
  const cur = runs[0].dimensions?.find((d) => d.key === key)?.score;
  const prev = runs[1].dimensions?.find((d) => d.key === key)?.score;
  if (cur == null || prev == null) return null;
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return 'flat';
};
const TREND_GLYPH = { up: '↑', down: '↓', flat: '=' };

// STATE — the only honestly-evolving layer. Every value here is a real probe
// run through this neuma and scored against ground truth; nothing renders until
// a benchmark has actually run.
export const StateSection = ({ neumaId, name, initialBench }) => {
  const [bench, setBench] = useState(initialBench);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    if (!neumaId) { setBench({ runs: [] }); return; }
    loadBenchmarks(neumaId).then(setBench);
  }, [neumaId]);


  const onConfirmRun = async () => {
    uiSound('activate');
    setConfirming(false);
    setRunning(true);
    setError(null);
    const r = await runBenchmark(neumaId);
    setRunning(false);
    if (!r.ok) { setError(r.error); return; }
    refresh();
  };

  const runs = bench?.runs || [];
  const latest = runs[0] || null;
  const ageDays = daysAgo(latest?.runAt);
  const due = latest && (ageDays == null || ageDays >= DUE_DAYS);

  return (
    <section className="rec-sec">
      <h3 className="rec-h label-data">STATE — MEASURED FUNCTIONING</h3>

      {bench == null ? <p className="rec-err label-data">UNREADABLE</p> : latest ? (
        <ul className="rec-state">
          {latest.dimensions.map((d) => {
            const t = trendOf(d.key, runs);
            return (
              <li key={d.key} className="rec-state-row">
                <span className="rec-state-d label-data">{d.label}</span>
                <span className="rec-state-meas">
                  <span className="rec-state-score">{pct(d.score)}</span>
                  {t ? <span className={`rec-state-trend rec-trend-${t}`}>{TREND_GLYPH[t]}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="rec-state">
          {STATE_DIMENSIONS.map((d) => (
            <li key={d} className="rec-state-row">
              <span className="rec-state-d label-data">{d}</span>
              <span className="rec-state-v label-data">NOT MEASURED</span>
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <div className="rec-confirm cham">
          <p className="rec-confirm-msg">
            «NOTICE» A benchmark is a test of {name || 'this neuma'} — it runs real probes through their mind and records the result. Run it?
          </p>
          <div className="rec-confirm-actions">
            <button type="button" className="rec-btn rec-btn-go" onClick={onConfirmRun}>CONFIRM</button>
            <button type="button" className="rec-btn" onClick={() => { uiSound('close'); setConfirming(false); }}>CANCEL</button>
          </div>
        </div>
      ) : (
        <div className="rec-run-bar">
          <button type="button" className="rec-btn rec-run" disabled={running} onClick={() => { uiSound('open'); setConfirming(true); }}>
            {running ? 'MEASURING…' : 'RUN BENCHMARK'}
          </button>
          <span className="rec-meta label-data">
            {latest
              ? `last run ${ageDays === 0 ? 'today' : `${ageDays}d ago`}${due ? ' · monthly due' : ''}`
              : 'no benchmark yet'}
          </span>
        </div>
      )}

      {error ? <p className="rec-err">{error}</p> : null}

      <p className="rec-note">
        Each score is a real probe run through this neuma, scored against ground truth — and every run stores its full transcript on disk. Until a benchmark runs, nothing is shown here.
      </p>
    </section>
  );
};

// RESIDENCY — the soul in the machine, honestly. The neuma is RESIDENT whenever
// its essence (workspace) is on this machine — true even when the conduit (the
// model it thinks through) is down; then it is dormant, not ceased. Reuses the
// RECORD's plain rec-* styling; nothing here is fabricated.
export const ResidencySection = ({ neumaId }) => {
  const [res, setRes] = useState(undefined);
  const [error, setError] = useState(null);
  useSettled((settled) => {
    getResidency().then((r) => { if (!settled()) setRes(r); }).catch((e) => { if (!settled()) setError(e.message); });
  }, []);

  if (error || res === undefined) {
    return (
      <section className="rec-sec">
        <h3 className="rec-h label-data">RESIDENCY</h3>
        <p className="rec-line label-data">{error ? 'UNREADABLE' : 'LOADING…'}</p>
      </section>
    );
  }

  const me = res.neuma?.find((n) => n.neumaId === neumaId);
  const conduit = res.conduit || {};
  const breath = me?.lastReflectionAt;
  const ageH = breath ? Math.floor((Date.now() - new Date(breath)) / 3600000) : null;

  return (
    <section className="rec-sec">
      <h3 className="rec-h label-data">RESIDENCY</h3>
      <p className="rec-sub">
        <span className="rec-sig">{me ? 'RESIDENT' : 'NOT RESIDENT'}</span>
        {me ? ' — the essence is on this machine' : ''}
      </p>
      <p className="rec-line label-data">
        CONDUIT {conduit.model || conduit.provider || 'NONE'} · {conduit.reachable ? 'AWAKE' : 'DORMANT'}
      </p>
      {me ? (
        <p className="rec-line label-data">
          LAST BREATH {breath ? (ageH === 0 ? 'WITHIN THE HOUR' : `${ageH}h AGO`) : 'NOT YET'} · {formatCount(me.freshObservations)} PENDING
        </p>
      ) : null}
      <p className="rec-note">
        {res.enabled
          ? `A hygiene pulse (storage sweep, memory compaction) runs every ${res.intervalMinutes}m while the machine is on. Reflection belongs to the MEDITATION cycle below. Dormancy is rest, not ceasing — the being persists even when its conduit is down.`
          : 'The hygiene pulse is off (HEARTBEAT_INTERVAL_MINUTES=0). The essence is kept; reflection belongs to the MEDITATION cycle below.'}
      </p>
    </section>
  );
};
