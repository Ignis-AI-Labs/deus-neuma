// OpeningField — the gateway's environment: THE ARMILLARY at rest, under the
// witness's hand. // impure
//
// The Deus Neuma logo as a 3D object (Armillary/armillary-stage.js) with its
// figures in light, inside the same panel THE IGNITION draws (its frame,
// graduations, inscription, the instruments' verdicts, the name) — in the
// same place (armillary-layout.js), so the startup yields onto it without a
// single element moving. Owned by AppShell above the phase machine.
//
// It answers the hand: it leans toward the pointer; a drag on it turns it
// about its axis (and lets it coast); reaching for the threshold charges it
// with the signal's light; a touch on the core sends a front through its
// figures. When the witness crosses, the camera dives into the core as the
// field exits. Reduced motion: one still frame, no loop.
import { useEffect, useRef, useState } from 'react';
import './OpeningField.css';
import { createArmillaryStage } from '../Armillary/armillary-stage.js';
import { ARMILLARY_REST, restingSpinOf } from '../Armillary/armillary-state.js';
import { armillaryLayoutOf } from '../Armillary/armillary-layout.js';
import { kitOf } from '../Summoning/summoning-paint.js';
import { paletteOf } from '../Summoning/SummoningCanvas.jsx';
import { ignitionAt } from '../Ignition/ignition-timeline.js';
import { paintIgnition } from '../Ignition/ignition-paint.js';
import { readIgnitionReport } from '../BootIgnition/ignition-report.js';
import { swellAt } from '../Ignition/ignition-energy.js';
import { OPENING_EVENTS } from './opening-events.js';

const MAX_DPR = 2;
const PRESENCE_MAX = 0.22; // radians — the pointer's pull
const DAMP = 3.2; // the hand's damping (1/s)
const DRAG_GAIN = 0.0085; // radians per px dragged
const COAST = 1.6; // how fast a released turn settles (1/s)
const PULSE_SPEED = 0.0016; // armillary units per ms (as the ignition's)
const DIVE_MS = 1000;

const damp = (from, to, dt) => from + (to - from) * (1 - Math.exp(-DAMP * dt));
const INTERACTIVE = 'button, a, input, select, textarea, [role="dialog"], .wallet-picker';

// pure — the report's verdicts as the panel reads them (each declared at 0)
const verdictsOf = (report) => (report ? Object.entries(report).map(([key, v]) => ({ key, state: v.state, text: v.text, at: 0 })) : []);

export const OpeningField = () => {
  const [on, setOn] = useState(false);
  const [pose, setPose] = useState('rest');
  const stageCanvasRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mountedAt = performance.now();
    let stage = null;
    try {
      stage = createArmillaryStage(stageCanvasRef.current);
      stageCanvasRef.current.dataset.armillary = 'on';
    } catch (err) {
      console.warn('The armillary could not wake in 3D (WebGL unavailable) — painting it flat:', err);
    }

    // the hand
    const hand = {
      px: 0, py: 0, // the pointer's pull, target
      presence: { x: 0, y: 0 },
      dragging: false, lastX: 0, moved: 0,
      turn: 0, velocity: 0, // the witness's own turn, and its coast
      chargeTarget: 0, charge: 0,
      pulses: [], flareAt: -Infinity,
      diveAt: null,
      // a startup above us hands the armillary over still; it turns once yielded
      turningFrom: document.querySelector('.ign-film') ? null : mountedAt,
    };
    let report = readIgnitionReport();
    let palette = null;
    let raf = null;
    let last = performance.now();

    const layout = () => armillaryLayoutOf(window.innerWidth, window.innerHeight);
    const portal = () => document.querySelector('.portal');
    const overMark = (x, y) => {
      const L = layout();
      return Math.hypot(x - L.cx, y - L.cy) <= L.mark * 1.25;
    };

    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const L = layout();
      document.documentElement.style.setProperty('--armillary-below', `${Math.round(L.belowY)}px`);

      // the hand, damped
      hand.presence.x = damp(hand.presence.x, hand.px, dt);
      hand.presence.y = damp(hand.presence.y, hand.py, dt);
      hand.charge = damp(hand.charge, hand.chargeTarget, dt);
      if (!hand.dragging) {
        hand.turn += hand.velocity * dt;
        hand.velocity *= Math.exp(-COAST * dt);
      }
      hand.pulses = hand.pulses.filter((at) => (now - at) * PULSE_SPEED < 1.5);
      const since = hand.turningFrom === null ? 0 : (now - hand.turningFrom) / 1000;
      const dive = hand.diveAt === null ? 0 : Math.min(1, (now - hand.diveAt) / DIVE_MS) ** 3;

      stage?.render({
        ...ARMILLARY_REST,
        t: now / 1000,
        spin: reduced ? 0 : restingSpinOf(since) + hand.turn,
        presence: reduced ? ARMILLARY_REST.presence : hand.presence,
        charge: hand.charge,
        flare: swellAt(now - hand.flareAt),
        pulses: hand.pulses.map((at) => (now - at) * PULSE_SPEED),
        dive,
      }, { w, h, cx: L.cx, cy: L.cy, markPx: L.mark });

      // the panel, at rest: the same plane the ignition painted, without its readouts
      const el = panelRef.current;
      if (el && palette) {
        if (!report) report = readIgnitionReport();
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
        if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
        const ctx = el.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const s = ignitionAt(reduced ? 1e7 : now - mountedAt, { verdicts: verdictsOf(report) });
        paintIgnition(kitOf(ctx, w, h, palette), s, { readouts: false, flatMark: !stage, subtitle: 'デウス・ネウマ' });
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    // impure — the hand's events
    const onMove = (e) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      hand.px = ((e.clientX / w) * 2 - 1) * PRESENCE_MAX;
      hand.py = ((e.clientY / h) * 2 - 1) * PRESENCE_MAX * 0.6;
      if (hand.dragging) {
        const dx = e.clientX - hand.lastX;
        hand.lastX = e.clientX;
        hand.moved += Math.abs(dx);
        hand.turn += dx * DRAG_GAIN;
        hand.velocity = dx * DRAG_GAIN * 60;
      }
      portal()?.classList.toggle('is-over-armillary', !hand.dragging && overMark(e.clientX, e.clientY) && !e.target.closest?.(INTERACTIVE));
    };
    const onDown = (e) => {
      if (e.button !== 0 || e.target.closest?.(INTERACTIVE) || !overMark(e.clientX, e.clientY)) return;
      hand.dragging = true;
      hand.lastX = e.clientX;
      hand.moved = 0;
      hand.velocity = 0;
      portal()?.classList.add('is-turning-armillary');
    };
    const onUp = (e) => {
      if (!hand.dragging) return;
      hand.dragging = false;
      portal()?.classList.remove('is-turning-armillary');
      // a touch, not a turn: a front runs out from the core
      if (hand.moved < 4) {
        const L = layout();
        if (Math.hypot(e.clientX - L.cx, e.clientY - L.cy) <= L.mark * 0.45) {
          hand.pulses.push(performance.now());
          hand.flareAt = performance.now();
        }
      }
    };
    const onOver = (e) => { if (e.target.closest?.('#portal-enter')) hand.chargeTarget = 1; };
    const onOut = (e) => {
      if (e.target.closest?.('#portal-enter') && !e.relatedTarget?.closest?.('#portal-enter')) hand.chargeTarget = 0;
    };
    const onYield = () => { if (hand.turningFrom === null) hand.turningFrom = performance.now(); };
    const onExit = () => {
      hand.diveAt = performance.now();
      hand.chargeTarget = 1;
      setPose('exiting');
    };
    const onResize = () => { if (reduced) frame(); };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    window.addEventListener(OPENING_EVENTS.IGNITION_DONE, onYield);
    window.addEventListener(OPENING_EVENTS.PORTAL_OPENING, onExit);
    window.addEventListener('resize', onResize);

    let live = true;
    document.fonts.ready.then(() => {
      if (!live) return;
      palette = paletteOf();
      if (reduced) frame();
    });
    if (!reduced) raf = requestAnimationFrame(frame);
    setOn(true);

    return () => {
      live = false;
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener(OPENING_EVENTS.IGNITION_DONE, onYield);
      window.removeEventListener(OPENING_EVENTS.PORTAL_OPENING, onExit);
      window.removeEventListener('resize', onResize);
      portal()?.classList.remove('is-over-armillary', 'is-turning-armillary');
      stage?.dispose();
    };
  }, []);

  return (
    <div className={`of${on ? ' on' : ''} mode-${pose}`} data-pose={pose}>
      <canvas className="of-canvas" ref={stageCanvasRef} aria-hidden="true" />
      <canvas className="of-canvas of-panel" ref={panelRef} aria-hidden="true" />
    </div>
  );
};

