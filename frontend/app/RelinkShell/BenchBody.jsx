// BenchBody — the BENCH window's pure rendering: the icon, the DeskTabs
// frame, the OVERVIEW (THE ATLAS — every benchmark on one chart and the
// architecture's influence — over the rig fold: serving, daemons, rig lock,
// the night window, the plane's owned children, the incident rail) and the
// RUNS table. REPORTS and
// LAUNCH are their own pure subcomponents (size law). The display law lives
// in bench-view.js; the IO lives in BenchApp.jsx.
// NO sound imports — the module stays renderable under node (the
// static-markup view tests).

import { useState } from 'react';
import './BenchApp.css';
import { EmptyState } from './empty-state.jsx';
import { BenchAtlas } from './BenchAtlas.jsx';
import { DeskTabs } from './DeskTabs.jsx';
import {
  servingLive, servingLine, gpuLine, daemonLine, lockLine, nightLine, nightGroups,
  nightSteps, deadlineCountdown, ownedLine, incidentRows, relTime,
} from './bench-view.js';
import { BenchReports } from './BenchReports.jsx';
import { BenchLaunch } from './BenchLaunch.jsx';
import { BenchRelight } from './BenchRelight.jsx';
import { BenchProof } from './BenchProof.jsx';
import { BenchRuns } from './BenchRuns.jsx';
import { BenchLive, benchLiveActive } from './BenchLive.jsx';

export const BenchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 13.5 H14" />
    <path d="M4 13.5 V8.5 M8 13.5 V5 M12 13.5 V2.5" />
  </svg>
);

// LIVE is what runs now and how far (Design note, 2026-10-15: […]); LAUNCH is only for starting one.
// The LIVE tab wears a signal dot while anything runs on this machine.
const tabsFor = (active) => [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'live', label: active ? <><span className="bench-tab-dot" aria-hidden="true">●</span> LIVE</> : 'LIVE' },
  { id: 'runs', label: 'RUNS' },
  { id: 'reports', label: 'REPORTS' },
  { id: 'launch', label: 'LAUNCH' },
];

// THE RIG AS IT STANDS — serving, the GPU driver, the daemons, the lock.
const RigSection = ({ status }) => {
  const daemons = status?.daemons ?? {};
  const watchdog = daemonLine('SERVING WATCHDOG', daemons.servingWatchdog);
  const swap = daemonLine('SWAP MODEL', daemons.swapModel);
  const gpu = gpuLine(status?.gpu);
  const lock = lockLine(status?.lock);
  return (
    <section className="bench-sec">
      <p className="bench-sec-head label-data">THE RIG AS IT STANDS</p>
      <p className={`bench-line label-data${servingLive(status?.serving) ? ' is-signal' : ' is-alert'}`}>
        {servingLine(status?.serving)}
      </p>
      <p className={`bench-line label-data${gpu.alert ? ' is-alert' : ''}`}>{gpu.text}</p>
      <p className={`bench-line label-data${watchdog.live ? ' is-signal' : ''}`}>{watchdog.text}</p>
      <p className={`bench-line label-data${swap.live ? ' is-signal' : ''}`}>{swap.text}</p>
      {lock ? (
        <p className={`bench-line label-data${lock.live ? ' is-signal' : ''}`}>{lock.text}</p>
      ) : (
        <p className="bench-line label-data">THE RIG IS FREE — NO BENCHMARK HOLDS THE LOCK</p>
      )}
    </section>
  );
};

// THE NIGHT WINDOW — the last (or live) window's account: status, countdown,
// what it is waiting on, groups and steps, and why it aborted when it did.
const NightSection = ({ status, nowMs }) => {
  const night = status?.night ?? null;
  if (!night) {
    return (
      <section className="bench-sec">
        <p className="bench-sec-head label-data">THE NIGHT WINDOW</p>
        <EmptyState title="NO NIGHT WINDOW ON RECORD" />
      </section>
    );
  }
  const live = !night.finishedAt;
  const left = live ? deadlineCountdown(night.deadline, nowMs) : null;
  const groups = nightGroups(night);
  const steps = nightSteps(night);
  return (
    <section className="bench-sec">
      <p className="bench-sec-head label-data">THE NIGHT WINDOW</p>
      <p className={`bench-line label-data${live ? ' is-signal' : ''}`}>
        {nightLine(night, nowMs)}
        {left ? <span className={left.overdue ? ' is-alert' : ''}> · {left.text}</span> : null}
      </p>
      {live && night.waitingFor ? (
        <p className="bench-line label-data is-alert">
          «WARNING» WAITING FOR {String(night.waitingFor).replace(/-/g, ' ').toUpperCase()}
          {night.mtimeMs ? ` — STATUS LAST WROTE ${relTime(night.mtimeMs, nowMs)}` : ''}
        </p>
      ) : null}
      {night.abortReason ? (
        <p className="bench-line label-data is-alert">ABORTED — {night.abortReason}</p>
      ) : null}
      {night.unstartedGroups?.length ? (
        <p className="bench-line label-data">UNSTARTED — {night.unstartedGroups.join(', ')}</p>
      ) : null}
      {groups.map((g) => (
        <p key={g.key} className={`bench-row label-data is-${g.register}`}>{g.text}</p>
      ))}
      {steps.map((s) => (
        <p key={s.key} className={`bench-row label-data is-${s.register}`}>{s.text}</p>
      ))}
      {night.serving?.file ? (
        <p className="bench-line bench-dim label-data">SERVING {night.serving.file}</p>
      ) : null}
    </section>
  );
};

// OWNED BY THIS PLANE — the children the desk itself launched (long verbs),
// and the incident rail: both journals, newest first.
const PlaneSection = ({ status, incidents, nowMs }) => {
  const owned = status?.owned ?? [];
  const rows = incidentRows(incidents ?? { serving: status?.incidents ?? [], watch: [] });
  return (
    <section className="bench-sec">
      <p className="bench-sec-head label-data">OWNED BY THIS PLANE</p>
      {owned.length === 0 ? (
        <p className="bench-line label-data">NO PLANE-OWNED CHILDREN — THE DESK HAS LAUNCHED NOTHING LONG</p>
      ) : (
        owned.map((child) => (
          <p key={child.pid} className="bench-row label-data is-live">{ownedLine(child, nowMs)}</p>
        ))
      )}
      <p className="bench-sub-head label-data">THE INCIDENT RAIL</p>
      {rows.length === 0 ? (
        <p className="bench-line label-data">NO INCIDENTS ON RECORD — SERVING AND THE WATCH ARE QUIET</p>
      ) : (
        rows.map((row) => (
          <p key={row.key} className={`bench-row label-data is-${row.register}`}>
            {row.text}
            <span className="bench-dim"> · {relTime(row.atMs, nowMs)}</span>
          </p>
        ))
      )}
    </section>
  );
};

// THE RIG — serving, the GPU, the daemons, the night window, the plane's
// children and the incident rail: under the atlas, one fold (open by default
// when something needs the operator — serving down or a window running).
const RigFold = ({ status, incidents, nowMs, relight }) => {
  const needs = Boolean(status && (!servingLive(status.serving) || status.night));
  const [open, setOpen] = useState(needs);
  return (
    <section className="bl-fold bench-rig-fold">
      <button type="button" className="bl-fold-toggle label-data" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} THE RIG — {servingLine(status?.serving)}
      </button>
      {open ? (
        <>
          <RigSection status={status} />
          {status && !servingLive(status.serving) ? <BenchRelight gpu={status.gpu} {...relight} /> : null}
          <NightSection status={status} nowMs={nowMs} />
          <PlaneSection status={status} incidents={incidents} nowMs={nowMs} />
        </>
      ) : null}
    </section>
  );
};

export const BenchBody = ({
  tab, onTab, absent, error, status, incidents, nowMs,
  runs, reports, atlas, onOpenSuite, launch, relight, proof, why = null, live = null,
}) => (
  <div className="bench">
    <header className="bench-head">
      <span className="bench-head-label label-data">BENCH</span>
      <span className={`bench-head-state label-data${servingLive(status?.serving) ? ' is-signal' : ''}`}>
        {absent ? 'NO HARNESS ON THIS MACHINE' : servingLine(status?.serving)}
      </span>
    </header>
    {error ? <p className="bench-error label-data">{error}</p> : null}
    {absent ? (
      <EmptyState title="«NOTICE» NO BENCHMARK HARNESS STANDS ON THIS MACHINE">
        <small>THE PLANE READS AND DRIVES THE SIBLING HARNESS — SET NEUMA_BENCH_HARNESS_PATH WHEN IT LIVES ELSEWHERE</small>
      </EmptyState>
    ) : (
      <DeskTabs
        items={tabsFor(benchLiveActive(status, proof?.run))}
        value={tab}
        onChange={onTab}
        label="Bench sections"
        className="bench-tabs"
        tabClassName="bench-tab label-data"
        panelClassName="bench-panel"
      >
        {tab === 'overview' ? (
          <>
            <BenchAtlas summary={atlas?.summary ?? null} onOpen={onOpenSuite} />
            <RigFold status={status} incidents={incidents} nowMs={nowMs} relight={relight} />
          </>
        ) : null}
        {tab === 'live' ? <BenchLive status={status} proofRun={proof?.run} nowMs={nowMs} {...live} /> : null}
        {tab === 'runs' ? <BenchRuns runs={runs} nowMs={nowMs} onOpenSuite={onOpenSuite} why={why} /> : null}
        {tab === 'reports' ? <BenchReports {...reports} explorer={{ ...reports?.explorer, why }} /> : null}
        {tab === 'launch' ? (
          <>
            <BenchProof status={status} {...proof} />
            <BenchLaunch {...launch} serving={status?.serving ?? null} machine={status?.machine ?? null} live={status?.live ?? []} />
          </>
        ) : null}
      </DeskTabs>
    )}
  </div>
);
