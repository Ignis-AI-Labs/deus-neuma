// Ignition — THE IGNITION, every startup after GENESIS. // impure
//
// Design note, 2026-10-03, on its specimen: […]
// The pure timeline and painter are the specimen's own (ignition-timeline.js,
// ignition-paint.js); this is the boundary: the clock, the real instruments
// (BootIgnition/boot-probes.js — the platform's liveness, this desk's memory,
// the portal's binding, and on desk entry the Arrival's being and session),
// the report the gateway reads, and the skip. It rides ABOVE the destination
// already mounted beneath it (AppShell); when the still point has opened, it
// is done. Skippable from the first instant by a deliberate gesture — a click
// or a fresh key (a held key's autorepeat is never a gesture).
//
// Beneath its painted plane, THE ARMILLARY — the Deus Neuma logo as a 3D
// object (Armillary/armillary-stage.js) — wakes, and the instruments' light
// runs through its figures (ignition-energy.js). Onto the gateway it ends by
// yielding: the gateway rests on the very same armillary in the very same
// place (armillary-layout.js), so nothing moves but the panel's readouts.
// Onto the desk the camera dives into the core as the still point opens. No
// WebGL paints the armillary flat instead, honestly logged, never fatal.

import { useEffect, useRef, useState } from 'react';
import { kitOf } from '../Summoning/summoning-paint.js';
import { paletteOf } from '../Summoning/SummoningCanvas.jsx';
import { ignitionAt, shownAt, restingLeanOf, cuesOf } from './ignition-timeline.js';
import { paintIgnition, irisMaskOf } from './ignition-paint.js';
import { energyAt } from './ignition-energy.js';
import { createArmillaryStage } from '../Armillary/armillary-stage.js';
import { armillaryOfIgnition } from '../Armillary/armillary-state.js';
import { armillaryLayoutOf } from '../Armillary/armillary-layout.js';
import { genesisInscription } from '../Genesis/genesis-record.js';
import { probePlatform, probeMemory, probePortal } from '../BootIgnition/boot-probes.js';
import { platformRow, memoryRow, portalRow, arrivalRow, ARRIVAL_ROW_CEILING_MS, ROW_STATE } from '../BootIgnition/boot-sequence.js';
import { writeIgnitionReport } from '../BootIgnition/ignition-report.js';
import { OPENING_EVENTS } from '../Opening/opening-events.js';
import { lastArrival } from '../Opening/opening-state.js';
import { isArrivalSeen } from '../../utils/arrival-flag.js';
import { rememberedGenesis } from '../Genesis/genesis-gate.js';
import { playSound, primeSound } from '../../services/sound-engine.js';
import '../Genesis/Genesis.css';
import './Ignition.css';

const MAX_DPR = 2;
// THE IGNITION RAISED to the rite's instrument language (2026-10-06, Founder: […]):
// its columns, timed answers, burst ring and measure (ignition-panels.js).
// false restores the 10-03 approved look exactly.
const RAISED = true;

// impure — does the desk's Arrival run beneath (desk entry, first time this
// window session)? Then its being and session are this ignition's last instruments.
const arrivalBeneath = (destination) => {
  if (destination !== 'relink') return false;
  try { return !isArrivalSeen(localStorage.getItem('walletAddress')); } catch { return false; }
};

// impure — an Arrival instrument's verdict once its real stage proves it, or NO ANSWER at the ceiling
const arrivalProbe = (key) => new Promise((resolve) => {
  let done = false;
  const finish = (verdict) => {
    if (done) return;
    done = true;
    window.removeEventListener(OPENING_EVENTS.ARRIVAL, onStage);
    clearTimeout(ceiling);
    resolve(verdict);
  };
  const onStage = () => { const v = arrivalRow(key, lastArrival()); if (v) finish(v); };
  const ceiling = setTimeout(() => finish({ state: ROW_STATE.FAIL, text: 'NO ANSWER' }), ARRIVAL_ROW_CEILING_MS);
  window.addEventListener(OPENING_EVENTS.ARRIVAL, onStage);
  onStage();
});

// The instruments, in order: what each truly measures, and the gateway's report key.
const instrumentsFor = (destination) => [
  { key: 'PLATFORM', report: 'PLATFORM', probe: () => probePlatform().then(platformRow) },
  { key: 'MEMORY', report: 'MEMORY', probe: async () => memoryRow(probeMemory()) },
  { key: 'PORTAL', report: 'PORTAL', probe: async () => portalRow(probePortal()) },
  ...(arrivalBeneath(destination) ? [
    { key: 'BEING', report: 'BEING', probe: () => arrivalProbe('BEING') },
    { key: 'SESSION', report: 'SESSION', probe: () => arrivalProbe('SESSION') },
  ] : []),
];

// Until Founder's own sound for THE IGNITION, its cues borrow the desk's (opt-in,
// as all sound is): a verdict ticks, the opening arrives. Each fires from the
// frame that paints it, so sound and picture share one clock.
const SOUND_OF = (cue) => (cue.startsWith('VERDICT') ? 'deliberationTick' : cue === 'OPEN' ? 'noticeArrival' : null);

// The first-paint veil (index.html) is the void this ignition begins from.
const liftVeil = () => document.getElementById('first-paint-veil')?.remove();

// pure — the inscription the panel carries for this install's genesis
// (nothing, honestly, without one)
const genesisOf = (record) => {
  try {
    return record ? genesisInscription(record) : null;
  } catch {
    return null;
  }
};

export const Ignition = ({ onDone, destination = null }) => {
  const ref = useRef(null);
  const rootRef = useRef(null);
  const stageCanvasRef = useRef(null);
  const stageRef = useRef(null);
  const t0 = useRef(performance.now());
  const doneRef = useRef(false);
  const [instruments] = useState(() => instrumentsFor(destination));
  const [verdicts, setVerdicts] = useState(() => instruments.map((i) => ({ key: i.key, state: null, text: null, at: null })));
  const [skipAt, setSkipAt] = useState(null);
  const [palette, setPalette] = useState(null);
  const [restingLean] = useState(() => restingLeanOf(rememberedGenesis()?.hash));
  const [genesis] = useState(() => genesisOf(rememberedGenesis()));
  const verdictsRef = useRef(verdicts);
  verdictsRef.current = verdicts;

  // impure — the void is ours from the first frame; the face is loaded before the first word
  useEffect(() => {
    liftVeil();
    primeSound();
    let live = true;
    document.fonts.ready.then(() => { if (live) setPalette(paletteOf()); });
    try {
      stageRef.current = createArmillaryStage(stageCanvasRef.current);
    } catch (err) {
      console.warn('The armillary could not wake in 3D (WebGL unavailable) — painting it flat:', err);
    }
    return () => {
      live = false;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  // impure — the real instruments, each declaring when it truly answers
  useEffect(() => {
    let live = true;
    instruments.forEach((inst, i) => {
      inst.probe().catch(() => ({ state: ROW_STATE.FAIL, text: 'NO ANSWER' })).then((row) => {
        if (!live) return;
        const arrived = performance.now() - t0.current;
        const at = shownAt(i, arrived);
        setVerdicts((vs) => vs.map((v, k) => (k === i ? { key: v.key, state: row.state, text: row.text, at, arrived } : v)));
      });
    });
    return () => { live = false; };
  }, [instruments]);

  // impure — a deliberate gesture skips: a click, or a fresh key
  useEffect(() => {
    const skip = (e) => {
      if (e?.repeat || doneRef.current) return;
      setSkipAt((s) => s ?? performance.now() - t0.current);
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  // impure — the clock and the paint, until the still point has opened
  useEffect(() => {
    if (!palette) return undefined;
    let raf;
    let reported = false;
    let heardUpTo = performance.now() - t0.current;
    const frame = () => {
      const el = ref.current;
      if (!el) return;
      const t = performance.now() - t0.current;
      const s = ignitionAt(t, { verdicts: verdictsRef.current, restingLean, skipAt });
      cuesOf(verdictsRef.current, s.openAt).forEach((c) => {
        const sound = c.at > heardUpTo && c.at <= t ? SOUND_OF(c.cue) : null;
        if (sound) playSound(sound);
      });
      heardUpTo = t;
      if (s.openAt !== null && t >= s.openAt && !reported) {
        // the gateway's strip reports what truly declared, under the keys it reads
        reported = true;
        writeIgnitionReport(Object.fromEntries(instruments
          .map((inst, i) => [inst.report, verdictsRef.current[i]])
          .filter(([, v]) => v.state)
          .map(([k, v]) => [k, { state: v.state, text: v.text }])));
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
      if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
      const ctx = el.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = kitOf(ctx, w, h, palette);
      const L = armillaryLayoutOf(w, h);
      // onto the gateway the film yields in place; onto the desk it dives and opens
      const yielding = destination === 'gateway';
      const e = energyAt(t, { verdicts: verdictsRef.current, openAt: s.openAt });
      stageRef.current?.render(
        armillaryOfIgnition(s, yielding ? { ...e, dive: 0 } : e, performance.now() / 1000),
        { w, h, cx: L.cx, cy: L.cy, markPx: L.mark },
      );
      paintIgnition(k, s, { genesis, flatMark: !stageRef.current, raised: RAISED });
      const root = rootRef.current;
      if (root && s.open > 0) {
        if (yielding) {
          root.style.opacity = String(1 - s.open);
        } else {
          const mask = irisMaskOf(s, w, h, [L.cx, L.cy]);
          root.style.maskImage = mask;
          root.style.webkitMaskImage = mask;
        }
      }
      if (s.done) {
        if (!doneRef.current) {
          doneRef.current = true;
          window.dispatchEvent(new CustomEvent(OPENING_EVENTS.IGNITION_DONE));
          onDone();
        }
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [palette, instruments, restingLean, genesis, skipAt, onDone, destination]);

  return (
    <div ref={rootRef} className="gen-root ign-film" data-ignition={skipAt === null ? 'playing' : 'skipped'}>
      <canvas ref={stageCanvasRef} className="gen-canvas" aria-hidden="true" />
      <canvas ref={ref} className="gen-canvas" />
      <span className="ign-hint">CLICK / ANY KEY — SKIP</span>
    </div>
  );
};
