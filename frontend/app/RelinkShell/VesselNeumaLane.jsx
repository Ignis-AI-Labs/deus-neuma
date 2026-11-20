// VesselNeumaLane — a being's lane of VESSEL, extracted verbatim from
// VesselApp.jsx (size-law breakdown, 2026-08-26): the machine vessel's record
// and memory. (Its EVOLUTION section, the LoRA refinement's milestone and
// adapters, left on 2026-11-14: Founder, […].) The being's self-check lives on its sheet's STATE
// tab, never here (one surface, 2026-10-19). Telemetry is the SUBSTRATE HUD's
// non-critical poll: 3s while the lane is open and the tab is visible,
// null-safe, never a fabricated zero.

import { useState } from 'react';
import { EmptyState } from './empty-state.jsx';
import { useSettled } from './use-settled.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { shortDate } from './todo-view.js';
import {
  fetchNeumaRecord, fetchTelemetry, fetchCapacity,
} from './vessel-client.js';
import { Fact, FactRow, n1, n0, pct, gbOf } from './vessel-format.jsx';

// --- One being: the machine vessel ----------------------------------------

export const NeumaLane = ({ neumaId }) => {
  // undefined = loading; each leg may independently come back null (UNREADABLE).
  const [legs, setLegs] = useState(undefined);
  const [telemetry, setTelemetry] = useState(null);
  const [capacity, setCapacity] = useState(undefined);

  useSettled((settled) => {
    setLegs(undefined);
    // One leg: the parsed payload, or null on any failure — a failed leg
    // marks its section UNREADABLE without sinking the others.
    const leg = (p, pick) => p.then((b) => pick(b) ?? null).catch(() => null);
    Promise.all([
      leg(fetchNeumaRecord(neumaId), (b) => b?.record),
    ]).then(([record]) => {
      if (!settled()) setLegs({ record });
    });
    fetchCapacity()
      .then((b) => { if (!settled()) setCapacity(b ?? null); })
      .catch(() => { if (!settled()) setCapacity(null); });
  }, [neumaId]);

  // Telemetry poll — every 3s while the live strip is seen (the desk shown,
  // the window not shaded, the strip on screen; use-visible-interval.js);
  // dies with the lane. Never rejects.
  const watch = useVisibleInterval(() => { fetchTelemetry().then(setTelemetry); }, 3000);

  if (legs === undefined) return <EmptyState title="LOADING…" />;

  const { record } = legs;
  const sub = record?.substrate;
  const memory = record?.record?.memory;
  const relationship = record?.record?.relationship;
  const serving = Boolean(telemetry?.serving);

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
