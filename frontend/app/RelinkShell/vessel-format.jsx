// vessel-format — VESSEL's shared bits, extracted verbatim from VesselApp.jsx
// (size-law breakdown, 2026-08-26): the pure formatters, the constant sets,
// and the three little display atoms both lanes render.

import { uiSound } from '../../services/ui-sound.js';

// pure formatters — an absent measurement shows as '—', never a fabricated
// zero (the SUBSTRATE HUD's idiom).
export const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
export const n0 = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
export const pct = (r) => (Number.isFinite(r) ? `${(r * 100).toFixed(0)}%` : '—');
export const gbOf = (gb) => (Number.isFinite(gb) ? `${gb} GB` : '—');

export const MARKERS = Object.freeze(['sunlight', 'social', 'other']);
export const UNITS = Object.freeze(['kg', 'lb']);
export const LOG_KINDS = Object.freeze([
  { value: 'pr', label: 'PR' },
  { value: 'bodyweight', label: 'BODYWEIGHT' },
  { value: 'session', label: 'SESSION' },
  { value: 'life', label: 'MARKER' },
]);

// One at-a-glance card: a value over its plain label, an optional sub-line,
// SIGNAL only when the value is a live truth (the telemetry strip, serving).
export const Fact = ({ value, label, sub, live }) => (
  <div className="vl-fact">
    <span className={`vl-fact-v${live ? ' is-live' : ''}`}>{value}</span>
    {sub ? <span className="vl-fact-s label-data">{sub}</span> : null}
    <span className="vl-fact-l label-data">{label}</span>
  </div>
);

// Small toggle chips (unit, marker) — the chosen one carries SIGNAL, the
// same register as the dropdown's selected option.
export const ToggleChips = ({ options, value, onPick, ariaLabel }) => (
  <div className="vl-chips" role="group" aria-label={ariaLabel}>
    {options.map((o) => (
      <button
        key={o}
        type="button"
        className={`vl-chip${value === o ? ' is-on' : ''}`}
        aria-pressed={value === o}
        onClick={() => { uiSound('tick'); onPick(o); }}
      >{o.toUpperCase()}</button>
    ))}
  </div>
);

// A mono fact row: plain label left, the honest value right ('—' when the
// record does not carry it).
export const FactRow = ({ label, value }) => (
  <div className="vl-row">
    <span className="vl-row-l label-data">{label}</span>
    <span className="vl-row-v">{value ?? '—'}</span>
  </div>
);
