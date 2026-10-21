// SubstrateApp — the SUBSTRATE HUD: a single pane of glass over the engine room.
//
// A rig-level lens (owned by no one neuma): polls /substrate/telemetry (1.5 s)
// and /substrate/machine (5 s) and lays the live state out as a 12-column
// console of instruments — the serving substrate (activity, model, who holds
// the GPU's memory, failures), the machine as parts (GPU, CPU, memory,
// storage, board and cooling), and the operator's controls (ignite, GPU share,
// parallel capacity) — instruments packed so the whole engine room reads in
// a screen or two instead of a scroll of text (design-language.md § JŌHŌ SEKKEI).

import './SubstrateApp.css';
// The capacity card keeps its RECORD-window vocabulary (every selector in
// StatsApp.css is .rec-/.stats-/.sk- namespaced — no bleed), so its styles
// ride along wherever the card mounts.
import './StatsApp.css';
import { useEffect, useRef, useState } from 'react';
import { loadTelemetry } from './substrate-client.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { useMachine } from './use-machine.js';
import { HISTORY_CAP, pushSample, sampleOf, seriesOf } from './sample-history.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { IgniteControl } from './IgniteControl.jsx';
import { ParallelCeilingCard } from './ParallelCeilingCard.jsx';
import { ServingFitCard } from './ServingFitCard.jsx';
import { Panel } from './sub-panel.jsx';
import { AlertStrip, BoardPanel, CpuPanel, GpuPanel, MemoryPanel, StoragePanel } from './MachinePanels.jsx';
import { ActivityPanel, FailuresPanel, ModelPanel, VramPanel } from './SubstrateLivePanels.jsx';
import { displayModelName } from '../../utils/model-name.js';

const POLL_MS = 1500;
const TRACE_SPAN = `${Math.round((HISTORY_CAP * POLL_MS) / 60_000)} MIN`;

const SubstrateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <rect x="2.5" y="2.5" width="9" height="9" />
    <rect x="5.5" y="5.5" width="3" height="3" fill="currentColor" stroke="none" />
    <path d="M7 0.5 V2.5 M7 11.5 V13.5 M0.5 7 H2.5 M11.5 7 H13.5" />
  </svg>
);

const SubstrateBody = () => {
  const [tel, setTel] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState([]);
  const [machine, watchMachine] = useMachine();
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
    if (t) setHistory((h) => pushSample(h, sampleOf(t)));
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

  const trace = (key) => ({ values: seriesOf(history, key), capacity: HISTORY_CAP, span: TRACE_SPAN });
  const readings = machine?.readings ?? [];
  const machinePanels = (
    <>
      <GpuPanel g={machine?.gpu} tel={tel?.gpu} alerts={machine?.alerts} fanService={machine?.fanService} temps={trace('gpuTemp')} span={8} />
      <CpuPanel cpu={machine?.cpu} readings={readings} span={6} />
      <MemoryPanel ram={tel?.ram} readings={readings} span={3} />
      <StoragePanel readings={readings} span={3} />
      <BoardPanel readings={readings} span={6} />
    </>
  );
  // The operator's controls over the serving: the GPU share the mind may fill,
  // and the rig's measured parallel ceiling with its RE-SCAN — here because
  // the + TAB stale-ceiling refusal sends the operator to this window, so the
  // re-scan must be reachable here.
  const controlPanels = (
    <>
      <Panel title="GPU SHARE · CONTEXT POOL" span={6}><ServingFitCard /></Panel>
      <Panel title="PARALLEL CAPACITY" span={6}><ParallelCeilingCard /></Panel>
    </>
  );
  const machineDown = machine === null
    ? <p className="hud-down label-data">MACHINE READINGS UNAVAILABLE — the platform did not answer</p>
    : null;

  if (!loaded) return <div className="sub-body" ref={watch}><EmptyState title="READING THE SUBSTRATE…" /></div>;
  if (!tel) {
    // The lens is down, but the machine and the capacity RECORD are their own
    // reads, and the scan card carries its own honest refusals — the operator
    // sent here by a stale-ceiling notice must find the re-scan, not another
    // dead end.
    return (
      <div className="sub-body" ref={watch}>
        <p className="hud-down label-data">SUBSTRATE LENS UNAVAILABLE — NOT AUTHENTICATED OR BACKEND UNREACHABLE</p>
        <AlertStrip machine={machine} />
        {machineDown}
        <div className="sub-grid" ref={watchMachine}>
          {machinePanels}
          {controlPanels}
        </div>
      </div>
    );
  }

  const { model, provider, serving, contextLength, adapters, sampling, activity, slots, gpu, processes, failures } = tel;

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
      <AlertStrip machine={machine} />
      {machineDown}

      <div className="sub-grid" ref={watchMachine}>
        <ActivityPanel activity={activity} slots={slots} gen={trace('gen')} span={4} />
        {machinePanels}
        <ModelPanel contextLength={contextLength} sampling={sampling} adapters={adapters} span={3} />
        <VramPanel gpu={gpu} processes={processes} span={3} />
        {controlPanels}
        <FailuresPanel failures={failures} span={12} />
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
