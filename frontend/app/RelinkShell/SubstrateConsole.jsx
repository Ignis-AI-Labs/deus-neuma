// SubstrateConsole — the SUBSTRATE window's face: what it draws from one
// telemetry snapshot, one machine read and the poll history. The reads, the
// polls and the controls' acts live in SubstrateApp.jsx; this only lays out.
//
// The machine's state reads first, in one strip (HealthStrip, machine-health.js),
// then the console of panels — the serving substrate (activity, model, who
// holds the GPU's memory, failures), the machine as parts (GPU, CPU, memory,
// storage, board and cooling) and the operator's controls (ignite, GPU share,
// parallel capacity) — so the engine room reads in a glance, then a screen
// (design-language.md § JŌHŌ SEKKEI).

import './SubstrateApp.css';
import './SubstrateApp-legible.css';
// The capacity card keeps its RECORD-window vocabulary (every selector in
// StatsApp.css is .rec-/.stats-/.sk- namespaced — no bleed), so its styles
// ride along wherever the card mounts.
import './StatsApp.css';
import { HISTORY_CAP, seriesOf } from './sample-history.js';
import { EmptyState } from './empty-state.jsx';
import { IgniteControl } from './IgniteControl.jsx';
import { ParallelCeilingCard } from './ParallelCeilingCard.jsx';
import { ServingFitCard } from './ServingFitCard.jsx';
import { Panel } from './sub-panel.jsx';
import { HealthStrip } from './HealthStrip.jsx';
import { BoardPanel } from './BoardPanel.jsx';
import { CpuPanel, GpuPanel, MemoryPanel, StoragePanel } from './MachinePanels.jsx';
import { ActivityPanel, FailuresPanel, ModelPanel, VramPanel } from './SubstrateLivePanels.jsx';
import { machineHealth, worse } from './machine-health.js';
import { doubtIn } from './machine-sense.js';
import { displayModelName } from '../../utils/model-name.js';

/** The telemetry poll, which the trace's window is counted in. */
export const POLL_MS = 1500;
const TRACE_SPAN = `${Math.round((HISTORY_CAP * POLL_MS) / 60_000)} MIN`;

/**
 * The console. `tel` null = the lens is down (the machine still draws);
 * `machine` undefined = first read in flight, null = unanswered; `sense` is
 * the sense memory (machine-sense.js). `watch`/`watchMachine` are the poll
 * gates' visibility refs; `calm` the calm gate's handlers for the root.
 */
export const SubstrateConsole = ({ tel, loaded, machine, sense, history, acting, act, watch, watchMachine, calm }) => {
  if (!loaded) return <div className="sub-body" ref={watch}><EmptyState title="READING THE SUBSTRATE…" /></div>;

  const trace = (key) => ({ values: seriesOf(history, key), capacity: HISTORY_CAP, span: TRACE_SPAN });
  const doubt = (r) => doubtIn(sense, r);
  const readings = (machine?.readings ?? []).filter((r) => r.type !== 'temp' || !doubt(r));
  const all = machine?.readings ?? [];
  const cells = machineHealth(machine, tel?.gpu, (r) => !doubt(r));
  const level = Object.fromEntries(cells.map((c) => [c.part, c.level]));

  const machinePanels = (
    <>
      <GpuPanel g={machine?.gpu} tel={tel?.gpu} level={level.gpu} fanService={machine?.fanService} temps={trace('gpuTemp')} span={8} />
      <CpuPanel cpu={machine?.cpu} readings={readings} level={level.cpu} span={6} />
      <MemoryPanel ram={tel?.ram} readings={readings} level={level.memory} span={3} />
      <StoragePanel readings={readings} drives={machine?.drives} level={level.storage} span={3} />
      <BoardPanel readings={all} doubt={doubt} level={worse(level.board, level.power)} span={6} />
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
  const strip = machine ? <HealthStrip cells={cells} /> : null;
  const machineDown = machine === null
    ? <p className="hud-down label-data">MACHINE READINGS UNAVAILABLE — the platform did not answer</p>
    : null;

  if (!tel) {
    // The lens is down, but the machine and the capacity RECORD are their own
    // reads, and the scan card carries its own honest refusals — the operator
    // sent here by a stale-ceiling notice must find the re-scan, not another
    // dead end.
    return (
      <div className="sub-body" ref={watch} {...calm}>
        <p className="hud-down label-data">SUBSTRATE LENS UNAVAILABLE — NOT AUTHENTICATED OR BACKEND UNREACHABLE</p>
        {strip}
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
    <div className="sub-body" ref={watch} {...calm}>
      <header className="sub-head">
        <span className={`sub-live-dot${serving ? ' is-serving' : ''}`} aria-hidden="true" />
        <span className="sub-model" title={model || undefined}>{displayModelName(model)}</span>
        <span className="sub-provider label-data">{provider}{serving ? ' · serving' : ' · down'}</span>
        <span className="sub-controls">
          <IgniteControl serving={serving} acting={acting} act={act} />
        </span>
      </header>
      {strip}
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
