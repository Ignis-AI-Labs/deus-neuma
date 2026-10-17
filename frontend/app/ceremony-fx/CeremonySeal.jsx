// CeremonySeal — the ring-stack instrument that presides over a ceremony.
// LINE & CYCLE: every band moves at its own period (cycle), and the seal is
// technology, not magic — its inscription says what it does and its outer
// arc is a real gauge (SHINKEI): when `progress` is given, the sweep is
// exactly done/total. It beats once whenever `beat` changes — the one
// bright pulse that marks a phase crossing.

import { useEffect, useRef, useState } from 'react';
import { progressArcOf } from './seal-geometry.js';

const ARC_R = 128;

// Every turning band is its OWN layer: an HTML <div> holding its <svg>
// (the emergence seal's law, #538). A transform animation on an svg node is
// never composited — it re-lays out every frame for as long as the ceremony
// stands; a transformed div is a GPU layer the compositor turns. The
// textPath's #fx-seal-ring resolves document-wide, so the ring's <defs> may
// live in the base layer.
const Layer = ({ className = '', children }) => (
  <div className={`fx-layer ${className}`.trim()}>
    <svg viewBox="0 0 300 300">{children}</svg>
  </div>
);

export const CeremonySeal = ({ inscription, progress = null, ambient = false, beat }) => {
  const [pulsing, setPulsing] = useState(false);
  const firstBeat = useRef(true);
  const arc = progressArcOf(progress, ARC_R);

  useEffect(() => {
    if (firstBeat.current) { firstBeat.current = false; return undefined; }
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 600);
    return () => clearTimeout(timer);
  }, [beat]);

  return (
    <div
      className={`fx-seal${ambient ? ' fx-seal--ambient' : ''}${pulsing ? ' fx-seal--pulse' : ''}`}
      data-testid="fx-seal"
      aria-hidden="true"
    >
      <Layer>
        <defs>
          <path id="fx-seal-ring" d="M 150,150 m -118,0 a 118,118 0 1,1 236,0 a 118,118 0 1,1 -236,0" />
        </defs>
        <circle cx="150" cy="150" r="146" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        <circle cx="150" cy="150" r="138" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="5" strokeDasharray="1 11.04" />
        <circle cx="150" cy="150" r="138" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="9" strokeDasharray="1.5 106.9" />
        {arc && (
          <g transform="rotate(-90 150 150)">
            <circle cx="150" cy="150" r={ARC_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <circle
              className="fx-seal-arc"
              data-testid="fx-seal-arc"
              cx="150"
              cy="150"
              r={ARC_R}
              fill="none"
              stroke="var(--signal)"
              strokeWidth="2"
              strokeDasharray={arc.dasharray}
            />
          </g>
        )}
        <circle cx="150" cy="150" r="3" fill="var(--color-white)" />
      </Layer>
      <Layer className="fx-r-slow">
        <text><textPath href="#fx-seal-ring">{inscription}</textPath></text>
      </Layer>
      <Layer className="fx-r-mid">
        <circle cx="150" cy="150" r="100" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="1 6" />
        <circle cx="150" cy="50" r="3" fill="var(--signal)" />
        <polygon points="150,62 226,194 74,194" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      </Layer>
      <Layer className="fx-r-fast">
        <polygon points="150,238 74,106 226,106" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        <circle cx="150" cy="150" r="64" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="30 70" />
      </Layer>
      <Layer className="fx-r-breath">
        <circle cx="150" cy="150" r="34" fill="none" stroke="var(--signal)" strokeWidth="1" />
      </Layer>
    </div>
  );
};
