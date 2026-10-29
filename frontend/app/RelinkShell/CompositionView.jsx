// CompositionView — the CONTEXT MAP's COMPOSITION view: the context window
// read as instruments (design-language.md § JŌHŌ SEKKEI). THE WINDOW — how
// full it is, what the next turn inherits; WHAT FILLS IT — the last request by
// family, a family press narrowing the ranked sections; WHAT WAS CUT — shed,
// degraded and compressed regions. Drawn from the portal's context:composition
// event only (counts, never the assembled text); the shaping is
// context-anatomy.js. Every token figure carries its honest source
// (TokenFigure): a measured total reads bare, attributed and approx counts
// read ~N EST, a carried one says CARRIED.

import { useState } from 'react';
import { EmptyState } from './empty-state.jsx';
import { formatClockStamp, formatCount } from '../../utils/format.js';
import { approxTokensFromChars } from '../../../core/continuity/layers/record-util.js';
import { TokenFigure } from './context-token-figure.jsx';
import { cutsOf, familiesOf, windowOf } from './context-anatomy.js';
export { TokenFigure } from './context-token-figure.jsx';

const pctOf = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const SECTIONS_SHOWN = 12;

// THE WINDOW — the budget as one bar: standing input, output, free; the
// working peak and the serving's cache reuse marked on the same scale.
const WindowPanel = ({ w, session }) => {
  const scale = w.budget ?? Math.max(w.used, w.peak ?? 0, 1);
  const at = (n) => `${Math.min(100, (n / scale) * 100)}%`;
  return (
    <section className="ctx-panel ctx-window" aria-label="the context window">
      <div className="ctx-window-head">
        <span className="ctx-big"><TokenFigure tokens={w.used} tokenSource={w.source} /></span>
        <span className="ctx-window-of label-data">
          {w.budget === null ? 'OF AN UNKNOWN WINDOW' : `OF ${formatCount(w.budget)} · ${pctOf(w.used, w.budget)} USED · ${formatCount(w.free)} LEFT`}
        </span>
      </div>
      <div className="ctx-window-bar" aria-hidden="true">
        <i className="ctx-part-input" style={{ width: at(w.input) }} />
        <i className="ctx-part-output" style={{ width: at(w.output) }} />
        {w.cached ? <b className="ctx-mark-cache" style={{ left: at(w.cached) }} title={`cache reused ${formatCount(w.cached)} tokens`} /> : null}
        {w.peak ? <b className="ctx-mark-peak" style={{ left: at(w.peak) }} title={`working peak ${formatCount(w.peak)} tokens`} /> : null}
      </div>
      <div className="ctx-readouts">
        <span className="ctx-readout ctx-standing"><i className="ctx-sw ctx-part-input" />STANDING INPUT <TokenFigure tokens={w.input} tokenSource={w.source} /></span>
        <span className="ctx-readout"><i className="ctx-sw ctx-part-output" />OUTPUT <TokenFigure tokens={w.output} tokenSource={w.source} /></span>
        <span className="ctx-readout ctx-budget">
          BUDGET {w.budget === null ? '— / UNKNOWN' : <><TokenFigure tokens={w.used} tokenSource={w.source} />{' / '}{formatCount(w.budget)} · {String(w.budgetSource).toUpperCase()}</>}
        </span>
        {w.peak ? (
          <span className="ctx-readout ctx-peak"><i className="ctx-sw ctx-mark-peak" />WORKING PEAK <TokenFigure tokens={w.peak} tokenSource="measured" /> · TOOL MACHINERY — NOT CARRIED FORWARD</span>
        ) : null}
        {w.cached ? <span className="ctx-readout"><i className="ctx-sw ctx-mark-cache" />CACHE REUSED {formatCount(w.cached)}</span> : null}
        {Number.isInteger(session?.compactionCount) ? (
          <span className="ctx-readout">COMPACTIONS {session.compactionCount}{session.atBoundary ? ' · AT THE BOUNDARY THIS TURN' : ''}</span>
        ) : null}
      </div>
    </section>
  );
};

// One section as a bar on the anatomy's shared axis (the largest section).
const SectionBar = ({ s, max, total }) => (
  <li
    className={`ctx-sec ctx-fam-${s.family}`}
    tabIndex={0}
    title={`${s.label} — ${formatCount(s.chars)} chars`}
    aria-label={`${s.label} — ${s.chars} chars, ${s.tokenSource === 'measured' ? '' : 'about '}${s.tokens} tokens (${s.tokenSource})`}
  >
    <span className="ctx-sec-name">{(s.label || s.id).toUpperCase()}</span>
    <span className="ctx-sec-track"><i style={{ width: `${(s.tokens / max) * 100}%` }} /></span>
    <span className="ctx-sec-n"><TokenFigure tokens={s.tokens} tokenSource={s.tokenSource} /><small>{pctOf(s.tokens, total)}</small></span>
  </li>
);

// WHAT FILLS IT — the last request by family; a family press narrows the sections.
const AnatomyPanel = ({ composition }) => {
  const [family, setFamily] = useState(null);
  const [all, setAll] = useState(false);
  const { totals } = composition;
  const families = familiesOf(composition);
  const picked = families.find((f) => f.id === family) ?? null;
  const ranked = (picked ? picked.sections.map((s) => ({ ...s, family: picked.id }))
    : families.flatMap((f) => f.sections.map((s) => ({ ...s, family: f.id }))).sort((a, b) => b.tokens - a.tokens));
  const shown = all || picked ? ranked : ranked.slice(0, SECTIONS_SHOWN);
  const max = Math.max(1, ...ranked.map((s) => s.tokens));
  const empty = (picked ? [picked] : families).reduce((a, f) => a + f.empty, 0);
  return (
    <section className="ctx-panel ctx-anatomy" aria-label="what fills the window">
      <p className="ctx-panel-h label-data">
        LAST REQUEST · SECTION TOTAL <TokenFigure tokens={totals.tokens} tokenSource={totals.tokenSource} />
      </p>
      <div className="ctx-fam-bar" aria-hidden="true">
        {families.filter((f) => f.tokens > 0).map((f) => (
          <i key={f.id} className={`ctx-fam-${f.id}${family && family !== f.id ? ' is-dim' : ''}`} style={{ flexGrow: f.tokens }} title={`${f.label} ${pctOf(f.tokens, totals.tokens)}`} />
        ))}
      </div>
      <div className="ctx-fams" role="group" aria-label="families">
        {families.map((f) => (
          <button key={f.id} type="button" className={`ctx-fam ctx-fam-${f.id}${family === f.id ? ' is-lit' : ''}`}
            aria-pressed={family === f.id} onClick={() => setFamily(family === f.id ? null : f.id)}>
            <i className="ctx-sw" />{f.label}<b>{pctOf(f.tokens, totals.tokens)}</b>
          </button>
        ))}
      </div>
      <ol className="ctx-secs" aria-label="context sections, largest first">
        {shown.map((s) => <SectionBar key={s.id} s={s} max={max} total={totals.tokens} />)}
      </ol>
      <p className="ctx-more label-data">
        {ranked.length > shown.length ? (
          <button type="button" onClick={() => setAll(true)}>SHOW ALL {ranked.length}</button>
        ) : null}
        {empty ? `${empty} EMPTY SECTION${empty === 1 ? '' : 'S'} THIS TURN` : null}
      </p>
    </section>
  );
};

// A compressed region — a tool result that crossed the compression cap, kept
// under its ref: the bar is what rode the wire against what the tool produced.
// Chars arrive, the operator budgets in tokens, so they read as ~N TOK.
const RefBar = ({ r }) => {
  const kept = approxTokensFromChars(r.sentChars);
  const original = approxTokensFromChars(r.originalChars);
  return (
    <li className="ctx-ref" tabIndex={0}
      aria-label={`${r.ref} — ${r.tool}, kept about ${kept} of ${original} tokens, ${r.kind}`}>
      <span className="ctx-ref-id">{r.ref}</span>
      <span className="ctx-ref-track"><i style={{ width: `${original > 0 ? Math.min(100, (kept / original) * 100) : 0}%` }} /></span>
      <span className="ctx-ref-kept label-data">{(r.tool || '').toUpperCase()} · KEPT ~{formatCount(kept)} OF ~{formatCount(original)} TOK</span>
      <span className="ctx-ref-kind label-data">{(r.kind || '').toUpperCase()}</span>
    </li>
  );
};

// WHAT WAS CUT — what the window could not hold, could not read, or compressed.
const CutsPanel = ({ composition }) => {
  const { shed, degraded } = cutsOf(composition);
  const refs = composition.toolResults || [];
  return (
    <section className="ctx-panel ctx-cuts" aria-label="what was cut">
      {shed.length ? (
        <p className="ctx-cut is-loud" tabIndex={0} aria-label={`shed this turn — ${shed.map((s) => s.id).join(', ')} did not fit the window`}>
          <b>SHED</b> {shed.map((s) => `${s.id} ~${formatCount(s.tokens)}`).join(', ').toUpperCase()} · THE WINDOW COULD NOT HOLD THEM
        </p>
      ) : null}
      {degraded.length ? (
        <p className="ctx-cut is-loud" tabIndex={0} aria-label={`context degraded — ${degraded.join(', ')} unavailable this turn`}>
          <b>DEGRADED</b> {degraded.join(', ').toUpperCase()} · FAILED SOFT THIS TURN
        </p>
      ) : null}
      {!shed.length && !degraded.length ? <p className="ctx-cut label-data">NOTHING SHED · NOTHING FAILED THIS TURN</p> : null}
      <p className="ctx-panel-h label-data">COMPRESSED REGIONS</p>
      {refs.length === 0 ? (
        <p className="ctx-note">None this session — no tool result has crossed the compression cap.</p>
      ) : (
        <ul className="ctx-refs" aria-label="compressed tool results">{refs.map((r) => <RefBar key={r.ref} r={r} />)}</ul>
      )}
    </section>
  );
};

// Pure view of one composition event. Exported for the component-level
// vitest (real event objects from the real builder — no browser needed).
export const CompositionView = ({ composition }) => {
  if (!composition) {
    return (
      <EmptyState title="NO TURN OBSERVED YET THIS SESSION">
        <small>
          The map draws from real telemetry only. Send a thought — the
          window&apos;s anatomy appears with the first turn.
        </small>
      </EmptyState>
    );
  }

  // A replayed event is the session's recorded truth, not a live turn — the
  // heading says so, with the recorded moment when the record carries one.
  const recordedStamp = composition.replayed
    ? ` · AS RECORDED${composition.at ? ` ${formatClockStamp(composition.at).toUpperCase()}` : ''}`
    : '';

  return (
    <div className="ctx-comp">
      <p className="ctx-h label-data">WINDOW ANATOMY · LAST TURN{recordedStamp}</p>
      <WindowPanel w={windowOf(composition)} session={composition.session} />
      <div className="ctx-grid">
        <AnatomyPanel composition={composition} />
        <CutsPanel composition={composition} />
      </div>
    </div>
  );
};
