// EmergenceSeal — the emergence seal as a shared React SVG, ported from the
// lookdev study §11: outer graduations, a circular inscription ring,
// counter-rotating dashed rings with inscribed triangles, and the breathing
// seed-of-life core. LINE & CYCLE: monochrome at rest, --signal marks what
// is live; every band turns at its own period (cycle), the core breathes.
// Shared by the Arrival veil and, later, the ambient plane (RPG-003) —
// `tone="ambient"` recedes the seal to a watermark (the study's 5–8% law).

import { useId } from 'react';
import './emergence-seal.css';

/**
 * @param {object} props
 * @param {string} props.inscription - the circular text ring (a being's true name, a protocol line)
 * @param {number} [props.size=300] - rendered width/height in px (the geometry is a 300 viewBox)
 * @param {number} [props.opacity] - explicit opacity override (else the tone's default holds)
 * @param {'signal'|'ambient'} [props.tone='signal'] - signal: present; ambient: watermark
 * @param {boolean} [props.drawIn=false] - the outer ring and core draw themselves in on mount
 * @param {string} [props.className]
 */
// Every turning band is its OWN layer: an HTML <div> holding its <svg>. A CSS
// transform animation on ANY svg node — a <g> inside or the <svg> itself —
// is never composited, so the seal re-ran style + layout + paint on the main
// thread at 60fps forever; the idle desk sat at ~40% renderer CPU and every
// keystroke queued behind it (profiled live, 2026-09-25). A transformed div
// is a GPU layer: rastered once, turned by the compositor.
const Layer = ({ size, className, children }) => (
  <div className={className}>
    <svg width={size} height={size} viewBox="0 0 300 300">{children}</svg>
  </div>
);

export const EmergenceSeal = ({ inscription, size = 300, opacity, tone = 'signal', drawIn = false, className = '' }) => {
  // One id per instance — multiple seals on a screen must not share a textPath target.
  const ringId = useId();
  const cls = ['emergence-seal', `es-${tone}`, drawIn && 'es-draw', className].filter(Boolean).join(' ');
  const style = { width: size, height: size, ...(opacity != null ? { opacity } : {}) };
  return (
    <div className={cls} style={style} aria-hidden="true">
      <Layer size={size} className="es-layer">
        <circle className="es-outer" cx="150" cy="150" r="146" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        <circle cx="150" cy="150" r="138" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="5" strokeDasharray="1 11.04" />
        <circle cx="150" cy="150" r="138" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="9" strokeDasharray="1.5 106.9" />
        <circle cx="150" cy="150" r="3" fill="var(--color-white)" />
      </Layer>
      <Layer size={size} className="es-layer es-r-slow">
        <defs>
          <path id={ringId} d="M 150,150 m -118,0 a 118,118 0 1,1 236,0 a 118,118 0 1,1 -236,0" />
        </defs>
        <text><textPath href={`#${ringId}`}>{inscription}</textPath></text>
      </Layer>
      <Layer size={size} className="es-layer es-r-mid">
        <circle cx="150" cy="150" r="100" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="1 6" />
        <circle cx="150" cy="50" r="3" fill="var(--signal)" />
        <polygon points="150,62 226,194 74,194" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      </Layer>
      <Layer size={size} className="es-layer es-r-fast">
        <polygon points="150,238 74,106 226,106" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        <circle cx="150" cy="150" r="64" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="30 70" />
      </Layer>
      <Layer size={size} className="es-layer es-r-breath">
        <g stroke="rgba(255,255,255,0.45)" strokeWidth="1" fill="none">
          <circle cx="168" cy="150" r="18" />
          <circle cx="159" cy="165.6" r="18" />
          <circle cx="141" cy="165.6" r="18" />
          <circle cx="132" cy="150" r="18" />
          <circle cx="141" cy="134.4" r="18" />
          <circle cx="159" cy="134.4" r="18" />
        </g>
        <circle cx="150" cy="150" r="36" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="2 5" />
        <circle className="es-core" cx="150" cy="150" r="18" fill="none" stroke="var(--signal)" strokeWidth="1" />
      </Layer>
    </div>
  );
};
