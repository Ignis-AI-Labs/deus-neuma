// BenchAtlas — THE ATLAS, the top of OVERVIEW, pure rendering. Every
// benchmark taken on one navigable chart, and what the architecture does
// to the model across all of them (bench-atlas-view.js is the law).
//
//   INFLUENCE — two instruments, one per headline layer (HARNESS, FULL
//     BEING): the mean change in points against the bare model over every
//     paired benchmark, how often it wins, and what it costs.
//   THE CHART — one row per benchmark, grouped by tier: the arms as points
//     on one 0–100% line, the span between them drawn — how far, and which
//     way, the architecture moves this benchmark. ↑/↓ walks the rows, Enter
//     (or OPEN) takes the row into REPORTS' explorer.
//   THE TABLE — the same rows as numbers, for reading exact values.
// State that is only the view's (the focused row, the mode, the tier, chart
// vs table) is local; the summary and the jump to REPORTS arrive as props.
// No sound imports — node-renderable (the static-markup view tests).

import { useState } from 'react';
import './BenchAtlas.css';
import { EmptyState } from './empty-state.jsx';
import {
  ATLAS_ARMS, ATLAS_MODES, atlasRows, atlasTiers, influence, ratioText, stepRow, rowReading, pointsText,
} from './bench-atlas-view.js';
import { armName } from './bench-launch-view.js';
import { notTakenByTier } from './bench-summary-view.js';
import { benchMeaning } from './bench-glossary.js';

// NOT TAKEN YET — the catalog cells no run has answered, by tier, behind a fold.
const Owed = ({ notTaken }) => {
  const [open, setOpen] = useState(false);
  const groups = notTakenByTier(notTaken);
  if (!groups.length) return null;
  return (
    <section className="atlas-owed">
      <button type="button" className="bl-fold-toggle label-data" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {notTaken.length} NOT TAKEN YET — DECLARED IN THE CATALOG, NEVER RUN
      </button>
      {open ? groups.map((g) => (
        <p key={g.tier} className="atlas-owed-row">
          <span className="atlas-owed-tier label-data">{g.tier}</span>
          {g.ids.map((id) => <span key={id} className="atlas-owed-id" title={benchMeaning(id) ?? undefined}>{id}</span>)}
        </p>
      )) : null}
    </section>
  );
};

const TICKS = [0, 0.25, 0.5, 0.75, 1];
const at = (v) => `${Math.max(0, Math.min(1, v)) * 100}%`;

const Glyph = ({ arm }) => <span className={`atlas-glyph is-${arm}`} aria-hidden="true" />;

const Influence = ({ layers }) => (
  <div className="atlas-influence">
    {layers.map((l) => (
      <article key={l.arm} className={`atlas-layer${l.mean > 0.005 ? ' is-up' : l.mean < -0.005 ? ' is-down' : ''}`}>
        <header className="atlas-layer-head label-data"><Glyph arm={l.arm} />{l.name}</header>
        <p className="atlas-layer-num">
          {l.meanText}<span className="atlas-layer-unit">{l.mean === null ? '' : ' pts'}</span>
        </p>
        <p className="atlas-layer-line">
          {l.count ? `${l.verdict} the bare model — mean over ${l.count} paired benchmark${l.count === 1 ? '' : 's'}` : 'no paired benchmark yet'}
        </p>
        {l.count ? (
          <p className="atlas-layer-meta label-data">
            {l.wins} UP · {l.losses} DOWN · {l.ties} EVEN
            {[ratioText(l.tokenRatio, 'PROMPT TOKENS'), ratioText(l.timeRatio, 'TIME')].filter(Boolean).map((t) => ` · ${t}`).join('')}
          </p>
        ) : null}
        {l.excluded?.length ? (
          <p className="atlas-layer-meta label-data is-alert" title="a score must be a rate between 0 and 1">
            LEFT OUT — SCORE NOT A 0–1 RATE: {l.excluded.join(', ')}
          </p>
        ) : null}
      </article>
    ))}
  </div>
);

const Row = ({ row, focused, onFocus, onOpen }) => (
  <div
    role="option"
    aria-selected={focused}
    className={`atlas-row${focused ? ' is-on' : ''}`}
    onClick={() => onFocus(row.suiteId)}
    onDoubleClick={() => onOpen(row.suiteId)}
  >
    <span className="atlas-row-name">
      <span className="atlas-row-id">{row.suiteId}</span>
      {row.n ? <span className="atlas-row-n label-data">n={row.n}</span> : null}
    </span>
    <span className="atlas-track">
      {TICKS.map((t) => <span key={t} className="atlas-grid" style={{ left: at(t) }} />)}
      {row.points.length > 1 ? (
        <span className="atlas-span" style={{ left: at(row.low), width: `calc(${at(row.high)} - ${at(row.low)})` }} />
      ) : null}
      {row.points.map((p) => (
        <span key={p.arm} className={`atlas-point is-${p.arm}`} style={{ left: at(p.value) }} title={`${p.name} — ${p.display}`} />
      ))}
    </span>
    <span className="atlas-row-best label-data">
      {row.best ? row.best.display : '—'}
      {row.bestDelta ? <span className="atlas-row-delta">{row.bestDelta}</span> : null}
    </span>
    {focused ? (
      <button type="button" className="atlas-open label-data" onClick={(e) => { e.stopPropagation(); onOpen(row.suiteId); }}>
        OPEN →
      </button>
    ) : <span />}
  </div>
);

const Table = ({ rows, focusedId, onFocus, onOpen }) => (
  <table className="atlas-table">
    <thead>
      <tr>
        <th className="label-data">BENCHMARK</th>
        {ATLAS_ARMS.map((arm) => <th key={arm} className="label-data"><Glyph arm={arm} />{armName(arm)}</th>)}
        <th className="label-data">n</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => {
        const bare = r.points.find((p) => p.arm === 'bare');
        return (
          <tr key={r.suiteId} className={r.suiteId === focusedId ? 'is-on' : ''} onClick={() => onFocus(r.suiteId)} onDoubleClick={() => onOpen(r.suiteId)}>
            <td>{r.suiteId}</td>
            {ATLAS_ARMS.map((arm) => {
              const p = r.points.find((x) => x.arm === arm);
              if (!p) return <td key={arm} className="is-empty">—</td>;
              const d = bare && arm !== 'bare' ? pointsText(p.value - bare.value) : null;
              return (
                <td key={arm}>
                  {p.display}
                  {d ? <span className={`atlas-cell-delta${d.startsWith('+') ? ' is-up' : d.startsWith('−') ? ' is-down' : ''}`}>{d}</span> : null}
                </td>
              );
            })}
            <td className="is-dim">{r.n ?? '—'}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

export const BenchAtlas = ({ summary, onOpen, startView = 'chart' }) => {
  const [mode, setMode] = useState('latest');
  const [tier, setTier] = useState('all');
  const [view, setView] = useState(startView);
  const [focusedId, setFocusedId] = useState(null);
  if (!summary) {
    return <section className="atlas"><EmptyState title="READING EVERY RECEIPT…" /></section>;
  }
  const all = atlasRows(summary, mode);
  const rows = tier === 'all' ? all : all.filter((r) => r.tier === tier);
  const focused = rows.find((r) => r.suiteId === focusedId) ?? null;
  const layers = influence(summary);
  const tiers = atlasTiers(summary, mode);
  const onKey = (e) => {
    if (e.key === 'Enter' && focused) { onOpen(focused.suiteId); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    setFocusedId(stepRow(rows, focusedId, e.key));
  };
  // Tier group headers ride inside the list, before each tier's first row.
  const grouped = [];
  let lastTier;
  for (const r of rows) {
    if (r.tier !== lastTier) grouped.push({ header: String(r.tier ?? '—').toUpperCase(), key: `h-${r.tier}` });
    grouped.push(r);
    lastTier = r.tier;
  }
  return (
    <section className="atlas" aria-label="The atlas">
      <header className="atlas-head">
        <span className="atlas-title label-data">THE ATLAS</span>
        <span className="atlas-count label-data">
          {all.length} BENCHMARK{all.length === 1 ? '' : 'S'} TAKEN · {summary.notTaken?.length ?? 0} NOT TAKEN YET
        </span>
        <span className="atlas-controls">
          <span className="atlas-seg" role="group" aria-label="Which comparison each row stands on">
            {ATLAS_MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} className={`atlas-seg-btn label-data${mode === m.id ? ' is-on' : ''}`} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </span>
          <span className="atlas-seg" role="group" aria-label="Chart or table">
            {['chart', 'table'].map((v) => (
              <button key={v} type="button" aria-pressed={view === v} className={`atlas-seg-btn label-data${view === v ? ' is-on' : ''}`} onClick={() => setView(v)}>
                {v.toUpperCase()}
              </button>
            ))}
          </span>
        </span>
      </header>

      {summary.proofs?.length ? (
        <p className="atlas-proof label-data">
          PROOF SUITE — {summary.proofs[0].total.total ? `${Math.round((summary.proofs[0].total.pass / summary.proofs[0].total.total) * 1000) / 10}%` : '—'}
          {' · '}{summary.proofs[0].total.pass}/{summary.proofs[0].total.total} · {summary.proofs[0].chart?.date ?? ''}
          <span className="atlas-proof-hint"> · the loaded model, NEUMA&apos;s own 43-item check — its certificate is in REPORTS → LIBRARY</span>
        </p>
      ) : null}
      <Influence layers={layers} />
      <p className="atlas-note">
        Each layer is judged only against a bare model that answered the same questions in the same set. T0 smoke runs prove the road and never count.
      </p>

      {all.length === 0 ? <EmptyState title="NO BENCHMARK TAKEN YET — RUN ONE FROM LAUNCH" /> : (
        <>
          <div className="atlas-bar">
            <span className="atlas-seg" role="group" aria-label="Tier">
              {[{ tier: 'all', label: 'ALL', count: all.length }, ...tiers].map((t) => (
                <button key={t.tier} type="button" aria-pressed={tier === t.tier} className={`atlas-seg-btn label-data${tier === t.tier ? ' is-on' : ''}`} onClick={() => setTier(t.tier)}>
                  {t.label} <span className="atlas-seg-n">{t.count}</span>
                </button>
              ))}
            </span>
            <span className="atlas-legend label-data">
              {ATLAS_ARMS.map((arm) => <span key={arm} className="atlas-legend-item"><Glyph arm={arm} />{armName(arm)}</span>)}
            </span>
          </div>
          {view === 'chart' ? (
            <div className="atlas-chart" role="listbox" aria-label="Every benchmark taken" tabIndex={0} onKeyDown={onKey}>
              <div className="atlas-axis" aria-hidden="true">
                <span />
                <span className="atlas-axis-track">
                  {TICKS.map((t) => <span key={t} className="atlas-axis-tick label-data" style={{ left: at(t) }}>{Math.round(t * 100)}%</span>)}
                </span>
                <span className="label-data">BEST</span>
                <span />
              </div>
              {grouped.map((g) => (g.header
                ? <p key={g.key} className="atlas-tier label-data">{g.header}</p>
                : <Row key={g.suiteId} row={g} focused={g.suiteId === focusedId} onFocus={setFocusedId} onOpen={onOpen} />))}
            </div>
          ) : (
            <Table rows={rows} focusedId={focusedId} onFocus={setFocusedId} onOpen={onOpen} />
          )}
          <p className="atlas-reading" aria-live="polite">
            {focused ? rowReading(focused) : 'Select a row — ↑ ↓ to walk the benchmarks, Enter to open one in REPORTS.'}
          </p>
          {focused?.meaning ? <p className="atlas-meaning">{focused.meaning}</p> : null}
        </>
      )}
      <Owed notTaken={summary.notTaken ?? []} />
    </section>
  );
};
