// BenchRuns — the RUNS ledger v3, pure rendering: the same navigable read as
// the Atlas and the Explorer (2026-09-26, […]).
//
//   THE BAND — the ledger in instruments, and a day strip: one stacked
//     column per day (done / failed / aborted); a click narrows to that day.
//   THE RAIL — search, status, arm and tier; the runs by day, then by matched
//     set, one line each. ↑/↓ walks the runs.
//   THE FOCUS — the run in depth (BenchRunFocus.jsx), with WHAT HAPPENED
//     inside a run that did not land and WHY its set missed (BenchWhy.jsx).
//
// The operator's standing ask (2026-09-24) still binds: times on every run,
// the hashes one click away. Filter and focus state are local (pure
// computation over the rows prop — no IO); the law is bench-ledger-view.js
// and bench-runs-view.js. Node-renderable (the static-markup view tests).

import { useState } from 'react';
import './BenchExplorer.css';
import './BenchAtlas.css';
import './BenchLaunch.css';
import './BenchLedger.css';
import { EmptyState } from './empty-state.jsx';
import { BenchRunFocus } from './BenchRunFocus.jsx';
import { EVERY_ARM, stepRow } from './bench-atlas-view.js';
import { armName } from './bench-launch-view.js';
import { filterRuns, sortRuns, runStatus, RUN_STATUS_CHOICES, RUN_ORDERS } from './bench-runs-view.js';
import { ledgerCounts, dayStrip, ledgerGroups, ledgerOrder } from './bench-ledger-view.js';

const Seg = ({ label, value, items, onPick }) => (
  <span className="atlas-seg" role="group" aria-label={label}>
    {items.map((it) => (
      <button key={it.id} type="button" aria-pressed={value === it.id} aria-label={it.aria} title={it.aria} className={`atlas-seg-btn label-data${value === it.id ? ' is-on' : ''}`} onClick={() => onPick(it.id)}>
        {it.glyph ? <span className={`atlas-glyph is-${it.glyph}`} aria-hidden="true" /> : null}
        {it.label}{it.count != null ? <span className="atlas-seg-n">{it.count}</span> : null}
      </button>
    ))}
  </span>
);

const Band = ({ runs, day, onDay }) => {
  const c = ledgerCounts(runs);
  const strip = dayStrip(runs);
  const insts = [
    { label: 'RUNS ON RECORD', value: c.total },
    { label: 'LANDED', value: c.landed, sub: `${c.succeeded} DONE` },
    { label: 'FAILED', value: c.failed, alert: c.failed > 0 },
    { label: 'ABORTED', value: c.aborted },
    ...(c.invalidated ? [{ label: 'INVALIDATED', value: c.invalidated, sub: 'NEVER SCORED' }] : []),
    { label: 'COMPUTE', value: c.compute },
    { label: 'TOKENS', value: c.tokens },
  ];
  return (
    <section className="lx-band" aria-label="The ledger at a glance">
      <div className="lx-band-insts">
        {insts.map((i) => (
          <div key={i.label} className={`lx-band-inst${i.alert ? ' is-alert' : ''}`}>
            <p className="lx-band-num">{i.value}</p>
            <p className="label-data">{i.label}{i.sub ? <span className="lx-band-sub"> · {i.sub}</span> : null}</p>
          </div>
        ))}
      </div>
      {strip.days.length ? (
        <div className="lx-strip" role="group" aria-label="Runs per day — click a day to narrow the ledger">
          {strip.days.map((d) => (
            <button
              key={d.day}
              type="button"
              aria-pressed={day === d.day}
              disabled={!d.total}
              className={`lx-day${day === d.day ? ' is-on' : ''}${day && day !== d.day ? ' is-off' : ''}`}
              title={`${d.day} — ${d.total} run${d.total === 1 ? '' : 's'}: ${d.succeeded} done · ${d.failed} failed · ${d.aborted} aborted${d.invalidated ? ` · ${d.invalidated} invalidated` : ''}`}
              onClick={() => onDay(day === d.day ? null : d.day)}
            >
              <span className="lx-day-col" style={{ height: `${Math.max(d.total ? 6 : 0, d.height * 100)}%` }}>
                {d.failed ? <span className="lx-day-part is-failed" style={{ flexGrow: d.failed }} /> : null}
                {d.aborted ? <span className="lx-day-part is-aborted" style={{ flexGrow: d.aborted }} /> : null}
                {d.invalidated ? <span className="lx-day-part is-invalidated" style={{ flexGrow: d.invalidated }} /> : null}
                {d.succeeded ? <span className="lx-day-part is-succeeded" style={{ flexGrow: d.succeeded }} /> : null}
              </span>
              <span className="lx-day-label label-data">{d.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {strip.span ? <p className="lx-strip-span label-data">{strip.span}</p> : null}
    </section>
  );
};

const Rail = ({ runs, days, filters, onFilters, selectedId, onSelect }) => {
  const order = ledgerOrder(days);
  const count = (status) => (status === 'all' ? runs.length : runs.filter((r) => runStatus(r) === status).length);
  const tiers = [...new Set(runs.map((r) => r.suiteTier).filter(Boolean))].sort();
  const onKey = (e) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = stepRow(order.map((key) => ({ suiteId: key })), selectedId, e.key);
    if (next) onSelect(next);
  };
  return (
    <aside className="bx-rail lx-rail">
      <input
        className="bx-search"
        type="search"
        value={filters.q}
        placeholder="Search run, set or benchmark…"
        aria-label="Search runs"
        spellCheck={false}
        onChange={(e) => onFilters({ q: e.target.value })}
      />
      <Seg label="Status" value={filters.status} onPick={(v) => onFilters({ status: v })}
        items={RUN_STATUS_CHOICES.filter((s) => s !== 'invalidated' || count(s) > 0).map((s) => ({ id: s, label: s === 'succeeded' ? 'DONE' : s.toUpperCase(), count: count(s) }))} />
      <Seg label="Arm" value={filters.arm} onPick={(v) => onFilters({ arm: v })}
        items={[{ id: 'all', label: 'ALL ARMS' }, ...EVERY_ARM.map((a) => ({ id: a, label: '', glyph: a, aria: armName(a) }))]} />
      <span className="lx-rail-row">
        <Seg label="Tier" value={filters.tier} onPick={(v) => onFilters({ tier: v })}
          items={[{ id: 'all', label: 'ALL' }, ...tiers.map((t) => ({ id: t, label: t.toUpperCase() }))]} />
        <Seg label="Order" value={filters.order} onPick={(v) => onFilters({ order: v })} items={RUN_ORDERS} />
      </span>
      {filters.day ? (
        <button type="button" className="lx-dayfilter label-data" onClick={() => onFilters({ day: null })}>
          ONLY {filters.day} — CLEAR ✕
        </button>
      ) : null}
      <div className="bx-list lx-list" role="listbox" aria-label="Runs on record" tabIndex={0} onKeyDown={onKey}>
        {days.map((d) => (
          <div key={d.day} className="lx-dayblock" role="presentation">
            <p className="lx-dayhead label-data">{d.label}<span className="lx-dayhead-n">{d.count}</span></p>
            {d.sets.map((set) => (
              <div key={set.id} className="lx-set" role="presentation">
                <p className="lx-sethead label-data" title={set.id}>
                  <span className="lx-set-id">{set.suiteId}</span>
                  {set.tier ? <span className="lx-set-tier">{set.tier}</span> : null}
                  <span className="lx-set-time">{set.time}</span>
                </p>
                {set.lines.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    role="option"
                    aria-selected={l.key === selectedId}
                    className={`lx-run${l.key === selectedId ? ' is-on' : ''}`}
                    title={l.key}
                    onClick={() => onSelect(l.key)}
                  >
                    <span className={`atlas-glyph is-${l.arm}`} aria-hidden="true" />
                    <span className="lx-run-arm label-data">{l.name}{l.retry ? ` · ${l.retry}` : ''}</span>
                    <span className="lx-run-score">{l.score}</span>
                    <span className={`lx-status is-${l.register}`}>{l.mark}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
        {days.length === 0 ? <p className="bx-none">Nothing matches — loosen the filters.</p> : null}
      </div>
    </aside>
  );
};

export const BenchRuns = ({ runs, nowMs, onOpenSuite, why = null }) => {
  const [filters, setFilters] = useState({ q: '', status: 'all', arm: 'all', tier: 'all', day: null, order: 'newest' });
  const [selected, setSelected] = useState(null);
  if (!runs) return <EmptyState title="READING THE LEDGER…" />;
  if (runs.length === 0) return <EmptyState title="NO RUNS ON RECORD — THE HARNESS HAS NOT RUN YET" />;
  const onFilters = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const rows = sortRuns(filterRuns(runs, filters), filters.order);
  const days = ledgerGroups(rows, nowMs);
  // The focus reads the WHOLE ledger, so a sibling stepped to from THE SET
  // stands even when the rail's filters hide it.
  const first = ledgerOrder(days)[0];
  const focus = runs.find((r) => r.runId === selected) ?? runs.find((r) => r.runId === first) ?? null;
  return (
    <div className="lx">
      <Band runs={runs} day={filters.day} onDay={(day) => onFilters({ day })} />
      <div className="bx lx-body">
        <Rail runs={runs} days={days} filters={filters} onFilters={onFilters} selectedId={focus?.runId ?? null} onSelect={setSelected} />
        {focus
          ? <BenchRunFocus row={focus} runs={runs} nowMs={nowMs} onSelect={setSelected} onOpenSuite={onOpenSuite} why={why} />
          : <EmptyState title="NOTHING MATCHES — LOOSEN THE FILTERS" />}
      </div>
    </div>
  );
};
