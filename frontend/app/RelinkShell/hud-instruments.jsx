// hud-instruments.jsx — the SUBSTRATE HUD's instrument set. Each one draws a
// measured number against a true scale (SHINKEI): the dial sweeps its ratio,
// the bar fills to its value on a stated axis, the trace's top is labelled.
// The geometry is hud-geometry.js; the instruments carry their own styles
// (hud-instruments.css) so they draw the same wherever they mount.
//
// An unmeasured value draws an empty instrument and reads '—', never a zero.

import './hud-instruments.css';
import { DIAL_START, DIAL_SWEEP, arcBetween, dialArc, dialTick, ringSegments, ratioOf, traceMax, tracePath } from './hud-geometry.js';

/** pure — the tone of a filled ratio: alert past 85%, warm past 60%. */
export const loadTone = (r) => (r === null ? 'idle' : r > 0.85 ? 'hot' : r > 0.6 ? 'warm' : 'live');
/** pure — the tone of a reading against its own thermal marks. */
export const heatTone = (state) => (state === 'critical' ? 'crit' : state === 'hot' ? 'hot' : 'live');

const GRADUATIONS = Array.from({ length: 11 }, (_, i) => i / 10);

/**
 * A 270° dial. `ratio` 0..1 sweeps the arc; `marks` are 0..1 positions of
 * limits; the centre holds the value. Graduations every 10% of the scale.
 */
export const Dial = ({ label, ratio, value, unit, sub, marks = [], tone, title }) => {
  const t = tone ?? loadTone(ratio);
  return (
    <figure className={`hud-dial is-${t}`} title={title}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        {GRADUATIONS.map((g) => <path key={g} className="hud-dial-grad" d={dialTick(36, 36, 33, g, 0, 2)} />)}
        <path className="hud-dial-track" d={arcBetween(36, 36, 28, DIAL_START, DIAL_START + DIAL_SWEEP)} />
        <path className="hud-dial-fill" d={dialArc(36, 36, 28, ratio)} />
        {marks.map((m) => <path key={m} className="hud-dial-mark" d={dialTick(36, 36, 28, m, 6, 6)} />)}
      </svg>
      <span className="hud-dial-value">{value}<span className="hud-unit">{unit}</span></span>
      <figcaption className="hud-dial-label">{label}{sub ? <span className="hud-dial-sub">{sub}</span> : null}</figcaption>
    </figure>
  );
};

/** A sparkline of the poll window (`span` names how long it is), with the current numeral and its scale top stated. */
export const Trace = ({ label, values, capacity, span, unit, floor, current, digits = 0 }) => {
  const max = traceMax(values, floor);
  const now = Number.isFinite(current) ? current.toFixed(digits) : '—';
  return (
    <div className="hud-trace">
      <div className="hud-trace-head">
        <span className="hud-label">{label}</span>
        <span className="hud-trace-now">{now}<span className="hud-unit">{unit}</span></span>
      </div>
      <svg className="hud-trace-plot" viewBox="0 0 160 36" preserveAspectRatio="none" aria-hidden="true">
        <path className="hud-trace-mid" d="M 0 18 L 160 18" />
        <path className="hud-trace-line" d={tracePath(values, capacity, 160, 36, max)} />
      </svg>
      <div className="hud-trace-scale"><span>{span}</span><span>TOP {max}{unit}</span></div>
    </div>
  );
};

/**
 * A horizontal bar on a stated axis 0..max, with tick marks for the reading's
 * own limits (high/crit) or a peak. `text` is the readout at its right.
 */
export const Bar = ({ name, value, max, marks = [], text, tone, title }) => {
  const r = ratioOf(value, max);
  return (
    <div className={`hud-bar is-${tone ?? loadTone(r)}`} title={title}>
      <span className="hud-bar-name">{name}</span>
      <span className="hud-bar-track">
        <span className="hud-bar-fill" style={{ transform: `scaleX(${r ?? 0})` }} />
        {marks.filter((m) => Number.isFinite(m.at)).map((m) => (
          <span key={m.kind} className={`hud-bar-mark is-${m.kind}`} style={{ left: `${(ratioOf(m.at, max) ?? 0) * 100}%` }} />
        ))}
      </span>
      <span className="hud-bar-text">{text}</span>
    </div>
  );
};

/** One whole split into its parts (each part's share of `total`), with a legend. */
export const StackBar = ({ parts, total, marks = [] }) => (
  <div className="hud-stack">
    <div className="hud-stack-track">
      {parts.map((p) => (
        <span key={p.key} className={`hud-stack-part is-${p.tone}`} style={{ flexBasis: `${(ratioOf(p.value, total) ?? 0) * 100}%` }} title={`${p.label} ${p.text}`} />
      ))}
      {marks.map((m) => <span key={m.key} className={`hud-stack-mark is-${m.kind}`} style={{ left: `${(ratioOf(m.at, total) ?? 0) * 100}%` }} title={m.label} />)}
    </div>
    <div className="hud-legend">
      {parts.map((p) => (
        <span key={p.key} className="hud-legend-item"><i className={`hud-swatch is-${p.tone}`} />{p.label}<b>{p.text}</b></span>
      ))}
    </div>
  </div>
);

/** The PCIe link: one cell per lane the card supports, lit for each lane trained. */
export const Lanes = ({ width, widthMax, gen }) => (
  <div className="hud-lanes" title={`PCIe gen ${gen ?? '—'} · x${width ?? '—'} of x${widthMax ?? '—'}`}>
    <span className="hud-lanes-cells">
      {Array.from({ length: widthMax ?? 0 }, (_, i) => <i key={i} className={i < (width ?? 0) ? 'is-on' : ''} />)}
    </span>
    <span className="hud-lanes-text">GEN {gen ?? '—'} · x{width ?? '—'}<span className="hud-unit">/{widthMax ?? '—'}</span></span>
  </div>
);

/** A discrete count as a segmented ring: one segment per slot, lit while busy. */
export const SegRing = ({ label, busy, total }) => (
  <figure className="hud-dial is-live">
    <svg viewBox="0 0 72 72" aria-hidden="true">
      {ringSegments(total ?? 0).map(([a, b], i) => (
        <path key={a} className={i < (busy ?? 0) ? 'hud-seg is-on' : 'hud-seg'} d={arcBetween(36, 36, 28, a, b)} />
      ))}
    </svg>
    <span className="hud-dial-value">{busy ?? '—'}<span className="hud-unit">/{total ?? '—'}</span></span>
    <figcaption className="hud-dial-label">{label}</figcaption>
  </figure>
);

/** A vertical thermometer on a shared °C axis, with the chip's own high and crit marks. */
export const Thermo = ({ row, axis }) => {
  const at = (v) => `${(ratioOf(v, axis) ?? 0) * 100}%`;
  return (
    <figure className={`hud-thermo is-${heatTone(row.state)}`} title={row.title}>
      <span className="hud-thermo-value">{Number.isFinite(row.value) ? row.value.toFixed(1) : '—'}<span className="hud-unit">°</span></span>
      <span className="hud-thermo-tube">
        <span className="hud-thermo-fill" style={{ transform: `scaleY(${ratioOf(row.value, axis) ?? 0})` }} />
        {row.high ? <span className="hud-thermo-mark is-high" style={{ bottom: at(row.high) }} /> : null}
        {row.crit ? <span className="hud-thermo-mark is-crit" style={{ bottom: at(row.crit) }} /> : null}
      </span>
      <figcaption className="hud-label">{row.name}</figcaption>
    </figure>
  );
};

/**
 * A rail against its nominal: the band is the published tolerance either side,
 * the needle sits at the measured drift (a ratio of nominal).
 */
export const Drift = ({ name, value, drift, tolerance }) => {
  const at = Math.max(0, Math.min(1, 0.5 + drift / (tolerance * 4)));
  const out = Math.abs(drift) > tolerance;
  return (
    <div className={`hud-drift${out ? ' is-hot' : ''}`} title={`${name} rail · ${value.toFixed(3)} V · ${(drift * 100).toFixed(1)}% from nominal (tolerance ±${tolerance * 100}%)`}>
      <span className="hud-bar-name">{name}</span>
      <span className="hud-drift-track">
        <span className="hud-drift-band" />
        <span className="hud-drift-needle" style={{ left: `${at * 100}%` }} />
      </span>
      <span className="hud-bar-text">{value.toFixed(2)}<span className="hud-unit">V</span> {drift >= 0 ? '+' : ''}{(drift * 100).toFixed(1)}%</span>
    </div>
  );
};

/** A labelled fact that is a setting, not a measurement: governor, driver, P-state. */
export const Chip = ({ k, v, tone }) => (
  <span className={`hud-chip${tone ? ` is-${tone}` : ''}`}><span className="hud-chip-k">{k}</span>{v}</span>
);
