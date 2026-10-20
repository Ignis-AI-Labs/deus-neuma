// SubstrateApp — the SUBSTRATE HUD: a single pane of glass over the engine room.
//
// A rig-level lens (owned by no one neuma): polls /substrate/telemetry and
// renders the live state of the serving substrate — active model + sampling,
// generation throughput, slots/KV, GPU load, RAM (the machine's, the model
// server's own and its prompt-cache ceiling), on-GPU processes, and the recent
// failures feed. v1 is observation only; controls (switch model, edit sampling,
// ignite/unload) land as a follow-on.

import './SubstrateApp.css';
// The capacity card keeps its RECORD-window vocabulary (every selector in
// StatsApp.css is .rec-/.stats-/.sk- namespaced — no bleed), so its styles
// ride along wherever the card mounts.
import './StatsApp.css';
import { useEffect, useRef, useState } from 'react';
import { loadTelemetry } from './substrate-client.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { IgniteControl } from './IgniteControl.jsx';
import { ParallelCeilingCard } from './ParallelCeilingCard.jsx';
import { ServingFitCard } from './ServingFitCard.jsx';
import { MachineCard } from './MachineCard.jsx';
import { displayModelName } from '../../utils/model-name.js';
import { asText } from '../../utils/as-text.js';

const POLL_MS = 1500;

// pure formatters — an absent measurement shows as '—', never a fabricated zero
const gb = (mb) => (Number.isFinite(mb) ? (mb / 1024).toFixed(1) : '—');
const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
const pct = (r) => (Number.isFinite(r) ? `${(r * 100).toFixed(0)}%` : '—');

const SubstrateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <rect x="2.5" y="2.5" width="9" height="9" />
    <rect x="5.5" y="5.5" width="3" height="3" fill="currentColor" stroke="none" />
    <path d="M7 0.5 V2.5 M7 11.5 V13.5 M0.5 7 H2.5 M11.5 7 H13.5" />
  </svg>
);

// A labelled reading. `live` tints the value with signal when it's a real number.
const Stat = ({ label, value, unit, live }) => (
  <div className="sub-stat">
    <span className="sub-stat-label label-data">{label}</span>
    <span className={`sub-stat-value${live ? ' is-live' : ''}`}>
      {value}{unit ? <span className="sub-stat-unit">{unit}</span> : null}
    </span>
  </div>
);

// A horizontal fill meter (0..1). Turns alert past 85%.
const Meter = ({ ratio }) => {
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const cls = r > 0.85 ? 'is-hot' : r > 0.6 ? 'is-warm' : '';
  return (
    <div className="sub-meter" role="meter" aria-valuenow={Math.round(r * 100)}>
      <div className={`sub-meter-fill ${cls}`} style={{ transform: `scaleX(${r})` }} />
    </div>
  );
};

const Panel = ({ title, children, span }) => (
  <section className={`sub-panel cham${span ? ' sub-panel-wide' : ''}`}>
    <div className="sub-panel-in cham-in">
      <h3 className="sub-panel-title label-data">{title}</h3>
      {children}
    </div>
  </section>
);

const SubstrateBody = () => {
  const [tel, setTel] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // Polls only while this lens is on screen (use-visible-interval.js): a
  // window-shaded or hidden SUBSTRATE window spent 40 reads a minute.
  const watch = useVisibleInterval(async () => {
    const t = await loadTelemetry();
    if (!alive.current) return;
    // A 429 / transport miss is not […] — keep the last
    // snapshot. First poll still lands null → UNAVAILABLE.
    setTel((prev) => (t == null && prev != null ? prev : t));
    setLoaded(true);
  }, POLL_MS);

  // Run a control action, then refresh once so the HUD reflects the new state
  // without waiting for the next poll tick. The client fns resolve {ok,error}
  // rather than rejecting, but the finally guarantees the button can never
  // wedge disabled even if that contract ever slips.
  const act = async (fn) => {
    if (acting) return;
    setActing(true);
    try {
      await fn();
      const t = await loadTelemetry();
      if (alive.current) setTel(t);
    } finally {
      if (alive.current) setActing(false);
    }
  };

  if (!loaded) return <div className="sub-body" ref={watch}><EmptyState title="READING THE SUBSTRATE…" /></div>;
  if (!tel) {
    // The lens is down, but the capacity RECORD is a disk fact and the scan
    // card carries its own honest refusals — the operator sent here by a
    // stale-ceiling notice must find the re-scan, not another dead end
    // (Design note, 2026-08-28: […]).
    return (
      <div className="sub-body" ref={watch}>
        <EmptyState title="SUBSTRATE LENS UNAVAILABLE — NOT AUTHENTICATED OR BACKEND UNREACHABLE" />
        <div className="sub-grid">
          <Panel title="MACHINE · THERMALS" span><MachineCard /></Panel>
          <Panel title="GPU SHARE · CONTEXT POOL" span><ServingFitCard /></Panel>
          <Panel title="PARALLEL CAPACITY" span><ParallelCeilingCard /></Panel>
        </div>
      </div>
    );
  }

  const { model, provider, serving, contextLength, adapters, sampling, activity, slots, gpu, ram, processes, failures } = tel;

  return (
    <div className="sub-body" ref={watch}>
      <header className="sub-head">
        <span className={`sub-live-dot${serving ? ' is-serving' : ''}`} aria-hidden="true" />
        <span className="sub-model" title={model || undefined}>{displayModelName(model)}</span>
        <span className="sub-provider label-data">{provider}{serving ? ' · serving' : ' · down'}</span>
        <span className="sub-controls">
          <IgniteControl serving={serving} acting={acting} act={act} />
        </span>
      </header>

      <div className="sub-grid">
        <Panel title="ACTIVITY">
          <Stat label="GENERATION" value={n1(activity?.genTokPerSec)} unit="tok/s" live />
          <Stat label="PROMPT" value={n0(activity?.promptTokPerSec)} unit="tok/s" />
          <Stat label="SLOTS BUSY" value={`${slots?.busy ?? '—'} / ${slots?.total ?? '—'}`} />
          <div className="sub-kv">
            <span className="sub-stat-label label-data">KV CACHE</span>
            <Meter ratio={activity?.kvUsage} />
            <span className="sub-kv-pct">{pct(activity?.kvUsage)}</span>
          </div>
        </Panel>

        <Panel title="GPU">
          <div className="sub-kv">
            <span className="sub-stat-label label-data">{gpu?.unified ? 'MEM · UNIFIED' : 'VRAM'}</span>
            <Meter ratio={gpu ? gpu.usedMB / gpu.totalMB : null} />
            <span className="sub-kv-pct">{gb(gpu?.usedMB)}/{gb(gpu?.totalMB)}G</span>
          </div>
          <Stat label="FREE" value={gb(gpu?.freeMB)} unit="GB" />
          <Stat label="UTIL" value={n0(gpu?.utilPct)} unit="%" live />
          <Stat label="TEMP · POWER" value={`${n0(gpu?.tempC)}°C · ${n0(gpu?.powerW)}W`} />
        </Panel>

        <Panel title="RAM">
          <div className="sub-kv">
            <span className="sub-stat-label label-data">USED</span>
            <Meter ratio={ram ? ram.usedMB / ram.totalMB : null} />
            <span className="sub-kv-pct">{gb(ram?.usedMB)}/{gb(ram?.totalMB)}G</span>
          </div>
          <Stat label="AVAILABLE" value={gb(ram?.availableMB)} unit="GB" />
          {/* The server's own memory — the parked prompt cache lives here — and the
              cache ceiling the RUNNING server was started with. */}
          <Stat label="MODEL SERVER" value={gb(ram?.server?.anonMB)} unit="GB" live />
          {/* 0 = the RAM prompt cache is OFF (serving-launch-config.js, 2026-10-13). */}
          <Stat label="CACHE LIMIT" value={ram?.server?.cacheLimitMB === 0 ? 'OFF' : gb(ram?.server?.cacheLimitMB)} unit={ram?.server?.cacheLimitMB === 0 ? '' : 'GB'} />
          {ram?.swapTotalMB ? (
            <div className="sub-kv">
              <span className="sub-stat-label label-data">SWAP</span>
              <Meter ratio={ram.swapUsedMB / ram.swapTotalMB} />
              <span className="sub-kv-pct">{gb(ram.swapUsedMB)}/{gb(ram.swapTotalMB)}G</span>
            </div>
          ) : null}
        </Panel>

        <Panel title="MODEL">
          <Stat label="CONTEXT" value={contextLength ? `${(contextLength / 1024).toFixed(0)}K` : '—'} />
          <Stat label="TEMP · TOP_P" value={`${n1(sampling?.temperature)} · ${n1(sampling?.topP)}`} />
          <Stat label="TOP_K · MIN_P" value={`${n0(sampling?.topK)} · ${n1(sampling?.minP)}`} />
          <Stat label="REPEAT" value={n1(sampling?.repeatPenalty)} />
          <div className="sub-adapters">
            <span className="sub-stat-label label-data">ADAPTERS</span>
            <span className="sub-adapter-list">
              {adapters?.length ? adapters.map((a) => a.split('/').pop().replace(/\.gguf$/, '')).join(' · ') : 'none'}
            </span>
          </div>
        </Panel>

        <Panel title="ON-GPU PROCESSES">
          <ul className="sub-proc-list">
            {(processes || []).slice(0, 8).map((p) => (
              <li key={p.pid} className="sub-proc">
                <span className="sub-proc-name">{p.name}</span>
                <span className="sub-proc-pid label-data">{p.pid}</span>
                <span className="sub-proc-mem">{gb(p.memMB)}G</span>
              </li>
            ))}
            {(!processes || processes.length === 0) ? <li className="sub-empty-row label-data">no GPU processes</li> : null}
          </ul>
        </Panel>

        <Panel title="FAILURES" span>
          <ul className="sub-fail-list">
            {(failures || []).slice(0, 8).map((f, i) => (
              <li key={`${f.ts}-${i}`} className={`sub-fail is-${f.level}`}>
                {/* a failure row is TEXT, whatever the backend sent */}
                <span className="sub-fail-ctx label-data">{asText(f.context)}</span>
                <span className="sub-fail-msg">{asText(f.msg)}</span>
                <span className="sub-fail-ts label-data">{(f.ts || '').slice(11, 19)}</span>
              </li>
            ))}
            {(!failures || failures.length === 0) ? <li className="sub-empty-row label-data">no recent failures — all clear</li> : null}
          </ul>
        </Panel>

        {/* The rig's measured parallel ceiling, and the RE-SCAN that renews
            it — HERE because this is where the + TAB refusal sends the
            operator when the ceiling was measured on a different model
            (Design note, 2026-08-28: […]). The card is the RECORD window's own, unchanged. */}
        <Panel title="MACHINE · THERMALS" span><MachineCard /></Panel>
        <Panel title="GPU SHARE · CONTEXT POOL" span><ServingFitCard /></Panel>
        <Panel title="PARALLEL CAPACITY" span><ParallelCeilingCard /></Panel>
      </div>
    </div>
  );
};

export const substrateApp = {
  label: 'SUBSTRATE',
  labelKey: 'apps.substrate',
  icon: <SubstrateIcon />,
  title: <AppTitle label="SUBSTRATE" labelKey="apps.substrate" />,
  Body: SubstrateBody,
  storageKey: 'substrate',
};
