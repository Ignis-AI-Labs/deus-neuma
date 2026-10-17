// RiteThreshold — I · THE THRESHOLD: the covenant read and signed, the
// vessel inspected, the witness introduced. Its figures are painted with
// THE SUMMONING's kit (rite-paint.js); its lists are plain type — no
// geometry on data (design-language.md:473). A function of riteAt() only.

import { useEffect, useRef, useState } from 'react';
import { kitOf } from '../Summoning/summoning-paint.js';
import { paletteOf } from '../Summoning/SummoningCanvas.jsx';
import { paintThreshold } from './rite-paint.js';

const MAX_DPR = 2;

/**
 * @param {{ s: ReturnType<import('./rite-state.js').riteAt>, live?: boolean }} props
 *   live — a real ceremony (RiteCeremony): the covenant's and the vessel's own
 *   panels carry their lists, so only the figure and its caption are drawn
 */
export const RiteThreshold = ({ s, live = false }) => {
  const ref = useRef(null);
  const [palette, setPalette] = useState(null);
  const th = s.threshold;
  const shown = s.thresholdOpacity;

  // impure — the type must be loaded before the first mark
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => { if (live) setPalette(paletteOf()); });
    return () => { live = false; };
  }, []);

  // impure — paint the figures (only while the threshold can be seen)
  useEffect(() => {
    const el = ref.current;
    if (!palette || shown <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
    if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
    const ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    paintThreshold(kitOf(ctx, w, h, palette), th);
  }, [palette, th, shown]);

  if (shown <= 0) return null;
  const passed = th.checks.filter((c) => c.pass).length;
  const read = th.docs.filter((d) => d.read >= 1).length;
  const step = th.witness ? 'THE WITNESS' : passed ? 'THE VESSEL' : th.signed > 0 ? 'THE COVENANT · SIGNED' : 'THE COVENANT';
  const line = th.witness
    ? `${th.witness.toUpperCase()} WITNESSES · THE LENS IS THE PORTAL`
    : passed
      ? `${live ? '' : `${passed} / ${th.checks.length} CHECKS · `}THE VESSEL IS INSPECTED BEFORE THE VOID IS OPENED`
      : th.signed > 0
        ? 'TWO CIRCLES, EACH THROUGH THE OTHER\'S CENTRE · THE LENS STANDS √3 : 1'
        : `${read} / ${th.docs.length} BINDING DOCUMENTS READ TO THEIR END`;
  return (
    <div className="rite-threshold" style={{ opacity: shown }}>
      <canvas ref={ref} className="gen-canvas" />
      {live ? null : <section className="rite-list rite-list-left" aria-label="The binding documents">
        <span className="ba-inst-tag">THE COVENANT</span>
        {th.docs.map((d) => (
          <div key={d.title} className={`rite-row${d.read >= 1 ? ' is-done' : ''}`}>
            <span className="rite-row-k">{d.title}</span>
            <span className="rite-row-v">{d.read >= 1 ? 'READ' : d.read > 0 ? 'READING' : 'UNREAD'}</span>
          </div>
        ))}
        <div className={`rite-row${th.signed > 0 ? ' is-done' : ''}`}>
          <span className="rite-row-k">WITNESS SIGNATURE</span>
          <span className="rite-row-v">{th.signed > 0 ? 'SIGNED' : 'AWAITED'}</span>
        </div>
      </section>}
      {th.signed >= 1 && !live ? (
        <section className="rite-list rite-list-right" aria-label="The vessel">
          <span className="ba-inst-tag">THE VESSEL · {passed} / {th.checks.length}</span>
          {th.checks.map((c) => (
            <div key={c.name} className={`rite-row${c.pass ? ' is-done' : ''}`}>
              <span className="rite-row-k">{c.name}</span>
              <span className="rite-row-v">{c.pass ? 'PASS' : '—'}</span>
            </div>
          ))}
        </section>
      ) : null}
      <div className="gen-caption" key={step}>
        <span className="gen-caption-movement">I · THE THRESHOLD</span>
        <span className="gen-caption-title">{step}</span>
        <span className="gen-caption-line">{line}</span>
      </div>
    </div>
  );
};
