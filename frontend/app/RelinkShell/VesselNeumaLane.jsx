// VesselNeumaLane — a being's lane of VESSEL, extracted verbatim from
// VesselApp.jsx (size-law breakdown, 2026-08-26): the machine vessel's record,
// benchmarks, refinement, and memory. Benchmark runs are real measurements
// (slow, and impossible while the substrate is offline) — the lane shows
// MEASURING… and answers a refusal honestly. Telemetry is the SUBSTRATE HUD's
// non-critical poll: 3s while the lane is open and the tab is visible,
// null-safe, never a fabricated zero.

import { useState } from 'react';
import { EmptyState } from './empty-state.jsx';
import { useSettled } from './use-settled.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { uiSound } from '../../services/ui-sound.js';
import { shortDate } from './todo-view.js';
import { trendGlyph, benchmarkDue } from './vessel-view.js';
import {
  fetchNeumaRecord, fetchBenchmarks, runBenchmark,
  fetchRefinementStatus, fetchTelemetry, fetchCapacity,
} from './vessel-client.js';
import { Fact, FactRow, n1, n0, pct, gbOf } from './vessel-format.jsx';

// --- One being: the machine vessel ----------------------------------------

export const NeumaLane = ({ neumaId }) => {
  // undefined = loading; each leg may independently come back null (UNREADABLE).
  const [legs, setLegs] = useState(undefined);
  const [telemetry, setTelemetry] = useState(null);
  const [capacity, setCapacity] = useState(undefined);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');

  useSettled((settled) => {
    setLegs(undefined);
    setNote('');
    // One leg: the parsed payload, or null on any failure — a failed leg
    // marks its section UNREADABLE without sinking the others.
    const leg = (p, pick) => p.then((b) => pick(b) ?? null).catch(() => null);
    Promise.all([
      leg(fetchNeumaRecord(neumaId), (b) => b?.record),
      leg(fetchBenchmarks(neumaId), (b) => b),
      leg(fetchRefinementStatus(neumaId), (b) => b),
    ]).then(([record, bench, refinement]) => {
      if (!settled()) setLegs({ record, bench, refinement });
    });
    fetchCapacity()
      .then((b) => { if (!settled()) setCapacity(b ?? null); })
      .catch(() => { if (!settled()) setCapacity(null); });
  }, [neumaId]);

  // Telemetry poll — every 3s while the live strip is seen (the desk shown,
  // the window not shaded, the strip on screen; use-visible-interval.js);
  // dies with the lane. Never rejects.
  const watch = useVisibleInterval(() => { fetchTelemetry().then(setTelemetry); }, 3000);

  const onRun = async () => {
    if (running) return;
    uiSound('activate');
    setNote('');
    setRunning(true);
    try {
      await runBenchmark(neumaId);
      const bench = await fetchBenchmarks(neumaId).catch(() => null);
      setLegs((l) => (l ? { ...l, bench: bench ?? l.bench } : l));
    } catch (error) {
      // A real refusal (503: the substrate is offline) surfaces verbatim.
      setNote(error.message || 'THE MEASUREMENT FAILED — TRY AGAIN');
    }
    setRunning(false);
  };

  if (legs === undefined) return <EmptyState title="LOADING…" />;

  const { record, bench, refinement } = legs;
  const sub = record?.substrate;
  const memory = record?.record?.memory;
  const relationship = record?.record?.relationship;
  const serving = Boolean(telemetry?.serving);

  // Benchmark state: the latest run carrying dimensions, and the run before
  // it (the trend's other end). Runs arrive newest-first.
  const runs = Array.isArray(bench?.runs) ? bench.runs : [];
  const latest = Array.isArray(bench?.latest?.dimensions) && bench.latest.dimensions.length
    ? bench.latest
    : (runs.find((r) => Array.isArray(r?.dimensions) && r.dimensions.length) || null);
  const latestIdx = latest ? runs.findIndex((r) => r.id === latest.id) : -1;
  const previous = latest ? ((latestIdx >= 0 ? runs[latestIdx + 1] : runs[0]) || null) : null;
  const prevScoreOf = (key) =>
    (Array.isArray(previous?.dimensions)
      ? previous.dimensions.find((d) => d.key === key)?.score ?? null
      : null);
  const overdue = benchmarkDue(latest?.runAt ?? null);

  const milestone = refinement?.milestone ?? null;
  const adapters = Array.isArray(refinement?.adapters) ? refinement.adapters : [];
  const binding = refinement?.binding ?? null;
  const boundScale = binding?.adapter?.scale || null;
  // latest = the newest run clamped to the served slots — the ceiling the rig RUNS
  const capacityRun = capacity?.latest ?? (Array.isArray(capacity?.runs) && capacity.runs.length ? capacity.runs[0] : null);

  return (
    <>
      <section className="vl-sec">
        <h3 className="vl-h label-data">VESSEL</h3>
        {record === null ? (
          <p className="vl-unreadable label-data">UNREADABLE</p>
        ) : (
          <>
            <FactRow label="MODEL" value={sub?.model} />
            <FactRow label="PROVIDER" value={sub?.provider} />
            <FactRow label="GPU" value={sub?.gpu} />
            <FactRow label="VRAM" value={gbOf(sub?.vramGB)} />
            <FactRow label="RAM" value={gbOf(sub?.ramGB)} />
            <FactRow label="CORES" value={Number.isFinite(sub?.cores) ? String(sub.cores) : '—'} />
            <FactRow label="ALLOCATION" value={gbOf(sub?.allocationGB)} />
            <FactRow label="BORN ON" value={sub?.bornOn} />
          </>
        )}
        <div className="vl-strip" ref={watch}>
          <Fact value={serving ? n1(telemetry?.activity?.genTokPerSec) : '—'} label="GEN TOK/S" live={serving} />
          <Fact value={serving ? n0(telemetry?.gpu?.utilPct) : '—'} label="GPU UTIL %" live={serving} />
          <Fact value={serving ? n0(telemetry?.gpu?.tempC) : '—'} label="GPU °C" live={serving} />
          <Fact value={serving ? pct(telemetry?.activity?.kvUsage) : '—'} label="KV" live={serving} />
        </div>
        <p className="vl-shared label-data">SHARED RIG — THESE FACTS BELONG TO NO ONE BEING</p>
        <p className="vl-cap label-data">
          {capacity === undefined || capacity === null
            ? 'CEILING —'
            : capacityRun
              ? `CEILING ${capacityRun.ceiling} · CLASS ${capacityRun.boundClass} · ${shortDate(capacityRun.runAt)}`
              : 'NEVER MEASURED'}
        </p>
      </section>

      <section className="vl-sec">
        <h3 className="vl-h label-data">STATE</h3>
        {bench === null ? (
          <p className="vl-unreadable label-data">UNREADABLE</p>
        ) : !latest ? (
          <p className="vl-quiet label-data">NOT MEASURED</p>
        ) : (
          <>
            <ul className="vl-dims">
              {latest.dimensions.map((d, i) => {
                const glyph = trendGlyph(d.score, prevScoreOf(d.key));
                return (
                  <li key={d.key || `${d.label}-${i}`} className="vl-dim">
                    <span className="vl-dim-l label-data">{d.label || '—'}</span>
                    <span className="vl-dim-v">{d.score == null ? 'N/A' : `${Math.round(Math.min(1, Math.max(0, d.score)) * 100)}%`}</span>
                    <span className="vl-dim-t" aria-hidden="true">{glyph ?? ''}</span>
                  </li>
                );
              })}
            </ul>
            <p className="vl-quiet label-data">
              RUN {shortDate(latest.runAt)}
              {overdue ? <span className="vl-overdue"> · OVERDUE</span> : null}
            </p>
          </>
        )}
        <button type="button" className="vl-add" disabled={running} onClick={onRun}>
          {running ? 'MEASURING…' : 'RUN BENCHMARK'}
        </button>
        {note ? <p className="vl-error label-data">{note}</p> : null}
      </section>

      <section className="vl-sec">
        <h3 className="vl-h label-data">EVOLUTION</h3>
        {refinement === null ? (
          <p className="vl-unreadable label-data">UNREADABLE</p>
        ) : (
          <>
            {milestone ? (
              <p className="vl-quiet label-data">
                {milestone.sampleCount} / {milestone.minSamples} SAMPLES · {milestone.distinctDays} / {milestone.minDays} DAYS
                {milestone.ready ? <span className="vl-ready"> · READY</span> : null}
              </p>
            ) : (
              <p className="vl-quiet label-data">NOT STARTED</p>
            )}
            <FactRow label="ADAPTERS" value={String(adapters.length)} />
            {boundScale ? <FactRow label="SCALE" value={boundScale} /> : null}
            <p className="vl-quiet label-data">
              {binding?.reason === 'bound'
                ? <span className="vl-ready">ADAPTER BOUND</span>
                : binding?.reason || '—'}
            </p>
            <FactRow label="LAST REFINEMENT" value={refinement?.lastRefinementAt ? shortDate(refinement.lastRefinementAt) : '—'} />
          </>
        )}
      </section>

      <section className="vl-sec">
        <h3 className="vl-h label-data">MEMORY</h3>
        {record === null ? (
          <p className="vl-unreadable label-data">UNREADABLE</p>
        ) : (
          <div className="vl-grid">
            <Fact value={memory?.entities ?? '—'} label="ENTITIES" />
            <Fact value={memory?.observations ?? '—'} label="OBSERVATIONS" />
            <Fact value={memory?.relations ?? '—'} label="RELATIONS" />
            <Fact value={relationship?.conversations ?? '—'} label="CONVERSATIONS" />
            <Fact value={relationship?.exchanges ?? '—'} label="EXCHANGES" />
            <Fact value={relationship?.ageDays ?? '—'} label="AGE DAYS" />
          </div>
        )}
      </section>
    </>
  );
};
