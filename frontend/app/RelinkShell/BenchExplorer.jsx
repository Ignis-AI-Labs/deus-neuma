// BenchExplorer — REPORTS' EXPLORER, pure rendering. Pick a benchmark on the
// left (search, tier, ↑/↓); its depth on the right: the comparisons it
// stands on (newest first, ‹ › to step), the chart, every arm's stats —
// score and change against bare, every metric, time, tokens, requests, tool
// calls — WHY each arm missed what it missed (BenchWhy.jsx), and each arm's
// history across runs. The law is
// bench-explorer-view.js; the IO lives in use-bench-reports.js.
// No sound imports — node-renderable (the static-markup view tests).

import { useState } from 'react';
import './BenchExplorer.css';
import './BenchAtlas.css';
import './BenchLaunch.css';
import { EmptyState } from './empty-state.jsx';
import { BenchBars } from './BenchBars.jsx';
import { stepRow } from './bench-atlas-view.js';
import { WhyItMissed } from './BenchWhy.jsx';
import {
  explorerList, setChips, armStats, historyTracks, suiteHeader, identityNote,
} from './bench-explorer-view.js';

const pct = (v) => `${Math.max(0, Math.min(1, v)) * 100}%`;

const Rail = ({ summary, selectedId, onSelect }) => {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('all');
  const list = explorerList(summary, query, tier);
  const tiers = ['all', ...new Set((summary?.suites ?? []).map((s) => s.tier).filter(Boolean).sort())];
  const onKey = (e) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = stepRow(list, selectedId, e.key);
    if (next) onSelect(next);
  };
  return (
    <aside className="bx-rail">
      <input
        className="bx-search"
        type="search"
        value={query}
        placeholder="Search benchmarks…"
        aria-label="Search benchmarks"
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="atlas-seg bx-tiers" role="group" aria-label="Tier">
        {tiers.map((t) => (
          <button key={t} type="button" aria-pressed={tier === t} className={`atlas-seg-btn label-data${tier === t ? ' is-on' : ''}`} onClick={() => setTier(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </span>
      <ul className="bx-list" role="listbox" aria-label="Benchmarks taken" tabIndex={0} onKeyDown={onKey}>
        {list.map((row) => (
          <li key={row.suiteId}>
            <button
              type="button"
              role="option"
              aria-selected={row.suiteId === selectedId}
              className={`bx-item${row.suiteId === selectedId ? ' is-on' : ''}`}
              onClick={() => onSelect(row.suiteId)}
            >
              <span className="bx-item-id">{row.suiteId}</span>
              <span className="bx-item-meta label-data">
                {String(row.tier ?? '—').toUpperCase()} · {row.sets} set{row.sets === 1 ? '' : 's'} · {String(row.finishedAt ?? '').slice(5, 10)}
              </span>
              <span className="bx-dots" aria-hidden="true">
                {row.dots.map((d) => (
                  <span key={d.arm} className="bx-dot-track">
                    {d.value === null ? null : <span className={`atlas-point is-${d.arm}`} style={{ left: pct(d.value) }} />}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 ? <li className="bx-none">No benchmark matches.</li> : null}
      </ul>
    </aside>
  );
};

const History = ({ series }) => {
  const { tracks, span } = historyTracks(series);
  if (!span) return null;
  return (
    <section className="bx-sec">
      <p className="bx-kicker label-data">HISTORY — {span.runs} RUN{span.runs === 1 ? '' : 'S'} · {span.from} → {span.to}</p>
      <div className="bx-history" role="img" aria-label="Every arm's score across runs">
        {[0, 0.25, 0.5, 0.75, 1].map((y) => (
          <span key={y} className="bx-history-grid" style={{ bottom: pct(y) }}>
            <span className="bx-history-y label-data">{Math.round(y * 100)}%</span>
          </span>
        ))}
        {tracks.flatMap((tr) => tr.points.map((p) => (
          <span
            key={`${tr.arm}-${p.runId}`}
            className={`atlas-point is-${tr.arm} bx-history-point`}
            style={{ left: `calc(${pct(p.x)} * 0.94 + 3%)`, bottom: pct(p.y) }}
            title={`${tr.name} — ${Math.round(p.y * 1000) / 10}% · ${String(p.at).slice(0, 10)}`}
          />
        )))}
      </div>
    </section>
  );
};

const Stats = ({ series }) => {
  const rows = armStats(series);
  const metricIds = [...new Set(rows.flatMap((r) => r.metrics.map((m) => m.id)))];
  return (
    <>
      <section className="bx-sec">
        <p className="bx-kicker label-data">EVERY ARM</p>
        <div className="bx-table-wrap">
          <table className="atlas-table bx-stats">
            <thead>
              <tr>
                {['ARM', 'SCORE', 'VS BARE', 'TIME', 'PROMPT TOKENS', 'COMPLETION', 'REQUESTS', 'TOOL CALLS', 'FINISHED'].map((h) => <th key={h} className="label-data">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.arm}>
                  <td><span className={`atlas-glyph is-${r.arm}`} aria-hidden="true" /> {r.name}{r.identity ? <span className="bx-pin label-data">SILO PIN</span> : null}</td>
                  <td className="bx-score">{r.score}</td>
                  <td className={r.delta?.startsWith('+') ? 'is-up' : r.delta?.startsWith('−') ? 'is-down' : 'is-dim'}>{r.delta ?? '—'}</td>
                  <td>{r.time}{r.timeVsBare ? <span className="bx-x">{r.timeVsBare}</span> : null}</td>
                  <td>{r.prompt}{r.promptVsBare ? <span className="bx-x">{r.promptVsBare}</span> : null}</td>
                  <td>{r.completion}</td>
                  <td>{r.requests}</td>
                  <td>{r.toolCalls}</td>
                  <td className="is-dim" title={r.runId ?? undefined}>{r.finishedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {metricIds.length > 1 ? (
        <section className="bx-sec">
          <p className="bx-kicker label-data">EVERY METRIC</p>
          <div className="bx-table-wrap">
            <table className="atlas-table">
              <thead>
                <tr>
                  <th className="label-data">METRIC</th>
                  {rows.map((r) => <th key={r.arm} className="label-data"><span className={`atlas-glyph is-${r.arm}`} aria-hidden="true" /> {r.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {metricIds.map((id) => (
                  <tr key={id}>
                    <td className="bx-metric">{id}</td>
                    {rows.map((r) => <td key={r.arm}>{r.metrics.find((m) => m.id === id)?.value ?? '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
};

const Detail = ({ suite, setId, onSet, onShare, why }) => {
  const chips = setChips(suite);
  const at = Math.max(0, chips.findIndex((c) => c.id === setId));
  const chip = chips[at];
  const head = suiteHeader(suite);
  const note = identityNote(chip?.series);
  return (
    <div className="bx-detail kx-cascade" key={suite.suiteId}>
      <header className="bx-head">
        <p className="bx-title">
          {suite.suiteId}
          {head.tier ? <span className="bx-tag label-data">{head.tier}</span> : null}
        </p>
        {head.meaning ? <p className="bx-meaning">{head.meaning}</p> : null}
        {head.variant ? <p className="bx-variant label-data">THIS CELL — {head.variant}</p> : null}
      </header>
      <section className="bx-sec">
        <div className="bx-sets">
          <button type="button" className="bl-btn label-data" disabled={at <= 0} onClick={() => onSet(chips[at - 1].id)} aria-label="newer comparison">‹</button>
          <span className="bx-set-chips">
            {chips.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === chip.id} className={`bx-chip label-data${c.id === chip.id ? ' is-on' : ''}`} onClick={() => onSet(c.id)}>
                {c.line}
              </button>
            ))}
          </span>
          <button type="button" className="bl-btn label-data" disabled={at >= chips.length - 1} onClick={() => onSet(chips[at + 1].id)} aria-label="older comparison">›</button>
        </div>
        <p className="bx-meta label-data">{[chip.series.chart?.subtitle, chip.series.chart?.meta].filter(Boolean).join(' · ')}</p>
        <div className="bx-chart kx-scan" key={chip.id}>
          <BenchBars chart={chip.series.chart} />
        </div>
        {note ? <p className="bx-note">{note}</p> : null}
        <div className="bx-actions">
          <button type="button" className="bl-btn label-data" onClick={() => onShare({ kind: 'series', id: chip.id })}>SHARE THIS</button>
        </div>
      </section>
      <Stats series={chip.series} />
      {why ? (chip.series.comparisonIds ?? []).map((id, i, all) => (
        <WhyItMissed
          key={id}
          comparisonId={id}
          entry={why.diagnosis(id)}
          onRequest={why.requestDiagnosis}
          title={all.length > 1 ? `WHY IT MISSED — SET ${id}` : 'WHY IT MISSED — EVERY WRONG ANSWER, BY CAUSE'}
        />
      )) : null}
      <History series={chip.series} />
    </div>
  );
};

export const BenchExplorer = ({ summary, selectedSuite, onSelectSuite, selectedSet = {}, onSet, onShare, why = null }) => {
  if (!summary) return <EmptyState title="READING EVERY RECEIPT…" />;
  if (!summary.suites?.length) return <EmptyState title="NO BENCHMARK TAKEN YET — RUN ONE FROM LAUNCH" />;
  const suite = summary.suites.find((s) => s.suiteId === selectedSuite) ?? explorerList(summary).map((r) => summary.suites.find((s) => s.suiteId === r.suiteId))[0];
  return (
    <div className="bx">
      <Rail summary={summary} selectedId={suite.suiteId} onSelect={onSelectSuite} />
      <Detail suite={suite} setId={selectedSet[suite.suiteId]} onSet={(id) => onSet(suite.suiteId, id)} onShare={onShare} why={why} />
    </div>
  );
};
