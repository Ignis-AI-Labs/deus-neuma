// IgnitionSpecimen — THE IGNITION, the everyday startup, for Founder's review
// before it is wired (frontend/ignition.html, dev-only). Plays the real
// timeline and painter (ignition-timeline.js, ignition-paint.js) over a
// stand-in for the session beneath, in four situations: a returning witness
// landing on the desk, a new witness at the gateway, the platform down, and
// LIVE — the real instruments of this machine, read-only. Scrubbable; the
// cue sheet for sound is logged as it fires; SKIP opens at once.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kitOf } from '../Summoning/summoning-paint.js';
import { paletteOf } from '../Summoning/SummoningCanvas.jsx';
import { clockOf } from '../Genesis/genesis-timeline.js';
import { ignitionAt, shownAt, cuesOf, restingLeanOf, IGNITION } from './ignition-timeline.js';
import { paintIgnition, irisMaskOf } from './ignition-paint.js';
import { energyAt } from './ignition-energy.js';
import { createArmillaryStage } from '../Armillary/armillary-stage.js';
import { armillaryOfIgnition } from '../Armillary/armillary-state.js';
import { armillaryLayoutOf } from '../Armillary/armillary-layout.js';
import { genesisInscription } from '../Genesis/genesis-record.js';
import '../Genesis/GenesisSpecimen.css';
import '../Genesis/Genesis.css';
import './Ignition.css';

const MAX_DPR = 2;

// A situation: each instrument's true answer and when it arrives (ms).
const SITUATIONS = Object.freeze({
  returning: {
    label: 'RETURNING · THE DESK',
    beneath: 'THE DESK',
    answers: [
      { key: 'PLATFORM', state: 'ok', text: 'OK · 014 MS', arrives: 30 },
      { key: 'MEMORY', state: 'ok', text: 'ROSTER HELD', arrives: 5 },
      { key: 'PORTAL', state: 'bound', text: 'BOUND', arrives: 5 },
      { key: 'BEING', state: 'ok', text: 'ANCHORED', arrives: 1900 },
      { key: 'SESSION', state: 'ok', text: 'RESUMED', arrives: 2350 },
    ],
  },
  fresh: {
    label: 'NEW WITNESS · THE GATEWAY',
    beneath: 'THE GATEWAY',
    answers: [
      { key: 'PLATFORM', state: 'ok', text: 'OK · 011 MS', arrives: 25 },
      { key: 'MEMORY', state: 'empty', text: 'EMPTY', arrives: 5 },
      { key: 'PORTAL', state: 'standby', text: 'AWAITING IDENTITY', arrives: 5 },
    ],
  },
  down: {
    label: 'PLATFORM DOWN',
    beneath: 'THE GATEWAY',
    answers: [
      { key: 'PLATFORM', state: 'fail', text: 'NO ANSWER', arrives: 1500 },
      { key: 'MEMORY', state: 'ok', text: 'ROSTER HELD', arrives: 5 },
      { key: 'PORTAL', state: 'standby', text: 'AWAITING IDENTITY', arrives: 5 },
    ],
  },
});

// impure — this machine's own instruments, read-only (the platform's public
// liveness route, this browser's storage)
const liveAnswers = async () => {
  const t0 = performance.now();
  let platform;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/v1/health', { signal: ctrl.signal });
    clearTimeout(timer);
    const ms = Math.max(1, Math.round(performance.now() - t0));
    platform = res.ok ? { state: 'ok', text: `OK · ${String(ms).padStart(3, '0')} MS` } : { state: 'fail', text: 'NO ANSWER' };
  } catch {
    platform = { state: 'fail', text: 'NO ANSWER' };
  }
  const arrives = performance.now() - t0;
  const held = Boolean(localStorage.getItem('walletAddress'));
  return [
    { key: 'PLATFORM', ...platform, arrives },
    { key: 'MEMORY', state: held ? 'ok' : 'empty', text: held ? 'ROSTER HELD' : 'EMPTY', arrives: 5 },
    { key: 'PORTAL', state: sessionStorage.getItem('authToken') ? 'bound' : 'standby', text: sessionStorage.getItem('authToken') ? 'BOUND' : 'AWAITING IDENTITY', arrives: 5 },
  ];
};

// pure — the answers as the timeline reads them (each shown no earlier than its check)
const verdictsOf = (answers) => answers.map((a, i) => ({ key: a.key, state: a.state, text: a.text, at: shownAt(i, a.arrives), arrived: a.arrives }));

// impure — a stand-in genesis hash: this page's own, so its axis wakes from its own rest
const pageHash = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

// pure — a stand-in genesis record for this page's hash (its moment is the page's load)
const LOADED_AT = new Date().toISOString();
const genesisOf = (hash) => genesisInscription({ at: LOADED_AT, hash });

export const IgnitionSpecimen = () => {
  const ref = useRef(null);
  const layerRef = useRef(null);
  const stageCanvasRef = useRef(null);
  const stageRef = useRef(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [which, setWhich] = useState('returning');
  const [answers, setAnswers] = useState(SITUATIONS.returning.answers);
  const [skipAt, setSkipAt] = useState(null);
  // RAISED (2026-10-06): the rite's instrument language, beside the approved CURRENT for comparison
  const [raised, setRaised] = useState(() => new URLSearchParams(window.location.search).get('look') !== 'current');
  const [palette, setPalette] = useState(null);
  const [hash, setHash] = useState(pageHash);
  const [box, setBox] = useState({ w: 1, h: 1, dpr: 1 });
  const verdicts = useMemo(() => verdictsOf(answers), [answers]);
  const restingLean = useMemo(() => restingLeanOf(hash), [hash]);
  const genesis = useMemo(() => genesisOf(hash), [hash]);
  const s = ignitionAt(t, { verdicts, restingLean, skipAt });
  const length = (s.openAt ?? 4000) + IGNITION.OPEN_MS + 600;
  const cues = useMemo(() => cuesOf(verdicts, s.openAt).filter((c) => c.at <= t), [verdicts, s.openAt, t]);

  useEffect(() => {
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

  // impure — the canvas follows the window
  useEffect(() => {
    const fit = () => setBox({ w: window.innerWidth, h: window.innerHeight, dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR) });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // impure — paint
  useEffect(() => {
    const el = ref.current;
    if (!palette || !el) return;
    el.width = Math.round(box.w * box.dpr);
    el.height = Math.round(box.h * box.dpr);
    const ctx = el.getContext('2d');
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    const k = kitOf(ctx, box.w, box.h, palette);
    const L = armillaryLayoutOf(box.w, box.h);
    const yielding = beneath === 'THE GATEWAY';
    const e = energyAt(t, { verdicts, openAt: s.openAt });
    stageRef.current?.render(
      armillaryOfIgnition(s, yielding ? { ...e, dive: 0 } : e, t / 1000),
      { w: box.w, h: box.h, cx: L.cx, cy: L.cy, markPx: L.mark },
    );
    paintIgnition(k, s, { genesis, flatMark: !stageRef.current, raised });
    const layer = layerRef.current;
    const mask = yielding ? null : irisMaskOf(s, box.w, box.h, [L.cx, L.cy]);
    layer.style.maskImage = mask || 'none';
    layer.style.webkitMaskImage = mask || 'none';
    layer.style.opacity = yielding ? String(1 - s.open) : '1';
  });

  const seek = useCallback((next) => { tRef.current = Math.max(0, next); setT(tRef.current); }, []);

  // impure — the clock
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const next = tRef.current + (now - last);
      last = now;
      seek(next);
      if (next >= length) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, length, seek]);

  const run = async (key) => {
    setWhich(key);
    setSkipAt(null);
    setHash(pageHash());
    seek(0);
    setPlaying(true);
    if (key === 'live') {
      setAnswers((SITUATIONS.fresh.answers).map((a) => ({ ...a, arrives: Number.POSITIVE_INFINITY })));
      setAnswers(await liveAnswers());
    } else {
      setAnswers(SITUATIONS[key].answers);
    }
  };
  const beneath = which === 'live' ? (sessionStorage.getItem('authToken') ? 'THE DESK' : 'THE GATEWAY') : SITUATIONS[which].beneath;

  return (
    <div className="gen-root ign-root">
      <div className="ign-beneath" aria-hidden="true">
        <span>{beneath}</span>
        <small>THE SESSION BENEATH — ALREADY MOUNTED, WAITING</small>
      </div>
      <div ref={layerRef} className="ign-layer">
        <canvas ref={stageCanvasRef} className="gen-canvas" aria-hidden="true" />
        <canvas ref={ref} className="gen-canvas" style={{ width: box.w, height: box.h }} />
      </div>
      {raised ? null : (
        <aside className="gs-cues" aria-label="Cues fired">
          <span className="gs-label">SOUND · CUES FIRED</span>
          {[...cues].reverse().slice(0, 9).map((c) => (
            <span key={`${c.cue}-${c.at}`} className="gs-cue"><b>{c.cue}</b> {clockOf(c.at)}</span>
          ))}
        </aside>
      )}
      {s.openAt === null || t < s.openAt ? (
        <button type="button" className="ign-skip" onClick={() => setSkipAt(tRef.current)}>CLICK / ANY KEY — SKIP</button>
      ) : null}
      <footer className="gs-bar">
        <span className="gs-tag">SPECIMEN — THE IGNITION · {which === 'live' ? 'LIVE · THIS MACHINE' : SITUATIONS[which].label}</span>
        <button type="button" className="gs-btn" onClick={() => run(which)}>FROM THE TOP</button>
        <button type="button" className={`gs-btn${raised ? ' is-on' : ''}`} onClick={() => setRaised((r) => !r)} aria-pressed={raised}>{raised ? 'RAISED' : 'CURRENT'}</button>
        <button type="button" className="gs-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'PAUSE' : 'PLAY'}</button>
        <span className="gs-time">{clockOf(t)} / {clockOf(length)}</span>
        <div className="gs-scrub">
          <input type="range" className="gs-range" min={0} max={Math.ceil(length / 10) * 10} step={10} value={Math.min(t, length)}
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} aria-label="Ignition time" />
        </div>
        {[...Object.keys(SITUATIONS), 'live'].map((key) => (
          <button type="button" key={key} className={`gs-btn${which === key ? ' is-on' : ''}`} onClick={() => run(key)}>
            {key === 'live' ? 'LIVE' : SITUATIONS[key].label.split(' · ')[0]}
          </button>
        ))}
      </footer>
    </div>
  );
};
