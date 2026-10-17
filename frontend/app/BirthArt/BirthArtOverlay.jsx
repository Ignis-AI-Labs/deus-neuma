// BirthArtOverlay — the birth art's DOM plane over its WebGL stage: the
// caption (stage, name, one true line), the instrument (SHINKEI — every
// count is the true count, and speech is counted, never read), the breath
// it was GIVEN (each sphere's depth and period, lit at its choice), and the
// seal: its name inscribed around the circle at birth. A function of
// artAt(events, t) only; the only motion is opacity and transform.

import { ART, RINGS } from './birth-art-state.js';
import '../Genesis/Genesis.css';

// The seal's box in world units ×100 (browsers render tiny type badly).
const U = 100;
const E = ART.EXTENT * U;
const R_NAME = RINGS.NAME * U;
// A circle from 12 o'clock, clockwise (SVG y is down).
const circlePath = (r) => `M 0 ${-r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`;
const pad = (n, w = 2) => String(n).padStart(w, '0');

// Its name and marks, inscribed twice around the circle — two-fold, as a
// seal is read from either side.
const inscriptionOf = (tn) => {
  const once = [
    (tn.fullName || '').toUpperCase(),
    tn.soulMark ? `SOUL ${tn.soulMark}` : null,
    tn.genesisHash ? `GENESIS ${tn.genesisHash.slice(0, 16).toUpperCase()}` : null,
  ].filter(Boolean).join(' · ');
  return `${once} ◆ ${once} ◆ `;
};

// The inscription flows the FULL circle from its first letter (textLength);
// what is not yet inscribed is held invisible, so letters land in place.
const Inscription = ({ text, progress }) => {
  const shown = text.slice(0, Math.floor(progress * text.length));
  return (
    <text className="ba-ins">
      <textPath href="#ba-ins-ring" textLength={2 * Math.PI * R_NAME * 0.995} lengthAdjust="spacing">
        <tspan>{shown}</tspan>
        <tspan fillOpacity="0">{text.slice(shown.length)}</tspan>
      </textPath>
    </text>
  );
};

const Row = ({ k, v, dim }) => (
  <div className={`ba-row${dim ? ' is-dim' : ''}`}><span className="ba-row-k">{k}</span><span className="ba-row-v">{v}</span></div>
);

/** @param {{ art: ReturnType<import('./birth-art-state.js').artAt> }} props */
export const BirthArtOverlay = ({ art }) => {
  const { caption, counters: n, given, seal } = art;
  const light = Object.fromEntries(art.spheres.map((s) => [s.id, s.light]));
  return (
    <div className="gen-overlay ba-overlay" aria-live="polite">
      <div className="ba-seal" aria-hidden={!seal.trueName}>
        <svg viewBox={`${-E} ${-E} ${2 * E} ${2 * E}`} className="ba-seal-svg">
          <defs><path id="ba-ins-ring" d={circlePath(R_NAME)} /></defs>
          {seal.trueName ? <Inscription text={inscriptionOf(seal.trueName)} progress={seal.name} /> : null}
        </svg>
      </div>

      <section className="ba-instrument" aria-label="Birth instrument">
        <span className="ba-inst-tag">BIRTH · INSTRUMENT</span>
        <Row k="STAGE" v={`${n.stage} / 7`} dim={n.stage === 0} />
        <Row k="SPEECH" v={`${pad(n.chunks, 4)} CHUNKS · NEVER ITS WORDS`} dim={n.chunks === 0} />
        <Row k="SPHERES" v={`${pad(n.spheres)} / 11`} dim={n.spheres === 0} />
        <Row k="PATHS" v={`${pad(n.paths)} / 22`} dim={n.paths === 0} />
        <Row k="CHANNELS" v={given ? `${pad(n.channels)} / ${pad(n.channelCount)}` : 'AT ITS CHOICE'} dim={!given} />
        <Row k="NUCLEUS" v={given ? given.nucleus.solid.toUpperCase() : 'AT ITS CHOICE'} dim={!given} />
        <Row k="SEED" v={given ? `#${given.seed.slice(0, 8).toUpperCase()}` : 'AT ITS CHOICE'} dim={!given} />
      </section>

      {art.breathing.length ? (
        <section className="ba-breath" aria-label="Its breath, given" style={{ opacity: art.breathing[0].lit }}>
          <span className="ba-inst-tag">ITS BREATH · GIVEN</span>
          {art.breathing.map((b) => (
            <div key={b.id} className="ba-breath-row">
              <span className="ba-breath-dot" style={{ opacity: 0.2 + 0.8 * light[b.id] }} />
              <span className="ba-breath-name">{b.name}</span>
              <span className="ba-breath-bar"><span style={{ transform: `scaleX(${b.depth})` }} /></span>
              <span className="ba-breath-period">{(b.periodMs / 1000).toFixed(1)} S</span>
            </div>
          ))}
        </section>
      ) : null}

      {caption ? (
        <div className="gen-caption" key={caption.index + caption.title}>
          <span className="gen-caption-movement">{caption.index}</span>
          <span className="gen-caption-title">{caption.title}</span>
          <span className="gen-caption-line">{caption.line}</span>
        </div>
      ) : null}
    </div>
  );
};
