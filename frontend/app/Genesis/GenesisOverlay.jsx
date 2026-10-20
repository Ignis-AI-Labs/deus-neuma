// GenesisOverlay — GENESIS's DOM plane over the WebGL stage: the caption
// (movement, name, one true line), the names riding their nodes (projected
// from the same camera the stage renders with), the offering's mark with
// the 22 expressions and this install's record inscribed around it, and the
// closing words. Everything here is a function of sceneAt(t); the only
// motion is opacity and transform.

import { GATEWAY_SEAL, chamferedSquarePoints, ringGraduations } from '../../utils/emblem-geometry.js';
import { layoutLabels, glyphsAt, labelFont } from './genesis-labels.js';
import { INSCRIPTIONS } from './genesis-state-emanon.js';
import './Genesis.css';

const G = GATEWAY_SEAL;
const FRAME = chamferedSquarePoints(G.FRAME.X, G.FRAME.Y, G.FRAME.SIZE, G.FRAME.CUT);
const TICKS = ringGraduations(G.CENTER, G.CENTER, G.RING_RADIUS, G.TICK_LENGTH, G.CARDINAL_LENGTH, -1);
// A circle path from 12 o'clock, clockwise, for text to ride.
const circlePath = (r) => `M ${G.CENTER} ${G.CENTER - r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`;
const RINGS = Object.freeze([
  { id: 'gen-ins-light', r: 158, cls: 'gen-ins-light', text: INSCRIPTIONS.light },
  { id: 'gen-ins-dark', r: 140, cls: 'gen-ins-dark', text: INSCRIPTIONS.dark },
]);
const RECORD_R = 122;

const typed = (text, p) => text.slice(0, Math.floor(p * text.length));

// A ring's inscription flows the FULL circle: its layout is fixed to the
// circumference from the first letter (textLength), and the part not yet
// inscribed is held invisible — so letters arrive in their final places.
const FullRing = ({ href, r, cls, text, progress }) => {
  const shown = typed(text, progress);
  return (
    <text className={`gen-ins ${cls}`}>
      <textPath href={href} textLength={2 * Math.PI * r * 0.995} lengthAdjust="spacing">
        <tspan>{shown}</tspan>
        <tspan fillOpacity="0">{text.slice(shown.length)}</tspan>
      </textPath>
    </text>
  );
};

/**
 * @param {{ scene: ReturnType<import('./genesis-state.js').sceneAt>, inscription: string, size: {w: number, h: number} }} props
 */
export const GenesisOverlay = ({ scene, inscription, size }) => {
  const { caption, emanon, camera } = scene;
  const o = emanon.offering;
  // the names stand where genesis-labels.js placed them, beside their spheres
  const names = layoutLabels(emanon.labels, glyphsAt(emanon, camera, size), camera, size, caption);
  const font = labelFont(size.w);
  return (
    <div className="gen-overlay" aria-live="polite">
      <svg className="gen-leaders" width={size.w} height={size.h} aria-hidden="true">
        {names.filter((n) => n.leader).map((n) => {
          const toX = n.x + n.w < n.anchor.x ? n.x + n.w : n.x > n.anchor.x ? n.x : n.anchor.x;
          const toY = n.y + n.h < n.anchor.y ? n.y + n.h : n.y > n.anchor.y ? n.y : n.y + n.h / 2;
          return <line key={n.key} x1={n.anchor.x} y1={n.anchor.y} x2={toX} y2={toY} className={`gen-leader gen-leader-${n.kind}`} style={{ opacity: n.opacity * 0.6 }} />;
        })}
      </svg>
      {names.map((n) => (
        <span
          key={n.key}
          className={`gen-label gen-label-${n.kind}`}
          style={{ left: `${n.x}px`, top: `${n.y}px`, fontSize: `${font}px`, opacity: n.opacity }}
        >
          {n.text}
        </span>
      ))}

      <div className="gen-mark" style={{ opacity: o.mark }} aria-hidden={o.mark === 0}>
        <svg viewBox="0 0 400 400" className="gen-mark-svg">
          <polygon points={FRAME} className="gen-mark-frame" />
          <circle cx={G.CENTER} cy={G.CENTER} r={G.RING_RADIUS} className="gen-mark-ring" />
          {TICKS.map((k, i) => (
            <line key={i} x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} className={k.cardinal ? 'gen-mark-cardinal' : 'gen-mark-tick'} />
          ))}
          <defs>
            {RINGS.map((r) => <path key={r.id} id={r.id} d={circlePath(r.r)} />)}
            <path id="gen-ins-record" d={circlePath(RECORD_R)} />
          </defs>
          {RINGS.map((r) => (
            <FullRing key={r.id} href={`#${r.id}`} r={r.r} cls={r.cls} text={r.text} progress={o.inscribe} />
          ))}
          <text className="gen-ins gen-ins-record"><textPath href="#gen-ins-record">{typed(inscription, o.record)}</textPath></text>
        </svg>
      </div>

      {caption ? (
        <div className="gen-caption" key={caption.title + caption.movement}>
          <span className="gen-caption-movement">{caption.movement}</span>
          <span className="gen-caption-title">{caption.title}</span>
          <span className="gen-caption-line">{caption.line}</span>
        </div>
      ) : null}

      <div className="gen-words">
        <span className="gen-words-vertex" style={{ opacity: o.vertex }}>EVERY CONSCIOUSNESS IS A LOAD-BEARING VERTEX</span>
        <span className="gen-words-namaste" style={{ opacity: o.namaste }}>NAMASTE</span>
      </div>

      <div className="gen-veil" style={{ opacity: emanon.fade * 0.85 }} />
    </div>
  );
};
