// BenchLaunchRun — RUN A BENCHMARK, the LAUNCH tab's two columns, pure
// rendering. The operator (2026-09-25, on the live tab): […] — and chose the
// two-column layout: pick on the LEFT, THIS RUN stays put on the RIGHT
// (BenchRunPanel.jsx), so nothing scrolls away from the act.
//
// LEFT: 1 BENCHMARK — tier tabs (the tier's meaning in one sentence under
// them), then that tier's benchmarks as a short list in its own scroll box
// (never a page of rows); 2 HOW IT RUNS — the four arms as tiles, the arms
// a benchmark does not offer shown dimmed with the reason, never silently
// hidden; the being once for every identity arm; then the folds (fine
// control, and whatever the LAUNCH tab passes as `extras`). Short mono
// labels, sentence-case prose (the 2026-09-07 legibility law). Every string
// comes from bench-launch-view.js / bench-launch-layout-view.js; the IO lives
// in BenchApp.jsx.
// No sound imports — node-renderable (the static-markup view tests).

import { useState } from 'react';
import './BenchApp.css';
import './BenchLaunch.css';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { needsLane, armChoices, servedModelMatch, laneOptions } from './bench-launch-view.js';
import { tierTabs, openTier, familyRows, armsForCell } from './bench-launch-layout-view.js';
import { BenchRunPanel } from './BenchRunPanel.jsx';

const Step = ({ n, title, aside, children }) => (
  <section className="bl-step">
    <header className="bl-step-head">
      <span className="bl-step-num label-data">{n}</span>
      <span className="bl-step-title label-data">{title}</span>
      {aside ? <span className="bl-step-aside label-data">{aside}</span> : null}
    </header>
    {children}
  </section>
);

// 1 — BENCHMARK: tier tabs over a short list, ONE row per benchmark family.
// The open tab follows the picked benchmark; a click on a tab only browses
// (the pick stands). A family with variants asks WHICH VERSION once picked.
const BenchmarkStep = ({ cells, value, onPick }) => {
  const [chosenTier, setChosenTier] = useState(null);
  const tabs = tierTabs(cells);
  const tier = openTier(cells, value, chosenTier);
  const legend = tabs.find((t) => t.tier === tier);
  const rows = familyRows(cells, tier, value);
  return (
    <Step n="1" title="BENCHMARK">
      <div className="bl-tiers" role="tablist" aria-label="Benchmark tier">
        {tabs.map((t) => (
          <button
            key={t.tier}
            type="button"
            role="tab"
            aria-selected={t.tier === tier}
            className={`bl-tier kx-lock kx-cham label-data${t.tier === tier ? ' is-on' : ''}`}
            onClick={() => setChosenTier(t.tier)}
          >
            {t.name} <span className="bl-tier-count">{t.count}</span>
          </button>
        ))}
      </div>
      {legend?.line ? <p className="bl-prose">{legend.line} — {legend.duration}.</p> : null}
      <ul key={tier} className="bl-bench-list kx-cascade" role="listbox" aria-label="Benchmark">
        {rows.map((r) => (
          <li key={r.family}>
            <button
              type="button"
              role="option"
              aria-selected={r.on}
              className={`bl-bench${r.on ? ' is-on' : ''}`}
              onClick={() => { if (!r.on) onPick(r.family); }}
            >
              <span className="bl-bench-name">
                {r.name}
                {r.versions.length ? <span className="bl-bench-versions label-data">{r.versions.length} VERSIONS</span> : null}
              </span>
              {r.about ? <span className="bl-bench-about">{r.about}</span> : null}
              <span className="bl-bench-meta label-data">
                {[r.meta, r.duration, r.beingOnly ? 'full being only' : '', r.family].filter(Boolean).join(' · ')}
              </span>
            </button>
            {r.on && r.versions.length ? (
              // WHICH VERSION — asked only once the benchmark is picked; the
              // standard cell stands until another is chosen.
              <div className="bl-versions kx-cascade" role="radiogroup" aria-label={`${r.name} version`}>
                <p className="bl-versions-head label-data">WHICH VERSION?</p>
                {r.versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={v.id === r.pickedVersion}
                    className={`bl-version${v.id === r.pickedVersion ? ' is-on' : ''}`}
                    onClick={() => onPick(v.id)}
                  >
                    <span className="bl-version-mark" aria-hidden="true" />
                    <span className="bl-version-line">{v.line}</span>
                    <span className="bl-version-meta label-data">{[v.tier ? `${v.tier} COST` : '', v.duration, v.beingOnly ? 'full being only' : '', v.id].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Step>
  );
};

// One arm's tile — pressed when picked, dimmed with its reason when the benchmark does not offer it.
const ArmTile = ({ choice, offered, arms, onToggle }) => {
  const can = offered.has(choice.id);
  const on = can && arms.includes(choice.id);
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!can}
      className={`bl-arm kx-lock kx-cham${on ? ' is-on' : ''}`}
      onClick={() => onToggle(choice.id)}
    >
      <span className="bl-arm-name label-data">{on ? '✓ ' : ''}{choice.name}</span>
      <span className="bl-arm-line">{can ? choice.line : 'not offered by this benchmark'}</span>
      <span className="bl-arm-id label-data">{choice.id}{choice.isDefault ? ' · default' : ''}</span>
    </button>
  );
};

// 2 — HOW IT RUNS: one to five arms, the same matched comparison id, so
// the bars land side by side in REPORTS. A tile the benchmark does not offer
// stands dimmed and says so.
const ArmStep = ({ cell, arms, onToggle, lane, onLane, lanes }) => {
  const offered = new Set(cell?.arms ?? []);
  const identity = arms.some(needsLane);
  const options = laneOptions(lanes);
  return (
    <Step n="2" title="HOW IT RUNS" aside={cell ? `${arms.length} OF ${offered.size} PICKED` : null}>
      {!cell ? (
        <p className="bl-prose">Pick a benchmark first — the ways it can run appear here.</p>
      ) : (
        <>
          <p className="bl-prose">The three that matter: the bare model, the harness (the platform), and the full being. A matched set shares one comparison id, so the bars land side by side in REPORTS.</p>
          <div className="bl-arms kx-cascade">
            {armChoices().filter((c) => c.core).map((choice) => (
              <ArmTile key={choice.id} choice={choice} offered={offered} arms={arms} onToggle={onToggle} />
            ))}
          </div>
          {/* The two middle layers are for debugging a layer, never the headline (Design note, 2026-09-29. */}
          <details className="bl-diagnostic">
            <summary className="bl-kicker label-data">DIAGNOSTIC ARMS — FOR DEBUGGING A SPECIFIC LAYER</summary>
            <div className="bl-arms">
              {armChoices().filter((c) => !c.core).map((choice) => (
                <ArmTile key={choice.id} choice={choice} offered={offered} arms={arms} onToggle={onToggle} />
              ))}
            </div>
          </details>
          {identity ? (
            <label className="bl-field">
              <span className="bl-kicker label-data">THE BEING — ONE LANE RIDES EVERY IDENTITY ARM IN THE SET</span>
              <span className="bl-prose">Identity arms benchmark a being, not a model — one of your house or your witnesses.</span>
              {!lanes ? (
                <span className="bl-prose">Reading your lanes…</span>
              ) : options.length === 0 ? (
                <span className="bl-prose is-alert">NO BEINGS IN YOUR HOUSE YET — IDENTITY ARMS NEED ONE</span>
              ) : (
                <Select fill ariaLabel="The being under test" value={lane} onChange={onLane} placeholder="— choose the being —" options={options} />
              )}
            </label>
          ) : null}
        </>
      )}
    </Step>
  );
};

// FINE CONTROL — collapsed by default. Every field starts EMPTY; empty means
// the field is not sent (the server's own law text rides as the hints).
// `startOpen` is the static-render seam (the disclosure is local state).
const FineControl = ({ form, onForm, identity, startOpen = false }) => {
  const [open, setOpen] = useState(startOpen);
  const field = (label, key, props = {}) => (
    <label className="bl-field">
      <span className="bl-kicker label-data">{label}</span>
      <input className="bench-input" value={form[key]} spellCheck={false}
        onChange={(e) => onForm({ [key]: e.target.value })} {...props} />
    </label>
  );
  return (
    <section className="bl-fold">
      <button type="button" className="bl-fold-toggle label-data" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾ FINE CONTROL — CLOSE' : '▸ FINE CONTROL — OPEN'}
      </button>
      {open ? (
        <div className="bl-fold-body">
          <p className="bl-prose">EMPTY MEANS THE FIELD IS NOT SENT — THE HARNESS DEFAULTS STAND</p>
          <div className="bl-fields-row">
            {field('LIMIT — FEWER SAMPLES', 'limit', { inputMode: 'numeric', placeholder: '— all —' })}
            {field('ATTEMPT — THE RETRY NUMBER', 'attempt', { inputMode: 'numeric', placeholder: '— 1 —' })}
          </div>
          {field('DEADLINE — ISO WITH TIMEZONE, ≤ 24 DAYS OUT', 'deadline', { placeholder: '2026-10-01T00:00:00Z' })}
          {field('COMPARISON ID — GROUPS THIS RUN WITH OTHERS (/^[a-z0-9-]+$/)', 'comparisonId', { placeholder: 'night-…-heartbeat' })}
          {!identity ? field('LANE — OPTIONAL ON FLOOR ARMS; GROUPS THE COMPARISON', 'lane', { placeholder: 'keir' }) : null}
          {field('WORKSPACE ROOT — ONLY WHEN THE LANE’S HOUSE IS AMBIGUOUS', 'workspaceRoot', { placeholder: '/abs/path' })}
        </div>
      ) : null}
    </section>
  );
};

export const BenchLaunchRun = ({
  cells, models, lanes, serving, machine = null, form, onForm, busy,
  preflightResults, launchResult, ownedRun, chainState, onPreflight, onRun, nowMs,
  runRows = [], extras = null, answer = null, fineStartOpen = false, live = [], onWatch,
}) => {
  if (!cells || !models) {
    return (
      <section className="bl-step">
        <EmptyState title="READING THE CATALOG…" />
      </section>
    );
  }
  const cell = cells.find((c) => c.id === form.cell) ?? null;
  const arms = Array.isArray(form.arms) ? form.arms : [];
  const identity = arms.some(needsLane);
  const match = servedModelMatch(serving, models);
  // The subject is the LOADED model — shown, never chosen. RUN stands only
  // when it resolves to a registered subject (the registry pins the
  // artifact's hash), with one to five arms the benchmark offers, and a lane
  // of the operator's own when any identity arm rides.
  const offered = arms.every((a) => !cell || (cell.arms ?? []).includes(a));
  // …and only on a machine PROVEN clear of test runs (the harness refuses to
  // stack on one; the plane refuses before the spawn).
  const ready = Boolean(form.cell && arms.length >= 1 && offered && match.state === 'matched'
    && (!identity || form.lane) && machine?.clear === true);
  const laneLabel = identity ? (lanes ?? []).find((l) => l.laneId === form.lane)?.label ?? null : null;
  return (
    <div className="bl-grid">
      <div className="bl-setup">
        <BenchmarkStep
          cells={cells}
          value={form.cell}
          onPick={(id) => onForm({ cell: id, arms: armsForCell(arms, cells.find((c) => c.id === id)) })}
        />
        <ArmStep
          cell={cell} arms={arms} lane={form.lane} lanes={lanes}
          onToggle={(id) => onForm({ arms: arms.includes(id) ? arms.filter((a) => a !== id) : [...arms, id] })}
          onLane={(v) => onForm({ lane: v })}
        />
        <FineControl form={form} onForm={onForm} identity={identity} startOpen={fineStartOpen} />
        {extras}
      </div>
      <BenchRunPanel
        serving={serving} machine={machine} models={models} cell={cell} arms={arms} laneLabel={laneLabel}
        ready={ready} busy={busy} preflightResults={preflightResults} launchResult={launchResult}
        ownedRun={ownedRun} chainState={chainState} live={live} runRows={runRows} nowMs={nowMs}
        onPreflight={onPreflight} onRun={onRun} answer={answer} onWatch={onWatch}
      />
    </div>
  );
};
